// The VIK server, as a module: the studio page and its API (the agents), /voice (the local engine), /brain and
// /events (the hub). Used by the Electron app (electron/main.cjs) and by the command line (src/server.mjs).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname, extname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.mjs';
import { Session, SESSION_DEFAULTS, voiceParamsOf } from './session.mjs';
import { createHub } from './hub.mjs';
import { createFarmFinder } from './farm.mjs';
import { remoteGenerate, remoteModels } from './llm.mjs';
import { createAgentStore } from './agent/agents.mjs';
import { createDecider } from './agent/decide.mjs';
import { wordsMatcher } from './agent/matcher.mjs';
import { handleApi } from './api.mjs';
import { mutex, progressText, createLeveler } from './util.mjs';
import { createZonosVoice, withZonos } from './engines/zonos.mjs';
import { createZonosFiles } from './engines/zonos-files.mjs';
import { createPeople, voiced, ENROL_SECONDS, MIN_SECONDS } from './speakers/speakers.mjs';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
/** This version of VIK (app/package.json). */
export const VERSION = String(JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version || '');

/** The pages allowed to open a conversation. An entry ending in * is a prefix. */
export const DEFAULT_ORIGINS = ['https://cables.gl', 'https://sandbox.cables.gl', 'https://dev.cables.gl', 'http://localhost:*', 'http://127.0.0.1:*', 'cables:*', 'file:*', 'https://editor.p5js.org', 'https://preview.p5js.org'];
export function originAllowed(list, origin) {
  const l = Array.isArray(list) && list.length ? list : DEFAULT_ORIGINS;
  if (!origin) return true;                          // not a browser (local tool, test)
  if (l.includes('*')) return true;
  return l.some((x) => origin === x || (x.endsWith('*') && origin.startsWith(x.slice(0, -1))));
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8' };

/**
 * Starts the server. Tries the requested port, then the next ones if it is taken (up to +9).
 * @param {{config: any, mock?: boolean, port?: number, host?: string, log?: (m: string) => void,
 *   onStatus?: (s: {text: string, progress: number|null}) => void,
 *   agentsDir?: string, legacyDirs?: string[], peopleFile?: string}} o
 *   agentsDir: where the agents live (default: a new temporary folder, with the examples: for the tests);
 *   peopleFile: before 3.8, the people of this computer (one file): copied into each agent once, then renamed;
 *   legacyDirs: folders of persona JSON files from earlier versions, imported on first launch.
 * @returns {Promise<{port: number, url: string, wsUrl: string, engineName: () => string|null, ready: Promise<void>, close: () => Promise<void>}>}
 */
export async function startServer(o) {
  const config = o.config;
  const log = o.log || ((m) => console.log(`[${new Date().toLocaleTimeString('en-GB')}] ${m}`));
  const host = String(o.host || config.host || '127.0.0.1');
  const wanted = Number(o.port || config.port || 8790);
  const store = createAgentStore({
    dir: o.agentsDir || mkdtempSync(join(tmpdir(), 'vik-agents-')),
    examples: join(APP_DIR, 'agents'),
    legacy: o.legacyDirs || [],
    log,
  });
  // the decision model: the engine's embedding model when it is loaded, the words matcher otherwise
  const words = wordsMatcher();
  const decider = createDecider({ store, matcher: () => (engine && engine.matcher && engine.matcher()) || words, log });

  let engine = null;
  let engineError = null;        // no engine at all (SDK missing): every conversation fails
  let warmupError = null;        // the engine is there but the warm-up failed: each Start tries again
  let warm = 'loading';
  let lastStatus = { text: 'Starting…', progress: null };
  const prepareLock = mutex();
  const zonosConfig = ((config.models || {}).tts || {}).zonos || {};
  const zonosFiles = createZonosFiles(zonosConfig, APP_DIR, log);   // the in-browser engine and its model, for the window
  const zonos = createZonosVoice(zonosConfig, log, { downloading: () => zonosFiles.downloading() });
  const sessions = new Set();
  const hub = createHub(log);
  const farms = createFarmFinder(log);
  // the people recognized by their voice (Settings → People): each agent's own (its people.json), since 3.8
  const peopleStores = new Map();
  /** The people an agent recognizes; null for no agent (strict: an error instead, for the API). */
  function peopleFor(id, strict = false) {
    try {
      const file = store.peopleFile(String(id || ''));
      if (!peopleStores.has(file)) peopleStores.set(file, createPeople({ file, log }));
      return peopleStores.get(file);
    } catch (e) { if (strict) throw e; return null; }
  }
  // before 3.8 they were this computer's (one people.json): each agent gets a copy, once, so that nobody is lost
  if (o.peopleFile && existsSync(o.peopleFile)) {
    try {
      const old = JSON.parse(readFileSync(o.peopleFile, 'utf8'));
      if (old && Array.isArray(old.people) && old.people.length) {
        for (const a of store.list()) { const f = store.peopleFile(a.id); if (!existsSync(f)) writeFileSync(f, `${JSON.stringify(old)}\n`); }
        log(`▸ people: the ${old.people.length} people recorded on this computer now belong to each agent (Settings → People)`);
      }
      renameSync(o.peopleFile, `${o.peopleFile}.before-3.8`);
    } catch (e) { log(`(people of this computer: ${e.message})`); }
  }
  /** Chatterbox's recording of a voice to clone, as a file for the engine (the agent's voices/<name>.wav). */
  const withReference = (s) => {
    const p = s && s.referenceAudio ? store.voiceAudioPath(String(s.agent || ''), String(s.referenceAudio)) : '';
    return p ? { ...s, referenceAudioPath: p } : s;
  };
  const status = (text, progress) => {
    lastStatus = { text, progress: progress == null ? null : progress };
    for (const s of sessions) s.status(text, progress);
    if (o.onStatus) o.onStatus({ text, progress: progress == null ? null : progress });
  };

  function logError(e) {
    log(`✖ ${e.message}`);
    // QVAC's worker did not start: its own reason (exit code, what it wrote) is in the cause
    if (e.cause && e.cause.message) log(`  ${e.cause.message}${e.cause.stderrTail ? `\n${String(e.cause.stderrTail).slice(-1500)}` : ''}`);
  }

  async function boot() {
    try {
      if (o.mock) {
        const { createMockEngine } = await import('./engines/mock.mjs');
        engine = await createMockEngine(config, log);
      } else {
        const { createQvacEngine } = await import('./engines/qvac.mjs');
        engine = await createQvacEngine(config, log);
      }
      // the Zonos voice (setting localVoiceEngine 'zonos'): an extra voice around either engine, see engines/zonos.mjs
      engine = withZonos(engine, zonos, log);
      log(`▸ engine: ${engine.name === 'mock' ? 'SIMULATED (no models)' : 'QVAC'}`);
    } catch (e) {
      engineError = e;
      warm = 'error';
      logError(e);
      status(`Error: ${e.message}`, null);
      for (const s of sessions) s.fatal(e);
      return;
    }
    // A failed warm-up (a blocked download, a slow first start of QVAC's worker) is not final:
    // the next Start loads again, and the models can still be downloaded (Files → Download all models).
    if (config.warmup !== false) {
      try {
        await prepareLock(() => engine.prepare(config.defaults || {}, (p) => status(progressText(p), p.progress)));
      } catch (e) {
        warmupError = e;
        logError(e);
      }
    }
    warm = 'ready';
    status('', null);
    if (!warmupError) log('▸ models ready.');
  }

  function json(res, code, o) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); }
  function readJson(req) {
    return new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => { b += c; if (b.length > 100000) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }
  function sendFile(res, file) {
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  }
  /** The shared core: the repository copy during development, otherwise the one that travels with the app. */
  function coreFile() {
    const dev = join(APP_DIR, '..', 'common', 'voice-core.js');
    return existsSync(dev) ? dev : join(APP_DIR, 'public', 'voice-core.js');
  }
  /**
   * A request from the studio's own page (or a tool, not a browser). Another website must not read or change
   * the agents, nor make this computer probe addresses: browsers say where a request comes from.
   */
  function samePage(req) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.headers.origin;
    return !origin || ownOrigin(origin);
  }

  /**
   * A request named for this computer (127.0.0.1, localhost). A web page whose name was pointed at this computer
   * (DNS rebinding) is "same-origin" for the browser but keeps its own name in the Host header: refused. When the
   * server listens on the network ("host" in config.json), any name.
   */
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  function hostAllowed(req) {
    if (!loopback) return true;
    const h = String(req.headers.host || '').toLowerCase();
    return [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`].includes(h);
  }

  /**
   * A request that comes from this computer itself. When the server listens on the network ("host" in config.json,
   * for clients on other computers), those computers get what a client gets: the conversation's events (/events),
   * the pages and /health. The agents, the people, the conversation itself (/voice), the hub's brain and the Zonos
   * bridge stay this computer's: a program elsewhere on the network does not say where it comes from, so nothing
   * else would tell it from the studio.
   */
  const localPeer = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String((req.socket && req.socket.remoteAddress) || ''));
  const ownOnly = (path) => path.startsWith('/api/') || path.startsWith('/zonos/') || path === '/farms' || path === '/models';

  const server = createServer((req, res) => {
    if (!hostAllowed(req)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Use http://127.0.0.1 or http://localhost'); return; }
    let path;
    try { path = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); res.end('Invalid address'); return; }
    if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (ownOnly(path) && !localPeer(req)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Only from the computer VIK runs on'); return; }
    if (path === '/' || path === '/index.html') return sendFile(res, join(APP_DIR, 'public', 'index.html'));
    if (path === '/voice-core.js') return sendFile(res, coreFile());
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      const error = engineError ? engineError.message : warmupError ? `${warmupError.message} (Click Start to try again.)` : null;
      const m = engine && engine.matcher ? engine.matcher() : null;
      res.end(JSON.stringify({ engine: engine ? engine.name : null, models: warm, error, port: actualPort, status: lastStatus, wsUrl, matcher: m ? m.name : 'Words', matcherModel: !!m,
        // the agents folder (its path holds the account's name): for the studio's own page, not for any website
        ...(samePage(req) && !req.headers.origin && localPeer(req) ? { agentsDir: store.dir } : {}) }));
      return;
    }
    if ((path.startsWith('/api/') || path === '/farms') && !samePage(req)) { res.writeHead(403); res.end(); return; }
    // the models a farm or a service offers: {url, key} → [ids] (POST: the key stays out of the address)
    if (path === '/api/llm/models' && req.method === 'POST') {
      readJson(req).then((q) => remoteModels(q)).then((models) => json(res, 200, { models }), (e) => json(res, 200, { error: e.message, models: [] }));
      return;
    }
    // the Zonos voice for the studio: can it speak, its voices, its design sliders, and whether its engine is here
    if (path === '/api/voice/zonos' && req.method === 'GET') {
      zonos.probe(new URL(req.url || '/', 'http://x').searchParams.has('fresh')).then(() => json(res, 200, { ...zonos.describe(), engineFiles: zonosFiles.enginePresent(), modelPresent: zonosFiles.modelPresent() }))
        .catch((e) => { log(`✖ Zonos voice: ${e.message}`); json(res, 200, { mode: zonos.mode, host: null, available: false, url: zonos.url, error: e.message, voices: [], sliders: [], engineFiles: zonosFiles.enginePresent() }); });
      return;
    }
    // its in-browser engine and its model (downloaded once), for the studio's own page only: another website
    // must not make this computer download a model
    if (path.startsWith('/zonos/')) {
      if (!samePage(req)) { res.writeHead(403); res.end(); return; }
      if (zonosFiles.handle(req, res, path)) return;
    }
    if (path.startsWith('/api/people') && handlePeople(req, res, path)) return;
    const va = /^\/api\/agents\/([a-z0-9][a-z0-9-]{0,63})\/voice-audio$/.exec(path);
    if (va && req.method === 'POST') { saveVoiceAudio(req, res, va[1]); return; }
    if (path.startsWith('/api/updates') && handleUpdates(req, res, path)) return;
    if (path.startsWith('/api/folder') && handleFolder(req, res, path)) return;
    if (path === '/api/prepare' && req.method === 'POST') { readJson(req).then(prepareFor).then((o) => json(res, 200, o), (e) => json(res, 200, { error: e.message })); return; }
    if (path === '/api/voice/test' && req.method === 'POST') { readJson(req).then((q) => testVoice(q, res)).catch((e) => { if (!res.headersSent) json(res, 400, { error: e.message }); }); return; }
    if (handleApi(req, res, path, { store, decide: decideForStudio })) return;
    // The models offered for listening and thinking (config.json "choices"), and whether each is on this computer.
    if (path === '/models') {
      waitEngine().then(() => (engine.choices ? engine.choices() : null), () => null).then((c) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(c || { asr: [], llm: [] }));
      });
      return;
    }
    // The LLM farms on the network (?add=<address>: one the beacon does not reach). The app's page only:
    // another website must not make this computer probe addresses.
    if (path === '/farms') {
      const add = new URL(req.url || '/', 'http://x').searchParams.get('add');
      const reply = (o) => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ farms: farms.list(), ...o })); };
      if (!add) return reply({});
      farms.add(add).then((id) => reply({ added: id }), (e) => reply({ error: e.message }));
      return;
    }
    if (path.startsWith('/public/')) {
      const file = join(APP_DIR, 'public', path.slice('/public/'.length));
      if (!file.startsWith(join(APP_DIR, 'public'))) { res.writeHead(403); res.end(); return; }
      return sendFile(res, file);
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  // /voice: the studio's audio (local engine). /brain: the studio publishes to the hub. Only the
  // app's own page may use them, so no website can take over the conversation or pose as the agent.
  // /events: the clients (cables, p5.js, pages).
  const ownOrigin = (origin) => [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`].includes(origin);
  const sockets = attachWebSocket(server, {
    path: /^\/(voice|brain|events|zonos)$/,
    // another computer (the server listening on the network) may follow the conversation, nothing more
    allowRequest: (req) => hostAllowed(req) && ((req.url || '').split('?')[0] === '/events' || localPeer(req)),
    allowOrigin: (origin, path) => {
      const ok = path === '/events' ? originAllowed(config.allowedOrigins, origin) : !origin || ownOrigin(origin);
      if (!ok) log(`✖ refused a connection to ${path} from the page ${origin}${path === '/events' ? ' (not in "allowedOrigins", config.json)' : ''}`);
      return ok;
    },
    onConnection(ws, req) {
      const path = (req.url || '').split('?')[0];
      if (path === '/brain') return hub.brain(ws);
      if (path === '/events') return hub.client(ws);
      if (path === '/zonos') return zonos.attach(ws);     // the studio's window, running the Zonos engine
      // One conversation at a time: the models run on this machine, for one person.
      for (const s of sessions) { s.error('replaced', 'Another page opened a conversation, so this one is stopping.'); s.close('replaced'); }
      const session = new Session(ws, {
        info: () => (engine ? engine.info() : {}),
        prepare: async (s, p) => { await waitEngine(); await engine.prepare(withReference(s), p); warmupError = null; },
        openAsr: (x, cb) => engine.openAsr(x, cb),
        // an LLM farm or a service chosen (llm): the reply comes from it, the rest stays on this computer
        generate: (x) => (x.remote ? remoteGenerate({ ...x, maxTokens: config.models.llm.maxTokens || 320 }) : engine.generate(x)),
        speak: (x) => engine.speak(x),
        decider,
        newConversation: () => { if (engine && engine.newConversation) engine.newConversation(); },
        smartTurn: () => getSmartTurn(),
        peopleFor,                                 // Settings → People: who the agent recognizes by their voice
        speakerModel: () => getSpeakers(),
      }, prepareLock, log);
      sessions.add(session);
      ws.on('close', () => sessions.delete(session));
      if (engineError) session.fatal(engineError);
      else if (warm !== 'ready') session.status('Loading the models… (the first launch downloads about 1.5 GB)', null);
    },
  });

  /** The studio's test field: what the agent would decide (POST /api/decide {agent, text, stage, focus}). */
  async function decideForStudio(q) {
    await waitEngine().catch(() => {});
    const d = await decider.decide(String(q.agent || ''), String(q.text || '').slice(0, 2000), { stage: q.stage, focus: q.focus });
    const { then, entryCells, knowledge, ...shown } = d;
    return { ...shown, then, knowledge: knowledge.map((e) => ({ table: e.table, key: e.key })) };
  }

  async function waitEngine() {
    while (!engine && !engineError) await new Promise((r) => setTimeout(r, 100));
    if (engineError) throw engineError;
  }

  // Smart Turn (end-of-turn model): created the first time a session asks for it (turnDetection 'smart'),
  // then shared. Its module, and the optional onnxruntime-node runtime, are only imported at that moment.
  let smartTurn = null;
  function getSmartTurn() {
    if (!smartTurn) {
      smartTurn = (async () => {
        const c = (config.turn && config.turn.smartTurn) || {};
        const model = String(c.model || 'models/smart-turn-v3.2-cpu.onnx');
        const { createSmartTurn } = await import('./turn/smart-turn.mjs');
        return createSmartTurn({
          modelPath: isAbsolute(model) ? model : join(APP_DIR, model),
          threads: Number(c.threads) || 1,
          threshold: c.threshold == null ? 0.5 : Number(c.threshold),
          log,
        });
      })();
    }
    return smartTurn;
  }

  // The speaker model (who is speaking): loaded the first time it is needed, then shared, like Smart Turn.
  let speakers = null;
  function getSpeakers() {
    if (!speakers) {
      speakers = (async () => {
        const c = config.speakers || {};
        const model = String(c.model || 'models/campplus-voxceleb.onnx');
        const { createSpeakerModel } = await import('./speakers/speakers.mjs');
        return createSpeakerModel({ modelPath: isAbsolute(model) ? model : join(APP_DIR, model), threads: Number(c.threads) || 1, log });
      })();
    }
    return speakers;
  }

  /** Settings → People: the voice read by someone (16-bit PCM, 16 kHz), as {audio, seconds of voice}. */
  function readVoice(req) {
    return new Promise((resolve, reject) => {
      const parts = []; let n = 0;
      req.on('data', (c) => { n += c.length; if (n > 16000 * 2 * 60) { req.destroy(); reject(new Error('More than a minute of sound.')); } else parts.push(c); });
      req.on('end', () => {
        const b = Buffer.concat(parts);
        const a = new Float32Array(b.length >> 1);
        for (let i = 0; i < a.length; i++) a[i] = b.readInt16LE(i * 2) / 32768;
        resolve(voiced(a));
      });
      req.on('error', reject);
    });
  }
  async function voiceprint(req, least) {
    const model = await getSpeakers();
    if (!(await model.ready())) throw new Error('Recognizing people is unavailable on this computer (see the log).');
    const v = await readVoice(req);
    if (v.seconds < least) throw new Error(`Only ${v.seconds.toFixed(1)} s of voice were heard: ${least >= ENROL_SECONDS ? 'read the whole text, close to the microphone' : 'speak a little longer'}.`);
    return { print: await model.embed(v.audio), seconds: v.seconds };
  }
  /**
   * The studio prepares the models of the agent it shows (POST /api/prepare {settings}): its language, its voice,
   * its language model are loaded before Start, which then starts at once. Not while a conversation runs: its
   * models are in use.
   */
  async function prepareFor(q) {
    if (sessions.size) return { skipped: 'a conversation is running' };
    await waitEngine();
    const s = { ...SESSION_DEFAULTS, ...((q && q.settings) || {}) };
    await prepareLock(() => engine.prepare(withReference(s), (p) => status(progressText(p), p.progress)));
    status('', null);
    return { ok: true };
  }

  /**
   * Voice & timing → Listen (POST /api/voice/test {settings, language, text}): the text typed (or a sample
   * sentence) in this voice, as a WAV, without a conversation (one running uses the voice model: it would be taken
   * from it).
   */
  const SAMPLES = {
    en: 'Hello! This is how I sound. Do you like my voice?',
    fr: 'Bonjour ! Voici ma voix. Est-ce qu\'elle te plaît ?',
  };
  async function testVoice(q, res) {
    if (sessions.size) throw new Error('Stop the conversation to listen to a voice: the conversation uses the voice.');
    await waitEngine();
    const language = Object.hasOwn(SAMPLES, q && q.language) ? q.language : 'en';
    const s = { ...SESSION_DEFAULTS, ...((q && q.settings) || {}), language };
    // the voice alone: listening in English to a French agent must not reload its speech recognition (a reload on a
    // full graphics card can fail) nor its language model
    await prepareLock(() => engine.prepare(withReference(s), (p) => status(progressText(p), p.progress), { voiceOnly: true }));
    status('', null);
    const tts = engine.speak(voiceParamsOf(s));
    tts.write(String((q && q.text) || '').replace(/\s+/g, ' ').trim().slice(0, 400) || SAMPLES[language]);
    tts.end();
    const parts = []; let rate = 24000; let n = 0;
    const level = createLeveler();                   // as in a conversation: the voice at a steady level
    for await (const f of tts.frames) { rate = f.sampleRate || rate; const p = level(f.pcm, rate, !!f.text); parts.push(p); n += p.length; }
    if (!n) throw new Error('The voice said nothing.');
    const wav = Buffer.alloc(44 + n * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
    let o = 44;
    for (const p of parts) { Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(wav, o); o += p.byteLength; }
    res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' });
    res.end(wav);
  }

  /**
   * The Updates window (app/public/js/updates.js): GET /api/updates (the state of app/electron/updates.cjs),
   * POST /api/updates/check, POST /api/updates/install (Windows: restart into the new version). Without the app
   * (the server alone, from the source code): this version, nothing to check.
   */
  /**
   * Settings → VIK folder (app/electron/folder.cjs, through the app): GET /api/folder (where the agents, the people
   * and the models are; a move in progress), POST /api/folder/choose (the app asks for a folder), POST
   * /api/folder/move {dir, asIs}. Without the app (the server alone): where they are, not movable from here.
   */
  function handleFolder(req, res, path) {
    const f = typeof o.folder === 'function' ? o.folder() : null;
    if (path === '/api/folder' && req.method === 'GET') {
      json(res, 200, f ? f.state() : { movable: false, dir: '', agents: store.dir, people: o.peopleFile || '', models: '', holds: null, moving: null });
      return true;
    }
    if (!f) { if (path.startsWith('/api/folder/')) { json(res, 400, { error: 'The VIK folder is moved from the VIK app (here: --agents, VIK_AGENTS).' }); return true; } return false; }
    if (path === '/api/folder/choose' && req.method === 'POST') { f.choose().then((r) => json(res, 200, r), (e) => json(res, 400, { error: e.message })); return true; }
    if (path === '/api/folder/move' && req.method === 'POST') {
      readJson(req).then((q) => {
        if (sessions.size) throw new Error('Stop the conversation first: VIK restarts in its new folder.');
        return f.move(String((q && q.dir) || ''), { asIs: !!(q && q.asIs) });
      }).then((r) => json(res, 200, { moving: r }), (e) => json(res, 400, { error: e.message }));
      return true;
    }
    return false;
  }

  function handleUpdates(req, res, path) {
    const u = typeof o.updates === 'function' ? o.updates() : null;
    const state = () => (u ? u.state() : { version: VERSION, mode: 'none', status: 'source', latest: '', page: 'https://github.com/b2renger/voice-interaction-kit/releases/latest', error: '', checkedAt: 0 });
    if (path === '/api/updates' && req.method === 'GET') { json(res, 200, state()); return true; }
    if (path === '/api/updates/check' && req.method === 'POST') { if (u) u.check(); json(res, 200, state()); return true; }
    if (path === '/api/updates/install' && req.method === 'POST') { if (u) u.install(); json(res, 200, state()); return true; }
    return false;
  }

  /**
   * Voice & timing → Clone a voice: POST /api/agents/<id>/voice-audio?name=&format=pcm|wav, the recording of the
   * voice (the studio's: 16-bit PCM at 16 kHz; or a WAV file chosen). Kept as the agent's voices/<name>.wav:
   * answers {referenceAudio} for the saved voice.
   */
  function saveVoiceAudio(req, res, id) {
    const q = new URL(req.url || '/', 'http://x').searchParams;
    const parts = []; let n = 0; let over = false;
    req.on('data', (c) => { n += c.length; if (n > 12e6) over = true; else parts.push(c); });
    req.on('end', () => {
      try {
        if (over) throw Object.assign(new Error('The recording is too long (at most about a minute).'), { status: 400 });
        let wav = Buffer.concat(parts);
        if (q.get('format') === 'pcm') {
          if (wav.length < 16000 * 2 * 5) throw Object.assign(new Error('Record at least 5 seconds of the voice.'), { status: 400 });
          const head = Buffer.alloc(44);
          head.write('RIFF', 0); head.writeUInt32LE(36 + wav.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
          head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(16000, 24);
          head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(wav.length, 40);
          wav = Buffer.concat([head, wav]);
        }
        const rel = store.saveVoiceAudio(id, q.get('name') || 'voice', wav);
        log(`▸ voice recorded for cloning: ${id}/${rel}`);
        json(res, 200, { referenceAudio: rel });
      } catch (e) { json(res, e.status || 400, { error: e.message }); }
    });
  }

  /**
   * An agent's people (Settings → People): GET /api/people?agent=, POST /api/people?agent=&name= (a recording),
   * POST /api/people/identify?agent= (a recording), DELETE /api/people/<id>?agent=.
   */
  function handlePeople(req, res, path) {
    const fail = (e) => json(res, 400, { error: e.message });
    let people;
    try { people = peopleFor(new URL(req.url || '/', 'http://x').searchParams.get('agent') || '', true); } catch (e) { json(res, e.status || 400, { error: e.message }); return true; }
    if (path === '/api/people' && req.method === 'GET') { json(res, 200, { people: people.list() }); return true; }
    if (path === '/api/people' && req.method === 'POST') {
      const name = new URL(req.url || '/', 'http://x').searchParams.get('name') || '';
      voiceprint(req, ENROL_SECONDS).then((v) => {
        const p = people.add(name, v.print, v.seconds);
        log(`▸ people: ${p.name} recorded (${p.seconds} s of voice)`);
        json(res, 200, { person: p, people: people.list() });
      }).catch(fail);
      return true;
    }
    if (path === '/api/people/identify' && req.method === 'POST') {
      voiceprint(req, MIN_SECONDS).then((v) => json(res, 200, people.identify(v.print, v.seconds))).catch(fail);
      return true;
    }
    const m = /^\/api\/people\/([0-9a-f]{8})$/.exec(path);
    if (m && req.method === 'DELETE') { people.remove(m[1]); json(res, 200, { people: people.list() }); return true; }
    return false;
  }

  let actualPort = wanted;
  let wsUrl = '';
  for (let p = wanted; p <= wanted + 9; p++) {
    const ok = await new Promise((resolve) => {
      const onErr = (e) => { server.off('listening', onOk); resolve(e.code === 'EADDRINUSE' ? false : Promise.reject(e)); };
      const onOk = () => { server.off('error', onErr); resolve(true); };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(p, host);
    });
    if (ok) { actualPort = p; break; }
    if (p === wanted + 9) throw new Error(`Ports ${wanted} to ${wanted + 9} are all taken.`);
    log(`(port ${p} is taken, trying ${p + 1})`);
  }
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  const url = `http://${shown}:${actualPort}/`;
  wsUrl = `ws://${shown === '127.0.0.1' ? 'localhost' : shown}:${actualPort}/events`;
  log(`▸ studio: ${url}`);
  log(`▸ WebSocket for the clients (cables, p5.js, web pages): ${wsUrl}`);
  const ready = boot();

  return {
    port: actualPort,
    url,
    wsUrl,
    engineName: () => (engine ? engine.name : null),
    ready,
    /** The agents (their folder: agents.dir). */
    agents: store,
    /** The models of the QVAC engine and whether each is on this computer ([] for the simulated engine). */
    models: () => (engine && engine.models ? engine.models() : []),
    /** Downloads the missing models, after any loading in progress; the progress shows like a loading. Returns the failed ones. */
    install: () => prepareLock(async () => {
      try { return await engine.install((p) => status(progressText(p), p.progress)); } finally { status('', null); }
    }),
    async close() {
      for (const s of sessions) s.close('server shutting down');
      hub.close();
      farms.close();
      sockets.closeAll();                          // the studio's Zonos voice, the clients: server.close() waits for each one
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(() => r()));
      try { if (smartTurn) await (await smartTurn).close(); } catch { /* closed */ }
      try { if (speakers) await (await speakers).close(); } catch { /* closed */ }
      try { if (engine && engine.close) await engine.close(); } catch { /* closed */ }
    },
  };
}
