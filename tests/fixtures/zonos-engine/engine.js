// A fake of Zonos's in-browser engine (the real one: dist/engine.js of github.com/Zyphra/ZONOS3-Mini servers/web),
// for the tests: the same two exports, `engine` (init, onFatal, onEncoderProgress) and `localFetch`, and no WebGPU.
// init() reads its "model" from the models address it is given, the way the real engine reads its shards:
// fixture.json (the voices and the sliders, written by the test) and one shard. localFetch() answers the v2 API
// like tests/mock-zonos.mjs, and keeps each /v2/generate request in window.__zonos.requests.
//   ?nogpu       init() fails the way the real engine does without WebGPU
//   ?slow=<ms>   init() takes that long, reporting its progress
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = new URLSearchParams(location.search);
const state = (window.__zonos = window.__zonos || { requests: [], inits: 0, opts: null, aborted: 0 });
let data = null;
let fatal = () => {};
window.__zonosFatal = (m) => fatal(m);

export const engine = {
  async init(progress, opts = {}) {
    state.inits++; state.opts = opts;
    if (q.has('nogpu')) throw new Error('WebGPU is not available in this browser');
    const total = 1000000000;
    progress({ models: ['backbone', 'zac'], loaded: 0, total, fetched: 0 });
    const f = await fetch(opts.base + 'fixture.json');
    if (!f.ok) throw new Error(`the model did not load (fixture.json: ${f.status})`);
    data = await f.json();
    const slow = Number(q.get('slow')) || 0;
    for (let i = 1; i <= 4; i++) { if (slow) await sleep(slow / 4); progress({ models: ['backbone', 'zac'], loaded: (total * i) / 5, total, fetched: (total * i) / 5 }); }
    const shard = await fetch(opts.base + 'backbone/shard-0.bin');
    if (!shard.ok) throw new Error(`the model did not load (backbone/shard-0.bin: ${shard.status})`);
    state.shardBytes = (await shard.arrayBuffer()).byteLength;
    const missing = await fetch(opts.base + 'zac-full_mr/manifest.json');      // an optional part the source does not have
    state.optional = missing.status;
    progress({ models: ['backbone', 'zac'], loaded: total, total, fetched: total });
  },
  onFatal(cb) { fatal = cb; },
  onEncoderProgress() {},
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const LANGUAGES = ['en_us', 'en_gb', 'fr_fr', 'de', 'es', 'it', 'pt_br', 'ja', 'cmn', 'ko'];
const FIELDS = ['text', 'stream', 'format', 'language', 'speaker_embedding_id', 'speaker_mode', 'controls', 'seed', 'temperature'];

export async function localFetch(input, init = {}) {
  const url = new URL(String(input), location.href);
  const method = (init.method || 'GET').toUpperCase();
  if (method === 'GET' && url.pathname === '/v2/health') return json(200, { status: 'ok' });
  if (method === 'GET' && url.pathname === '/v2/speakers') return json(200, { speakers: data.speakers });
  if (method === 'GET' && url.pathname === '/v2/controls') return json(200, data.controls);
  if (method === 'POST' && url.pathname === '/v2/generate') {
    let b;
    try { b = JSON.parse(init.body); } catch { return json(422, { detail: 'not JSON' }); }
    state.requests.push(b);
    const extra = Object.keys(b).filter((k) => !FIELDS.includes(k));
    if (extra.length || typeof b.text !== 'string') return json(422, { detail: `unknown or missing fields: ${extra.join(', ')}` });
    if (b.language !== undefined && !LANGUAGES.includes(b.language)) return json(400, { detail: `unknown language ${b.language}` });
    if (b.speaker_embedding_id != null && !data.speakers.some((s) => s.id === b.speaker_embedding_id)) return json(400, { detail: 'unknown speaker' });
    const bad = Object.keys(b.controls || {}).filter((k) => !data.controls.directions[k]);
    if (bad.length) return json(400, { detail: `unknown control ${bad.join(', ')}` });
    // a 220 Hz tone, float32 LE mono 44.1 kHz, in chunks of 4001 bytes (never a whole sample); ?long: 3 s of it
    const n = Math.round((/long sentence/.test(b.text) ? 3 : 0.6) * 44100);
    const pcm = new Uint8Array(n * 4);
    const dv = new DataView(pcm.buffer);
    for (let i = 0; i < n; i++) dv.setFloat32(i * 4, 0.4 * Math.sin((2 * Math.PI * 220 * i) / 44100), true);
    let at = 0;
    const signal = init.signal;
    const body = new ReadableStream({
      async pull(c) {
        if (signal && signal.aborted) { state.aborted++; c.error(new DOMException('aborted', 'AbortError')); return; }
        if (at >= pcm.length) { c.close(); return; }
        await sleep(2);
        c.enqueue(pcm.slice(at, at + 4001)); at += 4001;
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream', 'x-audio-sample-rate': '44100', 'x-audio-channels': '1', 'x-audio-format': 'f32le', 'x-seed': '1' } });
  }
  return json(404, { detail: 'Not found' });
}
