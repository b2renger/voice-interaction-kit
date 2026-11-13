// Tests the Zonos voice (app/src/engines/zonos.mjs) WITHOUT a Zonos server or a model (Node 22+ only): a fake
// server (tests/mock-zonos.mjs) speaks ZONOS3-Mini's HTTP API and checks each request the way the real one does.
//   - the design line ("age +1.5, deep 3") and the doses it becomes;
//   - the voice wrapped around the simulated engine: Zonos speaks when its server is there, the default voice
//     otherwise, and when the server refuses a request or disappears in the middle of a reply;
//   - a conversation through the real local server (simulated engine, then the QVAC adapter on the fake SDK).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT, check, skip, summary, sleep, until, loadPlaywright } from './helpers.mjs';
import { startMockZonos, CONTROLS, SPEAKERS } from './mock-zonos.mjs';
import { parseDesign, designDoses, designSliders, zonosLanguage, f32ToS16, createZonosVoice, withZonos } from '../app/src/engines/zonos.mjs';
import { createMockEngine } from '../app/src/engines/mock.mjs';
import { mergeConfig, loadConfig } from '../app/src/config.mjs';

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
  const zonos = createZonosVoice({ url: fake.url }, log);
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
  const gone = createZonosVoice({ url: 'http://127.0.0.1:9', timeoutMs: 300 }, log);
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
  const z = createZonosVoice({ url: plain.url }, log);
  const engine = withZonos(await createMockEngine({}), z, log);
  await engine.prepare({ localVoiceEngine: 'zonos' }, () => {});
  const f = await collect(engine.speak({ engine: 'zonos', language: 'en', design: 'age 2' }), ['Hi.']);
  check(z.ok() && same(z.describe().sliders, []) && f.every((x) => x.sampleRate === 44100) && !('controls' in plain.requests[0]), 'a server without a steering file: Zonos speaks, with no sliders and no controls sent');
  await plain.close();
  const locked = await startMockZonos({ token: 'secret' });
  const no = createZonosVoice({ url: locked.url }, log);
  const yes = createZonosVoice({ url: locked.url, token: 'secret' }, log);
  check(!(await no.probe(true)) && /refused the access token/.test(no.reason()) && (await yes.probe(true)), 'a server with an access token: refused without it (and said so), reached with "token" in config.json', no.reason());
  await locked.close();
}

// — a conversation through the local server —
const servers = [];
const serverLog = [];
function startServer(port, engine, zonosUrl) {
  const cwd = mkdtempSync(join(tmpdir(), 'vik-zonos-'));
  writeFileSync(join(cwd, 'config.json'), JSON.stringify({ modelMirror: '', models: { tts: { zonos: { url: zonosUrl } } } }));
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
  check(ui.state === 'server found' && ui.voices.join('|') === 'The server’s first voice|Savannah|Gaspard' && ui.groups.join('|') === 'Who|Texture|Delivery' && ui.labels[0] === 'Gender: masculine ↔ feminine' && ui.labels[2] === 'Deep',
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

for (const p of servers) p.kill();
await fake.close().catch(() => {});
const failed = summary();
if (failed) console.log('\n--- server log ---\n' + serverLog.join('').slice(-2500) + '\n--- voice log ---\n' + logs.join('\n'));
process.exit(failed ? 1 : 0);
