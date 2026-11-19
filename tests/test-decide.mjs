// The decision model (app/src/agent/: knowledge, matcher, decide) and how a conversation follows it: patterns,
// stages, entries, placeholders, signals, the knowledge given to the language model, the explanation events.
//   node tests/test-decide.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary, until, sleep } from './helpers.mjs';
import { startMockFarm } from './mock-farm.mjs';

const src = (f) => pathToFileURL(join(ROOT, 'app', 'src', f)).href;
const { entriesOf, namedIn, fill, unknownPlaceholders, describe, withLinks, normalize } = await import(src('agent/knowledge.mjs'));
const { wordVector, cosine, wordsMatcher, modelMatcher } = await import(src('agent/matcher.mjs'));
const { createDecider, knowledgePrompt } = await import(src('agent/decide.mjs'));
const { createAgentStore } = await import(src('agent/agents.mjs'));

// — 1. knowledge —
const museum = {
  tables: [
    { id: 'artworks', name: 'Artworks', headers: ['name', 'artist', 'year'], rows: [['Water Lilies', 'Claude Monet', '1916'], ['The Thinker', 'Auguste Rodin', '1904']] },
    { id: 'artists', name: 'Artists', headers: ['name', 'born'], rows: [['Claude Monet', '1840'], ['Auguste Rodin', '1840']] },
  ],
};
{
  const es = entriesOf(museum);
  const lilies = es.find((e) => e.key === 'Water Lilies');
  check(es.length === 4 && lilies.links.length === 1 && lilies.links[0].table === 'artists' && lilies.links[0].key === 'Claude Monet',
    'knowledge: a cell naming an entry of another table links them', lilies.links);
  check(describe(lilies) === 'Water Lilies (artworks) — artist: Claude Monet; year: 1916', 'knowledge: an entry as one line', describe(lilies));
  check(withLinks(es, [lilies]).map((e) => e.key).join('|') === 'Water Lilies|Claude Monet', 'knowledge: an entry comes with its links (one step)');
  check(namedIn('tell me about the WATER-LILIES!', 'Water Lilies') && !namedIn('the watery lilies', 'Water Lilies') && !namedIn('room 3 please', '3'),
    'knowledge: a name said as whole words (case, punctuation ignored); never names under 3 letters');
  check(fill('{name} by {Artist}, {year}. You said: {said}. {nope}', lilies, { said: 'hi' }) === 'Water Lilies by Claude Monet, 1916. You said: hi.',
    'knowledge: placeholders filled ({column} in any case, {said}), unknown ones emptied', fill('{name} by {Artist}, {year}. You said: {said}. {nope}', lilies, { said: 'hi' }));
  check(fill('Voilà un dessin animé, {speaker} !', null, { speaker: '' }) === 'Voilà un dessin animé !' && fill('Here it is, {speaker}.', null, { speaker: '' }) === 'Here it is.'
    && fill('Here it is, {speaker}.', null, { speaker: 'Léo' }) === 'Here it is, Léo.', 'fill: an empty {speaker} (someone not recognized) takes its comma with it');
  check(unknownPlaceholders('{name} {room} {said}', ['name', 'year']).join() === 'room', 'knowledge: the studio can warn about a placeholder no column fills');
  check(normalize("L'Été, à Paris!") === 'l ete a paris', 'knowledge: normalize (accents, apostrophes, punctuation)');
  check(namedIn('parlez-moi du Penseur', 'Le Penseur') && namedIn('where is Thinker', 'The Thinker') && !namedIn('the', 'The A'), 'knowledge: a leading article need not be said ("du Penseur" names "Le Penseur")');
  const alias = entriesOf({ tables: [
    { id: 'artworks', name: 'Artworks', headers: ['name', 'artist'], rows: [['Water Lilies | Nymphéas', 'Monet | Claude Monet']] },
    { id: 'artists', name: 'Artists', headers: ['name'], rows: [['Claude Monet | Monet']] },
  ] });
  check(alias[0].key === 'Water Lilies' && alias[0].names.join() === 'Water Lilies,Nymphéas' && alias[0].cells.name === 'Water Lilies' && alias[0].links.length === 0,
    'knowledge: a first cell "Water Lilies | Nymphéas" gives two names, shown by the first', alias[0]);
  check(entriesOf({ tables: [{ id: 'a', name: 'A', headers: ['name', 'by'], rows: [['X', 'Monet']] }, { id: 'b', name: 'B', headers: ['name'], rows: [['Claude Monet | Monet']] }] })[0].links[0].key === 'Claude Monet',
    'knowledge: a cell naming any name of another entry links to it');
  check(/^Water Lilies \(also: Nymphéas\) \(artworks\)/.test(describe(alias[0])), 'knowledge: the other names are part of the entry\'s text (the matcher, the model)', describe(alias[0]));
}

