// Tests voice-core's Gemini Live engine (the one the lab window runs) against a fake Gemini Live server,
// in Chromium, with a fake microphone, through the former op's ports (tests/fixtures/core-ports.js).
//   node tests/test-gemini.mjs
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startStatic, makeFakeMicWav, launch, check, summary, sleep, until } from './helpers.mjs';
import { startMockGemini } from './mock-gemini.mjs';

const gem = await startMockGemini();
const web = await startStatic();
const browser = await launch(makeFakeMicWav(join(tmpdir(), 'voice-fake-mic.wav')));
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`${web.url}/tests/core-harness.html`);
await page.evaluate(() => window.ready);

const port = (name) => page.evaluate((n) => { const p = window.P(n); if (!p) throw new Error('no port ' + n); return p.get(); }, name);
const set = (name, v) => page.evaluate(([n, val]) => window.P(n).set(val), [name, v]);
const fire = (name) => page.evaluate((n) => window.fire(n), name);
const triggered = (name) => page.evaluate((n) => window.P(n).triggered, name);
const events = () => page.evaluate(() => window.events.map((e) => e.type + (e.type === 'state' ? ':' + e.state : '')));
const sent = (kind) => gem.log.filter((l) => l.kind === kind);
const evs = () => page.evaluate(() => window.events.slice());
const speakingNow = () => until(async () => (await port('State')) === 'speaking', 6000);
const backToListening = () => until(async () => (await port('State')) === 'listening', 9000);

// ---- 0. dropdown default values (cables only applies the default value without "noindex") -----------
check((await port('Engine')) === 'Gemini Live' && (await port('Gemini voice')) === 'Kore' && (await port('Language')) === 'en',
  'dropdowns: engine, voice and language have their default value', [await port('Engine'), await port('Gemini voice'), await port('Language')]);
check((await port('End sensitivity')) === 'high' && (await port('Earcons')) === 'soft' && (await port('Thinking sound')) === 'off',
  'dropdowns: sensitivity, earcons and thinking sound have their default value');
check((await port('End of turn (local)')) === 'silence only' && (await port('Local voice engine')) === 'Supertonic'
  && (await port('Interrupt after (ms) (local)')) === 0 && (await port('Filler after (ms) (local)')) === 1200 && (await port('Away after (ms)')) === 0
  && (await port('Filler lines (local)')) === '' && (await port('Reprompt line')) === '' && (await port('Voice description (Parler)')) === '',
'new ports: End of turn, Local voice engine, Interrupt after, fillers, Away after, Reprompt line, Voice description have their defaults');
check(await page.evaluate(() => ['On interruption pending', 'On interruption cancelled', 'On filler', 'On away'].every((n) => window.P(n) && window.P(n).kind === 'trigger')
  && window.P('Turn probability (local)').kind === 'number'), 'new outputs: Turn probability (local), On interruption pending/cancelled, On filler, On away');

// ---- 1. settings, start, setup ---------------------------------------------------------------------
check(await page.evaluate(() => window.P('Gemini API key').ignoreValueSerialize === true), 'the API key is never saved in the patch');
await set('Gemini API key', 'test-key');
await set('Gemini endpoint (advanced)', gem.endpoint);
await set('Persona', 'You are Zoe, a gardener who talks about plants.');
await set('Name', 'Zoe');
await set('Gemini voice', 'Puck');
await set('End silence (ms)', 600);
await set('End sensitivity', 'low');
await set('Greeting', 'Welcome to the garden');
await set('Reply delay (ms)', 300);
await sleep(250);
await fire('Start');
check(await until(async () => (await port('State')) === 'listening' || (await port('State')) === 'speaking', 8000), 'Start → the session is open', await port('Error'));
const setup = gem.setups[0] || {};
check(setup.model === 'models/gemini-3.8-live', 'setup: model gemini-3.8-live', setup.model);
check(setup.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName === 'Puck', 'setup: chosen voice (Puck)');
check(/Zoe/.test(setup.systemInstruction?.parts?.[0]?.text) && /gardener/.test(setup.systemInstruction?.parts?.[0]?.text), 'setup: the persona is in the system instructions');
check(setup.realtimeInputConfig?.automaticActivityDetection?.silenceDurationMs === 600, 'setup: end silence = 600 ms');
check(setup.realtimeInputConfig?.automaticActivityDetection?.endOfSpeechSensitivity === 'END_SENSITIVITY_LOW', 'setup: low end sensitivity');
check(setup.realtimeInputConfig?.activityHandling === 'START_OF_ACTIVITY_INTERRUPTS', 'setup: interruptible');
check(setup.tools?.[0]?.functionDeclarations?.some((d) => d.name === 'show_choices'), 'setup: the show_choices tool is declared');
check(setup.inputAudioTranscription && setup.outputAudioTranscription, 'setup: transcriptions requested');

