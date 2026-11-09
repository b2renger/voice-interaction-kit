// LLM farms on the network (LlmOnLan, https://github.com/b2renger/LlmOnLan): a computer with a graphics card
// that serves a language model to the whole room through one OpenAI-compatible address. Voice Lab can ask it
// for the replies instead of the local model. Listening (Whisper) and the voice stay on this computer.
//
// Finding a farm works as in LlmOnLan's own client (shell/src/main/discovery.ts):
//   - each farm sends a small JSON snapshot every 5 s over UDP, to 239.255.43.10:41998 and to the broadcast
//     address. We only listen once the lab window asks for farms (Windows then asks to allow the app).
//   - a farm the beacon does not reach (another subnet): its address, asked at http://<host>:41997/lol/self.
// The snapshot: {v, id, name, proxyPort, endpoint, requiresKey, models: [{id, underlying, default}], healthy, ...}.
// The replies: POST http://<host>:<proxyPort>/v1/chat/completions, streamed, with the farm password as the key.
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

const GROUP = process.env.LOL_FED_GROUP || '239.255.43.10';
const PORT = Number(process.env.LOL_FED_PORT) || 41998;
const HTTP_PORT = Number(process.env.LOL_FED_HTTP_PORT) || 41997;
const STALE_MS = 12000;      // unheard this long: shown as not answering (LlmOnLan's value)
const FORGET_MS = 120000;    // unheard this long: leaves the list (a farm added by its address stays)

/** The farms heard on the network or added by their address. */
export function createFarmFinder(log = () => {}) {
  const farms = new Map();   // id → {snap, host, httpPort, seen, manual}
  let socket = null;
  let warned = false;

  function remember(snap, host, httpPort, manual) {
    if (!snap || snap.v == null || !host) return null;
    const id = String(snap.id || `${host}:${snap.proxyPort}`);
    const prev = farms.get(id);
    // the same farm heard under two addresses keeps the first while it answers there (LlmOnLan: no flapping)
    const keep = prev && prev.host !== host && Date.now() - prev.seen < STALE_MS;
    farms.set(id, { snap, host: keep ? prev.host : host, httpPort: keep ? prev.httpPort : httpPort, seen: Date.now(), manual: manual || !!(prev && prev.manual) });
    return id;
  }

  function listen() {
    if (socket) return;
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket = s;
    s.on('error', (e) => {
      if (!warned) log(`(LLM farms: cannot listen to the network: ${e.message})`);
      warned = true;
      try { s.close(); } catch { /* closed */ }
    });
    s.on('message', (msg, rinfo) => {
      let snap;
      try { snap = JSON.parse(String(msg)); } catch { return; }
      // the address the farm advertises beats the packet's (a farm sends on every interface, Docker's included)
      remember(snap, hostOf(snap && snap.endpoint) || rinfo.address, Number(snap && snap.httpPort) || HTTP_PORT, false);
    });
    s.bind(PORT, () => {
      try { s.addMembership(GROUP); } catch { /* the default interface may refuse */ }
      for (const a of ipv4s()) { try { s.addMembership(GROUP, a); } catch { /* already joined */ } }
      log(`▸ listening for LLM farms on the network (${GROUP}:${PORT})`);
    });
  }

  return {
    /** The farms, for the lab window. The first call starts listening. */
    list() {
      listen();
      const now = Date.now();
      for (const [id, f] of farms) {
        if (!f.manual && now - f.seen > FORGET_MS) farms.delete(id);
        // a farm added by its address does not reach us by beacon: ask it again
        else if (f.manual && now - f.seen > 5000 && !f.asking) {
          f.asking = true;
          getSelf(f.host, f.httpPort).then((snap) => remember(snap, f.host, f.httpPort, true), () => {}).finally(() => { f.asking = false; });
        }
      }
      return [...farms.entries()].map(([id, f]) => view(id, f, now));
    },
    /** A farm by its address ("192.168.1.20", "farm.local:41997"): asked once, then kept. Returns its id. */
    async add(address) {
      const { host, port } = parseAddress(address);
      let snap;
      try { snap = await getSelf(host, port); } catch (e) { throw new Error(`No LLM farm answers at ${host}:${port} (${e.message}).`); }
      const id = remember(snap, host, port, true);
      if (!id) throw new Error(`${host}:${port} answers, but it is not an LLM farm.`);
      return id;
    },
    close() { if (socket) { try { socket.close(); } catch { /* closed */ } socket = null; } },
  };
}

