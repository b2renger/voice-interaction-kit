// Zonos voice: Zyphra's ZONOS3-Mini (Apache-2.0 weights, MIT runtime), a voice DESIGNED with sliders (age, gender,
// pitch, texture, mood…) in 44 language codes, French included. It does not run through QVAC: it is spoken by a
// Zonos server on this computer (https://github.com/Zyphra/ZONOS3-Mini: zonos3-server, or the MLX server on a Mac),
// reached over its HTTP API (servers/api/openapi.yaml there, read on 13 November 2026):
//   GET  /v2/health      {status: 'ok'}
//   GET  /v2/speakers    {speakers: [{id, label, is_default, …}]}: the default voices
//   GET  /v2/controls    the steering bundle: its sliders are in ui.controls (404 without a bundle)
//   POST /v2/generate    {text, language, stream, format: 'pcm', speaker_embedding_id, speaker_mode, controls}
//                        → float32 little-endian mono PCM at 44.1 kHz, chunked
//
// It is an EXTRA voice (setting localVoiceEngine: 'zonos'), wrapped around the engine that does everything else
// (withZonos): when no Zonos server answers, the engine's own default voice speaks instead, and says so.
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

/**
 * The Zonos server of config.json ("models.tts.zonos": {url, voice, token, speakerMode, options}).
 * @param {{url?: string, voice?: string, token?: string, speakerMode?: string, options?: object, timeoutMs?: number}} cfg
 */
export function createZonosVoice(cfg = {}, log = () => {}) {
  const url = String(cfg.url || ZONOS_DEFAULT_URL).replace(/\/+$/, '');
  const headers = cfg.token ? { authorization: `Bearer ${cfg.token}` } : {};
  const st = { ok: false, checkedAt: 0, checking: null, speakers: [], doc: null, reason: 'not checked yet' };

  async function getJson(path, ms) {
    const r = await fetch(url + path, { headers, signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw Object.assign(new Error(`${path} answered ${r.status}`), { status: r.status });
    return r.json();
  }

  /** Is a Zonos server there? Asks at most every 5 s, unless forced. Never throws. */
  function probe(force = false) {
    if (st.checking) return st.checking;
    if (!force && Date.now() - st.checkedAt < 5000) return Promise.resolve(st.ok);
    st.checking = (async () => {
      const was = st.ok;
      try {
        const h = await getJson('/v2/health', num(cfg.timeoutMs, 1500));
        if (!h || h.status !== 'ok') throw new Error('its health check did not say "ok"');
        const [sp, doc] = await Promise.all([
          getJson('/v2/speakers', 5000).then((j) => (Array.isArray(j && j.speakers) ? j.speakers : []), () => []),
          getJson('/v2/controls', 5000).catch(() => null),          // 404: a server started without a steering bundle
        ]);
        st.speakers = sp; st.doc = doc; st.ok = true; st.reason = '';
        if (!was) log(`▸ Zonos voice: server at ${url} (${sp.length} voice(s), ${designSliders(doc).length} design slider(s))`);
      } catch (e) {
        st.ok = false;
        st.reason = e.status === 401 || e.status === 403 ? `the Zonos server at ${url} refused the access token` : `no Zonos server answers at ${url}`;
        if (was || !st.checkedAt) log(`(Zonos voice: ${st.reason}${e.message ? ` — ${e.message}` : ''})`);
      }
      st.checkedAt = Date.now(); st.checking = null;
      return st.ok;
    })();
    return st.checking;
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
      const r = await fetch(`${url}/v2/generate`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
      if (!r.ok) {
        const detail = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
        throw Object.assign(new Error(`the Zonos server answered ${r.status}${detail ? `: ${detail}` : ''}`), { status: r.status });
      }
      const rate = num(r.headers.get('x-audio-sample-rate'), ZONOS_RATE) || ZONOS_RATE;
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
      for await (const chunk of r.body) {
        pending = pending.length ? Buffer.concat([pending, Buffer.from(chunk)]) : Buffer.from(chunk);
        flush(false);
      }
      flush(true);
      return sent;
    } catch (e) { e.sent = sent; throw e; }
  }

  return {
    url,
    probe,
    say,
    voiceId,
    ok: () => st.ok,
    reason: () => st.reason,
    /** A server that stopped answering: the default voice takes over until a check finds it again. */
    lost(why) { if (st.ok) log(`(Zonos voice: ${why}; the default voice takes over)`); st.ok = false; st.reason = `the Zonos server at ${url} stopped answering`; st.checkedAt = Date.now(); },
    /** What the studio shows: is it there, its voices, its sliders. */
    describe() {
      return {
        available: st.ok, url, error: st.ok ? '' : st.reason,
        voices: st.ok ? st.speakers.map((s) => ({ id: String(s.id), label: String(s.label || s.id), default: !!s.is_default })) : [],
        sliders: st.ok ? designSliders(st.doc) : [],
      };
    },
  };
}

export const zonosFallbackNote = (reason) => `Zonos voice unavailable (${reason}): the default voice speaks instead.`;

/**
 * An engine with the Zonos voice added. Everything goes to `engine` as before; only with the setting
 * localVoiceEngine 'zonos' AND a Zonos server that answers does the voice come from Zonos. Otherwise the
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
      if (wanted) await zonos.probe(true);
    },
    info() {
      const i = engine.info();
      if (!wanted) return i;
      if (!zonos.ok()) return { ...i, voiceFallback: zonosFallbackNote(zonos.reason()) };
      return { ...i, voiceEngine: 'zonos', voices: [], models: { ...i.models, tts: `ZONOS3-Mini (${zonos.url})` } };
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
