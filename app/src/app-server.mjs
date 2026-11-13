// The VIK server, as a module: the studio page and its API (the agents), /voice (the local engine), /brain and
// /events (the hub). Used by the Electron app (electron/main.cjs) and by the command line (src/server.mjs).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname, extname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.mjs';
import { Session } from './session.mjs';
import { createHub } from './hub.mjs';
import { createFarmFinder } from './farm.mjs';
import { remoteGenerate, remoteModels } from './llm.mjs';
import { createAgentStore } from './agent/agents.mjs';
import { createDecider } from './agent/decide.mjs';
import { wordsMatcher } from './agent/matcher.mjs';
import { handleApi } from './api.mjs';
import { mutex, progressText } from './util.mjs';
import { createZonosVoice, withZonos } from './engines/zonos.mjs';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

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
 *   agentsDir?: string, legacyDirs?: string[]}} o
 *   agentsDir: where the agents live (default: a new temporary folder, with the examples: for the tests);
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
  const zonos = createZonosVoice(((config.models || {}).tts || {}).zonos, log);
  const sessions = new Set();
  const hub = createHub(log);
  const farms = createFarmFinder(log);
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

  const server = createServer((req, res) => {
    let path;
    try { path = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); res.end('Invalid address'); return; }
    if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (path === '/' || path === '/index.html') return sendFile(res, join(APP_DIR, 'public', 'index.html'));
    if (path === '/voice-core.js') return sendFile(res, coreFile());
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      const error = engineError ? engineError.message : warmupError ? `${warmupError.message} (Click Start to try again.)` : null;
      const m = engine && engine.matcher ? engine.matcher() : null;
      res.end(JSON.stringify({ engine: engine ? engine.name : null, models: warm, error, port: actualPort, status: lastStatus, wsUrl, matcher: m ? m.name : 'Words', matcherModel: !!m, agentsDir: store.dir }));
      return;
    }
    if ((path.startsWith('/api/') || path === '/farms') && !samePage(req)) { res.writeHead(403); res.end(); return; }
    // the models a farm or a service offers: {url, key} → [ids] (POST: the key stays out of the address)
    if (path === '/api/llm/models' && req.method === 'POST') {
      readJson(req).then((q) => remoteModels(q)).then((models) => json(res, 200, { models }), (e) => json(res, 200, { error: e.message, models: [] }));
      return;
    }
    // the Zonos voice for the studio: is its server there, its voices, its design sliders
    if (path === '/api/voice/zonos' && req.method === 'GET') {
      zonos.probe(new URL(req.url || '/', 'http://x').searchParams.has('fresh')).then(() => json(res, 200, zonos.describe()));
      return;
    }
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
  attachWebSocket(server, {
    path: /^\/(voice|brain|events)$/,
    allowOrigin: (origin, path) => {
      const ok = path === '/events' ? originAllowed(config.allowedOrigins, origin) : !origin || ownOrigin(origin);
      if (!ok) log(`✖ refused a connection to ${path} from the page ${origin}${path === '/events' ? ' (not in "allowedOrigins", config.json)' : ''}`);
      return ok;
    },
    onConnection(ws, req) {
      const path = (req.url || '').split('?')[0];
      if (path === '/brain') return hub.brain(ws);
      if (path === '/events') return hub.client(ws);
      // One conversation at a time: the models run on this machine, for one person.
      for (const s of sessions) { s.error('replaced', 'Another page opened a conversation, so this one is stopping.'); s.close('replaced'); }
      const session = new Session(ws, {
        info: () => (engine ? engine.info() : {}),
        prepare: async (s, p) => { await waitEngine(); await engine.prepare(s, p); warmupError = null; },
        openAsr: (x, cb) => engine.openAsr(x, cb),
        // an LLM farm or a service chosen (llm): the reply comes from it, the rest stays on this computer
        generate: (x) => (x.remote ? remoteGenerate({ ...x, maxTokens: config.models.llm.maxTokens || 320 }) : engine.generate(x)),
        speak: (x) => engine.speak(x),
        decider,
        newConversation: () => { if (engine && engine.newConversation) engine.newConversation(); },
        smartTurn: () => getSmartTurn(),
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
      await new Promise((r) => server.close(() => r()));
      try { if (smartTurn) await (await smartTurn).close(); } catch { /* closed */ }
      try { if (engine && engine.close) await engine.close(); } catch { /* closed */ }
    },
  };
}
