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
  check(old.settings.name === 'Olga' && old.body === 'An old persona.' && !('apiKey' in old.settings) && !('engine' in old.settings), 'store: an old persona keeps its settings, never its key or its engine', old.settings);
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
  const legacyImport = store.create({ bundle: { name: 'Zed', persona: 'A JSON from the old export.', localVoice: 'M2', serverUrl: 'ws://evil' } });
  check(store.get(legacyImport.id).settings.localVoice === 'M2' && !('serverUrl' in store.get(legacyImport.id).settings), 'store: an old settings JSON imports too (without its connections)');
  const x = store.saveTable('bike-shop', '../../x', { headers: ['a'], rows: [['1']] });
  check(x.id === 'x' && existsSync(join(dir, 'bike-shop', 'knowledge', 'x.csv')), 'store: a table name cannot leave the folder ("../../x" → x.csv, in knowledge/)', x.id);
  check(fails(() => store.get('../etc')).status === 400 && fails(() => store.saveTable('bike-shop', '../..', { headers: ['a'], rows: [] })).status === 400 && fails(() => store.get('nobody')).status === 404,
    'store: agent names that leave the folder, and empty table names, are refused (400); unknown agents are 404');
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
  check((await call('DELETE', '/agents/cafe-2')).status === 200 && (await call('GET', '/agents/cafe-2')).status === 404, 'api: DELETE an agent');
  const bad = await call('PUT', '/agents/cafe/persona', undefined);
  const r = await fetch(`${base}/agents/cafe/persona`, { method: 'PUT', body: '{not json' });
  check(bad.status === 200 && r.status === 400 && (await r.json()).error, 'api: invalid JSON → 400 with an error');
  check((await call('GET', '/nothing')).status === 404 && (await call('GET', '/agents/Bad%20Name')).status === 400, 'api: unknown route 404, bad name 400');
  const foreign = await fetch(`${base}/agents`, { headers: { origin: 'https://evil.example' } });
  check(foreign.status === 403, 'api: a request from another website is refused', foreign.status);
  await srv.close();
}

// no process.exit(): on Windows, exiting while the fetch sockets close can crash Node (0xC0000409)
process.exitCode = summary() ? 1 : 0;
