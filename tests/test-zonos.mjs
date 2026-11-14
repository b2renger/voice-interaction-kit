// Tests the Zonos voice (app/src/engines/zonos.mjs) WITHOUT Zonos, a model or WebGPU (Node 22+ only): a fake
// server (tests/mock-zonos.mjs) speaks ZONOS3-Mini's HTTP API and checks each request the way the real one does,
// and a fake in-browser engine (tests/fixtures/zonos-engine/engine.js) stands in for the real one in the window.
//   - the design line ("age +1.5, deep 3") and the doses it becomes;
//   - the voice wrapped around the simulated engine: Zonos speaks when its server is there, the default voice
//     otherwise, and when the server refuses a request or disappears in the middle of a reply;
//   - a conversation through the real local server (simulated engine, then the QVAC adapter on the fake SDK);
//   - Zonos in the studio's window ("mode": "web", the default): the engine's files and its model served and kept
//     on the computer, a window that answers over the page bridge (a fake one in Node, then the studio in Chromium).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, mkdtempSync, existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { ROOT, check, skip, summary, sleep, until, loadPlaywright } from './helpers.mjs';
import { startMockZonos, CONTROLS, SPEAKERS } from './mock-zonos.mjs';
import { parseDesign, designDoses, designSliders, zonosLanguage, f32ToS16, createZonosVoice, withZonos } from '../app/src/engines/zonos.mjs';
import { createMockEngine } from '../app/src/engines/mock.mjs';
import { mergeConfig, loadConfig } from '../app/src/config.mjs';
import { createZonosFiles } from '../app/src/engines/zonos-files.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// — the design line —
check(same(parseDesign('age +1.5, deep 3; gender=-1\nprojection: -2'), { age: 1.5, deep: 3, gender: -1, projection: -2 }), 'design: "age +1.5, deep 3; gender=-1" is read (commas, semicolons, lines, = and :)', parseDesign('age +1.5, deep 3; gender=-1\nprojection: -2'));
check(same(parseDesign('age 0, nonsense, deep'), {}) && same(parseDesign(''), {}) && same(parseDesign(null), {}), 'design: a zero, a word without a number and an empty line give nothing');
check(same(parseDesign('identity.age 1.5'), { 'identity.age': 1.5 }), 'design: a raw "<set>.<direction>" dose is read');
const d1 = designDoses('gender -1.5, age +1, deep 3', CONTROLS);
check(same(d1.doses, { 'identity.gender': -1.5, 'identity.age': 1, 'texture.deep': 3 }) && !d1.unknown.length, 'doses: gender -1.5, age +1, deep 3 → identity.gender -1.5, identity.age 1, texture.deep 3', d1);
check(same(designDoses('projection -2', CONTROLS).doses, { 'delivery.whisper': 2 }) && same(designDoses('projection 2', CONTROLS).doses, { 'delivery.loud': 2 }), 'doses: a slider with two directions (projection: whisper ↔ loud) doses the right one, positively');
check(same(designDoses('age 9, deep -4', CONTROLS).doses, { 'identity.age': 3 }), 'doses: a value is clamped to the slider\'s range; a one-sided slider pushed the other way does nothing', designDoses('age 9, deep -4', CONTROLS).doses);
const d2 = designDoses('robot 2, mood.valence 2, mood.nope 1', CONTROLS);
check(same(d2.doses, { 'mood.valence': 2 }) && same(d2.unknown, ['robot', 'mood.nope']), 'doses: a raw dose the server knows is kept; unknown names are left out and listed', d2);
check(same(designDoses('age 1', null).doses, {}) && same(designDoses('identity.age 1', null).doses, { 'identity.age': 1 }), 'doses: without the server\'s sliders, only raw doses go');
const sl = designSliders(CONTROLS);
check(sl.length === 4 && sl[0].id === 'gender' && sl[0].group === 'Who' && sl[0].min === -3 && sl[0].max === 3 && same(sl[0].poles, ['masculine', 'feminine']) && sl[2].poles === null, 'sliders: the studio gets each slider\'s name, group, range and poles', sl[0]);
check(zonosLanguage('fr') === 'fr_fr' && zonosLanguage('en') === 'en_us' && zonosLanguage('pt') === 'pt_br' && zonosLanguage('zh') === 'cmn' && zonosLanguage('de') === 'de' && zonosLanguage('fr-CA') === 'fr_fr' && zonosLanguage('xx') === 'en_us' && zonosLanguage('') === 'en_us',
  'languages: fr → fr_fr, en → en_us, pt → pt_br, zh → cmn, de → de; unknown → en_us');
{
  const b = Buffer.alloc(16); b.writeFloatLE(0, 0); b.writeFloatLE(0.5, 4); b.writeFloatLE(-2, 8); b.writeFloatLE(1, 12);
  check(same(Array.from(f32ToS16(b)), [0, 16384, -32767, 32767]), 'audio: float32 → 16-bit, clipped', Array.from(f32ToS16(b)));
}
check(mergeConfig(loadConfig(join(ROOT, 'app', 'config.json')), { models: { tts: { zonos: { voice: 'Gaspard' } } } }).models.tts.zonos.url === 'http://127.0.0.1:1919'
  && loadConfig(join(tmpdir(), 'no-such-config.json')).models.tts.zonos.url === 'http://127.0.0.1:1919', 'config: "models.tts.zonos" is merged key by key; its address defaults to http://127.0.0.1:1919');