// ---- 2. the greeting: the agent speaks first -------------------------------------------------------
const greet = sent('clientContent')[0];
check(greet && /Welcome to the garden/.test(JSON.stringify(greet.msg)), 'greeting: the opening message is sent');
check(await until(async () => (await triggered('On reply end')) >= 1, 8000), 'greeting: the agent said its line (On reply end)');

// ---- 3. the mic: audio sent, speech detection, reply -------------------------------------------------
const audio = await until(() => sent('realtimeInput').length > 20 && sent('realtimeInput'), 8000);
const a0 = audio && audio[0].msg.audio;
check(a0 && a0.mimeType === 'audio/pcm;rate=16000', 'mic: 16 kHz PCM audio sent', a0);
check(audio && audio.every((x) => Math.abs(x.msg.audio.samples - 1600) <= 1), 'mic: 100 ms packets (1600 samples)');
check(audio && audio.some((x) => x.msg.audio.rms > 0.05), 'mic: the fake mic\'s "speech" arrives with energy');
const turnsBefore = await triggered('On turn');
check(await until(async () => (await triggered('On user start')) >= 1, 9000), 'mic: "On user start" when speaking');
check(await until(async () => (await port('Mic level')) > 0.2, 6000), 'mic: "Mic level" moves when speaking', await port('Mic level'));
check(await until(async () => (await triggered('On turn')) > turnsBefore, 12000), 'mic: a complete turn (speech → reply)');
check((await port('Last user text')) === 'Hello Ada.', 'user transcription', await port('Last user text'));
check((await port('Last agent reply')) === 'Hello, I am Ada.', 'agent transcription', await port('Last agent reply'));
const wait = await port('Wait (ms)');
check(wait >= 250 && wait < 5000, 'timing: wait between the end of speech and the voice (300 ms delay included)', wait);
const seq = await events();
const iEnd = seq.lastIndexOf('user.end'); const iThink = seq.lastIndexOf('thinking'); const iStart = seq.lastIndexOf('bot.start'); const iBotEnd = seq.lastIndexOf('bot.end');
check(iEnd < iThink && iThink < iStart && iStart < iBotEnd, 'event order: user.end → thinking → bot.start → bot.end', seq.slice(-14));

// ---- 4. text, choices, mood, tools (mic muted for a deterministic run) ------------------------------
gem.opts.vad = false;
await set('Mic muted', 1);
await sleep(300);
await set('Text', 'Show me the CHOICES and your MOOD');
await fire('Send text');
check(await until(async () => (await port('Choices'))?.length === 2, 6000), 'choices: the options arrive on the Choices port', await port('Choices'));
check((await port('Question')) === 'Which do you prefer?', 'choices: the question');
check((await port('Mood')) === 'happy', 'mood: set_mood → Mood port');
const silent = gem.log.filter((l) => l.kind === 'toolResponse').map((l) => l.msg.toolResponse.functionResponses[0]);
check(silent.some((r) => r.id === 'fc-1' && r.response.scheduling === 'SILENT' && r.response.result === 'ok' && !('scheduling' in r)), 'choices: SILENT tool response sent to Gemini (scheduling inside response)', silent);
check(gem.errors.length === 0 && (await port('State')) !== 'error', 'tools: Gemini accepts the responses (no unknown field)', gem.errors);
await until(async () => (await port('State')) === 'listening', 6000);
await set('Choice index', 1);
await fire('Choose');
await sleep(200);
const chosen = sent('clientContent').pop();
check(chosen && /Sculpture/.test(JSON.stringify(chosen.msg)), 'choices: "Choose" sends the option to the agent');
await until(async () => (await port('State')) === 'listening', 6000);

