// Zonos voice: Zyphra's ZONOS3-Mini (Apache-2.0 weights, MIT runtime), a voice DESIGNED with sliders (age, gender,
// pitch, texture, mood…) in 44 language codes, French included. It does not run through QVAC. Two ways to reach it
// (config.json, "models.tts.zonos.mode"), which speak the same API:
//   'web' (default)  Zonos's in-browser engine (WebGPU, https://github.com/Zyphra/ZONOS3-Mini servers/web) runs in
//                    the studio's own window, on the graphics card; nothing else to install. The window connects
//                    to this server (WebSocket /zonos) and answers its requests: the "page bridge" below. The
//                    engine's files and its model are served to the window by zonos-files.mjs.
//   'server'         a Zonos server running on this computer (zonos3-server, or the MLX server on a Mac), over HTTP.
// The API (servers/api/openapi.yaml there, read on 13 November 2026):
//   GET  /v2/health      {status: 'ok'}
//   GET  /v2/speakers    {speakers: [{id, label, is_default, …}]}: the default voices
//   GET  /v2/controls    the steering bundle: its sliders are in ui.controls (404 without a bundle)
//   POST /v2/generate    {text, language, stream, format: 'pcm', speaker_embedding_id, speaker_mode, controls}
//                        → float32 little-endian mono PCM at 44.1 kHz, chunked
//
// It is an EXTRA voice (setting localVoiceEngine: 'zonos'), wrapped around the engine that does everything else
// (withZonos): when Zonos cannot speak (no WebGPU, the window closed, no server), the engine's own default voice
// speaks instead, and says so.
//
// The design (setting voiceDesign) is a line of text, so that it fits in persona.md and can be typed by hand:
//   "age +1.5, deep 3, gender -1"       slider names, as GET /v2/controls lists them (ui.controls[].id)
//   "identity.age 1.5, mood.valence 2"  or raw "<set>.<direction>" doses, sent as written
// Identity sliders (gender, age, pitch, texture) need the voice in embedding mode: that is how it is sent.
import { AsyncQueue, clamp, num } from '../util.mjs';

export const ZONOS_DEFAULT_URL = 'http://127.0.0.1:1919';
export const ZONOS_RATE = 44100;
/** VIK's language codes → the Zonos server's (model/src/zonos3/registries/languages.json, "server"). */
const LANGUAGE = { en: 'en_us', fr: 'fr_fr', pt: 'pt_br', zh: 'cmn' };
const SAME_CODE = ['de', 'es', 'it', 'ja', 'ko', 'ar', 'bn', 'bg', 'cs', 'da', 'nl', 'fi', 'ka', 'el', 'gu', 'he', 'hi', 'hu', 'id',
  'kn', 'ms', 'ml', 'mr', 'no', 'or', 'pl', 'pa', 'ro', 'ru', 'sk', 'sv', 'tl', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi'];
export function zonosLanguage(language) {
  const k = String(language || 'en').toLowerCase().split(/[-_]/)[0];
  return LANGUAGE[k] || (SAME_CODE.includes(k) ? k : 'en_us');
}

/** "age +1.5, deep 3; gender=-1" → {age: 1.5, deep: 3, gender: -1}. What it cannot read is left out. */
export function parseDesign(text) {
  const out = {};
  for (const part of String(text || '').split(/[,;\n]+/)) {
    const m = /^\s*([a-z_][\w.-]*?)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)\s*$/i.exec(part);
    if (m && Number(m[2]) !== 0) out[m[1].toLowerCase()] = Number(m[2]);
  }
  return out;
}

/**
 * A design → the doses a request carries ({"<set>.<direction>": dose}), with the server's controls document.
 * A slider is clamped to its range, then each direction of its pole gets |value| × its coefficient:
 * "gender -1.5" → {identity.gender: -1.5}; "projection -2" (whisper) → {delivery.whisper: 2}.
 * Returns {doses, unknown}: unknown = the names the server has no slider for.
 */
export function designDoses(design, doc) {
  const doses = {};
  const unknown = [];
  const sliders = (doc && doc.ui && Array.isArray(doc.ui.controls)) ? doc.ui.controls : [];
  const directions = (doc && doc.directions) || null;
  const add = (k, v) => { if (v) doses[k] = Math.round(((doses[k] || 0) + v) * 1000) / 1000; };
  for (const [name, value] of Object.entries(typeof design === 'string' ? parseDesign(design) : (design || {}))) {
    if (name.includes('.')) {                       // a raw dose
      if (directions && !directions[name]) unknown.push(name); else add(name, value);
      continue;
    }
    const c = sliders.find((x) => x && String(x.id).toLowerCase() === name);
    if (!c) { unknown.push(name); continue; }
    const range = Array.isArray(c.range) && c.range.length === 2 ? c.range : [-Infinity, Infinity];
    const v = clamp(value, Number(range[0]), Number(range[1]));
    const pole = (c.map || {})[v < 0 ? '-' : '+'];
    if (!pole) continue;                            // a one-sided slider pushed the other way
    for (const [direction, coefficient] of Object.entries(pole)) add(direction, Math.abs(v) * num(coefficient, 0));
  }
  return { doses, unknown };
}