// — the voice around the simulated engine —
const collect = async (tts, sentences) => {
  for (const s of sentences) tts.write(s);
  tts.end();
  const frames = [];
  for await (const f of tts.frames) frames.push(f);
  return frames;
};
const logs = [];
const log = (m) => logs.push(m);
const fake = await startMockZonos();
{
  const zonos = createZonosVoice({ mode: 'server', url: fake.url }, log);
  const engine = withZonos(await createMockEngine({}), zonos, log);
  await engine.prepare({ localVoiceEngine: 'supertonic' }, () => {});
  check(engine.info().voiceEngine === 'supertonic' && engine.info().voices.includes('F1') && !fake.requests.length, 'another voice engine chosen: nothing changes, Zonos is not asked');
  const f0 = await collect(engine.speak({ engine: 'supertonic', voice: 'F1', speed: 1 }), ['Hello.']);
  check(f0.length > 0 && f0.every((f) => f.sampleRate === 24000) && !fake.requests.length, 'another voice engine: its own voice speaks');

  await engine.prepare({ localVoiceEngine: 'zonos' }, () => {});
  const info = engine.info();
  check(info.voiceEngine === 'zonos' && same(info.voices, []) && /ZONOS3-Mini/.test(info.models.tts) && !info.voiceFallback && info.engine === 'mock', 'Zonos chosen, its server there: info() says voiceEngine "zonos" (no preset voices)', info);
  check(engine.name === 'mock' && typeof engine.openAsr === 'function' && typeof engine.generate === 'function' && typeof engine.choices === 'function', 'the rest of the engine is untouched (hearing, thinking, the models offered)');
  const d = zonos.describe();
  check(d.available && d.voices.length === 2 && d.voices[1].label === 'Gaspard' && d.sliders.length === 4, 'the studio is told: available, the voices, the sliders', d);

  const frames = await collect(engine.speak({ engine: 'zonos', language: 'fr', zonosVoice: 'Gaspard', design: 'age +1.5, deep 3, gender -1' }), ['Bonjour.', 'Bienvenue au musée.']);
  const samples = frames.reduce((n, f) => n + f.pcm.length, 0);
  check(frames.length > 2 && frames.every((f) => f.sampleRate === 44100 && f.pcm instanceof Int16Array), 'Zonos speaks: 16-bit frames at 44.1 kHz', frames.length);
  check(samples === 2 * Math.round(0.6 * 44100), 'every sample arrives, though the chunks do not fall on sample boundaries', samples);
  check(same(frames.filter((f) => f.text).map((f) => f.text), ['Bonjour.', 'Bienvenue au musée.']) && frames[0].text === 'Bonjour.', 'each sentence\'s text rides on its first frame (captions)');
  const peak = Math.max(...Array.from(frames[1].pcm).map(Math.abs));
  check(peak > 12000 && peak < 14000, 'the audio is the server\'s (a 0.4 amplitude tone)', peak);
  const r = fake.requests[0];
  check(fake.requests.length === 2 && r.text === 'Bonjour.' && r.language === 'fr_fr' && r.stream === true && r.format === 'pcm', 'the request: text, language fr_fr, stream, pcm', r);
  check(r.speaker_embedding_id === SPEAKERS[1].id && r.speaker_mode === 'embedding', 'the voice named "Gaspard" is sent by its id, in embedding mode (the identity sliders need it)', r);
  check(same(r.controls, { 'identity.age': 1.5, 'texture.deep': 3, 'identity.gender': -1 }), 'the design is sent as doses with each sentence', r.controls);

  fake.requests.length = 0;
  await collect(engine.speak({ engine: 'zonos', language: 'en', zonosVoice: '', design: '' }), ['Hi.']);
  check(fake.requests[0].speaker_embedding_id === SPEAKERS[0].id && !('controls' in fake.requests[0]) && fake.requests[0].language === 'en_us', 'no voice chosen, no design: the server\'s first default voice, no controls');
  await collect(engine.speak({ engine: 'zonos', language: 'en', zonosVoice: 'default_517319c805b927e9', design: 'robot 3' }), ['Hi.']);
  check(fake.requests[1].speaker_embedding_id === SPEAKERS[1].id && !('controls' in fake.requests[1]), 'a voice chosen by its id; a slider the server does not have is not sent');

  // a refused request: that reply in the default voice, Zonos still there for the next
  fake.requests.length = 0; fake.failNext('refuse');
  const f1 = await collect(engine.speak({ engine: 'zonos', language: 'en' }), ['One.', 'Two.']);
  check(f1.length > 0 && f1.every((f) => f.sampleRate === 24000) && f1.filter((f) => f.text).map((f) => f.text).join(' ') === 'One. Two.' && fake.requests.length === 1, 'the server refuses a sentence (400): the whole reply is said by the default voice, nothing is lost', f1.map((f) => f.sampleRate));
  check(zonos.ok() && engine.info().voiceEngine === 'zonos', '…and Zonos is still the voice for the next reply');
  const f2 = await collect(engine.speak({ engine: 'zonos', language: 'en' }), ['Three.']);
  check(f2.every((f) => f.sampleRate === 44100), 'the next reply: Zonos again');

  // cancelling in the middle of a reply (the person interrupts)
  const t = engine.speak({ engine: 'zonos', language: 'en' });
  t.write('A sentence that will be cut.'); t.write('Never said.');
  let got = 0; const before = fake.requests.length;
  for await (const f of t.frames) { got += f.pcm.length; t.cancel(); }
  await sleep(100);
  check(got > 0 && got < Math.round(0.6 * 44100) && fake.requests.length === before + 1, 'cancel(): the audio stops at once, the next sentence is never asked for', got);

  // the server disappears in the middle of a conversation
  fake.failNext('drop');
  const f3 = await collect(engine.speak({ engine: 'zonos', language: 'en' }), ['Four.', 'Five.']);
  check(f3.length > 0 && f3.every((f) => f.sampleRate === 24000) && f3.filter((f) => f.text).map((f) => f.text).join(' ') === 'Four. Five.', 'the server drops the connection: the default voice says the reply');
  check(!zonos.ok() && engine.info().voiceEngine === 'supertonic' && /Zonos voice unavailable/.test(engine.info().voiceFallback || ''), '…and info() says the default voice speaks instead, and why', engine.info().voiceFallback);
  const f4 = await collect(engine.speak({ engine: 'zonos', language: 'en' }), ['Six.']);
  check(f4.every((f) => f.sampleRate === 24000), 'while it is gone, the default voice speaks without waiting for it');
  await engine.prepare({ localVoiceEngine: 'zonos' }, () => {});
  check(zonos.ok() && engine.info().voiceEngine === 'zonos', 'choosing the voice again (or a new Start) finds the server again');
}
{
  // no server at all
  const gone = createZonosVoice({ mode: 'server', url: 'http://127.0.0.1:9', timeoutMs: 300 }, log);
  const engine = withZonos(await createMockEngine({}), gone, log);
  const t0 = Date.now();
  await engine.prepare({ localVoiceEngine: 'zonos' }, () => {});
  const info = engine.info();
  check(info.voiceEngine === 'supertonic' && /no Zonos server answers at http:\/\/127\.0\.0\.1:9/.test(info.voiceFallback) && Date.now() - t0 < 3000, 'no Zonos server: the default voice stays, info().voiceFallback says why, and it does not hang', info.voiceFallback);
  const f = await collect(engine.speak({ engine: 'zonos', language: 'fr', design: 'age 2' }), ['Bonjour.']);
  check(f.length > 0 && f.every((x) => x.sampleRate === 24000), 'no Zonos server: the reply is said by the default voice');
  check(same(gone.describe().voices, []) && gone.describe().available === false && !!gone.describe().error, 'the studio is told: not available, and why');
}
{
  // a server without design sliders, and one with an access token
  const plain = await startMockZonos({ controls: false });
  const z = createZonosVoice({ mode: 'server', url: plain.url }, log);
  const engine = withZonos(await createMockEngine({}), z, log);
  await engine.prepare({ localVoiceEngine: 'zonos' }, () => {});
  const f = await collect(engine.speak({ engine: 'zonos', language: 'en', design: 'age 2' }), ['Hi.']);
  check(z.ok() && same(z.describe().sliders, []) && f.every((x) => x.sampleRate === 44100) && !('controls' in plain.requests[0]), 'a server without a steering file: Zonos speaks, with no sliders and no controls sent');
  await plain.close();
  const locked = await startMockZonos({ token: 'secret' });
  const no = createZonosVoice({ mode: 'server', url: locked.url }, log);
  const yes = createZonosVoice({ mode: 'server', url: locked.url, token: 'secret' }, log);
  check(!(await no.probe(true)) && /refused the access token/.test(no.reason()) && (await yes.probe(true)), 'a server with an access token: refused without it (and said so), reached with "token" in config.json', no.reason());
  await locked.close();
}