await set('Text', 'TOOL');
await fire('Send text');
check(await until(async () => (await port('Tool name')) === 'open_door', 6000), 'tool: call to a tool declared by the patch');
await set('Tool result', '{"open": true}');
await fire('Send tool result');
await sleep(200);
const tr = gem.log.filter((l) => l.kind === 'toolResponse').map((l) => l.msg.toolResponse.functionResponses[0]).find((r) => r.id === 'fc-3');
check(tr && tr.response.open === true && tr.name === 'open_door', 'tool: the result goes back to Gemini', tr);
await until(async () => (await port('State')) === 'listening', 6000);

// ---- 5. interruptions ----------------------------------------------------------------------------------
const intBefore = await triggered('On interruption');
await set('Text', 'INTERRUPT_ME');
await fire('Send text');
check(await until(async () => (await triggered('On interruption')) > intBefore, 6000), 'interruption by the server: "On interruption"');
check(await until(async () => (await page.evaluate(() => window.op.voiceAgent.debug().sources)) === 0, 2000), 'interruption: the voice stops right away');
check(await until(async () => (await port('State')) === 'listening', 8000), 'after an interruption with nothing following: back to listening (not stuck on "hearing")', await port('State'));

await set('Text', 'LONG');
await fire('Send text');
await until(async () => (await port('State')) === 'speaking', 6000);
check(await until(async () => (await port('Voice level')) > 0.1, 3000), '"Voice level" moves when the agent speaks', await port('Voice level'));
const int2 = await triggered('On interruption');
await fire('Interrupt');
check((await port('State')) === 'listening', '"Interrupt" button: immediate return to listening');
check((await triggered('On interruption')) === int2 + 1, '"Interrupt" button: "On interruption"');
await sleep(1500);
check((await port('State')) === 'listening' && (await page.evaluate(() => window.op.voiceAgent.debug().sources)) === 0, 'after "Interrupt": the rest of the old reply is not played');
const note = sent('clientContent').pop();
check(note && note.msg.clientContent.turnComplete === false && /interrupted you/.test(JSON.stringify(note.msg)), 'after "Interrupt": Gemini is told, without having to reply');

// the reply that follows an "Interrupt" is played (it is not taken for the end of the old one)
await set('Text', 'LONG');
await fire('Send text');
await speakingNow();
await fire('Interrupt');
await set('Text', 'Again');
let ends = await triggered('On reply end');
await fire('Send text');
check(await until(async () => (await triggered('On reply end')) > ends, 8000) && (await port('Last agent reply')) === 'Hello, I am Ada.',
  'after "Interrupt": the next reply is played in full', await port('Last agent reply'));
await backToListening();

