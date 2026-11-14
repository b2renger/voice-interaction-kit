// Tests the saved voices (app/src/agent/voices.mjs) and the pattern action "Change voice", WITHOUT a model
// (Node 22+ only): the simulated engine, and a fake Zonos server (tests/mock-zonos.mjs) so that a change of voice
// can be seen in what the voice is asked (its voice, its design) and in the audio (its rate).
//   - what a saved voice is, and where an agent keeps them (voices.json; duplicate, export, import);
//   - a conversation: a pattern changes the voice, the change lasts, another gives the agent its own voice back;
//   - the studio (Chromium, when Playwright is here): saving, using and deleting a voice, and the pattern's action.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { ROOT, check, skip, summary, sleep, until, loadPlaywright } from './helpers.mjs';
import { startMockZonos, SPEAKERS } from './mock-zonos.mjs';
import { normalizeVoices, voiceOf, VOICE_KEYS } from '../app/src/agent/voices.mjs';
import { normalizeInteractions } from '../app/src/agent/interactions.mjs';
import { createAgentStore } from '../app/src/agent/agents.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// — what a saved voice is —
{
  const v = normalizeVoices({ voices: [
    { name: '  The   old sailor ', settings: { localVoiceEngine: 'zonos', zonosVoice: 'Gaspard', voiceDesign: 'age 2, deep 3', localSpeed: 9, apiKey: 'secret', persona: 'x' } },
    { name: 'the old SAILOR', settings: {} }, { name: '', settings: {} }, null, 'x',
    { name: 'Narrator', settings: { localVoiceEngine: 'nope', localVoice: 'M2', localSpeed: '1.2' } },
  ] });
  check(v.version === 1 && v.voices.length === 2 && v.voices[0].id === 'the-old-sailor' && v.voices[0].name === 'The old sailor', 'a saved voice has a name and an id made from it; the same name twice, an empty name and junk are dropped', v.voices.map((x) => x.id));
  check(same(Object.keys(v.voices[0].settings), VOICE_KEYS) && v.voices[0].settings.localSpeed === 2 && !('apiKey' in v.voices[0].settings) && v.voices[1].settings.localVoiceEngine === 'supertonic' && v.voices[1].settings.localSpeed === 1.2,
    'it holds the six voice settings and nothing else (no key, no persona); values are kept in range', v.voices[0].settings);
  check(same(normalizeVoices(null), { version: 1, voices: [] }) && same(normalizeVoices([{ name: 'A' }]).voices.map((x) => x.id), ['a']) && normalizeVoices({ voices: Array.from({ length: 60 }, (_, i) => ({ name: `v${i}` })) }).voices.length === 40, 'nothing, a bare list, and too many voices (40 at most) are all handled');
  check(same(voiceOf({ localVoiceEngine: 'parler', voiceDescription: ' A warm voice ', name: 'Ada', creativity: 2 }), { localVoiceEngine: 'parler', localVoice: '', localSpeed: 1, voiceDescription: 'A warm voice', zonosVoice: '', voiceDesign: '' }), 'voiceOf(settings): the voice part of an agent\'s settings');
  const it = normalizeInteractions({ stages: [{ id: 'main', name: 'Main' }], patterns: [{ name: 'P', when: { kind: 'says', examples: ['x'] }, then: [{ do: 'voice', voice: 'The Old Sailor' }, { do: 'voice' }, { do: 'voice', voice: 42 }] }] });
  check(same(it.patterns[0].then, [{ do: 'voice', voice: 'the-old-sailor' }, { do: 'voice', voice: '' }, { do: 'voice', voice: '42' }]), 'a pattern\'s "Change voice" keeps the voice\'s id (\'\' = the agent\'s own voice)', it.patterns[0].then);
}