// — a conversation through the local server —
const servers = [];
const serverLog = [];
process.on('exit', () => { for (const p of servers) { try { p.kill(); } catch { /* gone */ } } });   // also when a check throws
function startServer(port, engine, zonos) {
  const cwd = mkdtempSync(join(tmpdir(), 'vik-zonos-'));
  // a string: a Zonos server at that address ("mode": "server"); an object: the "zonos" section as given
  writeFileSync(join(cwd, 'config.json'), JSON.stringify({ modelMirror: '', models: { tts: { zonos: typeof zonos === 'string' ? { mode: 'server', url: zonos } : zonos } } }));
  const env = { ...process.env, VIK_AGENTS: mkdtempSync(join(tmpdir(), 'vik-agents-zonos-')) };
  const args = [join(ROOT, 'app', 'src', 'server.mjs'), '--port', String(port), '--config', 'config.json'];
  if (engine === 'mock') args.push('--mock'); else env.QVAC_SDK = pathToFileURL(join(ROOT, 'tests', 'fake-qvac-sdk.mjs')).href;
  const proc = spawn(process.execPath, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (x) => serverLog.push(String(x))); proc.stderr.on('data', (x) => serverLog.push(String(x)));
  servers.push(proc);
  return until(async () => { try { const j = await (await fetch(`http://127.0.0.1:${port}/health`)).json(); return j.models === 'ready' && j; } catch { return false; } }, 15000);
}
async function connect(port) {
  const c = { msgs: [], audio: [] };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/voice`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') { c.msgs.push(JSON.parse(e.data)); return; }
    const dv = new DataView(e.data);
    c.audio.push({ rate: dv.getUint32(0, true), turnId: dv.getUint32(4, true) });
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.has = (type, f = () => true) => c.msgs.find((m) => m.type === type && f(m));
  c.waitFor = (type, f, ms = 8000) => until(() => c.has(type, f), ms);
  c.turn = async (text) => {
    const prev = Math.max(0, ...c.msgs.filter((m) => m.type === 'bot.done').map((m) => m.turnId));
    c.send({ type: 'text', text });
    const d = await c.waitFor('bot.done', (m) => m.turnId > prev, 10000);
    if (d) c.send({ type: 'playback', state: 'ended', turnId: d.turnId });
    return d;
  };
  c.rates = (d) => [...new Set(c.audio.filter((a) => d && a.turnId === d.turnId).map((a) => a.rate))];
  c.close = () => { try { ws.close(); } catch { /* closed */ } };
  return c;
}
const base = 19900 + Math.floor(Math.random() * 300);
for (const [i, engine] of ['mock', 'fake-qvac'].entries()) {
  const port = base + i;
  const own = engine === 'mock' ? 24000 : 44100;      // the default voice's rate: simulated engine, Supertonic through the fake SDK
  fake.requests.length = 0;
  check(await startServer(port, engine, fake.url), `[${engine}] the local server starts`);
  const api = await (await fetch(`http://127.0.0.1:${port}/api/voice/zonos`)).json();
  check(api.available === true && api.url === fake.url && api.voices.some((v) => v.label === 'Gaspard') && api.sliders.some((s) => s.id === 'age' && s.group === 'Who'), `[${engine}] GET /api/voice/zonos: the voices and the sliders for the studio`, api);
  const c = await connect(port);
  c.send({ type: 'start', settings: { name: 'Test', persona: 'You are a test robot.', language: 'fr', greeting: '', localVoiceEngine: 'zonos', zonosVoice: 'Gaspard', voiceDesign: 'age +1.5, deep 3' } });
  const ready = await c.waitFor('ready');
  check(ready && ready.voiceEngine === 'zonos' && same(ready.voices, []), `[${engine}] start with the Zonos voice → ready {voiceEngine: "zonos", voices: []}`, ready);
  const t1 = await c.turn('Bonjour !');
  check(t1 && !c.has('error') && same(c.rates(t1), [44100]), `[${engine}] a reply is spoken by Zonos (44.1 kHz)`, c.rates(t1));
  const r = fake.requests[fake.requests.length - 1];
  check(r && r.language === 'fr_fr' && r.speaker_embedding_id === SPEAKERS[1].id && same(r.controls, { 'identity.age': 1.5, 'texture.deep': 3 }), `[${engine}] its requests carry the agent's language, voice and design`, r);
  c.send({ type: 'settings', settings: { voiceDesign: 'gender -2' } });
  await sleep(200);
  const before = fake.requests.length;
  const t2 = await c.turn('Et ensuite ?');
  check(t2 && !c.has('status', (m) => /reloading/.test(m.text)) && same(fake.requests[before].controls, { 'identity.gender': -2 }), `[${engine}] a new design applies to the next reply, without reloading anything`, fake.requests[before] && fake.requests[before].controls);
  c.send({ type: 'settings', settings: { localVoiceEngine: 'supertonic' } });
  await sleep(600);
  const n = fake.requests.length;
  const t3 = await c.turn('Merci.');
  check(t3 && same(c.rates(t3), [own]) && fake.requests.length === n, `[${engine}] back to Supertonic: its voice, Zonos is no longer asked`, c.rates(t3));
  c.close();
  await sleep(200);
}
{
  // the same server, but no Zonos server behind it
  const port = base + 5;
  check(await startServer(port, 'mock', 'http://127.0.0.1:9'), '[no Zonos server] the local server starts all the same');
  const api = await (await fetch(`http://127.0.0.1:${port}/api/voice/zonos`)).json();
  check(api.available === false && same(api.voices, []) && same(api.sliders, []) && /no Zonos server answers/.test(api.error), '[no Zonos server] GET /api/voice/zonos says so', api);
  const c = await connect(port);
  c.send({ type: 'start', settings: { name: 'Test', persona: 'You are a test robot.', language: 'fr', greeting: '', localVoiceEngine: 'zonos', voiceDesign: 'age 2' } });
  const ready = await c.waitFor('ready');
  check(ready && ready.voiceEngine === 'supertonic' && ready.voices.includes('F1'), '[no Zonos server] start → ready with the default voice', ready);
  const note = await c.waitFor('status', (m) => /^Zonos voice unavailable \(no Zonos server answers at http:\/\/127\.0\.0\.1:9\): the default voice speaks instead\.$/.test(m.text), 3000);
  check(!!note && !c.has('error'), '[no Zonos server] the status says "Zonos voice unavailable (…): the default voice speaks instead."', note);
  const t = await c.turn('Bonjour !');
  check(t && same(c.rates(t), [24000]) && !c.has('error'), '[no Zonos server] the conversation goes on in the default voice', c.rates(t));
  c.close();
}


