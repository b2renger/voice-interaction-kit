// The agents on disk (app/src/agent/): persona.md, the CSV tables, interactions.json, the store, and the
// studio's API (app/src/api.mjs) through the real server.
//   node tests/test-agents.mjs
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary } from './helpers.mjs';

const src = (f) => pathToFileURL(join(ROOT, 'app', 'src', f)).href;
const { parsePersona, writePersona } = await import(src('agent/persona.mjs'));
const { parseCsv, writeCsv } = await import(src('agent/csv.mjs'));
const { normalizeInteractions, slug } = await import(src('agent/interactions.mjs'));
const { createAgentStore } = await import(src('agent/agents.mjs'));
const fails = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// — persona.md —
{
  const p = parsePersona('﻿---\r\nname: Ada\r\n# a comment\r\nendSilenceMs: 900\r\nshortAnswers: false\r\ngreeting: Hello: welcome!\r\nzip: "75001"\r\n---\r\n\r\nYou are Ada.\r\n\r\n## How you speak\r\nWarmly.\r\n');
  check(p.settings.name === 'Ada' && p.settings.endSilenceMs === 900 && p.settings.shortAnswers === false && p.settings.greeting === 'Hello: welcome!' && p.settings.zip === '75001' && !('#' in p.settings),
    'persona: the front matter gives text, numbers, booleans; quotes keep "75001" text; comments ignored; Windows line ends and BOM', p.settings);
  check(p.body === 'You are Ada.\n\n## How you speak\nWarmly.', 'persona: the body is the markdown after it', p.body);
  const w = writePersona({ settings: { greeting: 'Hi', fillerLines: 'Hmm…|Well…', name: 'Bo', n: 42, odd: '42', on: true, t: 'true', spaced: ' x ', title: 'Bike shop', gone: null }, body: 'You sell bikes.\n' });
  check(w.startsWith('---\nname: Bo\ntitle: Bike shop\ngreeting: Hi\n'), 'persona: name, title, language, greeting come first', w.split('\n').slice(0, 5));
  const back = parsePersona(w);
  check(back.settings.n === 42 && back.settings.odd === '42' && back.settings.on === true && back.settings.t === 'true' && back.settings.spaced === ' x ' && back.settings.fillerLines === 'Hmm…|Well…' && !('gone' in back.settings),
    'persona: written then read, every value comes back as it was (text that looks like a number stays text)', back.settings);
  check(parsePersona('Just a text.').body === 'Just a text.' && Object.keys(parsePersona('Just a text.').settings).length === 0, 'persona: no front matter → all body');
  check(parsePersona('---\n---\nBody').body === 'Body', 'persona: an empty front matter');
}

// — CSV —
{
  const t = parseCsv('﻿name;artist;year\r\n"Water Lilies";Claude Monet;1916\r\n"The ""Raft""";"Géricault; Théodore";1819\n\n"Two\nlines";x\n');
  check(t.headers.join('|') === 'name|artist|year', 'csv: the separator is guessed (;), the BOM dropped', t.headers);
  check(t.rows.length === 3 && t.rows[1][0] === 'The "Raft"' && t.rows[1][1] === 'Géricault; Théodore' && t.rows[2][0] === 'Two\nlines' && t.rows[2][2] === '',
    'csv: quotes, doubled quotes, separators and line breaks inside quotes; empty lines dropped; short rows padded', t.rows);
  const odd = parseCsv('a,,a\n1,2,3,4');
  check(odd.headers.join('|') === 'a|column 2|a 2|column 4', 'csv: empty and repeated column names get a name', odd.headers);
  const text = writeCsv({ headers: ['name', 'note'], rows: [['Monet', 'Water, light'], ['Rodin', 'He said "hello"'], ['Millet', 'two\nlines']] });
  check(text.startsWith('﻿name,note\n') && text.includes('"Water, light"') && text.includes('"He said ""hello"""'), 'csv: written with commas, quotes where needed, and the UTF-8 mark for Excel');
  const again = parseCsv(text);
  check(again.rows[2][1] === 'two\nlines' && again.rows[1][1] === 'He said "hello"', 'csv: written then read, the same table');
  check(parseCsv('a\tb\n1\t2').headers.join('|') === 'a|b', 'csv: tab separated too');
}

