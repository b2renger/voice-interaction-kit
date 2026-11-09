// LLM farms (LlmOnLan) against a fake farm (tests/mock-farm.mjs): found by their UDP beacon or by their address,
// the replies streamed from the farm, its refusals said in words, and a conversation of the simulated engine
// whose replies come from the farm.
//   node tests/test-farm.mjs
import dgram from 'node:dgram';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary, sleep, until } from './helpers.mjs';
import { startMockFarm } from './mock-farm.mjs';

// a beacon port of our own (LlmOnLan's override), set before the module is imported
const BEACON_PORT = 42100 + Math.floor(Math.random() * 800);
process.env.LOL_FED_PORT = String(BEACON_PORT);
const src = (f) => pathToFileURL(join(ROOT, '2_qvac_local', 'src', f)).href;
const { createFarmFinder, farmGenerate } = await import(src('farm.mjs'));

const farm = await startMockFarm({ key: 'secret' });
const rejects = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

// — 1. the beacon —
{
  const logs = [];
  const finder = createFarmFinder((m) => logs.push(m));
  check(finder.list().length === 0, 'beacon: no farm before any beacon (the first list() starts listening)');
  await until(() => logs.some((l) => /listening for LLM farms/.test(l)), 3000);
  const udp = dgram.createSocket('udp4');
  const send = (o) => new Promise((r) => udp.send(Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)), BEACON_PORT, '127.0.0.1', r));
  await send('not json');
  await send({ name: 'no version field' });
  await send(farm.snapshot());
  const one = await until(() => finder.list().find((f) => f.id === 'mock-farm'), 3000);
  check(one && one.url === `${farm.url}` && one.name === 'Mock farm' && one.requiresKey && one.healthy && one.slots === 4 && one.clients === 1,
    'beacon: a farm is heard, its OpenAI address built from its endpoint and proxyPort', one);
  check(one && one.models.length === 1 && one.models[0].id === 'assistant' && one.models[0].underlying === 'gemma4:12b' && one.models[0].default,
    'beacon: its models (the served name, the real model behind it)', one && one.models);
  check(finder.list().length === 1, 'beacon: a packet that is not a farm snapshot is ignored', finder.list().map((f) => f.id));
  // another farm, sending from 127.0.0.1 but advertising its LAN address: the advertised one wins
  await send({ ...farm.snapshot(), id: 'far-farm', name: 'Far farm', endpoint: 'http://10.1.2.3:4000', proxyPort: 4000, requiresKey: false });
  const far = await until(() => finder.list().find((f) => f.id === 'far-farm'), 3000);
  check(far && far.url === 'http://10.1.2.3:4000/v1' && !far.requiresKey, 'beacon: the address the farm advertises beats the packet\'s', far);
  udp.close();
  finder.close();
}