/** The sliders of a controls document, as the studio shows them. */
export function designSliders(doc) {
  const ui = (doc && doc.ui) || {};
  const groups = Object.fromEntries((Array.isArray(ui.groups) ? ui.groups : []).map((g) => [g.id, g.label || g.id]));
  return (Array.isArray(ui.controls) ? ui.controls : []).filter((c) => c && c.id && Array.isArray(c.range)).map((c) => ({
    id: String(c.id), label: String(c.label || c.id), group: String(groups[c.group] || c.group || ''),
    poles: Array.isArray(c.poles) ? c.poles.map(String) : null,
    min: Number(c.range[0]), max: Number(c.range[1]),
    safe: Array.isArray(c.safe) ? [Number(c.safe[0]), Number(c.safe[1])] : null,
    effect: String(c.effect || ''),
  }));
}

/** float32 little-endian bytes → 16-bit PCM (clipped). */
export function f32ToS16(buf) {
  const n = buf.length >> 2;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(clamp(buf.readFloatLE(i * 4), -1, 1) * 32767);
  return out;
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
async function bytesOf(chunks) { const all = []; for await (const c of chunks) all.push(Buffer.from(c)); return Buffer.concat(all); }
/** What both transports answer with: {status, header(name), chunks (async iterable of bytes), text(), json()}. */
const reply = (status, header, chunks) => ({
  status, header, chunks,
  text: async () => (await bytesOf(chunks)).toString('utf8'),
  json: async () => JSON.parse((await bytesOf(chunks)).toString('utf8')),
});

/** A Zonos server over HTTP. */
function httpTransport(url, headers) {
  return {
    where: `the Zonos server at ${url}`,
    ready: () => true,
    async request(method, path, { body, signal, timeoutMs } = {}) {
      const signals = [signal, timeoutMs ? AbortSignal.timeout(timeoutMs) : null].filter(Boolean);
      const r = await fetch(url + path, {
        method, headers: body != null ? { ...headers, 'content-type': 'application/json' } : headers,
        body: body != null ? body : undefined, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
      });
      return reply(r.status, (n) => r.headers.get(n), r.body || []);
    },
  };
}

/**
 * The page bridge: the studio's window runs Zonos's in-browser engine and connects here (attach(ws)); each request
 * is sent to it and its answer comes back over the same WebSocket.
 *   to the page:    {type:'req', id, method, path, body}    {type:'abort', id}
 *   from the page:  {type:'state', state:'loading'|'ready'|'failed', loaded, total, error}
 *                   {type:'head', id, status, headers}, then binary frames [u32 id, little-endian][bytes],
 *                   then {type:'end', id} or {type:'error', id, message}
 */
export function createPageBridge(log = () => {}) {
  let ws = null;
  let nextId = 1;
  const pending = new Map();        // id → {head: {resolve, reject}|null, q: AsyncQueue}
  const host = { state: 'none', loaded: 0, total: 0, error: '' };     // 'none': no window is connected
  const failAll = (why) => {
    for (const p of pending.values()) { const e = new Error(why); if (p.head) p.head.reject(e); p.q.fail(e); }
    pending.clear();
  };
  return {
    where: 'the Zonos engine in the studio window',
    host: () => ({ ...host }),
    ready: () => !!ws && host.state === 'ready',
    /** The studio's window connected: it hosts the engine from now on (a newer window replaces an older one). */
    attach(sock) {
      if (ws && ws !== sock) { try { ws.close(1000, 'replaced'); } catch { /* closed */ } }
      ws = sock;
      Object.assign(host, { state: 'loading', loaded: 0, total: 0, error: '' });
      sock.on('message', (data, binary) => {
        if (ws !== sock) return;
        if (binary) {
          if (data.length < 4) return;
          const p = pending.get(data.readUInt32LE(0));
          if (p) p.q.push(data.subarray(4));
          return;
        }
        let m; try { m = JSON.parse(data); } catch { return; }
        if (m.type === 'state') {
          const state = ['loading', 'ready', 'failed'].includes(m.state) ? m.state : 'loading';
          if (state !== host.state) log(state === 'ready' ? '▸ Zonos voice: the engine is loaded in the studio window' : state === 'failed' ? `(Zonos voice: the engine did not load — ${String(m.error || 'no reason given')})` : '▸ Zonos voice: the engine is loading in the studio window…');
          Object.assign(host, { state, loaded: num(m.loaded, 0), total: num(m.total, 0), error: String(m.error || '') });
          if (state !== 'ready') failAll('the Zonos engine stopped');
          return;
        }
        const p = pending.get(m.id);
        if (!p) return;
        if (m.type === 'head' && p.head) { p.head.resolve({ status: num(m.status, 500), headers: m.headers || {} }); p.head = null; }
        else if (m.type === 'end') { p.q.end(); pending.delete(m.id); }
        else if (m.type === 'error') { const e = new Error(String(m.message || 'the engine failed')); if (p.head) p.head.reject(e); p.q.fail(e); pending.delete(m.id); }
      });
      sock.on('close', () => {
        if (ws !== sock) return;
        ws = null;
        Object.assign(host, { state: 'none', loaded: 0, total: 0, error: '' });
        failAll('the studio window that runs the Zonos engine closed');
      });
    },
    async request(method, path, { body, signal, timeoutMs } = {}) {
      if (!ws || host.state !== 'ready') throw new Error('the Zonos engine is not loaded');
      if (signal && signal.aborted) throw abortError();
      const id = nextId++; if (nextId > 0xFFFFFFF0) nextId = 1;
      const q = new AsyncQueue();
      const p = { head: null, q };
      const head = new Promise((resolve, reject) => { p.head = { resolve, reject }; });
      head.catch(() => {});
      pending.set(id, p);
      const stop = (e) => { if (!pending.has(id)) return; pending.delete(id); if (ws) ws.sendJson({ type: 'abort', id }); if (p.head) p.head.reject(e); q.fail(e); };
      if (signal) signal.addEventListener('abort', () => stop(abortError()), { once: true });
      const timer = timeoutMs ? setTimeout(() => { if (p.head) stop(new Error('the Zonos engine did not answer in time')); }, timeoutMs) : null;
      ws.sendJson({ type: 'req', id, method, path, body: body != null ? String(body) : null });
      try {
        const h = await head;
        return reply(h.status, (n) => { const k = Object.keys(h.headers).find((x) => x.toLowerCase() === String(n).toLowerCase()); return k ? String(h.headers[k]) : null; }, q);
      } finally { clearTimeout(timer); }
    },
  };
}

/**
 * The Zonos voice of config.json ("models.tts.zonos": {mode, url, voice, token, speakerMode, options}).
 * @param {{mode?: string, url?: string, voice?: string, token?: string, speakerMode?: string, options?: object, timeoutMs?: number}} cfg
 */
export function createZonosVoice(cfg = {}, log = () => {}) {
  const mode = cfg.mode === 'server' ? 'server' : 'web';
  const url = String(cfg.url || ZONOS_DEFAULT_URL).replace(/\/+$/, '');
  const bridge = mode === 'web' ? createPageBridge(log) : null;
  const transport = bridge || httpTransport(url, cfg.token ? { authorization: `Bearer ${cfg.token}` } : {});
  const where = transport.where;
  const st = { ok: false, checkedAt: 0, checking: null, speakers: [], doc: null, reason: 'not checked yet' };

  async function getJson(path, ms) {
    const r = await transport.request('GET', path, { timeoutMs: ms });
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`${path} answered ${r.status}`), { status: r.status });
    return r.json();
  }
  /** Why the engine in the window cannot speak right now ('' when it can). */
  function hostReason() {
    if (!bridge) return '';
    const h = bridge.host();
    if (h.state === 'ready') return '';
    if (h.state === 'failed') return h.error || 'the Zonos engine did not load';
    if (h.state === 'loading') return 'the Zonos engine is still loading';
    return 'the Zonos engine is not loaded in the studio window (open Voice & timing there)';
  }

  /** Can Zonos speak? Asks at most every 5 s, unless forced. Never throws. */
  function probe(force = false) {
    // a forced check must not be answered by one that started earlier (the window may have loaded since)
    if (st.checking) return force ? st.checking.then(() => probe(true)) : st.checking;
    if (!force && Date.now() - st.checkedAt < (bridge ? 1000 : 5000)) return Promise.resolve(st.ok);
    // (cleared below, not inside: with no window the check ends before this assignment is even made)
    const run = (async () => {
      const was = st.ok;
      try {
        const why = hostReason();
        if (why) throw Object.assign(new Error(''), { host: why });
        const h = await getJson('/v2/health', num(cfg.timeoutMs, bridge ? 5000 : 1500));
        if (!h || h.status !== 'ok') throw new Error('its health check did not say "ok"');
        const [sp, doc] = await Promise.all([
          getJson('/v2/speakers', 5000).then((j) => (Array.isArray(j && j.speakers) ? j.speakers : []), () => []),
          getJson('/v2/controls', 5000).catch(() => null),          // 404: a server started without a steering bundle
        ]);
        st.speakers = sp; st.doc = doc; st.ok = true; st.reason = '';
        if (!was) log(`▸ Zonos voice: ${bridge ? 'the engine in the studio window answers' : `server at ${url}`} (${sp.length} voice(s), ${designSliders(doc).length} design slider(s))`);
      } catch (e) {
        st.ok = false;
        st.reason = e.host || (bridge ? `the Zonos engine does not answer${e.message ? ` (${e.message})` : ''}`
          : e.status === 401 || e.status === 403 ? `the Zonos server at ${url} refused the access token` : `no Zonos server answers at ${url}`);
        if (was || !st.checkedAt) log(`(Zonos voice: ${st.reason}${!e.host && !bridge && e.message ? ` — ${e.message}` : ''})`);
      }
      st.checkedAt = Date.now();
      return st.ok;
    })();
    st.checking = run;
    run.finally(() => { if (st.checking === run) st.checking = null; });
    return run;
  }

  /** The speaker id of a voice named by its id or its label ("Gaspard"); '' = config.json's, else the first default voice. */
  function voiceId(name) {
    const want = String(name || cfg.voice || '').trim().toLowerCase();
    const by = (f) => st.speakers.find(f);
    const hit = want && (by((s) => String(s.id).toLowerCase() === want) || by((s) => String(s.label || '').toLowerCase() === want));
    const s = hit || by((x) => x.is_default) || st.speakers[0];
    return s ? String(s.id) : '';
  }

  /**
   * Says one sentence: push({pcm, sampleRate, text}) is called as the audio arrives (text on the first frame only).
   * Throws when the server refuses or is gone; e.sent = samples already pushed, e.status = its HTTP status if any.
   */
  async function say(sentence, o, push, signal) {
    const { doses } = designDoses(o.design, st.doc);
    const id = voiceId(o.voice);
    const body = {
      ...(cfg.options && typeof cfg.options === 'object' ? cfg.options : {}),
      text: sentence, language: zonosLanguage(o.language), stream: true, format: 'pcm',
    };
    if (id) { body.speaker_embedding_id = id; body.speaker_mode = cfg.speakerMode === 'reference' ? 'reference' : 'embedding'; }
    if (Object.keys(doses).length) body.controls = doses;
    let sent = 0;
    try {
      const r = await transport.request('POST', '/v2/generate', { body: JSON.stringify(body), signal });
      if (r.status < 200 || r.status >= 300) {
        const detail = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
        throw Object.assign(new Error(`${bridge ? 'the Zonos engine' : 'the Zonos server'} answered ${r.status}${detail ? `: ${detail}` : ''}`), { status: r.status });
      }
      const rate = num(r.header('x-audio-sample-rate'), ZONOS_RATE) || ZONOS_RATE;
      const least = Math.round(rate * 0.1) * 4;                     // frames of 100 ms at least
      let pending = Buffer.alloc(0);
      const flush = (all) => {
        const usable = pending.length - (pending.length % 4);
        if (!usable || (!all && usable < least)) return;
        const pcm = f32ToS16(pending.subarray(0, usable));
        pending = pending.subarray(usable);
        push({ pcm, sampleRate: rate, text: sent === 0 ? sentence : '' });
        sent += pcm.length;
      };
      for await (const chunk of r.chunks) {
        pending = pending.length ? Buffer.concat([pending, Buffer.from(chunk)]) : Buffer.from(chunk);
        flush(false);
      }
      flush(true);
      return sent;
    } catch (e) { e.sent = sent; throw e; }
  }

  /**
   * 'web' mode: waits while the window loads the engine (the first time, it downloads the model: about 1 GB),
   * reporting its progress like any model. Returns as soon as it is loaded or has failed; and, when no window
   * hosts the engine, after a few seconds (graceMs). 'server' mode: nothing to wait for.
   */
  async function settle(onProgress, { graceMs = num(cfg.graceMs, 4000), maxMs = 30 * 60 * 1000 } = {}) {
    if (!bridge) return;
    const t0 = Date.now();
    for (;;) {
      const h = bridge.host();
      if (h.state === 'ready' || h.state === 'failed') return;
      if (h.state === 'none' && Date.now() - t0 > graceMs) return;
      if (Date.now() - t0 > maxMs) return;
      if (h.state === 'loading' && onProgress) onProgress({ stage: 'Zonos voice', progress: h.total ? Math.min(100, (100 * h.loaded) / h.total) : 0, downloaded: h.loaded, total: h.total });
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return {
    mode,
    url,
    where,
    /** 'web' mode: the WebSocket of the studio's window that runs the engine (app-server.mjs, /zonos). */
    attach(sock) { if (bridge) { st.checkedAt = 0; bridge.attach(sock); } else sock.close(1008, 'this VIK reaches Zonos through a server'); },
    settle,
    probe,
    say,
    voiceId,
    ok: () => st.ok && transport.ready(),
    reason: () => (st.ok && !transport.ready() ? hostReason() : st.reason),
    /** Zonos stopped answering: the default voice takes over until a check finds it again. */
    lost(why) { if (st.ok) log(`(Zonos voice: ${why}; the default voice takes over)`); st.ok = false; st.reason = hostReason() || `${where} stopped answering`; st.checkedAt = Date.now(); },
    /** What the studio shows: is it there, its voices, its sliders. */
    describe() {
      const up = st.ok && transport.ready();
      return {
        mode, host: bridge ? bridge.host() : null,
        available: up, url, error: up ? '' : (st.ok ? hostReason() : st.reason),
        voices: up ? st.speakers.map((s) => ({ id: String(s.id), label: String(s.label || s.id), default: !!s.is_default })) : [],
        sliders: up ? designSliders(st.doc) : [],
      };
    },
  };
}

export const zonosFallbackNote = (reason) => `Zonos voice unavailable (${reason}): the default voice speaks instead.`;

/**
 * An engine with the Zonos voice added. Everything goes to `engine` as before; only with the setting
 * localVoiceEngine 'zonos' AND a Zonos that answers (its engine in the window, or its server) does the voice come from Zonos. Otherwise the
 * engine's default voice speaks (it stays loaded: 'zonos' is not a voice engine it knows, so it prepares
 * its default one), and info().voiceFallback says why.
 */
export function withZonos(engine, zonos, log = () => {}) {
  let wanted = false;
  const fallbackParams = (o) => ({ ...o, engine: 'supertonic' });
  const wrapped = Object.create(engine);
  return Object.assign(wrapped, {
    zonos,
    async prepare(s, onProgress) {
      await engine.prepare(s, onProgress);
      wanted = !!s && s.localVoiceEngine === 'zonos';
      if (wanted) { await zonos.settle(onProgress); await zonos.probe(true); }
    },
    info() {
      const i = engine.info();
      if (!wanted) return i;
      if (!zonos.ok()) return { ...i, voiceFallback: zonosFallbackNote(zonos.reason()) };
      return { ...i, voiceEngine: 'zonos', voices: [], models: { ...i.models, tts: `ZONOS3-Mini (${zonos.mode === 'web' ? 'in the studio window' : zonos.url})` } };
    },
    speak(o = {}) {
      if (o.engine !== 'zonos') return engine.speak(o);
      if (!zonos.ok()) { zonos.probe(); return engine.speak(fallbackParams(o)); }     // found again: from the next reply on
      const q = new AsyncQueue();
      const abort = new AbortController();
      let cancelled = false;
      let chain = Promise.resolve();
      let fb = null; let fbDone = null;
      const useFallback = () => {
        fb = engine.speak(fallbackParams(o));
        fbDone = (async () => { try { for await (const f of fb.frames) q.push(f); } catch (e) { if (!cancelled) q.fail(e); } })();
      };
      const params = { voice: o.zonosVoice, design: o.design, language: o.language };
      return {
        frames: q,
        write(sentence) {
          chain = chain.then(async () => {
            if (cancelled) return;
            if (fb) { fb.write(sentence); return; }
            try {
              await zonos.say(sentence, params, (f) => { if (!cancelled) q.push(f); }, abort.signal);
            } catch (e) {
              if (cancelled) return;
              // a refused request (4xx: a bad voice or dose) is not a lost server; anything else is
              if (e.status >= 400 && e.status < 500) log(`(Zonos voice: ${e.message}; this reply in the default voice)`);
              else zonos.lost(e.message);
              useFallback();
              if (!e.sent) fb.write(sentence);                      // nothing was heard of it yet: say it again
            }
          });
        },
        end() { chain = chain.then(async () => { if (fb) { fb.end(); await fbDone; } q.end(); }); },
        cancel() { cancelled = true; abort.abort(); if (fb) fb.cancel(); q.end(); },
      };
    },
  });
}