// — 1b. OSC out (app/src/osc.mjs): the action, its value, where it goes, the bytes —
const json = (x) => JSON.stringify(x);
/** One OSC message → {address, args}: strings, int32 and float32 (what the action sends). */
function decodeOsc(b) {
  let i = 0;
  const str = () => { const end = b.indexOf(0, i); const s = b.toString('utf8', i, end); i = (end + 4) & ~3; return s; };
  const address = str();
  const args = [...str().slice(1)].map((t) => { const v = t === 's' ? str() : t === 'i' ? b.readInt32BE(i) : b.readFloatBE(i); if (t !== 's') i += 4; return v; });
  return { address, args };
}
{
  const { oscArgs, oscTargets, encodeOsc } = await import(src('osc.mjs'));
  const { normalizeInteractions } = await import(src('agent/interactions.mjs'));
  const n = normalizeInteractions({ patterns: [{ name: 'P', then: [{ do: 'osc', address: ' artlux/scene/ recall', value: '{name}' }, { do: 'osc', to: 'evil.example:1' }] }] });
  check(json(n.patterns[0].then) === json([{ do: 'osc', address: '/artlux/scene/recall', value: '{name}' }, { do: 'osc', address: '', value: '' }]),
    'osc: the action keeps an address (spaces out, a leading /) and a value, never a destination', n.patterns[0].then);
  const whoPats = normalizeInteractions({ patterns: [
    { name: 'Route', when: { kind: 'says', examples: ['go'] }, who: [' Papa', 'papa', '[Maman]', ''] },
    { name: 'Start', when: { kind: 'start' }, who: ['Papa'] },
    { name: 'Anyone', when: { kind: 'says' }, who: [] },
  ] }).patterns;
  check(json(whoPats[0].who) === json(['Papa', 'Maman']) && !('who' in whoPats[1]) && !('who' in whoPats[2]),
    'who: a spoken pattern keeps its people (each once, no brackets); a moment has nobody speaking; none listed: no field', whoPats.map((p) => p.who));
  check(json([oscArgs(''), oscArgs('12'), oscArgs('-0.5'), oscArgs('Story A'), oscArgs('3 apples')]) === json([[], [{ type: 'i', value: 12 }], [{ type: 'f', value: -0.5 }], [{ type: 's', value: 'Story A' }], [{ type: 's', value: '3 apples' }]]),
    'osc: the value is typed by its look: none, an integer, a float, a string');
  check(json(oscTargets('127.0.0.1:10000, 192.168.1.20:8000;arduino.local:9000 nope 1.2.3.4:0 5.6.7.8:70000')) === json([{ host: '127.0.0.1', port: 10000 }, { host: '192.168.1.20', port: 8000 }, { host: 'arduino.local', port: 9000 }]),
    'osc: "Send to" holds several host:port, separated by commas (what is not one is left out)');
  // a packet built by hand from the OSC 1.0 spec: "/a\0\0" ",si\0" "Gr\xc3\xb6ve\0\0" (UTF-8, padded) then int 7
  const want = Buffer.concat([Buffer.from('/a\0\0,si\0'), Buffer.from('Gröve\0\0', 'utf8'), Buffer.from([0, 0, 0, 7])]);
  check(encodeOsc('/a', [{ type: 's', value: 'Gröve' }, { type: 'i', value: 7 }]).equals(want) && json(decodeOsc(encodeOsc('/f', oscArgs('0.25')))) === json({ address: '/f', args: [0.25] }),
    'osc: the bytes follow OSC 1.0 (padding, UTF-8, big-endian numbers)');

  // OSC in: what an Arduino sends, read; the patterns' conditions; the live data the language model reads
  const m = await import(src('osc.mjs'));
  const d = Buffer.alloc(8); d.writeDoubleBE(2.5);
  const typed = Buffer.concat([Buffer.from('/x\0\0,ifsdTFN\0\0\0\0'), Buffer.from([0, 0, 0, 42]), encodeOsc('/', [{ type: 'f', value: 0.5 }]).subarray(8), Buffer.from('hi\0\0'), d]);
  const one = encodeOsc('/arduino/temp', [{ type: 'f', value: 31.5 }]);
  const size = Buffer.alloc(4); size.writeInt32BE(one.length);
  const bundle = Buffer.concat([Buffer.from('#bundle\0'), Buffer.alloc(8), size, one, size, encodeOsc('/arduino/temp', [{ type: 'f', value: 31.75 }])]);
  check(json(m.decodeOsc(typed)) === json([{ address: '/x', args: [42, 0.5, 'hi', 2.5, true, false, null] }]) && json(m.decodeOsc(bundle)) === json([{ address: '/arduino/temp', args: [31.5] }, { address: '/arduino/temp', args: [31.75] }])
    && json(m.decodeOsc(Buffer.from('garbage'))) === '[]' && json(m.decodeOsc(Buffer.from('/no-tags\0\0\0\0'))) === json([{ address: '/no-tags', args: [] }]),
  'osc in: numbers, text, true/false/null, a bundle of messages; garbage is ignored', m.decodeOsc(typed));
  const run = (when, values) => { const edge = {}; return values.map((v) => (m.oscFires(when, String(v), edge) ? 'F' : '.')).join(''); };
  check(run({ test: 'above', threshold: 28 }, [25, 29, 29.5, 28.1, 27.9, 29, 27.3, 28.5, 'x']) === '.F.....F.',
    'osc in: "goes above 28" fires on the crossing, not while it stays above, and again once back under 27.44 (2 %)', run({ test: 'above', threshold: 28 }, [25, 29, 29.5, 28.1, 27.9, 29, 27.3, 28.5, 'x']));
  check(run({ test: 'below', threshold: 0.5 }, [1, 0, 0, 1, 0]) === '.F..F', 'osc in: "goes below 0.5" for a button sending 1, then 0 while pressed: once per press', run({ test: 'below', threshold: 0.5 }, [1, 0, 0, 1, 0]));
  check(run({ test: 'any' }, ['a', 'a', 'b']) === 'FFF' && run({ test: 'above', threshold: 1 }, ['5 tag', 'tag 5']) === 'F.', 'osc in: "any message" fires on each one; a condition reads the first argument as a number');
  check(json(['9000', ' 9000 ', '', '0', '70000', 'abc', 9000, null].map(m.oscPort)) === json([9000, 9000, 0, 0, 0, 0, 9000, 0]), 'osc in: the port setting (empty or not a port: not listening)');
  check(json([m.oscValue([31.5]), m.oscValue(['tag', 7]), m.oscValue([true, false, null]), m.oscValue([])]) === json(['31.5', 'tag 7', '1 0', '']), 'osc in: a message\'s value as the agent reads it');
  const live = m.liveDataPrompt(new Map([['/arduino/temp', { value: '29.5', at: 1000000 }], ['/door', { value: '', at: 1000000 - 5 * 60000 }]]), 1000000);
  check(live === 'Live data, right now (the latest OSC messages from sensors and buttons; they replace any value said earlier in the conversation): /arduino/temp = 29.5; /door = (no value) (5 min ago).' && m.liveDataPrompt(new Map()) === '',
    'osc in: the live data the language model reads (an old value says its age)', live);
  const w = normalizeInteractions({ patterns: [{ name: 'A', when: { kind: 'osc', address: ' arduino/temp ', test: 'above', threshold: '28.5' } }, { name: 'B', when: { kind: 'osc', test: 'between', threshold: 'hot' } }] }).patterns.map((p) => p.when);
  check(json(w) === json([{ kind: 'osc', address: '/arduino/temp', test: 'above', threshold: 28.5 }, { kind: 'osc', address: '', test: 'any', threshold: 0 }]),
    'osc in: the pattern keeps an address, a condition (any, above, below) and a number', w);
}

