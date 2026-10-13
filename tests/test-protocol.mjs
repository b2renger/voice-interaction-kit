// Tests the local backend's protocol WITHOUT a browser (Node 22+ only):
//   node tests/test-protocol.mjs            simulated engine (--mock)
//   node tests/test-protocol.mjs fake-qvac  the QVAC adapter plugged into a fake SDK (tests/fake-qvac-sdk.mjs)
// It sends synthetic "speech", waits for the transcription, the reply, the audio, then tests
// typed text, interruption and a change of voice. In simulated mode, extra servers test Smart Turn
// (SMART_TURN_FAKE) and the spoken fillers (MOCK_LLM_DELAY_MS).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary, sleep, until } from './helpers.mjs';

const mode = process.argv[2] === 'fake-qvac' ? 'fake-qvac' : 'mock';
const PORT = 19300 + Math.floor(Math.random() * 600);
const report = join(tmpdir(), `fake-qvac-report-${PORT}.json`);
const serverLog = [];
const servers = [];

/** Starts a local server (simulated engine, or the QVAC adapter on the fake SDK) on a port. */
function startServer(port, { env: extraEnv = {}, engine = mode, cwd, config } = {}) {
  const env = { ...process.env, ...extraEnv };
  const args = [join(ROOT, '2_qvac_local', 'src', 'server.mjs'), '--port', String(port)];
  if (engine === 'mock') args.push('--mock');
  else { env.QVAC_SDK = pathToFileURL(join(ROOT, 'tests', 'fake-qvac-sdk.mjs')).href; env.FAKE_QVAC_REPORT = report; }
  if (config) args.push('--config', config);
  const proc = spawn(process.execPath, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[:${port}] `;
  proc.stdout.on('data', (d) => serverLog.push(tag + String(d)));
  proc.stderr.on('data', (d) => serverLog.push(tag + String(d)));
  servers.push(proc);
  return proc;
}
const healthy = (port, engine = mode) => until(async () => {
  try { const j = await (await fetch(`http://127.0.0.1:${port}/health`)).json(); return j.models === 'ready' && j.engine === (engine === 'mock' ? 'mock' : 'qvac') && j; } catch { return false; }
}, 10000);