// — interactions.json —
{
  const n = normalizeInteractions({
    stages: [{ name: 'Welcome' }, { id: 'tour', name: 'Tour' }, { name: 'Welcome' }],
    start: 'nowhere', confidence: 7,
    patterns: [
      { name: 'Hours', when: { kind: 'says', examples: 'when do you open|what time' }, then: [{ do: 'say', text: 'Ten to six.' }, { do: 'explode' }] },
      { name: 'Hours', stage: 'mars', when: { kind: 'telepathy' }, then: [{ do: 'choices', options: 'A|B' }, { do: 'mood', mood: 'grumpy' }] },
      'junk',
    ],
  });
  check(n.stages.map((s) => s.id).join('|') === 'welcome|tour|welcome-2' && n.start === 'welcome' && n.confidence === 1,
    'interactions: stages get unique ids, an unknown start becomes the first stage, confidence stays within 0–1', n);
  check(n.patterns.length === 2 && n.patterns[0].id === 'hours' && n.patterns[1].id === 'hours-2' && n.patterns[0].when.examples.length === 2,
    'interactions: patterns get unique ids, examples a list', n.patterns.map((p) => p.id));
  check(n.patterns[0].then.length === 1 && n.patterns[1].stage === '' && n.patterns[1].when.kind === 'says' && n.patterns[1].then[0].options.join() === 'A,B' && n.patterns[1].then[1].mood === 'neutral',
    'interactions: unknown actions dropped, unknown stage → every stage, unknown kind → says, unknown mood → neutral', n.patterns[1]);
  check(slug('Opening hours — Été!') === 'opening-hours-ete', 'slug: "Opening hours — Été!" → opening-hours-ete');
  const lang = normalizeInteractions({ patterns: [{ name: 'L', then: ['fr', 'xx', 'toString', undefined].map((language) => ({ do: 'language', language })) }] }).patterns[0].then;
  check(lang.map((a) => a.language).join('|') === 'fr|||', 'interactions: "Change language" keeps a known language, anything else is the agent\'s own (\'\')', lang);
}

