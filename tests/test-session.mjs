// Tests a conversation (app/src/session.mjs) when things go wrong: models that fail to load or load slowly, text
// typed too early, a conversation closed with changes still queued, OSC in from anything on the network.
// A real Session with the simulated engine; its model loading can wait or fail on demand.
//   node tests/test-session.mjs
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary, until, sleep } from './helpers.mjs';

const src = (p) => pathToFileURL(join(ROOT, 'app', 'src', p)).href;
const { Session } = await import(src('session.mjs'));
const { createMockEngine } = await import(src('engines/mock.mjs'));
const { mutex, delay } = await import(src('util.mjs'));

const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(String(e && e.message ? e.message : e)));

/** A conversation over a fake socket; prepare(settings) can wait or throw. The browser "plays" each reply at once. */
async function conversation({ prepare = null, decider = null } = {}) {
  const mock = await createMockEngine();
  const ws = new EventEmitter();
  const sent = [];
  const calls = { prepare: [], openAsr: 0 };
  ws.sendJson = (o) => { sent.push(o); if (o.type === 'bot.done') setTimeout(() => say({ type: 'playback', state: 'ended', turnId: o.turnId }), 5); };
  ws.send = () => {};
  ws.close = () => {};
  const say = (o) => ws.emit('message', JSON.stringify(o), false);
  const engine = {
    info: () => mock.info(),
    prepare: async (s, p) => { calls.prepare.push({ ...s }); if (prepare) await prepare(s); return mock.prepare(s, p); },
    openAsr: (x, cb) => { calls.openAsr++; return mock.openAsr(x, cb); },
    generate: (x) => mock.generate(x),
    speak: (x) => mock.speak(x),
    decider,
  };
  const session = new Session(ws, engine, mutex(), () => {});
  const after = (k, type, ms = 5000) => until(() => sent.slice(k).find((m) => m.type === type), ms);
  return { session, sent, calls, say, after };
}

// — text typed before the models are ready: nothing to answer, nothing thrown —
{
  const c = await conversation();
  c.say({ type: 'text', text: 'hello?' });
  await sleep(50);
  check(!c.sent.some((m) => m.type === 'thinking' || m.type === 'error') && !unhandled.length, 'typed before the conversation started: ignored, no failure', { sent: c.sent, unhandled });
}

// — a model chosen while the first ones load is loaded too, before the conversation starts —
{
  let release;
  const gate = new Promise((r) => { release = r; });
  let first = true;
  const c = await conversation({ prepare: async () => { if (first) { first = false; await gate; } } });
  c.say({ type: 'start', settings: { localLlm: 'A' } });
  await sleep(30);
  c.say({ type: 'settings', settings: { localLlm: 'B' } });
  await sleep(30);
  release();
  await c.after(0, 'ready');
  check(c.calls.prepare.map((s) => s.localLlm).join() === 'A,B', 'a language model chosen during the first loading: loaded before the conversation starts', c.calls.prepare.map((s) => s.localLlm));
  c.session.close('test');
}

// — a reload that fails: the agent keeps hearing, and says why —
{
  let fail = false;
  const c = await conversation({ prepare: async () => { if (fail) throw new Error('download blocked'); } });
  c.say({ type: 'start', settings: {} });
  await c.after(0, 'ready');
  const k = c.sent.length;
  fail = true;
  c.say({ type: 'settings', settings: { endSilenceMs: 1500 } });       // a hearing setting: recognition reloads
  const err = await c.after(k, 'error');
  check(err && err.code === 'settings' && /download blocked/.test(err.message) && c.calls.openAsr === 2 && c.session.asr,
    'a reload that fails: an error says why, and speech recognition opens again (the agent is not left deaf)', { err, openAsr: c.calls.openAsr });
  // a language whose models cannot load: the conversation stays in its language, still hearing
  const k2 = c.sent.length;
  c.say({ type: 'language', language: 'fr' });
  await c.after(k2, 'error');
  const langs = c.sent.slice(k2).filter((m) => m.type === 'language').map((m) => m.language);
  check(langs.join() === 'fr,en' && c.session.language === 'en' && c.calls.openAsr === 3 && c.session.asr,
    'a language whose models cannot load: back to the agent\'s language, recognition open again', { langs, openAsr: c.calls.openAsr });
  c.session.close('test');
}

// — a reply that fails (a pattern changes language, its models cannot load): the turn ends, the next one works —
{
  const decision = (text, then) => ({ text, stage: 'main', matcher: 'Words', kind: 'pattern', pattern: { id: 'p', name: 'P', kind: 'says' }, speaker: null, who: [], score: 1, example: '', entry: null, candidates: [], ms: 0, then, entryCells: null, knowledge: [] });
  const decider = {
    decide: async (id, text) => decision(text, /french/.test(text) ? [{ do: 'language', language: 'fr' }, { do: 'say', text: 'Bonjour.' }] : [{ do: 'say', text: 'Fine.' }]),
    startStage: () => 'main', warm: async () => true, onMoment: async () => null,
  };
  let fail = false;
  const c = await conversation({ decider, prepare: async () => { if (fail) throw new Error('voice not downloaded'); } });
  c.say({ type: 'start', settings: { agent: 'a' } });
  await c.after(0, 'ready');
  fail = true;
  const k = c.sent.length;
  c.say({ type: 'text', text: 'speak french please' });
  const err = await c.after(k, 'error');
  const cut = await c.after(k, 'interrupted');
  check(err && err.code === 'reply' && /voice not downloaded/.test(err.message) && cut && cut.by === 'error' && c.session.bot === null && !unhandled.length,
    'a reply that fails: an error says why, the turn ends ("interrupted" by error), nothing left hanging', { err, cut, unhandled });
  fail = false;
  const k2 = c.sent.length;
  c.say({ type: 'text', text: 'how are you' });
  const done = await c.after(k2, 'bot.done');
  check(done && /Fine/.test(done.text), 'after a failed reply, the next sentence is answered', done);
  c.session.close('test');
}

// — a closed conversation does not reload the models with its old settings —
{
  const c = await conversation();
  c.say({ type: 'start', settings: { localLlm: 'A' } });
  await c.after(0, 'ready');
  c.session.close('stop');
  const n = c.calls.prepare.length;
  await c.session.applySettings({ localLlm: 'OLD' });
  check(c.calls.prepare.length === n, 'a closed conversation: its queued settings never reload the models (another one may own them)');
}

// — a wait cancelled before it starts is never "done" —
{
  const a = new AbortController(); a.abort();
  check((await delay(0, a.signal)) === false && (await delay(0)) === true, 'delay: already cancelled → false, even with no wait');
}

// — OSC in: anything on the network can send; an address too long is dropped, a new one is always shown —
{
  const c = await conversation();
  c.say({ type: 'start', settings: {} });
  await c.after(0, 'ready');
  c.session.onOscIn(`/${'x'.repeat(300)}`, [1]);
  check(c.session.oscValues.size === 0, 'osc in: an address of 300 characters is dropped (it would go into every request to the model)');
  for (let i = 0; i < 31; i++) c.session.onOscIn(`/sensor/${i}`, [i]);
  const shown = await until(() => c.sent.some((m) => m.type === 'osc.in' && m.address === '/sensor/30'), 2000);
  check(shown, 'osc in: the 31st address still shows (the oldest makes room)');
  c.session.close('test');
}

check(!unhandled.length, 'no unhandled rejection in any of these', unhandled);
process.exitCode = summary() ? 1 : 0;