// — 2. the words matcher —
{
  const sim = (a, b) => cosine(wordVector(a), wordVector(b));
  check(sim('When do you open?', 'when do YOU open') > 0.99, 'words: case and punctuation do not count');
  check(sim('what time do you open', 'when do you open') > sim('what time do you open', 'how much is a ticket'), 'words: shared meaningful words count, common words ("do", "you") do not', [sim('what time do you open', 'when do you open'), sim('what time do you open', 'how much is a ticket')]);
  check(sim('the toilets', 'toilet') > 0.95 && sim('sculptures', 'sculpture') > 0.95 && sim('the glass', 'glas') < 0.95, 'words: a plural matches its singular ("glass" is not a plural)', sim('the toilets', 'toilet'));
  check(sim('opening', 'open') > 0.15 && sim('opening', 'ticket') < 0.05, 'words: letter trigrams bring close words together', [sim('opening', 'open'), sim('opening', 'ticket')]);
  check(sim('yes', 'yes') > 0.99 && sim('next', 'okay next') > 0.6, 'words: a sentence of common words still has a vector');
}

// — 3. the decider, on the example agents —
const dir = mkdtempSync(join(tmpdir(), 'vik-decide-'));
const store = createAgentStore({ dir, examples: join(ROOT, 'app', 'agents') });
const words = wordsMatcher();
const decider = createDecider({ store, matcher: () => words });
{
  const d = await decider.decide('station-kiosk', 'When is the train to Lyon?', {});
  check(d.kind === 'pattern' && d.pattern.id === 'departure' && d.entry.key === 'Lyon' && d.score >= 0.95 && d.stage === 'main' && d.matcher === 'Words',
    'decide: "When is the train to Lyon?" → the pattern "A departure", entry Lyon (named: ≥ 0.95)', d);
  check(fill(d.then[0].text, d.entryCells) === 'The train to Lyon leaves at 2:12 pm from platform 4. It is on time.', 'decide: the line, filled from the row');
  check(d.candidates.length >= 2 && d.candidates[0].id === 'departure' && d.candidates[1].score < d.candidates[0].score, 'decide: the runners-up, best first (the explanation)', d.candidates);
  const w = await decider.decide('station-kiosk', 'what is the weather like', {});
  check(w.kind === 'otherwise' && w.pattern.id === 'off-topic' && w.score === null, 'decide: nothing fires → the stage\'s "otherwise" pattern', w.pattern);
  const g = await decider.decide('gardener', 'what is the capital of Peru', {});
  check(g.kind === 'free' && !g.pattern && g.then.length === 0, 'decide: nothing fires and no "otherwise" → a free answer', g.kind);
  // stages: the chef's "next" depends on the step
  const n1 = await decider.decide('chef', 'okay next', { stage: 'flour' });
  const n2 = await decider.decide('chef', 'okay next', { stage: 'eggs' });
  check(n1.pattern.id === 'step-eggs' && n2.pattern.id === 'step-milk', 'decide: the same sentence, another stage, another pattern (a state machine)', [n1.pattern.id, n2.pattern.id]);
  const start = await decider.decide('chef', 'okay next', { stage: 'nowhere' });
  check(start.stage === 'ready', 'decide: an unknown stage → the agent\'s first stage', start.stage);
  // the entry in focus, and its links, for the model
  const f = await decider.decide('museum-guide', 'who painted it?', { stage: 'tour', focus: { table: 'artworks', key: 'Water Lilies' } });
  check(f.kind === 'free' && f.knowledge.map((e) => e.key).includes('Water Lilies') && f.knowledge.map((e) => e.key).includes('Claude Monet'),
    'decide: "who painted it?" → a free answer, with the entry in focus and its artist (a link)', f.knowledge.map((e) => e.key));
  check(/^What you know that may help .*\n- Water Lilies \(also: Nymphéas\) \(artworks\) — artist: Claude Monet/.test(knowledgePrompt(f.knowledge)), 'decide: the knowledge, as text for the prompt', knowledgePrompt(f.knowledge).slice(0, 120));
  const fr = await decider.decide('museum-guide', 'parlez-moi des Nymphéas', { stage: 'welcome' });
  check(fr.pattern && fr.pattern.id === 'artwork' && fr.entry.key === 'Water Lilies', 'decide: an entry found by its other name ("Nymphéas"), shown by its first', fr.entry);
  // the confidence
  const raw = await decider.decide('museum-guide', 'what time do you open', { stage: 'welcome' });
  store.saveInteractions('museum-guide', { ...store.get('museum-guide').interactions, confidence: 0.99 });
  const strict = await decider.decide('museum-guide', 'what time do you open', { stage: 'welcome' });
  check(raw.pattern && raw.pattern.id === 'opening-hours' && raw.score < 0.99 && strict.kind === 'free', 'decide: a higher confidence asks for a closer match (0.99 → a free answer)', [raw.score, strict.kind]);
  store.saveInteractions('museum-guide', { ...store.get('museum-guide').interactions, confidence: 0.5 });
  // a vague sentence that fits every entry about as well is not a mention ("who painted it?")
  store.create({ name: 'Rooms' });
  store.saveTable('rooms', 'rooms', { headers: ['name', 'note'], rows: [['Red room', 'a quiet room with paintings'], ['Blue room', 'a quiet room with sculptures']] });
  store.saveInteractions('rooms', { stages: [{ name: 'Main' }], confidence: 0.3, patterns: [{ name: 'A room', when: { kind: 'mentions', table: 'rooms' }, then: [{ do: 'say', text: '{name}!' }] }] });
  const vague = await decider.decide('rooms', 'is it a quiet room', {});
  const clear = await decider.decide('rooms', 'take me to the blue room', {});
  check(vague.kind === 'free' && vague.candidates[0].score < 0.3 && clear.kind === 'pattern' && clear.entry.key === 'Blue room',
    'decide: a sentence that fits every entry about as well is not a mention (ambiguity); a name said is', [vague.candidates[0], clear.entry]);
  // moments: a client's signal, the start
  const sig = await decider.onMoment('station-kiosk', 'signal', {}, 'Visitor-Near');
  check(sig && sig.pattern.id === 'someone-near' && sig.then[0].text === 'Hello! Where are you going?', 'decide: a client\'s signal fires its pattern (name: case ignored)', sig && sig.pattern);
  check((await decider.onMoment('station-kiosk', 'signal', {}, 'nothing')) === null && (await decider.onMoment('chef', 'start', {})) === null, 'decide: no pattern for a moment → null');
  // a pattern turned off is ignored
  const off = store.get('station-kiosk').interactions;
  store.saveInteractions('station-kiosk', { ...off, patterns: off.patterns.map((p) => (p.id === 'departure' ? { ...p, on: false } : p)) });
  const d2 = await decider.decide('station-kiosk', 'When is the train to Lyon?', {});
  check(!d2.pattern || d2.pattern.id !== 'departure', 'decide: a pattern turned off never fires', d2.pattern);
  store.saveInteractions('station-kiosk', off);
}