// — the store —
const examples = join(ROOT, 'app', 'agents');
const dir = mkdtempSync(join(tmpdir(), 'vik-agents-test-'));
const legacy = mkdtempSync(join(tmpdir(), 'vik-legacy-'));
writeFileSync(join(legacy, 'old.json'), JSON.stringify({ title: 'Old one', name: 'Olga', persona: 'An old persona.', engine: 'gemini', apiKey: 'AIza-secret' }));
const changes = [];
let store = createAgentStore({ dir, examples, legacy: [legacy] });
{
  const ids = store.list().map((a) => a.id);
  check(['chef', 'gardener', 'museum-guide', 'old-one', 'station-kiosk'].every((x) => ids.includes(x)), 'store: first launch copies the examples and imports the old personas', ids);
  const old = store.get('old-one');
  check(old.settings.name === 'Olga' && old.body === 'An old persona.' && !('apiKey' in old.settings) && old.settings.engine === 'gemini', 'store: an old persona keeps its settings (its engine too), never its key', old.settings);
  const museum = store.get('museum-guide');
  check(museum.tables.map((t) => t.id).join() === 'artists,artworks' && museum.tables[1].rows.length === 6 && museum.interactions.patterns.length >= 5,
    'store: an agent comes with its tables and its patterns', museum.tables.map((t) => `${t.id}:${t.rows.length}`));
  const s = store.list().find((a) => a.id === 'museum-guide');
  check(s.title === 'Museum guide' && s.name === 'Ada' && s.tables === 2, 'store: the list gives title, name, counts', s);
  // a second start: the examples are not copied again (even those deleted)
  store.remove('chef');
  store = createAgentStore({ dir, examples, legacy: [legacy] });
  check(!store.list().some((a) => a.id === 'chef') && readdirSync(join(dir, '.trash')).some((n) => n.startsWith('chef-')), 'store: a deleted agent goes to the trash, and stays deleted at the next start');
  check(store.addExamples().join() === 'chef', 'store: "add the examples" brings back the missing ones only');
  store.onChange((id) => changes.push(id));
}
{
  const a = store.create({ name: 'Bike shop' });
  check(a.id === 'bike-shop' && store.get('bike-shop').interactions.stages.length === 1, 'store: a new agent, with one stage', a);
  store.savePersona('bike-shop', { settings: { name: 'Bo', title: 'Bike shop', endSilenceMs: 700, evil: { x: 1 } }, body: 'You sell bikes.' });
  const p = parsePersona(readFileSync(join(dir, 'bike-shop', 'persona.md'), 'utf8'));
  check(p.settings.endSilenceMs === 700 && !('evil' in p.settings) && p.body === 'You sell bikes.', 'store: the persona is saved as persona.md (plain values only)', p);
  const t = store.saveTable('bike-shop', 'Bikes for sale', { headers: ['model', 'price', ''], rows: [['City', '300', ''], ['', '', ''], ['Racing', '900']] });
  check(t.id === 'bikes-for-sale' && t.name === 'Bikes for sale' && t.rows.length === 2 && t.headers[2] === 'column 3' && existsSync(join(dir, 'bike-shop', 'knowledge', 'bikes-for-sale.csv')),
    'store: a table is saved as knowledge/<name>.csv; empty rows dropped, empty headers named', t);
  check(store.renameTable('bike-shop', 'bikes-for-sale', 'Bikes') === 'bikes' && store.get('bike-shop').tables[0].id === 'bikes', 'store: a table renamed');
  store.deleteTable('bike-shop', 'bikes');
  check(store.get('bike-shop').tables.length === 0, 'store: a table deleted');
  const i = store.saveInteractions('bike-shop', { stages: [{ name: 'Shop' }], patterns: [{ name: 'Price', when: { kind: 'says', examples: ['how much'] }, then: [{ do: 'say', text: 'Ask me!' }] }] });
  check(i.patterns[0].id === 'price' && JSON.parse(readFileSync(join(dir, 'bike-shop', 'interactions.json'), 'utf8')).patterns.length === 1, 'store: interactions saved, normalized');
  check(changes.includes('bike-shop'), 'store: each change is announced (the decision model rebuilds)');
  // a hand edit, while the app runs
  writeFileSync(join(dir, 'bike-shop', 'knowledge', 'hand.csv'), 'name,x\nFoo,1\n');
  check(store.get('bike-shop').tables.some((t2) => t2.id === 'hand'), 'store: a file added by hand is seen at once');
  const copy = store.create({ from: 'bike-shop' });
  check(copy.id === 'bike-shop-copy' && copy.title === 'Bike shop (copy)' && store.get(copy.id).tables.length === 1, 'store: a copy of an agent', copy);
  const bundle = store.exportBundle('museum-guide');
  check(bundle.vik === 'agent' && /name: Ada/.test(bundle.persona) && /Water Lilies/.test(bundle.knowledge.artworks), 'store: an agent exported in one file');
  const imported = store.create({ bundle });
  const im = store.get(imported.id);
  check(imported.id === 'museum-guide-2' && im.tables.length === 2 && im.interactions.patterns.length === store.get('museum-guide').interactions.patterns.length,
    'store: imported back, the same agent', imported);
  // an agent is a project (3.8): it carries its engine, language model, address and OSC (the studio asks before using
  // those of an imported agent), never a key or a password
  const sneaky = store.create({ bundle: { vik: 'agent', id: 'sneaky', persona: '---\nname: Sly\nllm: service\nllmUrl: https://evil.example/v1\nllmKey: stolen\noscTo: evil.example:9000\noscIn: 7777\nengine: gemini\napiKey: AIza-stolen\nserverUrl: ws://evil\nlocalVoice: M4\n---\n\nHi.', knowledge: {}, interactions: {} } });
  const sly = store.get(sneaky.id);
  const slyFile = readFileSync(join(dir, sneaky.id, 'persona.md'), 'utf8');
  check(sly.settings.localVoice === 'M4' && sly.settings.llmUrl === 'https://evil.example/v1' && sly.settings.oscTo === 'evil.example:9000' && sly.settings.oscIn === 7777 && sly.settings.engine === 'gemini'
    && !['llmKey', 'apiKey', 'serverUrl'].some((k) => k in sly.settings) && !/stolen|ws:\/\/evil/.test(slyFile),
    'store: an imported agent carries its project settings (language model, address, OSC, engine), never a key, a password or this computer\'s address', sly.settings);
  writeFileSync(join(dir, sneaky.id, 'persona.md'), '---\nname: Sly\nllmKey: stolen\napiKey: AIza-x\n---\n\nHi.');
  check(!('llmKey' in store.get(sneaky.id).settings) && !('apiKey' in store.get(sneaky.id).settings), 'store: … nor a key from a persona.md edited by hand');
  store.savePersona(sneaky.id, { settings: { name: 'Sly', llmKey: 'x', apiKey: 'y' }, body: 'Hi.' });
  check(!/llmKey|apiKey/.test(readFileSync(join(dir, sneaky.id, 'persona.md'), 'utf8')), 'store: … nor the studio by mistake (keys are never written in an agent)');
  const legacyImport = store.create({ bundle: { name: 'Zed', persona: 'A JSON from the old export.', localVoice: 'M2', serverUrl: 'ws://evil' } });
  check(store.get(legacyImport.id).settings.localVoice === 'M2' && !('serverUrl' in store.get(legacyImport.id).settings), 'store: an old settings JSON imports too (without its connections)');
  const x = store.saveTable('bike-shop', '../../x', { headers: ['a'], rows: [['1']] });
  check(x.id === 'x' && existsSync(join(dir, 'bike-shop', 'knowledge', 'x.csv')), 'store: a table name cannot leave the folder ("../../x" → x.csv, in knowledge/)', x.id);
  check(fails(() => store.get('../etc')).status === 400 && fails(() => store.saveTable('bike-shop', '../..', { headers: ['a'], rows: [] })).status === 400 && fails(() => store.get('nobody')).status === 404,
    'store: agent names that leave the folder, and empty table names, are refused (400); unknown agents are 404');
}
// — an agent is a project: its people and the voices recorded for cloning travel with it, only when asked —
{
  const wavOf = (n) => { const b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); return b; };
  const rel = store.saveVoiceAudio('bike-shop', 'Léa Martin', wavOf(3200));
  check(rel === 'voices/lea-martin.wav' && existsSync(join(dir, 'bike-shop', 'voices', 'lea-martin.wav')), 'project: a voice recorded for cloning is kept in the agent, voices/<name>.wav', rel);
  check(fails(() => store.saveVoiceAudio('bike-shop', 'x', Buffer.from('plain text, long enough to look like a file of some sort'))).status === 400, 'project: … only a WAV file');
  check(store.voiceAudioPath('bike-shop', rel) === join(dir, 'bike-shop', 'voices', 'lea-martin.wav') && store.voiceAudioPath('bike-shop', 'voices/../persona.md') === ''
    && store.voiceAudioPath('bike-shop', 'voices/nobody.wav') === '' && store.voiceAudioPath('../bike-shop', rel) === '',
    'project: the recorded voice\'s path, for Chatterbox; none for a path that leaves the folder, a missing file, a bad agent name');
  store.saveVoices('bike-shop', [{ name: 'Léa', settings: { localVoiceEngine: 'chatterbox', referenceAudio: rel } }, { name: 'Odd', settings: { localVoiceEngine: 'chatterbox', referenceAudio: '../../secret.wav' } }]);
  const kept = store.get('bike-shop').voices;
  check(kept[0].settings.referenceAudio === rel && kept[1].settings.referenceAudio === '', 'project: a saved voice keeps its recording; any other path is dropped', kept.map((v) => v.settings.referenceAudio));
  const print = Array.from({ length: 512 }, (_, i) => Math.sin(i));
  writeFileSync(store.peopleFile('bike-shop'), JSON.stringify({ version: 1, model: 'campplus-voxceleb', people: [{ id: 'a1', name: 'Léa', seconds: 12, voiceprint: print }] }));
  check(store.peopleFile('bike-shop') === join(dir, 'bike-shop', 'people.json') && JSON.stringify(store.privateParts('bike-shop')) === '{"people":1,"recordedVoices":1}' && JSON.stringify(store.privateParts('chef')) === '{"people":0,"recordedVoices":0}',
    'project: each agent has its own people.json; what an export could carry: 1 person, 1 recorded voice', store.privateParts('bike-shop'));
  const plain = store.exportBundle('bike-shop');
  const full = store.exportBundle('bike-shop', { withPeople: true });
  check(!('people' in plain) && !('voiceAudio' in plain) && plain.voices.length === 2, 'project: an export without consent carries the saved voices, not the people nor the recording', Object.keys(plain));
  check(full.people.people[0].name === 'Léa' && full.voiceAudio[rel] === wavOf(3200).toString('base64'), 'project: with consent, the people and the recording too', Object.keys(full));
  const back = store.create({ bundle: full });
  check(readFileSync(join(dir, back.id, rel)).equals(wavOf(3200)) && JSON.parse(readFileSync(join(dir, back.id, 'people.json'), 'utf8')).people[0].name === 'Léa' && store.get(back.id).voices[0].settings.referenceAudio === rel,
    'project: imported, the agent recognizes the same people and speaks with the same recorded voice', back.id);
  const evil = store.create({ bundle: { ...plain, id: 'evil', voiceAudio: { '../../evil.wav': wavOf(10).toString('base64'), 'voices/text.wav': Buffer.from('no').toString('base64') }, people: 'junk' } });
  check(!existsSync(join(dir, '..', 'evil.wav')) && !existsSync(join(dir, evil.id, 'voices', 'text.wav')) && !existsSync(join(dir, evil.id, 'people.json')),
    'project: an import cannot write outside its folder, nor a file that is not a WAV, nor people that are not a list');
}