// — where an agent keeps them —
{
  const dir = mkdtempSync(join(tmpdir(), 'vik-voices-store-'));
  const store = createAgentStore({ dir, examples: '' });
  const a = store.create({ name: 'Pirate ship' });
  check(same(store.get(a.id).voices, []) && !existsSync(join(dir, a.id, 'voices.json')), 'a new agent has no saved voice, and no voices.json');
  const kept = store.saveVoices(a.id, { voices: [{ name: 'Captain', settings: { localVoiceEngine: 'zonos', zonosVoice: 'Gaspard', voiceDesign: 'age 2' } }, { name: 'Parrot', settings: { localVoice: 'F3', localSpeed: 1.4 } }] });
  const file = JSON.parse(readFileSync(join(dir, a.id, 'voices.json'), 'utf8'));
  check(kept.length === 2 && kept[0].id === 'captain' && file.version === 1 && file.voices[1].settings.localVoice === 'F3' && same(store.get(a.id).voices, kept), 'saveVoices: written to <agent>/voices.json, and read back with the agent', file.voices.map((v) => v.id));
  writeFileSync(join(dir, a.id, 'voices.json'), '{ not json');
  check(same(store.get(a.id).voices, []), 'a voices.json edited into nonsense by hand: no saved voice, the agent still opens');
  store.saveVoices(a.id, kept);
  const copy = store.create({ from: a.id });
  check(same(store.get(copy.id).voices, kept), 'a duplicate has the same saved voices');
  const bundle = store.exportBundle(a.id);
  const back = store.create({ bundle: JSON.parse(JSON.stringify(bundle)) });
  check(same(bundle.voices, kept) && same(store.get(back.id).voices, kept), 'export carries them (.vik.json), import brings them back');
  const plain = store.create({ name: 'Plain' });
  check(!('voices' in store.exportBundle(plain.id)), 'an agent without saved voices exports as before (no "voices")');
  const all = store.allVoices();
  check(all.length === 6 && all.some((v) => v.agent === a.id && v.title === 'Pirate ship' && v.id === 'parrot' && v.settings.localVoice === 'F3') && !all.some((v) => v.agent === plain.id), 'allVoices(): the saved voices of every agent, with the agent they come from', all.map((v) => `${v.agent}/${v.id}`));
  store.saveVoices(a.id, []);
  check(same(store.get(a.id).voices, []), 'saving an empty list removes them');
}