// — 4. a model matcher: prompts, batches, cache —
{
  const calls = [];
  const m = modelMatcher({ id: 'fake', name: 'Fake model', calibration: { similar: [0.2, 1], search: [0.1, 0.6] }, batch: 2, embed: async (texts) => { calls.push(texts); return texts.map((t) => [t.length % 7, 1, t.includes('query') ? 1 : 0]); } });
  await m.vectors(['a', 'b', 'c'], 'similar');
  await m.vectors(['a', 'd'], 'similar');
  await m.vectors(['Lyon row'], 'document', ['Lyon']);
  check(calls.length === 4 && calls[0].length === 2 && calls[0][0] === 'task: sentence similarity | query: a' && calls[1].join() === 'task: sentence similarity | query: c'
    && calls[2].join() === 'task: sentence similarity | query: d',
  'model: batches of `batch`, with the "sentence similarity" prompt; a text already seen is not embedded again', calls);
  check(calls[3][0] === 'title: Lyon | text: Lyon row', 'model: an entry with the document prompt and its title', calls[3]);
  const [x] = await m.vectors(['a'], 'similar');
  check(calls.length === 4 && Math.abs(Math.hypot(...x) - 1) < 1e-6, 'model: vectors are cached, and of unit length');
  check(m.score(x, x) > 0.999 && m.score(x, Float32Array.from([0, 0, 0])) === 0, 'model: the score maps the cosine above the floor to 0–1');
}