// — 2. a farm by its address (another subnet: no beacon) —
{
  const finder = createFarmFinder();
  const id = await finder.add(`127.0.0.1:${farm.port}`);
  const f = finder.list().find((x) => x.id === id);
  check(id === 'mock-farm' && f && f.url === farm.url, 'address: "127.0.0.1:<port>" asks /lol/self and adds the farm', f);
  check(/No LLM farm answers at 127\.0\.0\.1:1 /.test(await rejects(finder.add('127.0.0.1:1')) || ''), 'address: nothing there → "No LLM farm answers at …"');
  check(/is not a computer's address/.test(await rejects(finder.add('rm -rf /')) || ''), 'address: not an address → said so, nothing asked');
  finder.close();
}

// — 3. the replies —
const ask = (o = {}, onDelta = () => {}) => farmGenerate({
  farm: { url: farm.url, model: 'assistant', key: 'secret', ...o },
  system: 'You are Ada.', history: [{ role: 'user', content: 'Hello?' }], temperature: 0.7, maxTokens: 320, onDelta,
});
{
  const deltas = [];
  const r = await ask({}, (d) => deltas.push(d)).done;
  check(r.text === 'Hello from the farm.' && deltas.join('|') === 'Hello| from| the farm.' && r.firstTokenMs >= 0 && !r.cancelled, 'reply: streamed word by word (onDelta), with the first word\'s time', r);
  const q = farm.requests[farm.requests.length - 1];
  check(q.authorization === 'Bearer secret' && q.body.model === 'assistant' && q.body.stream === true && q.body.max_tokens === 320 && q.body.temperature === 0.7,
    'reply: the farm password as the key, the model, stream, max_tokens', { ...q.body, messages: undefined, authorization: q.authorization });
  check(q.body.messages[0].role === 'system' && q.body.messages[0].content === 'You are Ada.' && q.body.messages[1].content === 'Hello?', 'reply: the system prompt first, then the history', q.body.messages);
  check(/needs a password: type it in Engine → Farm password/.test(await rejects(ask({ key: '' }).done) || ''), 'refusal: no password → "this LLM farm needs a password"');
  check(farm.requests[farm.requests.length - 1].authorization === 'Bearer sk-lol-lan', 'refusal: … (without a password, the key LlmOnLan\'s client sends)');
  check(/refused the password/.test(await rejects(ask({ key: 'wrong' }).done) || ''), 'refusal: a wrong password → "refused the password"');
  check(/no longer serves the model "gone"/.test(await rejects(ask({ model: 'gone' }).done) || ''), 'refusal: a model it does not serve → "no longer serves the model"');
  check(/no model is chosen/.test(await rejects(ask({ model: '' }).done) || ''), 'refusal: no model → said so, nothing sent');
  farm.state.full = true;
  check(/is full: all its places are taken \(one frees in about 2 min\)/.test(await rejects(ask().done) || ''), 'refusal: a full farm (429 lol_seats_full) → "is full", and when a place frees');
  farm.state.full = false;
  check(/does not answer: is it on, and on this network\?/.test(await rejects(ask({ url: 'http://127.0.0.1:1/v1' }).done) || ''), 'refusal: a farm that is off → "does not answer"');
  // cancelled while it writes (the person interrupts): no error, the words so far
  farm.state.wordMs = 400;
  const words = [];
  const g = ask({}, (d) => words.push(d));
  await until(() => words.length >= 1, 3000);
  g.cancel();
  const c = await g.done.catch((e) => ({ error: e.message }));
  check(c.cancelled === true && c.text === 'Hello' && !c.error, 'cancel: the reply stops, without an error', c);
  farm.state.wordMs = 20;
}

// — 4. the server: /farms, /models, and a conversation whose replies come from the farm —
{
  const { loadConfig } = await import(src('config.mjs'));
  const { startServer } = await import(src('app-server.mjs'));
  const config = loadConfig(join(tmpdir(), 'voice-lab-no-config.json'));
  const logs = [];
  const srv = await startServer({ config, mock: true, port: 19700 + Math.floor(Math.random() * 90), log: (m) => logs.push(m) });
  await srv.ready;
  const base = `http://127.0.0.1:${srv.port}`;
  const models = await (await fetch(`${base}/models`)).json();
  check(models.llm.length === 5 && models.asr.length === 4 && models.llm.filter((m) => m.default).map((m) => m.src).join() === 'QWEN3_1_7B_INST_Q4',
    'server: /models offers config.json\'s choices (5 language models, 4 speech recognitions), the default marked', models.llm.map((m) => m.src));
  const added = await (await fetch(`${base}/farms?add=${encodeURIComponent(`127.0.0.1:${farm.port}`)}`)).json();
  check(added.added === 'mock-farm' && added.farms.some((f) => f.id === 'mock-farm' && f.url === farm.url), 'server: /farms?add=<address> adds a farm', added);
  const bad = await (await fetch(`${base}/farms?add=127.0.0.1:1`)).json();
  check(/No LLM farm answers/.test(bad.error || '') && Array.isArray(bad.farms), 'server: … and says when nothing answers there', bad);
  const cross = await fetch(`${base}/farms?add=10.0.0.1`, { headers: { 'sec-fetch-site': 'cross-site' } });
  check(cross.status === 403, 'server: another website cannot use /farms (no probing from a web page)', cross.status);

  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/voice`);
  const msgs = [];
  ws.onmessage = (e) => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  await new Promise((r) => { ws.onopen = r; });
  const n0 = farm.requests.length;
  ws.send(JSON.stringify({ type: 'start', settings: { name: 'Ada', persona: 'A test.', llmFarm: farm.url, llmFarmModel: 'assistant', llmFarmKey: 'secret' } }));
  check(await until(() => msgs.some((m) => m.type === 'ready'), 5000), 'conversation: opens with an LLM farm chosen');
  ws.send(JSON.stringify({ type: 'text', text: 'Hello?' }));
  const done = await until(() => msgs.find((m) => m.type === 'bot.done'), 8000);
  check(done && done.text === 'Hello from the farm.', 'conversation: the reply comes from the farm (and is spoken by the local voice)', done || msgs.map((m) => m.type));
  check(farm.requests.length === n0 + 1 && /Ada/.test(farm.requests[n0].body.messages[0].content), 'conversation: the farm gets the persona\'s system prompt', farm.requests.length - n0);
  check(logs.some((l) => /conversation opened .*LLM farm http:\/\/127\.0\.0\.1/.test(l)), 'conversation: the log names the farm', logs.filter((l) => /opened/.test(l)));
  // the password changes: no reload, the next reply uses it (and the farm's refusal is said)
  ws.send(JSON.stringify({ type: 'settings', settings: { llmFarmKey: 'wrong' } }));
  await sleep(100);
  ws.send(JSON.stringify({ type: 'text', text: 'Again?' }));
  const err = await until(() => msgs.find((m) => m.type === 'error' && m.code === 'llm'), 8000);
  check(err && /^Language model: the LLM farm refused the password/.test(err.message) && !err.fatal, 'conversation: a refusal is an error the window shows, not the end', err);
  // back to the local model: the simulated one answers again
  const before = msgs.filter((m) => m.type === 'bot.done').length;
  ws.send(JSON.stringify({ type: 'settings', settings: { llmFarm: '' } }));
  await sleep(200);
  ws.send(JSON.stringify({ type: 'text', text: 'Hello again.' }));
  const local = await until(() => msgs.filter((m) => m.type === 'bot.done')[before], 8000);
  check(local && local.text && local.text !== 'Hello from the farm.' && farm.requests.length === n0 + 2, 'conversation: llmFarm "" → the local model answers again', local);
  ws.close();
  await srv.close();
}

await farm.close();
process.exit(summary() ? 1 : 0);
