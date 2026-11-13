// A fake Zonos server (ZONOS3-Mini's HTTP API, github.com/Zyphra/ZONOS3-Mini, servers/api/openapi.yaml) for the
// tests: health, the default voices, the design sliders, and /v2/generate, which checks the request the way the
// real server does (unknown fields: 422; an unknown voice, language or control: 400) and streams float32 PCM at
// 44.1 kHz in chunks that do not fall on sample boundaries.
import { createServer } from 'node:http';

export const SPEAKERS = [
  { id: 'default_de4d191ca7574982', label: 'Savannah' },
  { id: 'default_517319c805b927e9', label: 'Gaspard' },
].map((s) => ({ ...s, source_type: 'audio', scope: 'default', is_default: true, original_name: null, created_at: 0, has_preview: true,
  speaker_modes: ['embedding', 'reference'], embedding_dim: 192, transcript: null, disabled_controls: [] }));

/** A part of the real studio bundle (assets/steering/studio_bundle_mect60k_x10.json): same shapes, same numbers. */
export const CONTROLS = {
  bundle: 'studio_bundle_test', embedding_dim: 192, timing: {}, steer_release: null,
  sets: { identity: { space: 'speaker_embedding', modes: ['embedding'] }, texture: { space: 'speaker_embedding', modes: ['embedding'] }, delivery: { space: 'hidden', modes: ['embedding', 'reference'] }, mood: { space: 'hidden', modes: ['embedding', 'reference'] } },
  directions: Object.fromEntries(['identity.gender', 'identity.age', 'texture.deep', 'delivery.whisper', 'delivery.loud', 'mood.valence']
    .map((d) => [d, { set: d.split('.')[0], space: 'x', kind: 'direction', norm: 1 }])),
  ui: {
    groups: [{ id: 'who', label: 'Who' }, { id: 'texture', label: 'Texture' }, { id: 'delivery', label: 'Delivery' }],
    controls: [
      { id: 'gender', group: 'who', label: 'Gender', type: 'bipolar', poles: ['masculine', 'feminine'], map: { '-': { 'identity.gender': -1 }, '+': { 'identity.gender': 1 } }, range: [-3, 3], safe: [-2, 2], effect: '±2 flips the gender' },
      { id: 'age', group: 'who', label: 'Age', type: 'bipolar', poles: ['younger', 'older'], map: { '-': { 'identity.age': -1 }, '+': { 'identity.age': 1 } }, range: [-3, 3], safe: [-2, 2] },
      { id: 'deep', group: 'texture', label: 'Deep', type: 'unipolar', map: { '+': { 'texture.deep': 1 } }, range: [0, 6], safe: [0, 4] },
      { id: 'projection', group: 'delivery', label: 'Projection', type: 'bipolar', poles: ['whisper', 'loud'], map: { '-': { 'delivery.whisper': 1 }, '+': { 'delivery.loud': 1 } }, range: [-3, 4], safe: [-1.5, 2] },
    ],
  },
};
const LANGUAGES = ['en_us', 'en_gb', 'fr_fr', 'de', 'es', 'it', 'pt_br', 'ja', 'cmn', 'ko'];
const FIELDS = ['text', 'stream', 'format', 'language', 'speaker_embedding_id', 'speaker_mode', 'controls', 'seed', 'temperature'];

/**
 * @param {{controls?: boolean, token?: string, seconds?: number}} o  controls false: a server without a steering bundle
 * @returns {Promise<{url: string, port: number, requests: any[], failNext: (how: 'refuse'|'drop') => void, close: () => Promise<void>}>}
 */
export async function startMockZonos(o = {}) {
  const requests = [];
  let fail = '';
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (o.token && req.headers.authorization !== `Bearer ${o.token}`) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Access denied'); return; }
    if (req.method === 'GET' && path === '/v2/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && path === '/v2/speakers') return json(res, 200, { speakers: SPEAKERS });
    if (req.method === 'GET' && path === '/v2/controls') return o.controls === false ? json(res, 404, { detail: 'no steering bundle' }) : json(res, 200, CONTROLS);
    if (req.method === 'POST' && path === '/v2/generate') {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        let b;
        try { b = JSON.parse(raw); } catch { return json(res, 422, { detail: 'not JSON' }); }
        requests.push(b);
        if (fail === 'drop') { fail = ''; res.destroy(); return; }
        if (fail === 'refuse') { fail = ''; return json(res, 400, { detail: 'refused for the test' }); }
        const extra = Object.keys(b).filter((k) => !FIELDS.includes(k));
        if (extra.length || typeof b.text !== 'string') return json(res, 422, { detail: `unknown or missing fields: ${extra.join(', ')}` });
        if (b.language !== undefined && !LANGUAGES.includes(b.language)) return json(res, 400, { detail: `unknown language ${b.language}` });
        if (b.speaker_embedding_id != null && !SPEAKERS.some((s) => s.id === b.speaker_embedding_id)) return json(res, 400, { detail: 'unknown speaker' });
        const bad = Object.keys(b.controls || {}).filter((k) => !CONTROLS.directions[k]);
        if (bad.length || (b.controls && o.controls === false)) return json(res, 400, { detail: `unknown control ${bad.join(', ')}` });
        if (b.format === 'wav' && b.stream !== false) return json(res, 400, { detail: 'wav needs stream=false' });
        // the "voice": a 220 Hz tone, float32 LE mono 44.1 kHz, sent in chunks of 4001 bytes (never a whole sample)
        const n = Math.round((o.seconds || 0.6) * 44100);
        const pcm = Buffer.alloc(n * 4);
        for (let i = 0; i < n; i++) pcm.writeFloatLE(0.4 * Math.sin((2 * Math.PI * 220 * i) / 44100), i * 4);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-audio-sample-rate': '44100', 'x-audio-channels': '1', 'x-audio-format': 'f32le', 'x-seed': '1' });
        let at = 0;
        const step = () => {
          if (res.destroyed) return;
          if (at >= pcm.length) { res.end(); return; }
          res.write(pcm.subarray(at, at + 4001)); at += 4001;
          setTimeout(step, 2);
        };
        step();
      });
      return;
    }
    json(res, 404, { detail: 'Not found' });
  });
  await new Promise((r) => server.listen(o.port || 0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`, port, requests,
    failNext(how) { fail = how; },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