// — 5. a conversation follows the decisions (simulated engine; the replies of "answer" from a fake farm) —
{
  const farm = await startMockFarm({ reply: ['It is', ' a pond.'] });
  const { loadConfig } = await import(src('config.mjs'));
  const { startServer } = await import(src('app-server.mjs'));
  const srv = await startServer({ config: loadConfig(join(tmpdir(), 'none.json')), mock: true, port: 19600 + Math.floor(Math.random() * 90), agentsDir: mkdtempSync(join(tmpdir(), 'vik-decide-srv-')), log: () => {} });
  await srv.ready;
  const api = (p, body) => fetch(`http://127.0.0.1:${srv.port}/api${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then((r) => r.json());

  const t = await api('/decide', { agent: 'museum-guide', text: 'how much is a ticket?', stage: 'welcome' });
  check(t.pattern && t.pattern.id === 'tickets' && t.then[0].do === 'say' && Array.isArray(t.candidates) && !('entryCells' in t), 'api: /api/decide says what the agent would do, and why (the test field)', t.pattern);

  const open = async (settings) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/voice`);
    const msgs = [];
    ws.onmessage = (e) => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
    await new Promise((r) => { ws.onopen = r; });
    ws.send(JSON.stringify({ type: 'start', settings }));
    await until(() => msgs.some((m) => m.type === 'ready'), 5000);
    return { ws, msgs, after: (n, type) => until(() => msgs.slice(n).find((m) => m.type === type), 8000) };
  };
  const kiosk = await open({ agent: 'station-kiosk', name: 'Leon', persona: 'A kiosk.', greeting: 'Hello, where are you going?' });
  check(kiosk.msgs.some((m) => m.type === 'stage' && m.stage === 'main' && m.from === ''), 'conversation: it starts in the agent\'s first stage (event "stage")');
  let n = kiosk.msgs.length;
  kiosk.ws.send(JSON.stringify({ type: 'text', text: 'When is the train to Lyon?' }));
  const done = await kiosk.after(n, 'bot.done');
  const dec = kiosk.msgs.slice(n).find((m) => m.type === 'decision');
  const sig = kiosk.msgs.slice(n).find((m) => m.type === 'signal');
  check(dec && dec.pattern.id === 'departure' && dec.entry.key === 'Lyon' && dec.matcher === 'Words' && !('then' in dec), 'conversation: a "decision" event explains the choice', dec);
  check(done && done.text === 'The train to Lyon leaves at 2:12 pm from platform 4. It is on time.', 'conversation: the pattern\'s line is said, filled from the row (no language model)', done && done.text);
  check(sig && sig.name === 'show-departure' && sig.value === 'Lyon', 'conversation: its signal goes to the clients, filled', sig);
  n = kiosk.msgs.length;
  kiosk.ws.send(JSON.stringify({ type: 'signal', name: 'visitor-near', value: '1' }));
  const hello = await kiosk.after(n, 'bot.done');
  check(hello && hello.text === 'Hello! Where are you going?', 'conversation: a client\'s signal makes the agent speak (its pattern)', hello && hello.text);
  n = kiosk.msgs.length;
  kiosk.ws.send(JSON.stringify({ type: 'text', text: 'Where are the toilets?' }));
  check((await kiosk.after(n, 'bot.done')).text === 'The toilets are next to platform 1.', 'conversation: "{answer}" from the places table');
  kiosk.ws.close();
  await sleep(300);

  // the museum: an "answer" goes to the language model (the fake farm), with the entry and its links
  const guide = await open({ agent: 'museum-guide', name: 'Ada', persona: 'A guide.', llm: 'farm', llmUrl: farm.url, llmModel: 'assistant' });
  n = guide.msgs.length;
  guide.ws.send(JSON.stringify({ type: 'text', text: 'Tell me about the Water Lilies' }));
  const said = await guide.after(n, 'bot.done');
  const turn = guide.msgs.slice(n);
  const sys = farm.requests.length ? farm.requests[farm.requests.length - 1].body.messages[0].content : '';
  check(said && said.text === 'It is a pond.', 'conversation: "answer" → the language model writes the reply', said && said.text);
  check(/- Water Lilies \(also: Nymphéas\) \(artworks\) — artist: Claude Monet/.test(sys) && /- Claude Monet \(artists\)/.test(sys) && /For this reply: Tell this artwork as a short story/.test(sys),
    'conversation: the model gets the entry, its linked artist and the pattern\'s instruction', sys.slice(-500));
  check(turn.some((m) => m.type === 'stage' && m.stage === 'tour' && m.from === 'welcome') && turn.some((m) => m.type === 'signal' && m.name === 'show-artwork' && m.value === 'Water Lilies'),
    'conversation: "go" changes the stage, "signal" goes out', turn.filter((m) => ['stage', 'signal'].includes(m.type)));
  // the entry stays in focus for the next sentence
  n = guide.msgs.length;
  guide.ws.send(JSON.stringify({ type: 'text', text: 'who painted it?' }));
  await guide.after(n, 'bot.done');
  const sys2 = farm.requests[farm.requests.length - 1].body.messages[0].content;
  check(guide.msgs.slice(n).find((m) => m.type === 'decision').kind === 'free' && /Water Lilies/.test(sys2) && !/For this reply/.test(sys2),
    'conversation: "who painted it?" → a free answer that still knows the entry in focus', sys2.slice(-300));
  // a choice button: the option itself is matched
  n = guide.msgs.length;
  guide.ws.send(JSON.stringify({ type: 'text', text: '(The user chose: "Sculptures")' }));
  await guide.after(n, 'bot.done');
  const c = guide.msgs.slice(n).find((m) => m.type === 'decision');
  check(c && c.pattern && c.pattern.id === 'kind' && c.text === 'Sculptures', 'conversation: a choice button is decided on its option ("Sculptures")', c);
  // the agent changes during the conversation: back to its first stage
  n = guide.msgs.length;
  guide.ws.send(JSON.stringify({ type: 'settings', settings: { agent: 'chef' } }));
  check(await guide.after(n, 'stage') && guide.msgs.slice(n).find((m) => m.type === 'stage').stage === 'ready', 'conversation: another agent → its first stage');
  guide.ws.close();

  // a "start" pattern replaces the greeting
  await api('/agents', { name: 'Doorbell' });
  await fetch(`http://127.0.0.1:${srv.port}/api/agents/doorbell/interactions`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stages: [{ name: 'Main' }], patterns: [{ name: 'Hello', when: { kind: 'start' }, then: [{ do: 'say', text: 'Ding dong!' }, { do: 'mood', mood: 'happy' }] }] }) });
  const door = await open({ agent: 'doorbell', name: 'Bell', persona: 'A bell.', greeting: 'Not this one.' });
  const first = await door.after(0, 'bot.done');
  check(first && first.text === 'Ding dong!' && door.msgs.some((m) => m.type === 'ui.mood' && m.mood === 'happy'), 'conversation: a "start" pattern opens the conversation instead of the greeting', first && first.text);
  door.ws.close();

  // without an agent: as before (free answers from the persona)
  const plain = await open({ name: 'Ada', persona: 'A guide.' });
  n = plain.msgs.length;
  plain.ws.send(JSON.stringify({ type: 'text', text: 'Hello?' }));
  await plain.after(n, 'bot.done');
  check(!plain.msgs.some((m) => m.type === 'decision' || m.type === 'stage'), 'conversation: no agent → no decision, no stage (a persona alone)');
  plain.ws.close();

  // the conversation's language: a pattern changes it, then a client; the lines translated, the model told
  await api('/agents', { name: 'Polyglot' });
  await fetch(`http://127.0.0.1:${srv.port}/api/agents/polyglot/interactions`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stages: [{ name: 'Main' }], patterns: [
    { name: 'French', when: { kind: 'says', examples: ['can we speak French please'] }, then: [{ do: 'language', language: 'fr' }, { do: 'say', text: 'Of course.' }] },
    { name: 'Hours', when: { kind: 'says', examples: ['what time do you open'] }, then: [{ do: 'say', text: 'We open at nine.' }] },
  ] }) });
  const poly = await open({ agent: 'polyglot', name: 'Poly', persona: 'A desk.', language: 'en', llm: 'farm', llmUrl: farm.url, llmModel: 'assistant' });
  const firstLang = poly.msgs.find((m) => m.type === 'language');
  check(firstLang && firstLang.language === 'en' && firstLang.own === true, 'language: a conversation starts in the agent\'s language (event "language")', firstLang);
  n = poly.msgs.length;
  let asked = farm.requests.length;
  poly.ws.send(JSON.stringify({ type: 'text', text: 'can we speak French please' }));
  const fr = await poly.after(n, 'bot.done');
  const toFr = poly.msgs.slice(n).find((m) => m.type === 'language');
  const tr = farm.requests[asked] ? farm.requests[asked].body.messages : [];
  check(toFr && toFr.language === 'fr' && toFr.own === false && poly.msgs.indexOf(toFr) < poly.msgs.indexOf(fr)
    && poly.msgs.slice(n).some((m) => m.type === 'status' && m.text === 'Changing language…'),
  'language: a pattern\'s "Change language" → the event, then hearing and voice reload, before the reply', poly.msgs.slice(n).filter((m) => ['language', 'status'].includes(m.type)));
  check(/Translate the user's message into French/.test(tr[0] && tr[0].content) && tr[1] && tr[1].content === 'Of course.' && fr.text === 'It is a pond.',
    'language: in another language than the agent\'s, its line is translated by the language model', { messages: tr, said: fr.text });
  n = poly.msgs.length;
  asked = farm.requests.length;
  poly.ws.send(JSON.stringify({ type: 'text', text: 'Tell me something nice' }));
  await poly.after(n, 'bot.done');
  const sysFr = farm.requests[asked] ? farm.requests[asked].body.messages[0].content : '';
  check(/- Always answer in French\./.test(sysFr), 'language: the language model is told to answer in the conversation\'s language', sysFr.slice(0, 300));
  // a client's command: back to the agent's own language, the lines as written; an unknown language changes nothing
  n = poly.msgs.length;
  poly.ws.send(JSON.stringify({ type: 'language', language: 'xx' }));
  poly.ws.send(JSON.stringify({ type: 'language', language: 'en' }));
  const back = await poly.after(n, 'language');
  check(back && back.language === 'en' && back.own === true && poly.msgs.slice(n).filter((m) => m.type === 'language').length === 1,
    'language: a client\'s command goes back to the agent\'s own ("xx" is ignored)', poly.msgs.slice(n).filter((m) => m.type === 'language'));
  n = poly.msgs.length;
  asked = farm.requests.length;
  poly.ws.send(JSON.stringify({ type: 'text', text: 'what time do you open' }));
  const nine = await poly.after(n, 'bot.done');
  check(nine && nine.text === 'We open at nine.' && farm.requests.length === asked, 'language: in the agent\'s own language, the line is said as written (no model)', nine && nine.text);
  // the agent's language edited during the conversation: the conversation follows it
  poly.ws.send(JSON.stringify({ type: 'language', language: 'de' }));
  await until(() => poly.msgs.some((m) => m.type === 'language' && m.language === 'de'), 3000);
  n = poly.msgs.length;
  poly.ws.send(JSON.stringify({ type: 'settings', settings: { language: 'it' } }));
  const it2 = await poly.after(n, 'language');
  check(it2 && it2.language === 'it' && it2.own === true, 'language: the agent\'s language edited in the studio → the conversation goes back to it', it2);
  poly.ws.close();

  // "Send OSC": the ArtLux example agent, two listeners standing in for ArtLux and an Arduino
  const { createSocket } = await import('node:dgram');
  const listener = async () => {
    const got = [];
    const s = createSocket('udp4');
    s.on('message', (b) => got.push(decodeOsc(b)));
    await new Promise((r) => s.bind(0, '127.0.0.1', r));
    return { got, port: s.address().port, close: () => s.close() };
  };
  const artlux = await listener();
  const arduino = await listener();
  const bundle = JSON.parse(readFileSync(join(ROOT, 'examples', 'artlux', 'artlux-scenes.vik.json'), 'utf8'));
  // the example ships the per-state address (/vik/{scene}, tested below); start from a value-carrying message
  check(json(bundle.interactions.patterns[0].then[0]) === json({ do: 'osc', address: '/vik/{scene}', value: '' }), 'osc: the ArtLux example sends one address per state');
  bundle.interactions.patterns[0].then[0] = { do: 'osc', address: '/artlux/scene/recall', value: '{scene}' };
  const lux = await api('/agents', { bundle });
  const show = await open({ agent: lux.id, name: 'Lux', persona: 'Lights.', oscTo: `127.0.0.1:${artlux.port}, 127.0.0.1:${arduino.port}` });
  n = show.msgs.length;
  show.ws.send(JSON.stringify({ type: 'text', text: 'show me the forest' }));
  const forest = await show.after(n, 'bot.done');
  await until(() => artlux.got.length && arduino.got.length, 2000);
  const ev = show.msgs.slice(n).find((m) => m.type === 'osc');
  check(forest && forest.text === 'Here is Grove.' && json(artlux.got) === json([{ address: '/artlux/scene/recall', args: ['Grove'] }]) && json(arduino.got) === json(artlux.got),
    'osc: "show me the forest" → /artlux/scene/recall "Grove", filled from the entry, to every address of oscTo', { said: forest && forest.text, artlux: artlux.got, arduino: arduino.got });
  check(ev && ev.address === '/artlux/scene/recall' && json(ev.args) === json(['Grove']) && ev.to.length === 2 && show.msgs.indexOf(ev) < show.msgs.indexOf(forest),
    'osc: an "osc" event says what went where (the trace), before the reply is said', ev);
  // this computer's setting changes during the conversation: nowhere → nothing sent, and the event says so
  show.ws.send(JSON.stringify({ type: 'settings', settings: { oscTo: '' } }));
  n = show.msgs.length;
  show.ws.send(JSON.stringify({ type: 'text', text: 'lights out' }));
  await show.after(n, 'bot.done');
  await sleep(300);
  const none = show.msgs.slice(n).find((m) => m.type === 'osc');
  check(none && none.to.length === 0 && json(none.args) === json(['Blackout']) && artlux.got.length === 1, 'osc: no address in Settings → nothing sent, and the event says it', none);
  // the address filled from the entry, no value: one address per scene (ArtLux's "OSC jump" into a state)
  const it = (await api(`/agents/${lux.id}`)).interactions;
  it.patterns[0].then[0] = { do: 'osc', address: '/vik/{scene}', value: '' };
  await fetch(`http://127.0.0.1:${srv.port}/api/agents/${lux.id}/interactions`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(it) });
  show.ws.send(JSON.stringify({ type: 'settings', settings: { oscTo: `127.0.0.1:${artlux.port}` } }));
  n = show.msgs.length;
  show.ws.send(JSON.stringify({ type: 'text', text: 'the fire please' }));
  await show.after(n, 'bot.done');
  await until(() => artlux.got.length === 2, 2000);
  check(json(artlux.got[1]) === json({ address: '/vik/Ember', args: [] }), 'osc: the address filled from the entry (/vik/{scene} → /vik/Ember), no value', artlux.got);
  show.ws.close();
  artlux.close(); arduino.close();

  // OSC in: the example "Room climate", a socket standing in for the Arduino (its sensor, its fan)
  process.env.VIK_OSC_IN_HOST = '127.0.0.1';          // the tests listen on this computer only
  const { encodeOsc: enc } = await import(src('osc.mjs'));
  const fan = await listener();
  const probe = createSocket('udp4');
  await new Promise((r) => probe.bind(0, '127.0.0.1', r));
  const inPort = probe.address().port;                // a free port, given back for VIK to listen on
  probe.close();
  const sensor = createSocket('udp4');
  const temp = (v) => new Promise((r) => sensor.send(enc('/arduino/temp', [{ type: 'f', value: v }]), inPort, '127.0.0.1', r));
  const roomAgent = await api('/agents', { bundle: JSON.parse(readFileSync(join(ROOT, 'examples', 'arduino-osc', 'room-climate.vik.json'), 'utf8')) });
  const room = await open({ agent: roomAgent.id, name: 'Sol', persona: 'A room.', llm: 'farm', llmUrl: farm.url, llmModel: 'assistant', oscIn: String(inPort), oscTo: `127.0.0.1:${fan.port}` });
  const played = (m) => room.ws.send(JSON.stringify({ type: 'playback', state: 'ended', turnId: m.turnId }));   // the browser's news
  n = room.msgs.length;
  await temp(25);
  const seen = await room.after(n, 'osc.in');
  check(seen && seen.address === '/arduino/temp' && json(seen.args) === json([25]), 'osc in: a message on the port oscIn → an "osc.in" event (Settings, the clients)', seen);
  asked = farm.requests.length;
  room.ws.send(JSON.stringify({ type: 'text', text: 'Is it warm in here?' }));
  played(await room.after(n, 'bot.done'));
  const sysLive = farm.requests[asked] ? farm.requests[asked].body.messages[0].content : '';
  const lastTurn = farm.requests[asked] ? farm.requests[asked].body.messages.slice(-1)[0] : {};
  check(lastTurn.role === 'user' && /^Is it warm in here\?\n\n\(Live data, right now .*\/arduino\/temp = 25\.\)$/s.test(lastTurn.content)
    && !JSON.stringify(farm.requests[asked].body.messages.slice(1, -1)).includes('Live data'),
  'osc in: and again after the last thing said, for this request only (a small model trusts it more)', lastTurn.content);
  check(/Live data, right now \(the latest OSC messages from sensors and buttons; [^)]*\): \/arduino\/temp = 25\./.test(sysLive), 'osc in: the language model reads the latest value ("is it warm?")', sysLive.slice(-200));
  // 29 °C: "Too warm" fires, at a pause, with {value} in its instruction, then the fan stage
  n = room.msgs.length;
  asked = farm.requests.length;
  await temp(29);
  const warm = await room.after(n, 'decision');
  const warmDone = await room.after(n, 'bot.done');
  const instr = farm.requests[asked] ? farm.requests[asked].body.messages[0].content : '';
  check(warm && warm.pattern && warm.pattern.kind === 'osc' && warm.pattern.id === 'too-warm' && warm.text === '/arduino/temp 29' && /For this reply: The room has just reached 29 degrees\./.test(instr)
    && room.msgs.slice(n).some((m) => m.type === 'stage' && m.stage === 'fan'), 'osc in: "goes above 28" fires: the agent speaks, {value} filled, then the fan stage', { warm, instr: instr.slice(-200) });
  const cue = farm.requests[asked] ? farm.requests[asked].body.messages.slice(-1)[0].content : '';
  check(cue.startsWith('(OSC message: /arduino/temp 29)'), 'osc in: the model answers the message (a user turn), not its own last words', cue);
  played(warmDone);
  n = room.msgs.length;
  await temp(29.5); await temp(28.2); await temp(30);
  await sleep(2200);                                  // longer than the pause it would wait for
  check(!room.msgs.slice(n).some((m) => m.type === 'decision'), 'osc in: staying above 28 does not fire again');
  // "yes, please" in the fan stage: the fan's OSC message goes to the board
  n = room.msgs.length;
  room.ws.send(JSON.stringify({ type: 'text', text: 'yes, please' }));
  const on = await room.after(n, 'bot.done');
  played(on);
  await until(() => fan.got.length, 2000);
  check(on && on.text === 'The fan is on.' && json(fan.got) === json([{ address: '/arduino/fan', args: [1] }]), 'osc in: "yes, please" → /arduino/fan 1 to the board', { said: on && on.text, fan: fan.got });
  // back under 27.44, then over 28 while the agent is speaking: it waits for the pause, never talks over
  await temp(27);
  n = room.msgs.length;
  room.ws.send(JSON.stringify({ type: 'text', text: 'Tell me something nice' }));
  const busy = await room.after(n, 'bot.done');
  await temp(28.6);
  await sleep(600);
  const early = room.msgs.slice(n).some((m) => m.type === 'decision' && m.pattern && m.pattern.kind === 'osc');
  const endedAt = Date.now();
  played(busy);
  const again = await room.after(n, 'bot.done') && await until(() => room.msgs.slice(n).find((m) => m.type === 'decision' && m.pattern && m.pattern.kind === 'osc'), 6000);
  const waited = Date.now() - endedAt;
  check(!early && again && again.text === '/arduino/temp 28.6' && waited >= 1400, 'osc in: it fires again after going back, and waits until the agent has finished, plus a pause', { early, waited });
  room.ws.close();
  sensor.close(); fan.close();

  // People recognized by their voice (Settings → People). A fake speaker model: the "voice" is the pitch of a tone.
  process.env.VIK_SPEAKERS_FAKE = '1';
  const tone = (hz, sec, amp = 0.3) => { const a = new Int16Array(Math.round(16000 * sec)); for (let i = 0; i < a.length; i++) a[i] = Math.round(amp * 32767 * Math.sin((2 * Math.PI * hz * i) / 16000)); return Buffer.from(a.buffer); };
  const voice = (p, body) => fetch(`http://127.0.0.1:${srv.port}/api${p}`, { method: 'POST', body }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const papa = await voice('/people?name=Papa', tone(200, 9));
  const leo = await voice(`/people?name=${encodeURIComponent('Léo')}`, tone(500, 9));
  const tooShort = await voice('/people?name=Zoe', tone(800, 3));
  check(papa.person && papa.person.name === 'Papa' && leo.people && leo.people.map((p) => p.name).join() === 'Papa,Léo', 'people: two people recorded (POST /api/people, their voice as PCM)', leo);
  check(tooShort.status === 400 && /^Only 3\.0 s of voice/.test(tooShort.error), 'people: a recording with too little voice is refused, and says why', tooShort);
  const whoIs = await voice('/people/identify', tone(500, 2));
  check(whoIs.name === 'Léo' && whoIs.score === 1, 'people: who is speaking? (POST /api/people/identify)', whoIs);
  const cross = await fetch(`http://127.0.0.1:${srv.port}/api/people`, { headers: { origin: 'http://evil.example' } });
  check(cross.status === 403, 'people: another website cannot read them', cross.status);

  // the car: the parents change the route, the children can't; anyone asks for a cartoon
  const carOsc = await listener();
  const car = await api('/agents', { bundle: { vik: 'agent', id: 'car', persona: '---\nname: Nova\n---\nThe voice of a family car.', knowledge: {}, interactions: { version: 1, patterns: [
    { id: 'route', name: 'Change the route', when: { kind: 'says', examples: ['change the route', 'go to Lyon instead'] }, who: ['Papa', 'Maman'], then: [{ do: 'osc', address: '/car/route', value: '{said}' }, { do: 'say', text: 'Route changed, {speaker}.' }] },
    { id: 'cartoon', name: 'A cartoon', when: { kind: 'says', examples: ['play a cartoon', 'put on a video'] }, then: [{ do: 'signal', name: 'back-screen', value: 'cartoon' }, { do: 'say', text: 'Here it is, {speaker}.' }] },
  ] } } });
  const drive = await open({ agent: car.id, name: 'Nova', persona: 'A car.', llm: 'farm', llmUrl: farm.url, llmModel: 'assistant', oscTo: `127.0.0.1:${carOsc.port}` });
  const typed = async (text, speaker) => {
    const k = drive.msgs.length;
    drive.ws.send(JSON.stringify({ type: 'text', text, ...(speaker !== undefined ? { speaker } : {}) }));
    const done = await drive.after(k, 'bot.done');
    return { done, msgs: drive.msgs.slice(k), find: (type) => drive.msgs.slice(k).find((m) => m.type === type) };
  };
  asked = farm.requests.length;
  let t1 = await typed('change the route', 'Léo');
  check(t1.find('decision').kind === 'denied' && t1.find('decision').speaker === 'Léo' && json(t1.find('decision').who) === json(['Papa', 'Maman']) && !t1.find('osc'),
    'who: Léo asks to change the route, kept for Papa and Maman → "denied", nothing sent', t1.find('decision'));
  check(t1.done.text === 'Sorry Léo, only Papa or Maman can ask me that.' && farm.requests.length === asked,
    'who: the agent says it won\'t, in a fixed line (the small model, asked to refuse, often agreed)', t1.done.text);
  t1 = await typed('Are we there yet?', 'Léo');
  const req = farm.requests[farm.requests.length - 1];
  const sys1 = req ? req.body.messages[0].content : '';
  const last1 = req ? req.body.messages[req.body.messages.length - 1].content : '';
  check(/\n\nYou are talking with Léo right now\.(\n|$)/.test(sys1) && !/Papa/.test(sys1) && last1 === 'Are we there yet?',
    'who: the model knows who is talking (one sentence of the system prompt); the words go as said', { sys: sys1.slice(-200), last1 });
  t1 = await typed('change the route', 'Papa');
  await until(() => carOsc.got.length, 2000);
  check(t1.find('decision').kind === 'pattern' && t1.done.text === 'Route changed, Papa.' && json(carOsc.got) === json([{ address: '/car/route', args: ['change the route'] }]),
    'who: Papa may: the route is sent, and {speaker} is his name', { said: t1.done.text, osc: carOsc.got });
  t1 = await typed('play a cartoon', 'Léo');
  check(t1.find('decision').pattern.id === 'cartoon' && t1.done.text === 'Here it is, Léo.' && t1.find('signal').value === 'cartoon', 'who: a pattern for anyone, Léo too', t1.done.text);
  t1 = await typed('change the route');
  check(t1.find('decision').kind === 'denied' && t1.find('decision').speaker === '' && t1.done.text === 'Sorry, I don\'t recognize your voice: only Papa or Maman can ask me that.',
    'who: typed without a name, people recorded: someone not recognized, denied', t1.done.text);
  // by voice: the tone of Léo, then silence (the simulated recognizer hears a sentence)
  let k = drive.msgs.length;
  const say = async (buf) => { for (let i = 0; i < buf.length; i += 3200) { drive.ws.send(buf.subarray(i, i + 3200)); await sleep(5); } };
  await say(Buffer.concat([tone(500, 1.5), tone(0, 1.5, 0)]));
  await drive.after(k, 'bot.done');
  let heardTurn = drive.msgs.slice(k);
  const spk = heardTurn.find((m) => m.type === 'speaker');
  const ut = heardTurn.find((m) => m.type === 'user.text');
  check(spk && spk.name === 'Léo' && spk.short === false && ut && ut.speaker === 'Léo' && heardTurn.indexOf(spk) < heardTurn.indexOf(ut) && heardTurn.find((m) => m.type === 'decision').speaker === 'Léo',
    'who: by voice, Léo is recognized: "speaker", then "user.text" with his name, and the decision', { spk, ut });
  k = drive.msgs.length;
  await say(Buffer.concat([tone(500, 0.2), tone(0, 1.5, 0)]));
  await until(() => drive.msgs.slice(k).find((m) => m.type === 'speaker'), 5000);
  const brief = drive.msgs.slice(k).find((m) => m.type === 'speaker');
  check(brief && brief.name === '' && brief.short === true, 'who: too short to tell ("oui"): someone not recognized, never the last person recognized', brief);
  await drive.after(k, 'bot.done');
  drive.ws.close();
  // nobody recorded any more: no "speaker", no name, and a pattern kept for some people can't fire
  for (const p of (await api('/people')).people) await fetch(`http://127.0.0.1:${srv.port}/api/people/${p.id}`, { method: 'DELETE' });
  const alone = await open({ agent: car.id, name: 'Nova', persona: 'A car.', llm: 'farm', llmUrl: farm.url, llmModel: 'assistant' });
  k = alone.msgs.length;
  await (async (buf) => { for (let i = 0; i < buf.length; i += 3200) { alone.ws.send(buf.subarray(i, i + 3200)); await sleep(5); } })(Buffer.concat([tone(500, 1.5), tone(0, 1.5, 0)]));
  await alone.after(k, 'bot.done');
  heardTurn = alone.msgs.slice(k);
  check(!heardTurn.some((m) => m.type === 'speaker') && !('speaker' in heardTurn.find((m) => m.type === 'user.text')) && !('speaker' in heardTurn.find((m) => m.type === 'decision')),
    'who: nobody recorded → no "speaker" event, no name anywhere', heardTurn.filter((m) => /speaker|user.text|decision/.test(m.type)));
  k = alone.msgs.length;
  alone.ws.send(JSON.stringify({ type: 'text', text: 'change the route' }));
  await alone.after(k, 'bot.done');
  check(alone.msgs.slice(k).find((m) => m.type === 'decision').kind === 'denied', 'who: nobody recorded → a pattern kept for some people is denied to all');
  alone.ws.close();
  carOsc.close();
  await srv.close();
  await farm.close();
}

// no process.exit(): on Windows, exiting while the fetch sockets close can crash Node (0xC0000409)
process.exitCode = summary() ? 1 : 0;
