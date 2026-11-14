// The Zonos engine, hosted by this window. Zonos's in-browser engine (WebGPU) is loaded here from the app's own
// server (/zonos/engine/engine.js; its model from /zonos/models/, downloaded once and kept on the computer), and
// this window answers the server's requests over a WebSocket (/zonos): the server asks for a sentence, the engine
// speaks it on the graphics card, the audio goes back. The protocol is described in app/src/engines/zonos.mjs
// ("the page bridge").
export const host = { state: 'off', loaded: 0, total: 0, fetched: 0, error: '' };   // off | loading | ready | failed
const listeners = new Set();
/** fn(host) is called at each change (loading progress included). */
export function onHost(fn) { listeners.add(fn); }

let ws = null;
let localFetch = null;
let running = null;
let attempt = 0;
const aborts = new Map();

function tell() {
  if (ws && ws.readyState === 1 && host.state !== 'off') ws.send(JSON.stringify({ type: 'state', state: host.state, loaded: host.loaded, total: host.total, error: host.error }));
  for (const fn of listeners) { try { fn(host); } catch (e) { console.error(e); } }
}
function set(state, error = '', p = null) {
  host.state = state; host.error = error;
  if (p) { host.loaded = Number(p.loaded) || 0; host.total = Number(p.total) || 0; host.fetched = Number(p.fetched) || 0; }
  tell();
}

function connect() {
  if (ws && ws.readyState <= 1) return;
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/zonos`);
  sock.binaryType = 'arraybuffer';
  ws = sock;
  sock.onopen = () => tell();
  sock.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'req') serve(sock, m);
    else if (m.type === 'abort') { const a = aborts.get(m.id); if (a) a.abort(); }
  };
  sock.onclose = () => {
    for (const a of aborts.values()) a.abort();
    aborts.clear();
    if (ws === sock) { ws = null; if (host.state !== 'off') setTimeout(connect, 1000); }   // the server restarted: come back
  };
}

async function serve(sock, m) {
  const send = (o) => { if (sock.readyState === 1) sock.send(o); };
  const abort = new AbortController();
  aborts.set(m.id, abort);
  try {
    if (!localFetch) throw new Error('the Zonos engine is not loaded');
    const r = await localFetch(m.path, {
      method: m.method || 'GET', signal: abort.signal,
      headers: m.body != null ? { 'content-type': 'application/json' } : {},
      body: m.body != null ? m.body : undefined,
    });
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    send(JSON.stringify({ type: 'head', id: m.id, status: r.status, headers }));
    if (r.body) {
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.byteLength) continue;
        const frame = new Uint8Array(4 + value.byteLength);          // [u32 id, little-endian][bytes]
        new DataView(frame.buffer).setUint32(0, m.id, true);
        frame.set(value, 4);
        send(frame);
      }
    }
    send(JSON.stringify({ type: 'end', id: m.id }));
  } catch (e) {
    send(JSON.stringify({ type: 'error', id: m.id, message: String((e && e.message) || e) }));
  } finally { aborts.delete(m.id); }
}

async function run() {
  set('loading', '', { loaded: 0, total: 0, fetched: 0 });
  connect();
  let mod;
  try {
    // a new address at each try: a failed import is otherwise remembered by the browser
    mod = await import(`/zonos/engine/engine.js${attempt++ ? `?try=${attempt}` : ''}`);
  } catch (e) {
    set('failed', 'the Zonos engine is not in this copy of VIK, or did not load');
    console.error(e);
    return;
  }
  try {
    if (mod.engine.onFatal) mod.engine.onFatal((msg) => { localFetch = null; running = null; set('failed', String(msg)); });
    // cache: false — the model is already kept on this computer by the app's server, a second copy in the
    // browser's storage would only take another gigabyte
    await mod.engine.init((p) => { if (host.state === 'loading') set('loading', '', p); }, { base: new URL('/zonos/models/', location.href).href, cache: false });
  } catch (e) {
    running = null;
    set('failed', String((e && e.message) || e));
    return;
  }
  localFetch = mod.localFetch;
  set('ready');
}

/** Loads the engine in this window (once), and keeps answering the server. A failed load can be tried again. */
export function startZonosHost() {
  if (host.state === 'failed') running = null;
  running ??= run();
  return running;
}