// a text typed while the agent speaks: a single interruption (ours), and the new reply is kept
const userTextCount = async () => (await evs()).filter((e) => e.type === 'user.text').length;
for (const confirm of [true, false]) {
  gem.opts.confirmInterrupt = confirm;
  gem.opts.replyDelay = confirm ? 250 : 700;   // without confirmation, Gemini takes at least one round trip to reply
  await set('Text', 'LONG');
  await fire('Send text');
  await speakingNow();
  await sleep(300);
  const evBefore = (await evs()).length;
  const ut = await userTextCount();
  ends = await triggered('On reply end');
  await set('Text', 'And then?');
  await fire('Send text');
  const ok = await until(async () => (await triggered('On reply end')) > ends, 8000);
  const after = (await evs()).slice(evBefore);
  const ints = after.filter((e) => e.type === 'interrupted');
  const label = confirm ? '' : ' (even if Gemini does not confirm the interruption)';
  check(ok && (await port('Last agent reply')) === 'Hello, I am Ada.', 'text while speaking: the new reply is played in full' + label, await port('Last agent reply'));
  check(ints.length === 1 && ints[0].by === 'client', 'text while speaking: a single interruption, ours' + label, ints);
  check((await userTextCount()) === ut + 1, 'text while speaking: "user.text" only once' + label);
  await backToListening();
}
gem.opts.confirmInterrupt = true;
gem.opts.replyDelay = 250;

// a choice while the agent is still speaking: no "user" interruption, and the reply to the choice is kept
await set('Text', 'LONG CHOICES');
await fire('Send text');
await speakingNow();
check(await until(async () => (await port('Choices'))?.length === 2, 4000), 'choices shown while the agent speaks');
{
  const evBefore = (await evs()).length;
  ends = await triggered('On reply end');
  await set('Choice index', 0);
  await fire('Choose');
  const ok = await until(async () => (await triggered('On reply end')) > ends, 8000);
  const after = (await evs()).slice(evBefore);
  check(ok && (await port('Last agent reply')) === 'Hello, I am Ada.', 'choice while speaking: the reply to the choice is played', await port('Last agent reply'));
  check(!after.some((e) => e.type === 'interrupted' && e.by === 'user') && after.filter((e) => e.type === 'user.text').length === 1,
    'choice while speaking: no "user" interruption, a single message', after.map((e) => e.type + (e.by ? ':' + e.by : '')));
  check(/Painting/.test(JSON.stringify(sent('clientContent').pop().msg)), 'choice while speaking: the chosen option is sent');
}
await backToListening();

// a context sent while the agent speaks waits for the end of its reply (otherwise it would cut it off)
await set('Text', 'LONG');
await fire('Send text');
await speakingNow();
{
  const ccBefore = sent('clientContent').length;
  const intBeforeCtx = await triggered('On interruption');
  ends = await triggered('On reply end');
  await set('Context', 'The user is looking at room 2.');
  await fire('Send context');
  await sleep(500);
  check(sent('clientContent').length === ccBefore && (await port('State')) === 'speaking', 'context while speaking: nothing is sent, the agent carries on');
  await until(async () => (await triggered('On reply end')) > ends, 8000);
  const ctx = await until(() => sent('clientContent').slice(ccBefore).find((l) => /room 2/.test(JSON.stringify(l.msg))), 3000);
  check(ctx && ctx.msg.clientContent.turnComplete === false, 'context while speaking: sent at the end of the reply, without asking for a reply', ctx && ctx.msg);
  check((await triggered('On interruption')) === intBeforeCtx && (await port('Last agent reply')) === 'Once upon a time, a very long story.',
    'context while speaking: the reply was not cut off', await port('Last agent reply'));
}
await backToListening();

// ---- 6. session resumption (goAway) --------------------------------------------------------------------
await sleep(2500);
const setupsBefore = gem.setups.length;
await set('Text', 'GOAWAY');
await fire('Send text');
check(await until(() => gem.setups.length > setupsBefore, 6000), 'goAway: the op reconnects on its own');
check(gem.setups[gem.setups.length - 1]?.sessionResumption?.handle === 'handle-1', 'goAway: the resumption uses the resumption handle', gem.setups[gem.setups.length - 1]?.sessionResumption);

// ---- 7. a setting that needs a restart --------------------------------------------------------------
await set('Gemini voice', 'Kore');
await sleep(400);
check(!!(await page.evaluate(() => window.op.uiErrors.restart)), 'changing the voice during a session: the op says to restart');