// — a conversation —
const servers = [];
const serverLog = [];
process.on('exit', () => { for (const p of servers) { try { p.kill(); } catch { /* gone */ } } });
function startServer(port, zonosUrl) {
  const cwd = mkdtempSync(join(tmpdir(), 'vik-voices-'));
  writeFileSync(join(cwd, 'config.json'), JSON.stringify({ modelMirror: '', models: { tts: { zonos: { mode: 'server', url: zonosUrl } } } }));
  const proc = spawn(process.execPath, [join(ROOT, 'app', 'src', 'server.mjs'), '--port', String(port), '--config', 'config.json', '--mock'],
    { env: { ...process.env, VIK_AGENTS: mkdtempSync(join(tmpdir(), 'vik-agents-voices-')) }, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
  c.all = (type) => c.msgs.filter((m) => m.type === type);
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
const fake = await startMockZonos();
const port = 20300 + Math.floor(Math.random() * 300);
const url = `http://127.0.0.1:${port}`;
check(await startServer(port, fake.url), 'the local server starts (simulated engine, a fake Zonos server)');
const put = (path, body) => fetch(`${url}${path}`, { method: 'PUT', body: JSON.stringify(body) }).then((r) => r.json());
const made = await (await fetch(`${url}/api/agents`, { method: 'POST', body: JSON.stringify({ name: 'Storyteller' }) })).json();
const id = made.id;
const says = (name, example, then) => ({ name, stage: '', on: true, when: { kind: 'says', examples: [example] }, then });
const voices = await put(`/api/agents/${id}/voices`, { voices: [
  { name: 'Old sailor', settings: { localVoiceEngine: 'zonos', zonosVoice: 'Gaspard', voiceDesign: 'age +2, deep 3' } },
  { name: 'Child', settings: { localVoiceEngine: 'zonos', zonosVoice: 'Savannah', voiceDesign: 'age -2' } },
  { name: 'Robot', settings: { localVoiceEngine: 'parler', voiceDescription: 'A flat robotic voice.' } },
] });
await put(`/api/agents/${id}/interactions`, { stages: [{ id: 'main', name: 'Main' }], confidence: 0.5, patterns: [
  says('Sailor', 'tell it like an old sailor', [{ do: 'voice', voice: 'old-sailor' }, { do: 'say', text: 'Ahoy! Listen to this.' }]),
  says('Child', 'tell it like a child', [{ do: 'say', text: 'Once upon a time!' }, { do: 'voice', voice: 'child' }]),
  says('Robot', 'tell it like a robot', [{ do: 'voice', voice: 'robot' }, { do: 'say', text: 'Beep. Story loaded.' }]),
  says('Yourself', 'be yourself again', [{ do: 'voice', voice: '' }, { do: 'say', text: 'Here I am.' }]),
  says('Ghost', 'tell it like a ghost', [{ do: 'voice', voice: 'ghost' }, { do: 'say', text: 'Boo.' }]),
  says('Weather', 'what is the weather', [{ do: 'say', text: 'It is sunny.' }]),
] });
check(voices.length === 3 && voices[0].id === 'old-sailor', 'PUT /api/agents/:id/voices saves the list and returns it', voices.map((v) => v.id));
const got = await (await fetch(`${url}/api/agents/${id}`)).json();
const everyone = await (await fetch(`${url}/api/voices`)).json();
check(same(got.voices, voices) && everyone.filter((v) => v.agent === id).length === 3 && everyone[0].title, 'GET /api/agents/:id gives them with the agent; GET /api/voices, those of every agent');

const START = { name: 'Storyteller', persona: 'You tell stories.', language: 'fr', greeting: '', agent: id, localVoiceEngine: 'supertonic', localVoice: 'F1', localSpeed: 1 };
const c = await connect(port);
c.send({ type: 'start', settings: START });
await c.waitFor('ready');
const zonosAsked = () => fake.requests.length;
const t1 = await c.turn('what is the weather');
check(t1 && same(c.rates(t1), [24000]) && zonosAsked() === 0 && !c.has('voice'), 'the conversation starts in the agent\'s own voice (Supertonic)', c.rates(t1));

const t2 = await c.turn('tell it like an old sailor');
const v2 = c.all('voice');
check(t2 && same(c.rates(t2), [44100]) && /Ahoy/.test(t2.text), 'a pattern with "Change voice": its own reply is already said in the new voice (Zonos, 44.1 kHz)', [c.rates(t2), t2 && t2.text]);
check(v2.length === 1 && v2[0].voice === 'old-sailor' && v2[0].name === 'Old sailor', 'the clients are told: {type: "voice", voice: "old-sailor", name: "Old sailor"}', v2);
const r2 = fake.requests[fake.requests.length - 1];
check(r2 && r2.speaker_embedding_id === SPEAKERS[1].id && same(r2.controls, { 'identity.age': 2, 'texture.deep': 3 }) && r2.language === 'fr_fr', 'the voice is the saved one: its Zonos voice and its design (the language stays the agent\'s)', r2);

const n3 = zonosAsked();
const t3 = await c.turn('what is the weather');
const t3b = await c.turn('hello there, how are you?');
check(t3 && t3b && same(c.rates(t3), [44100]) && same(c.rates(t3b), [44100]) && zonosAsked() > n3 + 1 && c.all('voice').length === 1, 'the change lasts: the next replies (another pattern, a free answer) are in that voice');

c.send({ type: 'settings', settings: { ...START, creativity: 1.4, fillerLines: 'Hmm.' } });
await sleep(300);
const t4 = await c.turn('what is the weather');
check(t4 && same(c.rates(t4), [44100]) && c.all('voice').length === 1, 'the studio sending its settings again (another setting changed) does not undo the change of voice', c.rates(t4));

const reloads = () => c.all('status').filter((m) => m.text === 'Changing voice…').length;
const reloadsBefore = reloads();
const t5 = await c.turn('tell it like a child');
const r5 = fake.requests[fake.requests.length - 1];
check(t5 && same(c.rates(t5), [44100]) && r5.speaker_embedding_id === SPEAKERS[0].id && same(r5.controls, { 'identity.age': -2 }) && c.all('voice').length === 2 && c.all('voice')[1].voice === 'child' && reloads() === reloadsBefore,
  'another voice of the same engine: at once, nothing is reloaded (wherever the action is in the pattern)', [r5, c.all('status').map((m) => m.text)]);

const n6 = zonosAsked();
const t6 = await c.turn('tell it like a robot');
check(t6 && same(c.rates(t6), [44100]) && zonosAsked() === n6 && reloads() === reloadsBefore + 1 && c.all('voice')[2].voice === 'robot', 'a voice of another engine (Parler): it is loaded first ("Changing voice…"), then says the reply; Zonos is no longer asked', [c.rates(t6), zonosAsked() - n6]);

const t7 = await c.turn('tell it like a ghost');
check(t7 && /Boo/.test(t7.text) && c.all('voice').length === 3 && zonosAsked() === n6, 'a pattern naming a voice that does not exist (deleted): the reply is said, the voice stays');

const t8 = await c.turn('be yourself again');
const last = c.all('voice').pop();
check(t8 && same(c.rates(t8), [24000]) && last.voice === '' && last.name === '' && c.all('voice').length === 4, '"The agent\'s own voice": back to it, and the clients are told {voice: ""}', [c.rates(t8), last]);
const t9 = await c.turn('be yourself again');
check(t9 && c.all('voice').length === 4, 'changing to the voice it already has says nothing');

// the voice edited in the studio during the conversation ends a pattern's change
await c.turn('tell it like an old sailor');
c.send({ type: 'settings', settings: { ...START, localVoice: 'M2' } });
await until(() => c.all('voice').length === 6, 3000);
const t10 = await c.turn('what is the weather');
check(c.all('voice').length === 6 && c.all('voice')[5].voice === '' && t10 && same(c.rates(t10), [24000]), 'the agent\'s voice edited in the studio during the conversation: that is the one heard (the pattern\'s change ends)', [c.all('voice').length, c.rates(t10)]);

// a new conversation starts in the agent's own voice
await c.turn('tell it like an old sailor');
c.send({ type: 'start', settings: START });
await sleep(600);
const n11 = zonosAsked();
const t11 = await c.turn('what is the weather');
check(t11 && same(c.rates(t11), [24000]) && zonosAsked() === n11, 'a new Start: the agent\'s own voice again', c.rates(t11));
check(!c.has('error'), 'no error in the whole conversation', c.all('error'));
c.close();

// — the studio —
let playwright = null;
try { playwright = loadPlaywright(); } catch { /* not installed */ }
if (!playwright) skip('the studio: saving, using and deleting a voice; the pattern action', 'Playwright not installed');
else {
  const other = await (await fetch(`${url}/api/agents`, { method: 'POST', body: JSON.stringify({ name: 'Plain' }) })).json();
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${url}/`);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector(`#agentSelect option[value="${other.id}"]`, { state: 'attached' });
  await page.selectOption('#agentSelect', other.id);
  await until(() => page.evaluate((x) => window.agent.settings.agent === x, other.id), 5000);
  await page.click('.nav button[data-view="voice"]');
  const list = () => page.evaluate(() => ({ options: Array.from(document.querySelectorAll('#voiceList option')).map((o) => o.textContent), groups: Array.from(document.querySelectorAll('#voiceList optgroup')).map((g) => g.label), value: document.querySelector('#voiceList').value, about: document.querySelector('#voiceAbout').textContent, use: document.querySelector('#voiceUse').disabled, del: document.querySelector('#voiceDelete').disabled }));
  const l0 = await until(async () => { const l = await list(); return l.groups.length === 1 && l; }, 4000);
  check(l0 && l0.options[0] === 'None saved yet' && l0.groups[0] === 'From other agents' && l0.options.includes('Old sailor (Storyteller)') && l0.use && l0.del && /save it under a name/.test(l0.about), '[studio] an agent without saved voices: "None saved yet", and the voices of the other agents', l0);

  // save the voice as it is set
  await page.selectOption('#localVoices', 'M2');
  const askName = async (name) => { await page.waitForSelector('#ask[open]'); await page.fill('#askValue', name); await page.click('#askOk'); };
  await page.click('#voiceSave'); await askName('Deep narrator');
  const disk = () => fetch(`${url}/api/agents/${other.id}`).then((r) => r.json());
  check(await until(async () => { const a = await disk(); return a.voices.length === 1 && a.voices[0].id === 'deep-narrator' && a.voices[0].settings.localVoice === 'M2' && a.voices[0].settings.localVoiceEngine === 'supertonic'; }, 4000), '[studio] "Save this voice…": the voice as it is set, kept under the name typed (voices.json)');
  const l1 = await list();
  check(l1.value === 'deep-narrator' && l1.about === 'Supertonic · M2' && !l1.use && !l1.del && !l1.options.includes('None saved yet'), '[studio] it is in the list, chosen, and described: "Supertonic · M2"', l1);

  // use a voice of another agent: its settings become this agent's
  await page.selectOption('#voiceList', { label: 'Old sailor (Storyteller)' });
  const l2 = await list();
  check(l2.about === 'Zonos · Gaspard · age +2, deep 3' && !l2.use && l2.del, '[studio] a voice of another agent: described, usable, not deletable from here', l2);
  await page.click('#voiceUse');
  check(await until(async () => { const a = await disk(); return a.settings.localVoiceEngine === 'zonos' && a.settings.zonosVoice === 'Gaspard' && a.settings.voiceDesign === 'age +2, deep 3'; }, 4000)
    && (await page.evaluate(() => document.querySelector('[data-k="localVoiceEngine"]').value === 'zonos' && document.querySelector('[data-k="voiceDesign"]').value === 'age +2, deep 3')), '[studio] "Use": the agent now has that voice (the fields show it, persona.md has it)');
  await page.click('#voiceSave'); await askName('Sailor here');
  check(await until(async () => (await disk()).voices.length === 2, 4000), '[studio] …and it can be saved here under a name of its own');
  // saving under a name already taken replaces (after a question)
  await page.selectOption('#voiceList', 'deep-narrator');
  await page.click('#voiceUse');
  await until(async () => (await disk()).settings.localVoiceEngine === 'supertonic', 4000);
  await page.selectOption('#localVoices', 'F3');
  await page.click('#voiceSave'); await askName('deep narrator');
  check(await until(async () => { const a = await disk(); return a.voices.length === 2 && a.voices.find((v) => v.id === 'deep-narrator').settings.localVoice === 'F3'; }, 4000), '[studio] saving under a name already taken replaces that voice');

  // the pattern action
  await page.click('.nav button[data-view="interactions"]');
  await page.click('#newPattern').catch(() => {});
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /New pattern/.test(x.textContent)); if (b && !document.querySelector('#ask[open]')) b.click(); });
  await askName('Sailor mode');
  await page.waitForSelector('#patternEditor .add-actions');
  await page.locator('#patternEditor .add-actions button', { hasText: 'Change voice' }).click();
  const options = await page.evaluate(() => Array.from(document.querySelectorAll('#patternEditor select[aria-label="Voice"] option')).map((o) => o.textContent));
  check(same(options, ['The agent’s own voice', 'Deep narrator', 'Sailor here']), '[studio] a pattern\'s "Change voice" offers the agent\'s own voice and its saved voices', options);
  await page.selectOption('#patternEditor select[aria-label="Voice"]', 'sailor-here');
  check(await until(async () => { const a = await disk(); const p = a.interactions.patterns.find((x) => x.name === 'Sailor mode'); return p && p.then.some((s) => s.do === 'voice' && s.voice === 'sailor-here'); }, 4000), '[studio] the choice is saved in the pattern (interactions.json)');

  // deleting a voice a pattern uses: said before, and the pattern shows it
  await page.click('.nav button[data-view="voice"]');
  await page.selectOption('#voiceList', 'sailor-here');
  let asked = '';
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => { asked = d.message(); d.accept(); });
  await page.click('#voiceDelete');
  check(await until(async () => (await disk()).voices.length === 1, 4000) && /These patterns change to it: Sailor mode/.test(asked), '[studio] deleting a voice a pattern changes to: the question names the pattern', asked);
  await page.click('.nav button[data-view="interactions"]');
  const gone = await page.evaluate(() => { const s = document.querySelector('#patternEditor select[aria-label="Voice"]'); return s ? s.options[s.selectedIndex].textContent : ''; });
  check(gone === 'sailor-here (deleted)', '[studio] …and the pattern shows that its voice was deleted', gone);
  check(!errors.length, '[studio] no page error', errors);
  await browser.close();
}

for (const p of servers) p.kill();
await fake.close().catch(() => {});
const failed = summary();
if (failed) console.log('\n--- server log ---\n' + serverLog.join('').slice(-2500));
process.exit(failed ? 1 : 0);
