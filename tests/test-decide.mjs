// The decision model (app/src/agent/: knowledge, matcher, decide) and how a conversation follows it: patterns,
// stages, entries, placeholders, signals, the knowledge given to the language model, the explanation events.
//   node tests/test-decide.mjs
import { mkdtempSync } from 'node:fs';
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
  await srv.close();
  await farm.close();
}

// no process.exit(): on Windows, exiting while the fetch sockets close can crash Node (0xC0000409)
process.exitCode = summary() ? 1 : 0;