/** A client connection: the messages and the audio frames received, and helpers. */
async function connect(port) {
  const c = { msgs: [], audio: [] };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/voice`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') { const m = JSON.parse(e.data); m.at = Date.now(); c.msgs.push(m); return; }
    const dv = new DataView(e.data);
    c.audio.push({ rate: dv.getUint32(0, true), turnId: dv.getUint32(4, true), samples: (e.data.byteLength - 8) / 2, at: Date.now() });
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  c.ws = ws;
  c.send = (o) => ws.send(JSON.stringify(o));
  c.has = (type, f = () => true) => c.msgs.find((m) => m.type === type && f(m));
  c.waitFor = (type, f, ms = 8000) => until(() => c.has(type, f), ms);
  c.close = () => { try { ws.close(); } catch { /* closed */ } };
  return c;
}

const srv = startServer(PORT);
console.log(`— engine: ${mode} —`);

const health = await healthy(PORT);
check(health && health.engine === (mode === 'mock' ? 'mock' : 'qvac'), 'the server starts and loads its models', health);

const main = await connect(PORT);
const { msgs, audio, ws, send, has, waitFor } = main;

send({ type: 'start', settings: { name: 'Test', persona: 'You are a test robot.', language: 'en', localVoice: 'F1', endSilenceMs: 600, uiTools: true, greeting: '' } });
check(await waitFor('ready'), 'start → ready');
const ready = has('ready');
check(Array.isArray(ready.voices) && ready.voices.includes('F1'), 'ready: the list of voices', ready.voices);

// — a spoken "sentence": 1.2 s of vowels, then 1.5 s of silence, sent in 100 ms packets —
function pcmChunk(speech, i, samples = 1600) {
  const b = Buffer.alloc(samples * 2);
  for (let k = 0; k < samples; k++) {
    const t = (i * samples + k) / 16000;
    const v = speech ? 0.25 * Math.sin(2 * Math.PI * 150 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0.002 * Math.sin(k);
    b.writeInt16LE(Math.round(v * 32767), k * 2);
  }
  return b;
}
async function speak(seconds = 1.2, silence = 1.5) {
  let i = 0;
  for (let n = 0; n < seconds * 10; n++) { ws.send(pcmChunk(true, i++)); await sleep(50); }
  for (let n = 0; n < silence * 10; n++) { ws.send(pcmChunk(false, i++)); await sleep(50); }
}
/**
 * Speech in REAL time (50 ms packets every 50 ms, like a microphone), then silence until `stop()` is true
 * or `silence` seconds have passed. Returns the time the last speech packet was sent.
 */
async function speakRealtime(c, seconds, silence, stop = () => false) {
  let i = 0;
  const t0 = Date.now();
  for (let n = 0; n < Math.round(seconds * 20); n++) { c.ws.send(pcmChunk(true, i++, 800)); await sleep(Math.max(0, t0 + (n + 1) * 50 - Date.now())); }
  const speechEnd = Date.now();
  for (let n = 0; n < Math.round(silence * 20) && !stop(); n++) { c.ws.send(pcmChunk(false, i++, 800)); await sleep(Math.max(0, speechEnd + (n + 1) * 50 - Date.now())); }
  return speechEnd;
}
await speak();
check(await waitFor('vad', (m) => m.speaking), 'speech → vad (speaking)');
check(await waitFor('user.text'), 'end of turn → user.text', msgs.filter((m) => m.type.startsWith('user')));
check(await waitFor('thinking'), 'thinking');
check(await waitFor('bot.done', () => true, 10000), 'bot.done', msgs.map((m) => m.type).slice(-10));
const done1 = has('bot.done');
check(done1.text && !/\[\[|<think>/.test(done1.text), 'the reply text is clean (no tag, no reasoning)', done1.text);
check(!!has('ui.choices'), 'the choices tag becomes ui.choices', has('ui.choices'));
check(audio.length > 0 && audio.every((a) => a.turnId === done1.turnId && a.rate > 8000), 'audio: binary frames [rate][turn][PCM]', audio[0]);
check(!!has('bot.sentence'), 'bot.sentence (caption of the sentence being said)');
check(!!has('timing', (m) => m.turnId === done1.turnId && m.ms.firstAudio != null), 'timing: turn measurements', has('timing'));
send({ type: 'playback', state: 'ended', turnId: done1.turnId });

// — a typed message, then an interruption during the reply —
await sleep(300);
const before = audio.length;
send({ type: 'text', text: 'Tell me a long story.' });
check(await waitFor('thinking', (m) => m.turnId > done1.turnId), 'typed text → new reply');
await until(() => audio.length > before, 6000);
send({ type: 'interrupt' });
check(await waitFor('interrupted', (m) => m.turnId > done1.turnId, 3000), 'interrupt → interrupted', msgs.slice(-5));
const cut = has('interrupted', (m) => m.turnId > done1.turnId);
await sleep(600);
const afterCut = audio.filter((a) => a.turnId === cut.turnId && a.at > Date.now() - 400).length;
check(afterCut === 0, 'after interrupted: no more audio from that turn', afterCut);

// — changing the voice reloads the voice without cutting the conversation —
send({ type: 'settings', settings: { localVoice: 'M2' } });
await sleep(800);
check(!has('error', (m) => m.fatal), 'changing the voice: no error', has('error'));
send({ type: 'text', text: 'And now?' });
check(await waitFor('bot.done', (m) => m.turnId > cut.turnId, 10000), 'the conversation continues with the new voice');

// — changing the end silence reopens recognition (and reloads whisper) without losing the conversation —
send({ type: 'playback', state: 'ended', turnId: (has('bot.done', (m) => m.turnId > cut.turnId) || {}).turnId || 0 });
const userTexts = () => msgs.filter((m) => m.type === 'user.text').length;
const doneCount = () => msgs.filter((m) => m.type === 'bot.done').length;
send({ type: 'settings', settings: { endSilenceMs: 900, endSensitivity: 'low' } });   // "low" also changes whisper's detection
await sleep(900);
check(!has('error', (m) => m.fatal), 'changing the end silence: no error', has('error'));
{
  const u0 = userTexts(); const d0 = doneCount();
  await speak(1.2, 2.0);
  check(await until(() => userTexts() > u0, 8000), 'after the silence change: speech is still heard', msgs.slice(-6).map((m) => m.type));
  check(await until(() => doneCount() > d0, 10000), 'after the silence change: the agent replies');
}

// — talking over the agent with interruptAfterMs (simulated engine: a burst under 450 ms is heard as "Mm-hmm.") —
if (mode === 'mock') {
  const lastTurn = () => Math.max(0, ...msgs.filter((m) => m.turnId).map((m) => m.turnId));
  send({ type: 'playback', state: 'ended', turnId: lastTurn() });
  send({ type: 'settings', settings: { interruptAfterMs: 700 } });
  await sleep(200);
  // a 300 ms "mm-hm" during a long reply: the voice is lowered, then comes back, and the reply goes on
  const before = lastTurn();
  send({ type: 'text', text: 'Tell me a long story.' });
  const id = ((await waitFor('thinking', (m) => m.turnId > before)) || {}).turnId;
  await until(() => audio.some((a) => a.turnId === id), 6000);
  await speakRealtime(main, 0.3, 1.5);
  const duck = await waitFor('bot.duck', (m) => m.turnId === id, 3000);
  const unduck = await waitFor('bot.unduck', (m) => m.turnId === id, 3000);
  check(!!duck, 'talking over the agent (interruptAfterMs 700): bot.duck', msgs.slice(-6).map((m) => m.type));
  check(unduck && unduck.reason === 'backchannel' && unduck.text === 'Mm-hmm.' && unduck.at >= duck.at, 'a short "mm-hm": then bot.unduck (reason backchannel)', unduck);
  const done = await waitFor('bot.done', (m) => m.turnId === id, 10000);
  check(done && !has('interrupted', (m) => m.turnId === id), 'a short "mm-hm": no interruption, the reply completes (bot.done)');
  check(!has('user.text', (m) => /Mm-hmm/.test(m.text)) && !has('user.partial', (m) => /Mm-hmm/.test(m.text)) && !has('thinking', (m) => m.turnId > id),
    'a short "mm-hm": not a user turn, no reply to it', msgs.filter((m) => m.at >= duck.at).map((m) => m.type));
  send({ type: 'playback', state: 'ended', turnId: id });
  // a 1.5 s burst: the agent stops after 700 ms (interrupted), and the speech becomes the next turn
  send({ type: 'text', text: 'Tell me another story.' });
  const id2 = ((await waitFor('thinking', (m) => m.turnId > id)) || {}).turnId;
  await until(() => audio.some((a) => a.turnId === id2), 6000);
  await speakRealtime(main, 1.5, 1.5);
  const duck2 = await waitFor('bot.duck', (m) => m.turnId === id2, 3000);
  const cut2 = await waitFor('interrupted', (m) => m.turnId === id2, 3000);
  check(duck2 && cut2 && cut2.by === 'user' && cut2.at >= duck2.at, 'talking on over the agent: bot.duck, then interrupted (by the user)', [duck2, cut2]);
  check(duck2 && cut2 && cut2.at - duck2.at >= 600 && !has('bot.unduck', (m) => m.turnId === id2), `talking on: interrupted ${duck2 && cut2 ? cut2.at - duck2.at : '?'} ms after the voice was lowered (700)`);
  const id3 = await waitFor('thinking', (m) => m.turnId > id2, 6000);
  check(!!id3, 'talking on: the speech is the next user turn (a reply)');
  await waitFor('bot.done', (m) => id3 && m.turnId === id3.turnId, 10000);
  send({ type: 'playback', state: 'ended', turnId: (id3 || {}).turnId || 0 });
  send({ type: 'settings', settings: { interruptAfterMs: 0 } });
  await sleep(200);
}

// — {type:'say'}: the agent says a line as written (the reprompt of "Away after"), as an agent turn —
{
  const before = Math.max(0, ...msgs.filter((m) => m.turnId).map((m) => m.turnId));
  send({ type: 'playback', state: 'ended', turnId: before });
  send({ type: 'say', text: 'Are you still there?' });
  const sayText = await waitFor('bot.text', (m) => m.turnId > before && m.text === 'Are you still there?', 4000);
  const sayDone = await waitFor('bot.done', (m) => sayText && m.turnId === sayText.turnId, 6000);
  check(sayText && sayDone && sayDone.text === 'Are you still there?' && audio.some((a) => a.turnId === sayText.turnId) && !!has('bot.sentence', (m) => m.turnId === sayText.turnId),
    '{type:"say"}: a bot turn with the text (bot.text, bot.sentence, audio, bot.done)', sayDone);
  check(!has('user.text', (m) => m.text === 'Are you still there?'), '{type:"say"}: not a user turn');
  send({ type: 'playback', state: 'ended', turnId: (sayText || {}).turnId || 0 });
  send({ type: 'text', text: 'Yes, I am here.' });
  check(await waitFor('bot.done', (m) => sayText && m.turnId > sayText.turnId, 10000), '{type:"say"}: the conversation goes on');
}

// — the local voice engines: Supertonic, Parler (a voice described in words), Chatterbox —
if (mode === 'fake-qvac') {
  const turnAfter = async (prevId, text) => {
    send({ type: 'text', text });
    const d = await waitFor('bot.done', (m) => m.turnId > prevId, 10000);
    if (d) send({ type: 'playback', state: 'ended', turnId: d.turnId });
    return d;
  };
  let last = Math.max(0, ...msgs.filter((m) => m.turnId).map((m) => m.turnId));
  send({ type: 'playback', state: 'ended', turnId: last });
  send({ type: 'settings', settings: { localVoiceEngine: 'parler', voiceDescription: 'A warm, low-pitched female voice, speaking slowly.' } });
  await sleep(500);
  const p1 = await turnAfter(last, 'Describe the painting.');
  check(p1 && !has('error'), 'Parler: the conversation goes on with the Parler voice', has('error'));
  check(p1 && audio.filter((a) => a.turnId === p1.turnId).every((a) => a.rate === 44100) && audio.some((a) => a.turnId === p1.turnId), 'Parler: its audio at 44.1 kHz');
  send({ type: 'settings', settings: { voiceDescription: '' } });
  await sleep(200);
  const p2 = await turnAfter(p1 ? p1.turnId : last, 'And the sculpture?');
  check(!!p2, 'Parler without a description: the conversation goes on');
  send({ type: 'settings', settings: { localVoiceEngine: 'chatterbox' } });
  await sleep(500);
  const c1 = await turnAfter(p2 ? p2.turnId : last, 'Tell me more.');
  check(c1 && audio.filter((a) => a.turnId === c1.turnId).every((a) => a.rate === 24000) && audio.some((a) => a.turnId === c1.turnId), 'Chatterbox: the conversation goes on, audio at 24 kHz');
  send({ type: 'settings', settings: { localVoiceEngine: 'supertonic' } });
  await sleep(500);
  const s1 = await turnAfter(c1 ? c1.turnId : last, 'Thanks.');
  check(s1 && audio.filter((a) => a.turnId === s1.turnId).every((a) => a.rate === 44100), 'back to Supertonic');
}
if (mode === 'mock') {
  // Parler speaks English only: a status says so when the language is another one
  send({ type: 'settings', settings: { localVoiceEngine: 'parler', language: 'fr' } });
  const warn = await waitFor('status', (m) => m.text === 'Parler only speaks English: replies will sound English-accented.', 3000);
  check(warn && !has('error', (m) => m.fatal), 'Parler + French: the status "Parler only speaks English: replies will sound English-accented."', warn);
  send({ type: 'settings', settings: { localVoiceEngine: 'supertonic', language: 'en' } });
  await sleep(300);
}

// — one conversation only: a 2nd page takes over —
const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}/voice`);
await new Promise((r) => { ws2.onopen = r; });
check(await waitFor('error', (m) => m.code === 'replaced', 3000), 'a 2nd connection replaces the 1st (with a message)');
ws2.close();
ws.close();
await sleep(200);

