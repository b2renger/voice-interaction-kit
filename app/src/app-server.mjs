// The local voice server, as a module: the lab window page + the /voice WebSocket (cables op, "Local" engine).
// Used by the Electron app (electron/main.cjs) and by the command line (src/server.mjs).
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.mjs';
import { Session } from './session.mjs';
import { createHub } from './hub.mjs';
import { createFarmFinder, farmGenerate } from './farm.mjs';
import { mutex, progressText } from './util.mjs';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The pages allowed to open a conversation. An entry ending in * is a prefix. */
export const DEFAULT_ORIGINS = ['https://cables.gl', 'https://sandbox.cables.gl', 'https://dev.cables.gl', 'http://localhost:*', 'http://127.0.0.1:*', 'cables:*', 'file:*', 'https://editor.p5js.org', 'https://preview.p5js.org'];
export function originAllowed(list, origin) {
  const l = Array.isArray(list) && list.length ? list : DEFAULT_ORIGINS;
  if (!origin) return true;                          // not a browser (local tool, test)
  if (l.includes('*')) return true;
  return l.some((x) => origin === x || (x.endsWith('*') && origin.startsWith(x.slice(0, -1))));
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

/**
 * Starts the server. Tries the requested port, then the next ones if it is taken (up to +9).
 * @param {{config: any, mock?: boolean, port?: number, host?: string, log?: (m: string) => void,
 *   onStatus?: (s: {text: string, progress: number|null}) => void, personaDirs?: string[]}} o
 * @returns {Promise<{port: number, url: string, wsUrl: string, engineName: () => string|null, ready: Promise<void>, close: () => Promise<void>}>}
 */
export async function startServer(o) {
  const config = o.config;
  const log = o.log || ((m) => console.log(`[${new Date().toLocaleTimeString('en-GB')}] ${m}`));
  const host = String(o.host || config.host || '127.0.0.1');
  const wanted = Number(o.port || config.port || 8790);
  const personaDirs = o.personaDirs || [join(APP_DIR, 'personas')];

  let engine = null;
  let engineError = null;        // no engine at all (SDK missing): every conversation fails
  let warmupError = null;        // the engine is there but the warm-up failed: each Start tries again
  let warm = 'loading';
  let lastStatus = { text: 'Starting…', progress: null };
  const prepareLock = mutex();
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
  function personas() {
    const seen = new Set();
    const list = [];
    for (const dir of personaDirs) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
        const id = basename(f, '.json');
        if (seen.has(id)) continue;
        let p;
        try { p = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; /* invalid file ignored */ }
        // "knowledge": a text file next to the persona, added to its text. basename: a shared persona
        // file must not pull any other file of the computer into the prompt (sent to Gemini on that engine).
        if (p.knowledge) {
          try {
            p.persona = `${p.persona || ''}\n\nWhat you know:\n${readFileSync(join(dir, basename(String(p.knowledge))), 'utf8').trim()}`.trim();
          } catch (e) { log(`✖ persona ${f}: cannot read its knowledge file (${e.message})`); }
        }
        list.push({ id, ...p });
        seen.add(id);
      }
    }
    return list;
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
      res.end(JSON.stringify({ engine: engine ? engine.name : null, models: warm, error, port: actualPort, status: lastStatus, wsUrl }));
      return;
    }
    if (path === '/personas') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(personas()));
      return;
    }
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
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin') { res.writeHead(403); res.end(); return; }
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

  // /voice: the lab window's audio (local engine). /brain: the lab window publishes to the hub. Only the
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
        // an LLM farm chosen (llmFarm): the reply comes from it, the rest stays on this computer
        generate: (x) => (x.farm ? farmGenerate({ ...x, maxTokens: config.models.llm.maxTokens || 320 }) : engine.generate(x)),
        speak: (x) => engine.speak(x),
        newConversation: () => { if (engine && engine.newConversation) engine.newConversation(); },
        smartTurn: () => getSmartTurn(),
      }, prepareLock, log);
      sessions.add(session);
      ws.on('close', () => sessions.delete(session));
      if (engineError) session.fatal(engineError);
      else if (warm !== 'ready') session.status('Loading the models… (the first launch downloads about 1.5 GB)', null);
    },
  });

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
  log(`▸ lab window: ${url}`);
  log(`▸ WebSocket for the clients (cables, p5.js, web pages): ${wsUrl}`);
  const ready = boot();

  return {
    port: actualPort,
    url,
    wsUrl,
    engineName: () => (engine ? engine.name : null),
    ready,
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