// ---- 8. stop -------------------------------------------------------------------------------------------
await fire('Stop');
check(await until(async () => (await port('State')) === 'ended', 3000), 'Stop → state "ended"');
check((await port('Mic level')) === 0 && (await port('Voice level')) === 0, 'Stop: levels at zero');
const conv = await port('Conversation');
check(Array.isArray(conv) && conv.length >= 3 && conv.some((t) => t.user === 'Hello Ada.'), 'Conversation: the turns are kept', conv && conv.length);

// ---- 9. errors -----------------------------------------------------------------------------------------
await set('Gemini API key', 'wrong-key');
await sleep(250);
await fire('Start');
check(await until(async () => (await port('State')) === 'error', 6000), 'wrong key → state "error"');
check(/refused/.test(await port('Error')) && /Check the API key/.test(await port('Error')), 'wrong key → readable message that says what to do', await port('Error'));
check((await page.evaluate(() => window.op.uiErrors.error && window.op.uiErrors.error.level)) === 2, 'wrong key → error shown on the op');
await set('Gemini API key', '');
await sleep(250);
await fire('Start');
check(await until(async () => /API key/.test(await port('Error')), 4000), 'no key and no token server → message that says what to do', await port('Error'));

// ---- 9b. "Stop" during the connection, then restart -------------------------------------------------
await set('Gemini API key', 'silent-key');      // the fake server never finishes this setup
await sleep(250);
await fire('Start');
check(await until(async () => (await port('State')) === 'connecting' && gem.connections.some((c) => c.auth === 'silent-key'), 4000), 'a start that hangs: state "connecting"');
await fire('Stop');
check(await until(async () => (await port('State')) === 'ended', 2000), 'Stop during the connection → "ended"', await port('State'));
check(await until(() => gem.openConnections === 0, 2000), 'Stop during the connection: the connection is closed');
await sleep(400);
check((await port('State')) === 'ended' && !(await port('Error')), 'Stop during the connection: no error shown', await port('Error'));
await set('Gemini API key', 'test-key');
await sleep(250);
await fire('Start');
check(await until(async () => (await port('State')) === 'listening', 6000), 'then Start: the new session opens normally', await port('State'));
await fire('Stop');
await until(async () => (await port('State')) === 'ended', 3000);

// ---- 9c. "Stop" during the mic request ---------------------------------------------------------------
await page.evaluate(() => {
  const md = navigator.mediaDevices;
  window.__gum = md.getUserMedia.bind(md);
  window.__tracks = [];
  md.getUserMedia = (c) => new Promise((r) => setTimeout(r, 1200)).then(() => window.__gum(c)).then((s) => { window.__tracks.push(...s.getTracks()); return s; });
});
{
  const connBefore = gem.connections.length;
  await fire('Start');
  await sleep(300);
  await fire('Stop');
  await sleep(1800);
  const tracks = await page.evaluate(() => window.__tracks.map((t) => t.readyState));
  check((await port('State')) === 'ended' && gem.connections.length === connBefore, 'Stop during the mic request: nothing starts afterwards', [await port('State'), gem.connections.length - connBefore]);
  check(tracks.length === 1 && tracks[0] === 'ended', 'Stop during the mic request: the mic obtained afterwards is released', tracks);
}
await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__gum; });