function view(id, { snap: s, host, seen }, now) {
  const models = (Array.isArray(s.models) ? s.models : []).filter((m) => m && m.id)
    .map((m) => ({ id: String(m.id), underlying: m.underlying ? String(m.underlying) : '', default: !!m.default }));
  const cap = s.capacity || {};
  return {
    id,
    name: String(s.name || host),
    url: `http://${host}:${Number(s.proxyPort) || 4000}/v1`,
    requiresKey: !!s.requiresKey,
    healthy: s.healthy !== false && now - seen < STALE_MS,
    models,
    clients: Number.isFinite(cap.clients) ? cap.clients : null,
    slots: Number.isFinite(cap.slots) ? cap.slots : null,
  };
}

function hostOf(url) { try { return new URL(String(url || '')).hostname || null; } catch { return null; } }
function ipv4s() {
  return Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}
function parseAddress(a) {
  const hostPort = String(a || '').trim().replace(/^[a-z]+:\/\//i, '').split('/')[0];
  const [host, port] = hostPort.split(':');
  if (!/^[a-z0-9.-]+$/i.test(host || '')) throw new Error(`"${a}" is not a computer's address (example: 192.168.1.20).`);
  return { host, port: Number(port) || HTTP_PORT };
}
async function getSelf(host, port) {
  const r = await fetch(`http://${host}:${port}/lol/self`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`answer ${r.status}`);
  return r.json();
}

/**
 * A reply from a farm, streamed: the same interface as the engines' generate().
 * @param {{farm: {url: string, model: string, key?: string}, system: string, history: any[], temperature: number,
 *   maxTokens: number, onDelta: (d: string) => void}} o
 */
export function farmGenerate({ farm, system, history, temperature, maxTokens, onDelta }) {
  const t0 = Date.now();
  const ac = new AbortController();
  let cancelled = false;
  const done = (async () => {
    let text = '';
    let firstTokenMs = null;
    if (!farm.model) throw new Error('no model is chosen on the LLM farm: choose it again in Engine → Language model.');
    let res;
    try {
      res = await fetch(`${String(farm.url).replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ac.signal,
        // a farm without a password takes any key (LlmOnLan's client sends this one)
        headers: { 'content-type': 'application/json', authorization: `Bearer ${farm.key || 'sk-lol-lan'}` },
        body: JSON.stringify({ model: farm.model, stream: true, temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...history] }),
      });
    } catch (e) {
      if (cancelled) return { text, firstTokenMs, cancelled };
      throw new Error(`the LLM farm (${farm.url}) does not answer: is it on, and on this network? (${(e.cause && (e.cause.code || e.cause.message)) || e.message})`);
    }
    if (!res.ok) throw new Error(await refusal(res, farm));
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return { text, firstTokenMs, cancelled };
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          if (ev.error) throw new Error(`the LLM farm stopped: ${ev.error.message || JSON.stringify(ev.error)}`);
          const d = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content;
          if (d) {
            if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
            text += d;
            onDelta(d);
          }
        }
      }
    } catch (e) { if (!cancelled) throw e; }
    return { text, firstTokenMs, cancelled };
  })();
  return {
    done,
    cancel() { if (cancelled) return; cancelled = true; ac.abort(); },
  };
}

/** Why a farm refused, in words. */
async function refusal(res, farm) {
  const body = await res.text().catch(() => '');
  let msg = body;
  try { const j = JSON.parse(body); msg = (j.error && (j.error.message || j.error)) || j.message || body; } catch { /* not JSON */ }
  msg = String(msg).slice(0, 300);
  if (res.status === 401 || res.status === 403) {
    return farm.key ? 'the LLM farm refused the password (Engine → Farm password).' : 'this LLM farm needs a password: type it in Engine → Farm password.';
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after'));
    return `the LLM farm is full: all its places are taken${wait > 0 ? ` (one frees in about ${Math.ceil(wait / 60)} min)` : ''}. Try again later, or ask the person running it to raise "People served at once".`;
  }
  if ((res.status === 400 || res.status === 404) && /model/i.test(msg)) {
    return `the LLM farm no longer serves the model "${farm.model}": choose the language model again (Engine). (${msg})`;
  }
  return `the LLM farm answered ${res.status}: ${msg}`;
}