// ======================= Zonos in the studio's window ("mode": "web") ==========================================
// — the model's source (a stand-in for huggingface.co/Zyphra/ZONOS3-Mini, web/) —
const shard = Buffer.alloc(300000, 7);
const source = { hits: [], down: false };
const sourceServer = createServer((req, res) => {
  const path = decodeURIComponent((req.url || '/').split('?')[0]);
  source.hits.push(path);
  if (source.down) { res.destroy(); return; }
  const send = (type, body) => { res.writeHead(200, { 'content-type': type, 'content-length': body.length }); res.end(body); };
  if (path === '/web/fixture.json') return send('application/json', Buffer.from(JSON.stringify({ speakers: SPEAKERS, controls: CONTROLS })));
  if (path === '/web/backbone/shard-0.bin') return send('application/octet-stream', shard);
  if (path === '/web/voices/Mandarin Chinese/a b.mp3') return send('audio/mpeg', Buffer.from('mp3'));
  if (path === '/web/broken.bin') { res.writeHead(200, { 'content-length': 1000 }); res.write(Buffer.alloc(10)); setTimeout(() => res.destroy(), 20); return; }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => sourceServer.listen(0, '127.0.0.1', r));
const sourceUrl = `http://127.0.0.1:${sourceServer.address().port}/web/`;
const ENGINE_DIR = join(ROOT, 'tests', 'fixtures', 'zonos-engine');

// — the files: the engine, and the model downloaded once —
{
  const modelsDir = mkdtempSync(join(tmpdir(), 'vik-zonos-models-'));
  const files = createZonosFiles({ engineDir: ENGINE_DIR, modelsDir, models: sourceUrl }, join(ROOT, 'app'), log);
  const srv = createServer((req, res) => { if (!files.handle(req, res, decodeURIComponent((req.url || '/').split('?')[0]))) { res.writeHead(418); res.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${srv.address().port}`;
  const get = async (path, init) => { const r = await fetch(at + path, init); return { status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()) }; };
  check(files.enginePresent() && !createZonosFiles({}, join(ROOT, 'app')).enginePresent(), 'files: the engine is "present" when its folder holds engine.js (not in a plain checkout: it is built, not committed)');
  const e = await get('/zonos/engine/engine.js');
  check(e.status === 200 && /javascript/.test(e.type) && e.body.includes('export async function localFetch'), 'files: /zonos/engine/engine.js is served as JavaScript');
  check((await get('/zonos/engine/nope.js')).status === 404 && (await get('/zonos/engine/..%2f..%2fpackage.json')).status === 404 && (await get('/zonos/models/..%2f..%2fx')).status === 404, 'files: a missing file is a 404, and nothing outside the folders is served');
  const [a, b] = await Promise.all([get('/zonos/models/backbone/shard-0.bin'), get('/zonos/models/backbone/shard-0.bin')]);
  check(a.status === 200 && a.body.equals(shard) && b.body.equals(shard) && source.hits.filter((h) => h === '/web/backbone/shard-0.bin').length === 1, 'files: a model file asked twice at once is downloaded once', source.hits);
  check(existsSync(join(modelsDir, 'backbone', 'shard-0.bin')) && readFileSync(join(modelsDir, 'backbone', 'shard-0.bin')).equals(shard) && !readdirSync(join(modelsDir, 'backbone')).some((f) => f.endsWith('.part')), 'files: …and kept in the models folder, with no partial file left');
  const again = await get('/zonos/models/backbone/shard-0.bin');
  check(again.body.equals(shard) && source.hits.filter((h) => h === '/web/backbone/shard-0.bin').length === 1, 'files: the next time it comes from the computer, the source is not asked');
  const sp = await get('/zonos/models/voices/Mandarin%20Chinese/a%20b.mp3');
  check(sp.status === 200 && sp.type === 'audio/mpeg' && sp.body.toString() === 'mp3', 'files: a name with spaces is asked of the source correctly');
  check((await get('/zonos/models/zac-full_mr/manifest.json')).status === 404 && !existsSync(join(modelsDir, 'zac-full_mr')), 'files: what the source does not have is a 404 here too, and nothing is kept');
  const asked = source.hits.length;
  check((await get('/zonos/models/zac-full_mr/manifest.json')).status === 404 && source.hits.length === asked && JSON.parse(readFileSync(join(modelsDir, 'absent.json'), 'utf8'))['zac-full_mr/manifest.json'] > 0, 'files: …and that is remembered (absent.json): the source is not asked again');
  const broken = await get('/zonos/models/broken.bin');
  check(broken.status === 502 && !existsSync(join(modelsDir, 'broken.bin')) && !existsSync(join(modelsDir, 'broken.bin.part')), 'files: a download cut short is an error, and no half file is kept', broken.status);
  source.down = true;
  check((await get('/zonos/models/backbone/shard-0.bin')).body.equals(shard) && (await get('/zonos/models/other.bin')).status === 502 && (await get('/zonos/models/zac-full_mr/manifest.json')).status === 404,
    'files: offline, what was downloaded is still served, what is known to be absent is still a 404 (the engine needs that to start), the rest is an error, not a hang');
  writeFileSync(join(modelsDir, 'absent.json'), JSON.stringify({ 'zac-full_mr/manifest.json': Date.now() - 8 * 24 * 3600 * 1000, 'backbone/late.bin': Date.now() - 8 * 24 * 3600 * 1000 }));
  const old = createZonosFiles({ modelsDir, models: sourceUrl }, join(ROOT, 'app'));
  const srv3 = createServer((req, res) => { old.handle(req, res, (req.url || '/').split('?')[0]); });
  await new Promise((r) => srv3.listen(0, '127.0.0.1', r));
  check((await fetch(`http://127.0.0.1:${srv3.address().port}/zonos/models/zac-full_mr/manifest.json`)).status === 404, 'files: after a week an absent file is asked for again; offline it stays absent');
  srv3.close();
  source.down = false;
  const never = createZonosFiles({ modelsDir, models: '' }, join(ROOT, 'app'));
  const srv2 = createServer((req, res) => { never.handle(req, res, (req.url || '/').split('?')[0]); });
  await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
  const n0 = source.hits.length;
  const r2 = await fetch(`http://127.0.0.1:${srv2.address().port}/zonos/models/fixture.json`);
  check(r2.status === 404 && source.hits.length === n0 && never.upstream === '' && createZonosFiles({}, join(ROOT, 'app')).upstream === 'https://huggingface.co/Zyphra/ZONOS3-Mini/resolve/main/web/', 'files: "models": "" never downloads; by default the source is Zyphra/ZONOS3-Mini\'s web/ folder on Hugging Face');
  check((await fetch(at + '/zonos/models/fixture.json', { method: 'POST' })).status === 418, 'files: only GET and HEAD are answered');
  srv.close(); srv2.close();
}

// — a window that hosts the engine, played by Node: it connects to /zonos and answers from the fake Zonos server —
async function fakeWindow(port, { state = 'ready', error = '', progress = null } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/zonos`);
  ws.binaryType = 'arraybuffer';
  const w = { ws, requests: [], aborted: [], closed: false };
  const aborts = new Map();
  w.say = (o) => ws.send(JSON.stringify(o));
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'abort') { w.aborted.push(m.id); const a = aborts.get(m.id); if (a) a.abort(); return; }
    if (m.type !== 'req') return;
    w.requests.push(m);
    const abort = new AbortController(); aborts.set(m.id, abort);
    try {
      const r = await fetch(fake.url + m.path, { method: m.method, headers: m.body != null ? { 'content-type': 'application/json' } : {}, body: m.body != null ? m.body : undefined, signal: abort.signal });
      w.say({ type: 'head', id: m.id, status: r.status, headers: Object.fromEntries(r.headers) });
      for await (const chunk of r.body) { const f = Buffer.alloc(4 + chunk.length); f.writeUInt32LE(m.id, 0); Buffer.from(chunk).copy(f, 4); ws.send(f); }
      w.say({ type: 'end', id: m.id });
    } catch (err) { if (ws.readyState === 1) w.say({ type: 'error', id: m.id, message: String(err.message || err) }); }
  };
  ws.onclose = () => { w.closed = true; };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  if (progress) w.say({ type: 'state', state: 'loading', ...progress }); else w.say({ type: 'state', state, error });
  w.close = () => new Promise((r) => { if (w.closed) return r(); ws.addEventListener('close', () => r()); ws.close(); });
  return w;
}
{
  const port = base + 10;
  fake.requests.length = 0;
  check(await startServer(port, 'mock', { graceMs: 600 }), '[window] the local server starts ("mode": "web" is the default)');
  const zapi = async (fresh) => (await fetch(`http://127.0.0.1:${port}/api/voice/zonos${fresh ? '?fresh' : ''}`)).json();
  const a0 = await zapi(true);
  check(a0.mode === 'web' && a0.available === false && a0.engineFiles === false && a0.host.state === 'none' && /not loaded in the studio window/.test(a0.error), '[window] no window hosts the engine yet: the studio is told so (and that this checkout does not carry the engine)', a0);

  // no window: the conversation starts after a short wait, in the default voice
  let c = await connect(port);
  const t0 = Date.now();
  c.send({ type: 'start', settings: { name: 'Test', persona: 'You are a test robot.', language: 'fr', greeting: '', localVoiceEngine: 'zonos', voiceDesign: 'age 2' } });
  let ready = await c.waitFor('ready');
  check(ready && ready.voiceEngine === 'supertonic' && Date.now() - t0 < 4000 && (await c.waitFor('status', (m) => /^Zonos voice unavailable \(the Zonos engine is not loaded in the studio window/.test(m.text), 3000)), '[window] no window: Start waits a moment, then the default voice speaks and the status says why', Date.now() - t0);
  c.close(); await sleep(200);

  // a window that is still loading: Start waits for it, and shows its progress like any model
  const w = await fakeWindow(port, { progress: { loaded: 250000000, total: 1000000000 } });
  c = await connect(port);
  c.send({ type: 'start', settings: { name: 'Test', persona: 'You are a test robot.', language: 'fr', greeting: '', localVoiceEngine: 'zonos', zonosVoice: 'Gaspard', voiceDesign: 'age +1.5, deep 3' } });
  const loading = await c.waitFor('status', (m) => /^Loading: Zonos voice 25 % \(250\/1000 MB\)/.test(m.text), 4000);
  check(!!loading && !c.has('ready'), '[window] the engine is loading: Start waits, the status says "Loading: Zonos voice 25 % (250/1000 MB)"', c.msgs.filter((m) => m.type === 'status').map((m) => m.text));
  check((await zapi(true)).host.state === 'loading' && /still loading/.test((await zapi()).error), '[window] the studio is told it is loading');
  w.say({ type: 'state', state: 'ready' });
  ready = await c.waitFor('ready', undefined, 5000);
  check(ready && ready.voiceEngine === 'zonos' && /in the studio window/.test(ready.models.tts), '[window] the engine is ready: the conversation opens with the Zonos voice', ready);
  const a1 = await zapi(true);
  check(a1.available && a1.voices.some((v) => v.label === 'Gaspard') && a1.sliders.length === 4 && a1.host.state === 'ready', '[window] the voices and the sliders come from the engine in the window', a1);
  const t1 = await c.turn('Bonjour !');
  check(t1 && !c.has('error') && same(c.rates(t1), [44100]), '[window] a reply is spoken by the engine in the window (44.1 kHz)', c.rates(t1));
  const g = w.requests.filter((r) => r.path === '/v2/generate').map((r) => JSON.parse(r.body));
  check(g.length >= 1 && g[0].language === 'fr_fr' && g[0].speaker_embedding_id === SPEAKERS[1].id && same(g[0].controls, { 'identity.age': 1.5, 'texture.deep': 3 }) && w.requests.some((r) => r.path === '/v2/health' && r.method === 'GET' && r.body === null), '[window] the window received the request: language, voice, design', g[0]);

  // an interruption: the window is told to stop
  fake.slow(true);
  c.send({ type: 'text', text: 'Encore.' });
  await until(() => c.audio.some((a) => a.turnId > t1.turnId), 5000);
  c.send({ type: 'interrupt' });
  check(await until(() => w.aborted.length > 0, 3000), '[window] an interruption reaches the window: the sentence being spoken is aborted', w.aborted);
  fake.slow(false);
  await sleep(300);

  // the window closes (the studio is reloaded): the default voice takes over, and a new window brings Zonos back
  await w.close();
  await sleep(200);
  const t2 = await c.turn('Et maintenant ?');
  check(t2 && same(c.rates(t2), [24000]) && !c.has('error'), '[window] the window closes: the next reply is in the default voice', c.rates(t2));
  check((await zapi(true)).host.state === 'none', '[window] …and the studio is told no window hosts the engine');
  const w2 = await fakeWindow(port);
  await sleep(1300);
  const t3 = await c.turn('Et là ?');
  const t4 = await c.turn('Vraiment ?');
  check(t4 && same(c.rates(t4), [44100]), '[window] a window is back: Zonos speaks again, without a new Start', [c.rates(t3), c.rates(t4)]);

  // a newer window replaces the older one
  const w3 = await fakeWindow(port);
  check(await until(() => w2.closed, 2000), '[window] a second window takes over: the first is let go');
  await sleep(1300);
  await c.turn('Un.');
  const t5 = await c.turn('Deux.');
  check(t5 && same(c.rates(t5), [44100]) && w3.requests.some((r) => r.path === '/v2/generate'), '[window] …and it is the one that speaks', c.rates(t5));

  // the engine fails in the window (WebGPU lost): said plainly
  w3.say({ type: 'state', state: 'failed', error: 'WebGPU device lost' });
  await sleep(200);
  const t6 = await c.turn('Trois.');
  const a2 = await zapi(true);
  check(t6 && same(c.rates(t6), [24000]) && a2.available === false && a2.error === 'WebGPU device lost' && a2.host.state === 'failed', '[window] the engine fails in the window: the default voice speaks, the studio gets the engine\'s own reason', a2);
  c.close(); await w3.close();

  // a window where Zonos cannot run at all: Start does not wait
  const w4 = await fakeWindow(port, { state: 'failed', error: 'WebGPU is not available in this browser' });
  c = await connect(port);
  const t7 = Date.now();
  c.send({ type: 'start', settings: { name: 'Test', persona: 'You are a test robot.', language: 'fr', greeting: '', localVoiceEngine: 'zonos' } });
  ready = await c.waitFor('ready');
  const note = await c.waitFor('status', (m) => m.text === 'Zonos voice unavailable (WebGPU is not available in this browser): the default voice speaks instead.', 3000);
  check(ready && ready.voiceEngine === 'supertonic' && !!note && Date.now() - t7 < 2500, '[window] no WebGPU: Start does not wait, "Zonos voice unavailable (WebGPU is not available in this browser): the default voice speaks instead."', c.msgs.filter((m) => m.type === 'status').map((m) => m.text));
  c.close(); await w4.close();

  // other websites: neither the model's files nor the bridge
  const cross = await fetch(`http://127.0.0.1:${port}/zonos/models/fixture.json`, { headers: { 'sec-fetch-site': 'cross-site' } });
  const refused = await new Promise((r) => { const x = new WebSocket(`ws://127.0.0.1:${port}/zonos`, { headers: { origin: 'https://example.com' } }); x.onopen = () => { x.close(); r(false); }; x.onerror = () => r(true); });
  check(cross.status === 403 && refused, '[window] another website can neither fetch the model through this computer nor pose as the window', [cross.status, refused]);
}
{
  // "mode": "server": a window has nothing to host
  const port = base + 11;
  check(await startServer(port, 'mock', fake.url), '[server mode] the local server starts');
  const x = new WebSocket(`ws://127.0.0.1:${port}/zonos`);
  const closed = await new Promise((r) => { x.onclose = (e) => r(e.code); x.onerror = () => r(-1); setTimeout(() => r(0), 3000); });
  const api = await (await fetch(`http://127.0.0.1:${port}/api/voice/zonos?fresh`)).json();
  check(closed === 1008 && api.mode === 'server' && api.host === null && api.available === true, '[server mode] /zonos is closed at once (1008); the studio is told the mode is "server"', [closed, api.mode]);
}

// — the studio (Chromium, when Playwright is here): the voice picker and the design sliders —
let playwright = null;
try { playwright = loadPlaywright(); } catch { /* not installed */ }
if (!playwright) skip('the studio: the Zonos voice picker and its design sliders', 'Playwright not installed');
else {
  const port = base + 7;
  check(await startServer(port, 'mock', fake.url), '[studio] the local server starts');
  const url = `http://127.0.0.1:${port}`;
  await fetch(`${url}/api/agents`, { method: 'POST', body: JSON.stringify({ name: 'Plain' }) });
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url + '/');
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector('#agentSelect option[value="plain"]', { state: 'attached' });
  await page.selectOption('#agentSelect', 'plain');
  await until(() => page.evaluate(() => window.agent.settings.agent === 'plain'), 5000);
  await page.click('.nav button[data-view="voice"]');
  const hidden = (sel) => page.evaluate((x) => { const el = document.querySelector(x); return (el.closest('label') || el.closest('.design') || el).hidden; }, sel);
  check((await hidden('#zonosVoices')) && (await hidden('[data-k="voiceDesign"]')) && (await hidden('#zonosDesign')) && !(await hidden('#localVoices')), '[studio] Supertonic: nothing of Zonos is shown');
  await page.selectOption('[data-k="localVoiceEngine"]', 'zonos');
  check(await until(() => page.evaluate(() => document.querySelectorAll('#zonosDesign input[type=range]').length === 4), 5000), '[studio] Zonos chosen: the server\'s sliders appear');
  check(!(await hidden('#zonosVoices')) && !(await hidden('[data-k="voiceDesign"]')) && !(await hidden('#zonosDesign')) && (await hidden('#localVoices')) && (await hidden('[data-k="localSpeed"]')),
    '[studio] Zonos: its voice picker, its design line and its sliders are shown; the Supertonic picker and the speed are hidden');
  const ui = await page.evaluate(() => ({
    state: document.querySelector('#zonosState').textContent, help: document.querySelector('#zonosHelp').textContent,
    voices: Array.from(document.querySelectorAll('#zonosVoices option')).map((o) => o.textContent),
    groups: Array.from(document.querySelectorAll('#zonosDesign h3')).map((x) => x.textContent),
    labels: Array.from(document.querySelectorAll('#zonosDesign label > span')).map((x) => x.firstChild.textContent),
  }));
  check(ui.state === 'server found' && ui.voices.join('|') === 'The first voice|Savannah|Gaspard' && ui.groups.join('|') === 'Who|Texture|Delivery' && ui.labels[0] === 'Gender: masculine ↔ feminine' && ui.labels[2] === 'Deep',
    '[studio] "server found", the voices, the sliders by group with their poles', ui);
  const slide = (id, v) => page.evaluate(([i, x]) => { const el = document.querySelector(`#zonosDesign input[data-slider="${i}"]`); el.value = String(x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  await slide('age', 1.5); await slide('deep', 3); await slide('gender', -1);
  const st = () => page.evaluate(() => ({ line: document.querySelector('[data-k="voiceDesign"]').value, setting: window.agent.settings.voiceDesign, out: document.querySelector('#zonosDesign output[data-for="age"]').textContent }));
  check(await until(async () => (await st()).setting === 'age +1.5, deep 3, gender -1', 3000) && (await st()).line === 'age +1.5, deep 3, gender -1' && (await st()).out === '+1.5',
    '[studio] moving sliders writes the design line "age +1.5, deep 3, gender -1" (the setting voiceDesign)', await st());
  await slide('deep', 0);
  check(await until(async () => (await st()).setting === 'age +1.5, gender -1', 3000), '[studio] a slider back to 0 leaves the line', await st());
  await page.fill('[data-k="voiceDesign"]', 'projection -1.5');
  check(await until(() => page.evaluate(() => document.querySelector('#zonosDesign input[data-slider="projection"]').value === '-1.5' && document.querySelector('#zonosDesign input[data-slider="age"]').value === '0'), 3000), '[studio] typing the line moves the sliders');
  await page.selectOption('#zonosVoices', 'Gaspard');
  check(await until(() => page.evaluate(() => window.agent.settings.zonosVoice === 'Gaspard'), 3000), '[studio] choosing a voice sets zonosVoice to its name');
  const saved = await until(async () => { const a = await (await fetch(`${url}/api/agents/plain`)).json(); return a.settings && a.settings.voiceDesign === 'projection -1.5' && a.settings.zonosVoice === 'Gaspard' && a.settings.localVoiceEngine === 'zonos'; }, 5000);
  check(saved, '[studio] the voice, its design and the engine are saved in the agent (persona.md)');
  await page.click('#zonosReset');
  check(await until(async () => (await st()).setting === '' && (await st()).line === '', 3000), '[studio] "Reset the design" clears it');
  if (process.env.ZONOS_SHOT) { await slide('age', 1.5); await slide('deep', 3); await page.screenshot({ path: process.env.ZONOS_SHOT, fullPage: false }); }
  // the server goes away: "Check again" says so
  await fake.close();
  await page.click('#zonosCheck');
  check(await until(() => page.evaluate(() => document.querySelector('#zonosState').textContent === 'no server' && /No Zonos server answers at/.test(document.querySelector('#zonosHelp').textContent) && !document.querySelectorAll('#zonosDesign input').length), 5000),
    '[studio] without its server: "no server", the reason, no sliders; the typed design line stays');
  check(!errors.length, '[studio] no page error', errors);
  await browser.close();
}

// — the studio hosts the engine itself (Chromium): the fake engine, its model through the app's server —
if (playwright) {
  const port = base + 12;
  const modelsDir = mkdtempSync(join(tmpdir(), 'vik-zonos-models-'));
  source.hits.length = 0;
  check(await startServer(port, 'mock', { engineDir: ENGINE_DIR, models: sourceUrl, modelsDir, graceMs: 600 }), '[studio window] the local server starts');
  const url = `http://127.0.0.1:${port}`;
  await fetch(`${url}/api/agents`, { method: 'POST', body: JSON.stringify({ name: 'Plain' }) });
  const browser = await playwright.chromium.launch();
  const errors = [];
  const open = async (query = '') => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}/${query}`);
    await page.waitForSelector('#agentSelect option[value="plain"]', { state: 'attached' });
    await page.selectOption('#agentSelect', 'plain');
    await until(() => page.evaluate(() => window.agent.settings.agent === 'plain'), 5000);
    await page.click('.nav button[data-view="voice"]');
    return page;
  };
  const ui = (page) => page.evaluate(() => ({ state: document.querySelector('#zonosState').textContent, help: document.querySelector('#zonosHelp').textContent, sliders: document.querySelectorAll('#zonosDesign input[type=range]').length, voices: document.querySelectorAll('#zonosVoices option').length }));
  const zapi = async () => (await fetch(`${url}/api/voice/zonos?fresh`)).json();

  let page = await open('?slow=1600');
  check((await zapi()).host.state === 'none' && (await page.evaluate(() => !window.__zonos)), '[studio window] with another voice engine, the Zonos engine is not loaded');
  await page.selectOption('[data-k="localVoiceEngine"]', 'zonos');
  const loading = await until(async () => { const u = await ui(page); return /^loading \d+ %$/.test(u.state) && /Loading the Zonos voice \(\d+ MB of 1000 MB\)…/.test(u.help) && u; }, 4000);
  check(!!loading, '[studio window] Zonos chosen: the engine loads in the window, "loading 40 %" and the megabytes show', await ui(page));
  check(await until(async () => (await ui(page)).state === 'ready' && (await ui(page)).sliders === 4, 8000), '[studio window] then "ready", with the engine\'s voices and sliders', await ui(page));
  const st = await page.evaluate(() => ({ inits: window.__zonos.inits, base: window.__zonos.opts.base, cache: window.__zonos.opts.cache, shard: window.__zonos.shardBytes, optional: window.__zonos.optional }));
  check(st.inits === 1 && st.base === `${url}/zonos/models/` && st.cache === false && st.shard === 300000 && st.optional === 404, '[studio window] the engine was given the app\'s own models address (no second copy in the browser), and read its model through it', st);
  check(existsSync(join(modelsDir, 'fixture.json')) && existsSync(join(modelsDir, 'backbone', 'shard-0.bin')) && source.hits.includes('/web/backbone/shard-0.bin'), '[studio window] the model is now on the computer (the models folder)', readdirSync(modelsDir));
  const api = await zapi();
  check(api.available && api.mode === 'web' && api.engineFiles === true && api.host.state === 'ready' && api.voices.length === 2, '[studio window] the server sees the window: available, the voices', api);

  // a conversation (another connection, like the tests above): the window speaks
  const c = await connect(port);
  c.send({ type: 'start', settings: { name: 'Test', persona: 'You are a test robot.', language: 'fr', greeting: '', localVoiceEngine: 'zonos', zonosVoice: 'Gaspard', voiceDesign: 'age +1.5, deep 3' } });
  const ready = await c.waitFor('ready');
  const t1 = await c.turn('Bonjour !');
  const reqs = await page.evaluate(() => window.__zonos.requests);
  check(ready && ready.voiceEngine === 'zonos' && t1 && same(c.rates(t1), [44100]) && !c.has('error'), '[studio window] a reply is spoken by the engine in the studio\'s window (44.1 kHz)', [ready && ready.voiceEngine, c.rates(t1)]);
  check(reqs.length >= 1 && reqs[0].language === 'fr_fr' && reqs[0].speaker_embedding_id === SPEAKERS[1].id && same(reqs[0].controls, { 'identity.age': 1.5, 'texture.deep': 3 }) && reqs[0].stream === true, '[studio window] the engine got the sentence with the language, the voice and the design', reqs[0]);
  const samples = c.audio.filter((a) => a.turnId === t1.turnId).length;
  check(samples >= reqs.length, '[studio window] its audio crossed the bridge in frames', samples);

  // the window is reloaded with the model already here: nothing is downloaded again
  const hits = source.hits.length;
  await page.close();
  await until(async () => (await zapi()).host.state === 'none', 3000);
  source.down = true;
  page = await open();
  check(await until(async () => (await ui(page)).state === 'ready', 8000) && source.hits.length === hits, '[studio window] reloaded, offline: the engine loads from the computer, the source is not asked', [await ui(page), source.hits.slice(hits)]);
  const t2 = await c.turn('Encore ?');
  const t3 = await c.turn('Et encore ?');
  check(t3 && same(c.rates(t3), [44100]), '[studio window] …and Zonos speaks again in the conversation that was open', [c.rates(t2), c.rates(t3)]);
  source.down = false;

  // the engine dies in the window (the graphics card is lost): said in the studio, the default voice takes over
  await page.evaluate(() => window.__zonosFatal('WebGPU device lost'));
  check(await until(async () => { const u = await ui(page); return u.state === 'cannot run here' && /Zonos cannot run on this computer: WebGPU device lost\. The default voice speaks instead\./.test(u.help) && u.sliders === 0; }, 4000), '[studio window] the engine dies: "cannot run here", its reason, no sliders', await ui(page));
  const t4 = await c.turn('Allô ?');
  check(t4 && same(c.rates(t4), [24000]) && !c.has('error'), '[studio window] …and the conversation goes on in the default voice', c.rates(t4));
  await page.click('#zonosCheck');
  check(await until(async () => (await ui(page)).state === 'ready' && (await ui(page)).sliders === 4, 8000), '[studio window] "Check again" loads the engine again', await ui(page));
  c.close();
  await page.close();

  // a computer without WebGPU
  page = await open('?nogpu');
  check(await until(async () => { const u = await ui(page); return u.state === 'cannot run here' && /WebGPU is not available in this browser/.test(u.help); }, 5000), '[studio window] no WebGPU: "cannot run here: WebGPU is not available in this browser"', await ui(page));
  const c2 = await connect(port);
  c2.send({ type: 'start', settings: { name: 'Test', persona: 'You are a test robot.', language: 'fr', greeting: '', localVoiceEngine: 'zonos' } });
  const r2 = await c2.waitFor('ready');
  const t5 = await c2.turn('Bonjour !');
  check(r2 && r2.voiceEngine === 'supertonic' && c2.has('status', (m) => /WebGPU is not available/.test(m.text)) && t5 && same(c2.rates(t5), [24000]), '[studio window] …a conversation starts at once, in the default voice, and says why');
  c2.close(); await page.close();
  check(!errors.length, '[studio window] no page error', errors);

  // a copy of VIK without the engine (a plain checkout)
  const port2 = base + 13;
  check(await startServer(port2, 'mock', { models: sourceUrl, modelsDir, graceMs: 600 }), '[no engine] the local server starts');
  const page2 = await browser.newPage();
  await page2.goto(`http://127.0.0.1:${port2}/`);
  await fetch(`http://127.0.0.1:${port2}/api/agents`, { method: 'POST', body: JSON.stringify({ name: 'Plain' }) });
  await page2.reload();
  await page2.waitForSelector('#agentSelect option[value="plain"]', { state: 'attached' });
  await page2.selectOption('#agentSelect', 'plain');
  await until(() => page2.evaluate(() => window.agent.settings.agent === 'plain'), 5000);
  await page2.click('.nav button[data-view="voice"]');
  await page2.selectOption('[data-k="localVoiceEngine"]', 'zonos');
  check(await until(async () => { const u = await ui(page2); return u.state === 'not installed' && /does not carry the Zonos engine yet/.test(u.help); }, 4000) && (await (await fetch(`http://127.0.0.1:${port2}/api/voice/zonos?fresh`)).json()).host.state === 'none', '[no engine] the studio says "not installed" and how to get it; nothing is loaded', await ui(page2));
  await browser.close();
}

for (const p of servers) p.kill();
await fake.close().catch(() => {});
const failed = summary();
if (failed) console.log('\n--- server log ---\n' + serverLog.join('').slice(-2500) + '\n--- voice log ---\n' + logs.join('\n'));
process.exit(failed ? 1 : 0);