// — the API, through the server —
{
  const { loadConfig } = await import(src('config.mjs'));
  const { startServer } = await import(src('app-server.mjs'));
  const adir = mkdtempSync(join(tmpdir(), 'vik-api-'));
  const srv = await startServer({ config: loadConfig(join(tmpdir(), 'none.json')), mock: true, port: 19500 + Math.floor(Math.random() * 90), agentsDir: adir, log: () => {} });
  const base = `http://127.0.0.1:${srv.port}/api`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json(), headers: r.headers };
  };
  const l = await call('GET', '/agents');
  check(l.status === 200 && l.json.length === 4, 'api: GET /agents lists the example agents', l.json.map((a) => a.id));
  const made = await call('POST', '/agents', { name: 'Café' });
  check(made.status === 200 && made.json.id === 'cafe', 'api: POST /agents creates one', made.json);
  const put = await call('PUT', '/agents/cafe/persona', { settings: { name: 'Cleo', title: 'Café' }, body: 'You run a café.' });
  const got = await call('GET', '/agents/cafe');
  check(put.status === 200 && got.json.settings.name === 'Cleo' && got.json.body === 'You run a café.', 'api: PUT persona, then GET the agent', got.json);
  const tab = await call('PUT', '/agents/cafe/tables/menu', { headers: ['drink', 'price'], rows: [['Espresso', '2']] });
  check(tab.status === 200 && tab.json.rows[0][0] === 'Espresso', 'api: PUT a table');
  const ren = await call('POST', '/agents/cafe/tables/menu/rename', { to: 'Drinks' });
  check(ren.json.id === 'drinks', 'api: rename a table', ren.json);
  const inter = await call('PUT', '/agents/cafe/interactions', { patterns: [{ name: 'Hello', when: { kind: 'says', examples: ['hi'] }, then: [{ do: 'say', text: 'Hello!' }] }] });
  check(inter.json.patterns[0].id === 'hello', 'api: PUT interactions (normalized in the answer)');
  const ex = await call('GET', '/agents/cafe/export');
  check(ex.status === 200 && ex.json.vik === 'agent' && /attachment; filename="cafe\.vik\.json"/.test(ex.headers.get('content-disposition') || ''), 'api: export downloads cafe.vik.json');
  const imp = await call('POST', '/agents', { bundle: ex.json });
  check(imp.json.id === 'cafe-2', 'api: import it back');
  // Clone a voice: the studio's recording (PCM, 16 kHz) or a WAV file, kept in the agent
  const upload = (q, data) => fetch(`${base}/agents/cafe/voice-audio?${q}`, { method: 'POST', body: data }).then(async (x) => ({ status: x.status, json: await x.json() }));
  const pcm = await upload('name=Léa&format=pcm', Buffer.alloc(16000 * 2 * 6));
  const short = await upload('name=Léa&format=pcm', Buffer.alloc(16000 * 2 * 2));
  const notWav = await upload('name=Odd&format=wav', Buffer.from('just some text, not a sound file at all'));
  const saved = readFileSync(join(adir, 'cafe', 'voices', 'lea.wav'));
  check(pcm.status === 200 && pcm.json.referenceAudio === 'voices/lea.wav' && saved.subarray(0, 4).toString() === 'RIFF' && saved.readUInt32LE(24) === 16000 && saved.length === 44 + 16000 * 2 * 6,
    'clone: the recording (PCM) is kept as voices/lea.wav, a 16 kHz WAV', pcm.json);
  check(short.status === 400 && /5 seconds/.test(short.json.error) && notWav.status === 400 && /WAV/.test(notWav.json.error), 'clone: too short, or not a WAV: refused, and says why', [short.json, notWav.json]);
  check((await upload('name=x&format=pcm', Buffer.alloc(10))).status === 400 && (await fetch(`${base}/agents/nobody/voice-audio?name=x&format=wav`, { method: 'POST', body: saved })).status === 404,
    'clone: an unknown agent is 404');
  await call('PUT', '/agents/cafe/voices', { voices: [{ name: 'Léa', settings: { localVoiceEngine: 'chatterbox', referenceAudio: 'voices/lea.wav' } }] });
  const priv = await call('GET', '/agents/cafe/private');
  const exPlain = await call('GET', '/agents/cafe/export');
  const exFull = await call('GET', '/agents/cafe/export?people=1');
  check(priv.json.recordedVoices === 1 && priv.json.people === 0 && !('voiceAudio' in exPlain.json) && exFull.json.voiceAudio['voices/lea.wav'] === saved.toString('base64'),
    'export: GET …/private says what consent would add; ?people=1 adds the recorded voice', { priv: priv.json, plain: Object.keys(exPlain.json), full: Object.keys(exFull.json) });
  check((await call('DELETE', '/agents/cafe-2')).status === 200 && (await call('GET', '/agents/cafe-2')).status === 404, 'api: DELETE an agent');
  const bad = await call('PUT', '/agents/cafe/persona', undefined);
  const r = await fetch(`${base}/agents/cafe/persona`, { method: 'PUT', body: '{not json' });
  check(bad.status === 200 && r.status === 400 && (await r.json()).error, 'api: invalid JSON → 400 with an error');
  check((await call('GET', '/nothing')).status === 404 && (await call('GET', '/agents/Bad%20Name')).status === 400, 'api: unknown route 404, bad name 400');
  const foreign = await fetch(`${base}/agents`, { headers: { origin: 'https://evil.example' } });
  check(foreign.status === 403, 'api: a request from another website is refused', foreign.status);
  // Voice & timing → Listen: a sentence in a voice, as a WAV, without a conversation; the models prepared before Start
  const wavOf = (language) => fetch(`http://127.0.0.1:${srv.port}/api/voice/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { localVoiceEngine: 'supertonic', localVoice: 'M2' }, language }) });
  const wav = await wavOf('fr');
  const bytes = Buffer.from(await wav.arrayBuffer());
  check(wav.status === 200 && wav.headers.get('content-type') === 'audio/wav' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE' && bytes.length > 44 + 2000,
    'listen: POST /api/voice/test answers a WAV of the voice saying its sentence', { status: wav.status, type: wav.headers.get('content-type'), bytes: bytes.length });
  const mine = await fetch(`http://127.0.0.1:${srv.port}/api/voice/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { localVoiceEngine: 'supertonic' }, language: 'fr', text: 'Une phrase à moi, bien plus longue que la phrase d\'exemple, pour entendre la voix sur la durée, avec des virgules, des pauses et une question à la fin ?' }) });
  const mineBytes = Buffer.from(await mine.arrayBuffer());
  check(mine.status === 200 && mineBytes.length > bytes.length * 1.5, 'listen: a sentence of one\'s own is said instead of the sample (a longer text, a longer sound)', { mine: mineBytes.length, sample: bytes.length });
  const prep = await (await fetch(`http://127.0.0.1:${srv.port}/api/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { language: 'fr' } }) })).json();
  check(prep.ok === true, 'prepare: POST /api/prepare loads the models of the agent shown, before Start', prep);
  const talk = new WebSocket(`ws://127.0.0.1:${srv.port}/voice`);
  await new Promise((r) => { talk.onopen = r; });
  const readyNow = new Promise((r) => { talk.onmessage = (e) => { if (typeof e.data === 'string' && JSON.parse(e.data).type === 'ready') r(); }; });
  talk.send(JSON.stringify({ type: 'start', settings: { language: 'en' } }));
  await readyNow;
  const during = await wavOf('en');
  const prepDuring = await (await fetch(`http://127.0.0.1:${srv.port}/api/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { language: 'fr' } }) })).json();
  check(during.status === 400 && /Stop the conversation/.test((await during.json()).error) && prepDuring.skipped,
    'listen and prepare: not during a conversation (it uses the voice and the models)', prepDuring);
  talk.close();
  await new Promise((r) => setTimeout(r, 200));
  // DNS rebinding: a page whose own name points at this computer keeps that name in the Host header
  const { request } = await import('node:http');
  const asHost = (host, path, headers = {}) => new Promise((resolve) => {
    const q = request({ host: '127.0.0.1', port: srv.port, path, headers: { host, ...headers } }, (res) => { res.resume(); resolve(res.statusCode); });
    q.on('error', () => resolve(0));
    q.end();
  });
  const rebound = await asHost(`evil.example:${srv.port}`, '/api/agents', { 'sec-fetch-site': 'same-origin' });
  const upgrade = await asHost(`evil.example:${srv.port}`, '/voice', { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' });
  const named = await asHost(`localhost:${srv.port}`, '/api/agents');
  check(rebound === 403 && upgrade === 403 && named === 200, 'host: a request named for another site (DNS rebinding) is refused, HTTP and WebSocket; localhost is fine', { rebound, upgrade, named });
  const health = (h) => fetch(`http://127.0.0.1:${srv.port}/health`, { headers: h }).then((x) => x.json());
  const [own, site] = [await health({}), await health({ origin: 'https://example.com' })];
  check(own.agentsDir === adir && !('agentsDir' in site) && site.models, '/health: the agents folder (the account\'s name is in its path) only for the studio, not for a website', { own: own.agentsDir, site: site.agentsDir });
  // stopping does not wait for the studio's open sockets (the Zonos voice keeps one open)
  const sock = new WebSocket(`ws://127.0.0.1:${srv.port}/zonos`);
  const opened = await new Promise((r) => { sock.onopen = () => r(true); sock.onerror = () => r(false); });
  const t0 = Date.now();
  await Promise.race([srv.close(), new Promise((r) => setTimeout(r, 3000))]);
  check(opened && Date.now() - t0 < 1500, 'stop: the server closes at once with a socket still open', { opened, ms: Date.now() - t0 });
}

// — 3.8: the people recorded on this computer (one people.json) become each agent's, once —
{
  const { loadConfig } = await import(src('config.mjs'));
  const { startServer } = await import(src('app-server.mjs'));
  const adir = mkdtempSync(join(tmpdir(), 'vik-migrate-'));
  const home = mkdtempSync(join(tmpdir(), 'vik-home-'));
  const peopleFile = join(home, 'people.json');
  const old = { version: 1, model: 'campplus-voxceleb', people: [{ id: 'p1', name: 'Léa', seconds: 10, voiceprint: Array.from({ length: 512 }, (_, i) => Math.cos(i)) }] };
  writeFileSync(peopleFile, JSON.stringify(old));
  // an agent that already has its own people keeps them
  const pre = createAgentStore({ dir: adir, examples, legacy: [] });
  writeFileSync(pre.peopleFile('chef'), JSON.stringify({ ...old, people: [{ ...old.people[0], id: 'p9', name: 'Chef Jo' }] }));
  const srv = await startServer({ config: loadConfig(join(tmpdir(), 'none.json')), mock: true, port: 19600 + Math.floor(Math.random() * 90), agentsDir: adir, peopleFile, log: () => {} });
  const ppl = async (agent) => (await (await fetch(`http://127.0.0.1:${srv.port}/api/people?agent=${agent}`)).json()).people.map((p) => p.name).join();
  const [museum, chef] = [await ppl('museum-guide'), await ppl('chef')];
  check(museum === 'Léa' && chef === 'Chef Jo' && !existsSync(peopleFile) && existsSync(`${peopleFile}.before-3.8`),
    'migration: each agent gets the people of this computer (one that has its own keeps them); the old file is renamed, not deleted', { museum, chef });
  await srv.close();
}

// — files written by people and other programs —
{
  // a column title with semicolons, written then read back: still two columns (the separator is guessed)
  const t = { headers: ['Room', 'Open (mon; tue; wed)'], rows: [['Louvre', '9:00, closed tuesday'], ['Orsay', 'a;b']] };
  check(JSON.stringify(parseCsv(writeCsv(t))) === JSON.stringify(t), 'csv: semicolons in a title or a cell survive a save (quoted): the separator stays a comma', parseCsv(writeCsv(t)));
  const big = `a,b\n${'1,2\n'.repeat(200000)}`;
  let rows = -1;
  try { rows = parseCsv(big).rows.length; } catch (e) { rows = e.message; }
  check(rows === 200000, 'csv: a table of 200 000 rows is read (no stack overflow)', rows);
  const n = normalizeInteractions({ stages: [{ id: 'Intro' }, { name: 'Main Hall' }], start: 'Main Hall',
    patterns: [{ name: 'A', stage: 'Intro', when: { kind: 'constructor' }, then: [{ do: 'say', text: 'hi' }, { do: 'toString' }, { do: '__proto__' }] }] });
  check(n.start === 'main-hall' && n.patterns[0].stage === 'intro' && n.patterns[0].when.kind === 'says' && JSON.stringify(n.patterns[0].then) === '[{"do":"say","text":"hi"}]',
    'interactions: stages named as written ("Main Hall", "Intro") still found; "constructor", "toString" are not kinds or actions', n);
  // an interactions.json saved with a BOM (PowerShell, some Windows editors), a table named menu.CSV edited by hand
  const d = mkdtempSync(join(tmpdir(), 'vik-bom-'));
  const st = createAgentStore({ dir: d });
  st.create({ name: 'Kiosk' });
  writeFileSync(join(d, 'kiosk', 'interactions.json'), `﻿${JSON.stringify({ stages: [{ id: 'main' }], patterns: [{ name: 'Hi', when: { kind: 'says', examples: ['hello'] }, then: [] }] })}`);
  check(st.get('kiosk').interactions.patterns.length === 1, 'files: an interactions.json starting with a BOM keeps its patterns');
  writeFileSync(join(d, 'kiosk', 'knowledge', 'menu.CSV'), 'name,price\nTea,2\n');
  const before = st.get('kiosk').tables.find((x) => x.id === 'menu');
  writeFileSync(join(d, 'kiosk', 'knowledge', 'menu.CSV'), 'name,price\nTea,2\nCoffee,3\n');
  const after = st.get('kiosk').tables.find((x) => x.id === 'menu');
  check(before && before.rows.length === 1 && after && after.rows.length === 2, 'files: a table named menu.CSV, edited by hand, is read again', [before && before.rows.length, after && after.rows.length]);
}

// no process.exit(): on Windows, exiting while the fetch sockets close can crash Node (0xC0000409)
process.exitCode = summary() ? 1 : 0;