srv.kill('SIGTERM');
await new Promise((r) => srv.on('exit', r));

// =========================== Smart Turn: the end-of-turn model (simulated engine) ===================
if (mode === 'mock') {
  console.log('— Smart Turn —');
  const settings = { name: 'Test', persona: 'You are a test robot.', language: 'en', uiTools: false, greeting: '', turnDetection: 'smart', endSilenceMs: 3000 };
  // SMART_TURN_FAKE=complete: the turn ends right after the end of the sentence, without waiting 3 s
  {
    const port = PORT + 1;
    const proc = startServer(port, { env: { SMART_TURN_FAKE: 'complete', MOCK_LLM_DELAY_MS: '1500' } });
    await healthy(port);
    const c = await connect(port);
    c.send({ type: 'start', settings });
    await c.waitFor('ready');
    await sleep(300);                                        // Smart Turn loads (shared by the server)
    const speechEnd = await speakRealtime(c, 1.2, 4, () => !!c.has('thinking'));
    const thinking = await c.waitFor('thinking', () => true, 6000);
    const pred = c.has('turn.prediction');
    check(pred && pred.complete === true && pred.probability === 0.95 && pred.ms >= 0, 'Smart Turn (complete): a turn.prediction with complete=true', pred);
    check(thinking && thinking.at - speechEnd < 1800, `Smart Turn (complete): the turn ends ${thinking ? ((thinking.at - speechEnd) / 1000).toFixed(2) : '?'} s after the speech (end silence 3 s)`, thinking && thinking.at - speechEnd);
    check(!!c.has('user.text') && pred && thinking && pred.at <= thinking.at, 'Smart Turn (complete): the prediction comes first, then the user turn', c.msgs.map((m) => m.type).slice(0, 12));
    const timing = await c.waitFor('timing', () => true, 8000);
    check(timing && timing.ms && timing.ms.smartTurn >= 0, 'Smart Turn: the turn timing includes ms.smartTurn', timing && timing.ms);
    await sleep(3200);                                       // the engine's own end of turn arrives later: ignored
    check(c.msgs.filter((m) => m.type === 'thinking').length === 1 && !c.has('not.understood'), 'Smart Turn: the engine\'s later end of turn is ignored (a single reply)', c.msgs.map((m) => m.type));

    // — spoken fillers (this server's model is slow: MOCK_LLM_DELAY_MS=1500) —
    console.log('— spoken fillers —');
    const prev = await c.waitFor('bot.done', () => true, 10000);
    c.send({ type: 'playback', state: 'ended', turnId: (prev || {}).turnId || 0 });
    c.send({ type: 'settings', settings: { fillerLines: 'Hmm, let me see…', fillerAfterMs: 600 } });
    await sleep(500);                                       // the filler is synthesized in the background
    const a0 = c.audio.length;
    const sentAt = Date.now();
    c.send({ type: 'text', text: 'What is in this room?' });
    const fid = ((await c.waitFor('thinking', (m) => m.turnId > ((prev || {}).turnId || 0))) || {}).turnId;
    const filler = await c.waitFor('bot.filler', (m) => m.turnId === fid, 4000);
    const firstText = await c.waitFor('bot.text', (m) => m.turnId === fid, 8000);
    check(filler && filler.text === 'Hmm, let me see…' && firstText && filler.at < firstText.at, 'fillers: a bot.filler arrives before the first reply text', filler);
    check(filler && filler.at - sentAt >= 550 && filler.at - sentAt < 1200, `fillers: said ${filler ? filler.at - sentAt : '?'} ms after the end of the turn (fillerAfterMs 600)`);
    const done = await c.waitFor('bot.done', (m) => m.turnId === fid, 10000);
    const fFrames = c.audio.slice(a0).filter((a) => a.turnId === 0xFFFFFFFF);
    const rFrames = c.audio.slice(a0).filter((a) => a.turnId === fid);
    check(fFrames.length > 0 && rFrames.length > 0 && Math.max(...fFrames.map((a) => a.at)) <= Math.min(...rFrames.map((a) => a.at)),
      'fillers: the filler\'s frames carry turn id 0xFFFFFFFF, then come the reply\'s frames', { filler: fFrames.length, reply: rFrames.length });
    check(done && done.text && c.msgs.filter((m) => m.type === 'bot.filler').length === 1, 'fillers: then the reply, and a single filler for the turn', done);
    c.send({ type: 'playback', state: 'ended', turnId: fid });
    // a reply faster than fillerAfterMs: no filler
    c.send({ type: 'settings', settings: { fillerAfterMs: 4000 } });
    await sleep(200);
    c.send({ type: 'text', text: 'And the next room?' });
    const nid = ((await c.waitFor('thinking', (m) => m.turnId > fid)) || {}).turnId;
    await c.waitFor('bot.done', (m) => m.turnId === nid, 10000);
    await sleep(300);
    check(!c.has('bot.filler', (m) => m.turnId === nid), 'fillers: none when the reply comes before fillerAfterMs');
    c.close();
    proc.kill('SIGTERM');
  }
  // SMART_TURN_FAKE=incomplete: the end silence (3 s) ends the turn
  console.log('— Smart Turn (incomplete), then a short "stop" over the agent —');
  {
    const port = PORT + 2;
    const proc = startServer(port, { env: { SMART_TURN_FAKE: 'incomplete', MOCK_SHORT_TEXT: 'Stop.' } });
    await healthy(port);
    const c = await connect(port);
    c.send({ type: 'start', settings });
    await c.waitFor('ready');
    await sleep(300);
    const speechEnd = await speakRealtime(c, 1.2, 4.5, () => !!c.has('thinking'));
    const thinking = await c.waitFor('thinking', () => true, 6000);
    const pred = c.has('turn.prediction');
    const dt = thinking ? thinking.at - speechEnd : null;
    check(pred && pred.complete === false && pred.probability === 0.05, 'Smart Turn (incomplete): a turn.prediction with complete=false', pred);
    check(dt != null && dt > 2700 && dt < 4500, `Smart Turn (incomplete): the turn ends after the end silence, ${dt != null ? (dt / 1000).toFixed(2) : '?'} s after the speech`, dt);
    // (this server hears a short burst as "Stop."): a short "stop" over the agent stops it, with no reply
    const first = await c.waitFor('bot.done', () => true, 10000);
    c.send({ type: 'playback', state: 'ended', turnId: (first || {}).turnId || 0 });
    c.send({ type: 'settings', settings: { interruptAfterMs: 700, turnDetection: 'silence', endSilenceMs: 800 } });
    await sleep(200);
    c.send({ type: 'text', text: 'Tell me a long story.' });
    const sid = ((await c.waitFor('thinking', (m) => m.turnId > ((first || {}).turnId || 0))) || {}).turnId;
    await until(() => c.audio.some((a) => a.turnId === sid), 6000);
    await speakRealtime(c, 0.3, 1.6);
    const sd = await c.waitFor('bot.duck', (m) => m.turnId === sid, 3000);
    const cut = await c.waitFor('interrupted', (m) => m.turnId === sid, 3000);
    const said = await c.waitFor('user.text', (m) => m.text === 'Stop.', 3000);
    check(sd && cut && cut.by === 'user' && said && said.reply === false && !c.has('bot.unduck', (m) => m.turnId === sid),
      'a short "stop" over the agent: bot.duck, interrupted, user.text with reply:false', c.msgs.filter((m) => m.at >= (sd || {}).at).map((m) => m.type));
    await sleep(1200);
    check(!c.has('thinking', (m) => m.turnId > sid), 'a short "stop": the agent stops and listens (no reply)');
    c.close();
    proc.kill('SIGTERM');
  }
  // no model / no runtime: a status says so once, and the turn ends on silence
  console.log('— Smart Turn unavailable —');
  {
    const dir = mkdtempSync(join(tmpdir(), 'voice-lab-config-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ turn: { smartTurn: { model: join(dir, 'missing-model.onnx') } } }));
    const port = PORT + 3;
    const proc = startServer(port, { cwd: dir, config: 'config.json' });
    await healthy(port);
    const c = await connect(port);
    c.send({ type: 'start', settings: { ...settings, endSilenceMs: 800 } });
    await c.waitFor('ready');
    const st = await c.waitFor('status', (m) => /Smart Turn is unavailable here: using silence only\./.test(m.text), 3000);
    check(st && !c.has('error', (m) => m.fatal), 'Smart Turn unavailable: one non-fatal status "Smart Turn is unavailable here: using silence only."', st);
    await speakRealtime(c, 1.2, 2.5, () => !!c.has('thinking'));
    check(await c.waitFor('thinking', () => true, 4000) && !c.has('turn.prediction'), 'Smart Turn unavailable: the turn still ends (silence only)');
    c.send({ type: 'settings', settings: { turnDetection: 'silence' } });
    c.send({ type: 'settings', settings: { turnDetection: 'smart' } });
    await sleep(400);
    check(c.msgs.filter((m) => m.type === 'status' && /Smart Turn/.test(m.text)).length === 1, 'Smart Turn unavailable: said only once', c.msgs.filter((m) => m.type === 'status'));
    c.close();
    proc.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const p of servers) { try { p.kill('SIGTERM'); } catch { /* exited */ } }
if (mode === 'fake-qvac') {
  const rep = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  check(rep, 'the fake SDK wrote its report');
  if (rep) {
    check(rep.problems.length === 0, 'the adapter calls the SDK with the right options', rep.problems);
    const loads = rep.calls.filter((c) => c.fn === 'loadModel');
    check(loads.some((c) => c.modelType === 'whisper') && loads.some((c) => c.modelType === 'llm') && loads.some((c) => c.modelType === 'tts'), 'the three models are loaded');
    check(loads.filter((c) => c.modelType === 'tts').some((c) => c.modelConfig.voice === 'M2'), 'changing the voice reloads the voice (M2)');
    check(loads.find((c) => c.modelType === 'whisper').fallbackSrc && /^https:\/\/huggingface\.co\//.test(loads.find((c) => c.modelType === 'whisper').fallbackSrc), 'download: Hugging Face HTTP fallback for "hf" models');
    check(!loads.find((c) => c.modelType === 'tts').fallbackSrc, 'download: no invented fallback for Supertonic (s3)');
    check(loads.find((c) => c.modelType === 'llm').modelConfig.reasoning_budget === 0, 'Qwen3: reasoning off (reasoning_budget 0)');
    check(rep.calls.some((c) => c.fn === 'cancel'), 'interrupting cancels the generation (cancel)');
    check(rep.calls.some((c) => c.fn === 'completion' && c.history.some((h) => h.role === 'assistant' && h.content === 'Are you still there?')),
      '{type:"say"}: the line is in the history, as the agent\'s message');
    check(rep.calls.filter((c) => c.fn === 'completion').every((c) => c.history[0].content.includes('test robot')), 'the persona is in the system prompt');
    const streams = rep.calls.filter((c) => c.fn === 'transcribeStream');
    check(streams.length >= 2 && streams[streams.length - 1].o.endOfTurnSilenceMs === 900, 'the end silence reopens a recognition stream (900 ms)', streams.map((c) => c.o.endOfTurnSilenceMs));
    // the voice engines
    const ttsLoads = loads.filter((c) => c.modelType === 'tts');
    const parlerLoad = ttsLoads.find((c) => c.modelConfig.ttsEngine === 'parler');
    check(parlerLoad && parlerLoad.src === 'TTS_MINI_V1_EN_PARLER_TTS_Q8_0' && parlerLoad.modelConfig.seed === 42 && !('language' in parlerLoad.modelConfig) && !('voice' in parlerLoad.modelConfig),
      'Parler: switching loads TTS_MINI_V1_EN_PARLER_TTS_Q8_0 ({ttsEngine: parler, seed: 42})', parlerLoad);
    const ttsCalls = rep.calls.filter((c) => c.fn === 'textToSpeech');
    const parlerCalls = ttsCalls.filter((c) => c.engine === 'parler');
    const firstVoice = parlerCalls.findIndex((c) => c.voice !== undefined);
    const described = parlerCalls.slice(0, firstVoice < 0 ? parlerCalls.length : firstVoice);
    const templated = firstVoice < 0 ? [] : parlerCalls.slice(firstVoice);
    check(described.length > 0 && described.every((c) => c.description === 'A warm, low-pitched female voice, speaking slowly.' && c.voice === undefined),
      'Parler: every textToSpeech call carries the description (and no voice)', described.length);
    check(templated.length > 0 && templated.every((c) => c.voice === 'Laura' && c.description === undefined), 'Parler: with the description cleared, voice: "Laura" (and no description)', templated.length);
    const cbLoad = ttsLoads.find((c) => c.modelConfig.ttsEngine === 'chatterbox');
    check(cbLoad && cbLoad.src === 'TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0' && cbLoad.modelConfig.s3genModelSrc === 'TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0' && cbLoad.modelConfig.language === 'en',
      'Chatterbox: switching loads the T3 model with s3genModelSrc (S3Gen)', cbLoad);
    check(ttsCalls.filter((c) => c.engine !== 'parler').every((c) => c.voice === undefined && c.description === undefined), 'Supertonic and Chatterbox requests carry no Parler field');
    const whisperLoads = loads.filter((c) => c.modelType === 'whisper');
    check(whisperLoads.length === 2 && whisperLoads[1].modelConfig.vad_params.min_silence_duration_ms === 500, 'the end sensitivity reloads whisper (new detection), only once', whisperLoads.map((c) => c.modelConfig.vad_params.min_silence_duration_ms));
    unlinkSync(report);
  }
}
const failed = summary();
if (failed) console.log('\n--- server log ---\n' + serverLog.join('').slice(-2500));
process.exit(failed ? 1 : 0);