// ---- 9d. token server: one token per connection, and a new one on reconnection ------------------------
await set('Gemini API key', '');
await set('Token server', gem.tokenUrl);
await set('Greeting', '');
await sleep(250);
await fire('Start');
check(await until(async () => (await port('State')) === 'listening', 6000), 'token server: the session opens with a token', await port('Error'));
const firstTok = gem.connections[gem.connections.length - 1];
check(firstTok.constrained && /^tok-\d+$/.test(firstTok.auth), 'token server: "Constrained" connection with access_token', firstTok);
{
  const n = gem.connections.length;
  await set('Text', 'GOAWAY');
  await fire('Send text');
  const next = await until(() => gem.connections.length > n && gem.connections[gem.connections.length - 1], 6000);
  check(next && next.constrained && next.auth !== firstTok.auth && /^tok-\d+$/.test(next.auth), 'token server: the reconnection asks for a fresh token', next);
  check(await until(async () => (await port('State')) !== 'error' && gem.setups[gem.setups.length - 1]?.sessionResumption?.handle === 'handle-1', 4000), 'token server: the reconnection resumes the session');
}
await fire('Stop');
await until(async () => (await port('State')) === 'ended', 3000);
await set('Token server', '');

// ---- 9e. the person stays silent: "On away", and a reprompt said once ------------------------------------
await set('Gemini API key', 'test-key');
await set('Mic muted', 1);
await set('Away after (ms)', 1500);
await set('Reprompt line', 'Are you still there?');
await sleep(250);
{
  const awayBefore = await triggered('On away');
  const replyStarts = await triggered('On reply start');
  const ccBefore = sent('clientContent').length;
  const evBefore = (await evs()).length;
  await fire('Start');
  check(await until(async () => (await port('State')) === 'listening', 6000), 'away: the session opens (mic muted)', await port('Error'));
  check(await until(async () => (await triggered('On away')) >= awayBefore + 1, 4000), 'away: "On away" fires after 1.5 s of silence');
  const reprompt = await until(() => sent('clientContent').slice(ccBefore).find((l) => /silent/.test(JSON.stringify(l.msg))), 3000);
  check(reprompt && reprompt.msg.clientContent.turnComplete === true
    && reprompt.msg.clientContent.turns[0].parts[0].text === '(The user has been silent for 1.5 seconds. Say, in your own words: "Are you still there?")',
  'away: the reprompt instruction goes to Gemini (clientContent, turnComplete)', reprompt && reprompt.msg);
  const replyEnds = await triggered('On reply end');
  check(await until(async () => (await triggered('On reply start')) > replyStarts, 6000) && (await triggered('On away')) === awayBefore + 1,
    'away: "On away" fired once before the reply starts', [await triggered('On away') - awayBefore]);
  check(await until(async () => (await triggered('On reply end')) > replyEnds, 8000), 'away: the reply plays (an ordinary agent turn)');
  check(await until(async () => (await triggered('On away')) >= awayBefore + 2, 5000), 'away: "On away" fires again after the reply');
  const after = (await evs()).slice(evBefore);
  const aways = after.filter((e) => e.type === 'user.away');
  check(aways.length >= 2 && aways[0].count === 1 && aways[1].count === 2 && aways[0].afterMs === 1500, 'away: user.away with count 1, then count 2', aways);
  check(!after.some((e) => e.type === 'user.text'), 'away: no user.text event (the reprompt is not a user turn)', after.filter((e) => e.type === 'user.text'));
  await sleep(300);
  check(sent('clientContent').length === ccBefore + 1, 'away: no new clientContent at count 2 (the line is said once)', sent('clientContent').length - ccBefore);
  await set('Away after (ms)', 0);
  await fire('Stop');
  await until(async () => (await port('State')) === 'ended', 3000);
}

// ---- 10. deleting the op -------------------------------------------------------------------------------
await set('Gemini API key', 'test-key');
await sleep(250);
await fire('Start');
await until(async () => (await port('State')) === 'listening', 6000);
await page.evaluate(() => window.op.deleteOp());
check(await until(async () => (await page.evaluate(() => window.op.voiceAgent.state)) === 'ended', 2000), 'deleting the op closes the session and the mic');

check(gem.errors.length === 0, 'no Gemini protocol violation', gem.errors);
check(consoleErrors.length === 0, 'no JavaScript error in the page', consoleErrors.slice(0, 5));

await browser.close();
gem.close();
web.close();
process.exit(summary() ? 1 : 0);
