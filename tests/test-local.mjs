// Tests the local backend in SIMULATED mode (no models): the lab window, and its clients through the hub
// (the cables op, the p5.js and HTML examples),
// in Chromium, with a fake microphone. Checks the protocol, the states, the choices, the mood, the interruptions.
//   node tests/test-local.mjs
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, startStatic, makeFakeMicWav, launch, check, summary, sleep, until } from './helpers.mjs';

const PORT = 18790 + Math.floor(Math.random() * 500);
const srv = spawn(process.execPath, [join(ROOT, '2_qvac_local', 'src', 'server.mjs'), '--mock', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
const serverLog = [];
srv.stdout.on('data', (d) => serverLog.push(String(d)));
srv.stderr.on('data', (d) => serverLog.push(String(d)));
const base = `http://127.0.0.1:${PORT}`;
const health = await until(async () => { try { const r = await fetch(`${base}/health`); const j = await r.json(); return j.models === 'ready' && j; } catch { return false; } }, 10000);
check(health && health.engine === 'mock', 'the server starts in simulated mode', health);

const browser = await launch(makeFakeMicWav(join(tmpdir(), 'voice-fake-mic-local.wav')));
const errors = [];

// =========================== 1. the lab window ====================================================
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('lab: ' + e));
  await page.goto(base + '/');
  const personas = await page.evaluate(() => fetch('/personas').then((r) => r.json()));
  check(Array.isArray(personas) && personas.length >= 4 && personas.every((p) => p.name && p.persona), 'lab: the personas are served', personas.length);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  const ev = () => page.evaluate(() => window.__ev || []);
  await page.evaluate(() => { window.__ev = []; window.agent.on('*', (e) => window.__ev.push(e)); });
  const preset = personas.findIndex((p) => p.id === 'station-host');   // a persona (short end silence, quick turns)
  await page.selectOption('#presets', { value: String(preset) });
  // The station kiosk persona lowers its voice for 600 ms before giving way (interruptAfterMs 600):
  // a greeting long enough for the fake mic to keep talking over it past that.
  await page.fill('[data-k="greeting"]', 'Hello there, I am ready to help you find your train today.');
  await page.dispatchEvent('[data-k="greeting"]', 'input');
  await page.click('#start');
  check(await until(() => page.evaluate(() => window.agent.state === 'listening' || window.agent.state === 'speaking'), 8000), 'lab: Start → conversation open', await page.evaluate(() => window.agent.state));
  const types = async () => (await ev()).map((e) => e.type);
  check(await until(async () => (await types()).includes('bot.start'), 8000), 'lab: the agent starts with its greeting');
  { const t = await types(); check(t.indexOf('bot.start') < t.indexOf('user.text') || !t.includes('user.text'), 'lab: the greeting comes before the first reply', t.slice(0, 12)); }
  check(await until(async () => (await types()).includes('user.start'), 10000), 'lab: the fake mic is heard (server vad)');
  check(await until(async () => (await types()).includes('user.text'), 10000), 'lab: transcription received');
  check(await until(async () => (await types()).filter((t) => t === 'turn').length >= 2, 15000), 'lab: a complete turn with the simulated model');
  const all = await ev();
  const userText = all.find((e) => e.type === 'user.text');
  check(userText && /tell me about this room/.test(userText.text), 'lab: user text', userText && userText.text);
  const choices = all.find((e) => e.type === 'ui.choices');
  check(choices && choices.options.join('|') === 'Painting|Sculpture', 'lab: the [[choices: …]] tag becomes buttons', choices);
  const mood = all.find((e) => e.type === 'ui.mood');
  check(mood && mood.mood === 'happy', 'lab: the [[mood: …]] tag becomes a mood', mood);
  const botText = all.filter((e) => e.type === 'bot.end').pop();
  check(botText && !/\[\[/.test(botText.text) && /gallery/.test(botText.text), 'lab: the text said/shown does not contain the tags', botText && botText.text);
  check(all.some((e) => e.type === 'bot.sentence'), 'lab: sentence-by-sentence captions (bot.sentence)');
  const btns = await page.$$eval('#choices button', (b) => b.map((x) => x.textContent));
  check(btns.join('|') === 'Painting|Sculpture' || (await types()).filter((t) => t === 'thinking').length > 2, 'lab: choice buttons shown', btns);
  const t1 = all.find((e) => e.type === 'turn' && e.user);
  check(t1 && t1.ms.firstSound > 0 && t1.ms.total > t1.ms.firstSound, 'lab: turn measurements (wait, total)', t1 && t1.ms);
  check(all.some((e) => e.type === 'timing' && e.ms && e.ms.firstToken != null), 'lab: the server sends its measurements (timing)');

  // barge-in: the fake mic speaks while the agent is still talking (with these timings, over its greeting)
  check(await until(async () => (await types()).includes('interrupted'), 25000), 'lab: talking over the agent (barge-in) interrupts it');
  const inter = (await ev()).find((e) => e.type === 'interrupted');
  check(inter && inter.by === 'user', 'lab: interruption attributed to the user', inter);

  // typed text, then the Interrupt button
  await page.evaluate(() => window.agent.update({ micMuted: true }));
  await until(() => page.evaluate(() => window.agent.state === 'listening'), 15000);
  await page.fill('#sayText', 'Tell me about the storm.');
  await page.click('#sayForm button');
  check(await until(() => page.evaluate(() => window.agent.state === 'speaking'), 6000), 'lab: a typed message triggers a spoken reply');
  await page.click('#interrupt');
  check(await page.evaluate(() => window.agent.state) === 'listening', 'lab: "Interrupt" hands the floor back');
  await sleep(800);
  check(await page.evaluate(() => window.agent.debug().sources === 0 && window.agent.state === 'listening'), 'lab: nothing from the old reply is played again');

  // a message typed DURING the reply delay (the voice is already there but held back): the new reply is played
  await page.evaluate(() => window.agent.update({ replyDelayMs: 1500 }));
  await page.fill('#sayText', 'Tell me about the storm.');
  await page.click('#sayForm button');
  check(await until(() => page.evaluate(() => window.agent.state === 'thinking'), 4000), 'lab: reply delay → the agent is "thinking"');
  await sleep(700);                                          // in the middle of the delay: the reply has not started yet
  const n0 = (await ev()).length;
  await page.fill('#sayText', 'No, tell me about the garden instead.');
  await page.click('#sayForm button');
  check(await until(async () => (await ev()).slice(n0).some((e) => e.type === 'bot.end'), 12000), 'lab: text during the delay → the new reply is said to the end', (await ev()).slice(n0).map((e) => e.type));
  {
    const after = (await ev()).slice(n0);
    const ints = after.filter((e) => e.type === 'interrupted');
    check(ints.length === 1 && ints[0].by === 'client', 'lab: text during the delay → a single interruption (ours)', ints);
    check(after.filter((e) => e.type === 'bot.start').length === 1 && after.filter((e) => e.type === 'user.text').length === 1, 'lab: text during the delay → a single reply, a single message', after.map((e) => e.type));
    const t = after.find((e) => e.type === 'turn' && /garden/.test(e.user || ''));
    check(t && t.bot && !t.interrupted, 'lab: text during the delay → the turn is complete', t);
  }
  await page.evaluate(() => window.agent.update({ replyDelayMs: 0 }));
  await until(() => page.evaluate(() => window.agent.state === 'listening'), 10000);

  // sliders: one drag sends ONE setting (not one per pixel)
  await page.evaluate(() => {
    window.__updates = 0;
    const orig = window.agent.update;
    window.agent.update = (p) => { window.__updates++; return orig(p); };
    const el = document.querySelector('[data-k="endSilenceMs"]');
    for (let v = 500; v <= 1400; v += 100) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(500);
  check(await page.evaluate(() => window.__updates === 1 && window.agent.settings.endSilenceMs === 1400), 'lab: dragging a slider sends a single setting, the last one', await page.evaluate(() => [window.__updates, window.agent.settings.endSilenceMs]));

  // a local setting applies without restarting (speed), another one asks for a restart (server)
  const r1 = await page.evaluate(() => window.agent.update({ localSpeed: 1.3 }));
  check(r1.needsRestart === false, 'lab: the local speed changes live');
  await page.evaluate(() => window.agent.update({ micMuted: false }));
  await page.click('#stop');
  check(await until(() => page.evaluate(() => window.agent.state === 'ended'), 3000), 'lab: Stop');
  await page.close();
}

// =========================== 2. the hub: the cables op and the examples follow the lab window ===========
{
  const web = await startStatic(ROOT);
  const hubUrl = `ws://127.0.0.1:${PORT}/events`;
  const lab = await browser.newPage();
  lab.on('pageerror', (e) => errors.push('lab (brain): ' + e));
  await lab.goto(base + '/');
  await lab.evaluate(() => {                        // what the lab window receives from its clients
    window.__ctx = []; window.__chosen = [];
    const ctx = window.agent.sendContext; window.agent.sendContext = (t) => { window.__ctx.push(t); return ctx(t); };
    const ch = window.agent.choose; window.agent.choose = (o) => { window.__chosen.push(o); return ch(o); };
  });
  const labState = () => lab.evaluate(() => window.agent.state);

  // the cables op
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('op: ' + e));
  await page.goto(`${web.url}/tests/op-harness.html`);
  await page.evaluate(() => window.ready);
  const port = (n) => page.evaluate((x) => window.P(x).get(), n);
  const set = (n, v) => page.evaluate(([x, val]) => window.P(x).set(val), [n, v]);
  const fire = (n) => page.evaluate((x) => window.fire(x), n);
  const uiError = (id) => page.evaluate((x) => (window.op.uiErrors[x] || {}).txt || '', id);
  await set('App address', 'ws://127.0.0.1:1/events');
  check(await until(async () => /Cannot reach the Voice Lab app/.test(await uiError('app')), 5000), 'op: a clear message when the app is not running', await uiError('app'));
  await set('App address', hubUrl);
  check(await until(async () => (await port('App connected')) === 1, 5000), 'op: connected to the app (the lab window is open)', await port('App connected'));
  check((await port('Agent name')) === (await lab.evaluate(() => window.agent.settings.name)), "op: shows the agent's name", await port('Agent name'));
  await fire('Start');
  check(await until(async () => ['listening', 'speaking'].includes(await labState()), 8000), 'op: "Start" starts the conversation in the lab window', await labState());
  check(await until(async () => ['listening', 'hearing', 'thinking', 'speaking'].includes(await port('State')), 4000), "op: follows the lab window's state", await port('State'));
  check(await until(async () => (await port('Last user text')).length > 0, 12000), 'op: what the person said (heard by the lab window) arrives', await port('Last user text'));
  check(await until(async () => (await page.evaluate(() => window.P('On reply start').triggered)) >= 1, 12000), 'op: the agent replies (On reply start)');
  // each simulated conversation replays the same script: the 1st reply offers choices and a mood
  check(await until(async () => (await port('Choices'))?.join('|') === 'Painting|Sculpture' && (await port('Mood')) === 'happy', 6000),
    'op: choices and mood arrive on the ports', [await port('Choices'), await port('Mood')]);
  check(await until(async () => (await port('Mic level')) > 0 || (await port('Voice level')) > 0, 6000), 'op: the levels arrive', [await port('Mic level'), await port('Voice level')]);
  await set('Choice index', 1);
  await fire('Choose');
  check(await until(() => lab.evaluate(() => window.__chosen[0] === 'Sculpture'), 3000), 'op: "Choose" picks a choice in the lab window', await lab.evaluate(() => window.__chosen));
  await set('Context', 'The visitor is in room 2.');
  await fire('Send context');
  check(await until(() => lab.evaluate(() => window.__ctx.includes('The visitor is in room 2.')), 3000), 'op: "Send context" reaches the agent', await lab.evaluate(() => window.__ctx));
  await fire('Stop');
  check(await until(async () => (await labState()) === 'ended' && (await port('State')) === 'ended', 4000), 'op: "Stop" stops the conversation', [await labState(), await port('State')]);

  // the examples, served over HTTP (a double-clicked file is refused) and pointed at this test server
  const serveExample = (p) => p.route('**/examples/**/*.js', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('ws://localhost:8790/events', hubUrl) });
  });
  const html = await browser.newPage();
  html.on('pageerror', (e) => errors.push('html example: ' + e));
  await serveExample(html);
  await html.goto(`${web.url}/examples/html-css-js/index.html`);
  check(await until(async () => /Connected to/.test(await html.textContent('#app')), 5000), 'html example: connected to the app', await html.textContent('#app'));
  await html.click('#start');
  check(await until(async () => ['listening', 'speaking'].includes(await labState()), 8000), 'html example: Start starts the lab window', await labState());
  check(await until(async () => ['listening', 'hearing', 'thinking', 'speaking'].includes(await html.getAttribute('#orb', 'class')), 4000), 'html example: the orb follows the state', await html.getAttribute('#orb', 'class'));
  await html.fill('#context', 'The visitor is in room 3.');
  await html.click('#contextForm button');
  check(await until(() => lab.evaluate(() => window.__ctx.includes('The visitor is in room 3.')), 3000), 'html example: the context reaches the agent');
  await html.click('#stop');
  check(await until(async () => (await labState()) === 'ended', 4000), 'html example: Stop');

  const p5 = await browser.newPage();
  p5.on('pageerror', (e) => errors.push('p5 example: ' + e));
  await serveExample(p5);
  await p5.goto(`${web.url}/examples/p5js/index.html`);
  check(await until(() => p5.evaluate(() => typeof agent !== 'undefined' && agent.app === true), 8000), 'p5 example: connected to the app (p5.js from its CDN)');
  await p5.mouse.click(100, 100);
  check(await until(async () => ['listening', 'speaking'].includes(await labState()), 8000), 'p5 example: a click starts the conversation', await labState());
  await p5.keyboard.press('2');
  check(await until(() => lab.evaluate(() => window.__ctx.includes('The visitor is now in room 2.')), 3000), 'p5 example: key 2 sends the context', await lab.evaluate(() => window.__ctx));
  await p5.mouse.click(100, 100);
  check(await until(async () => (await labState()) === 'ended', 4000), 'p5 example: a second click stops it', await labState());

  // the lab window closes: every client knows it
  await lab.close();
  check(await until(async () => (await port('App connected')) === 0, 4000), 'op: the lab window closes → "App connected" goes to 0');
  check(await until(async () => /window is closed/.test(await html.textContent('#app')), 4000), 'html example: says the lab window is closed', await html.textContent('#app'));
  for (const p of [page, html, p5]) await p.close();
  web.close();
}

await browser.close();

// =========================== 3. the lab window: talking over the agent (a short "mm-hm") ==============
// Another fake mic: 2.5 s of room noise, a 300 ms burst (the simulated engine hears "Mm-hmm."), then silence.
/** Sets a lab window field as a person would (its input/change events). */
const setField = (page, key, value) => page.evaluate(([k, v]) => {
  const el = document.querySelector(`[data-k="${k}"]`);
  if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [key, value]);
{
  const browser2 = await launch(makeFakeMicWav(join(tmpdir(), 'voice-fake-mic-burst.wav'), { lead: 2.5, speech: 0.3, tail: 12 }));
  const page = await browser2.newPage();
  page.on('pageerror', (e) => errors.push('lab (duck): ' + e));
  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.evaluate(() => { window.__ev = []; window.agent.on('*', (e) => window.__ev.push({ type: e.type, state: e.state, t: e.t, reason: e.reason, text: e.text, by: e.by })); });
  await setField(page, 'greeting', 'Hello there, I am ready to tell you a long story about this whole gallery and all of its paintings.');
  await setField(page, 'interruptAfterMs', 700);
  check(await page.evaluate(() => document.querySelector('[data-out="interruptAfterMs"]').textContent === '700 ms' && window.agent.settings.interruptAfterMs === 700),
    'lab: the "Talk over it this long to interrupt (ms)" slider sets interruptAfterMs');
  await page.click('#start');
  // sample the duck factor and the voice gain every 10 ms
  await page.evaluate(() => { window.__duck = []; window.__duckTimer = setInterval(() => { const d = window.agent.debug(); window.__duck.push({ duck: d.duck, gain: d.gain, state: d.state }); }, 10); });
  const evs = () => page.evaluate(() => window.__ev);
  const cancelled = await until(async () => (await evs()).find((e) => e.type === 'interruption.cancelled'), 12000);
  await sleep(400);
  await page.evaluate(() => clearInterval(window.__duckTimer));
  const all = await evs();
  const pending = all.find((e) => e.type === 'interruption.pending');
  check(pending && pending.by === 'user' && pending.state === 'speaking', 'lab: a short burst over the agent → interruption.pending', all.map((e) => e.type).slice(0, 20));
  const iPending = all.findIndex((e) => e.type === 'interruption.pending');
  const iCancelled = all.findIndex((e) => e.type === 'interruption.cancelled');
  check(cancelled && cancelled.reason === 'backchannel' && cancelled.text === 'Mm-hmm.' && iPending >= 0 && iPending < iCancelled, 'lab: then interruption.cancelled (backchannel "Mm-hmm.")', cancelled);
  check(!all.some((e) => e.type === 'interrupted') && !all.some((e) => e.type === 'user.text'), 'lab: no interruption, no user turn');
  const samples = await page.evaluate(() => window.__duck);
  const low = samples.findIndex((x) => x.duck === 0.3);
  const minGain = Math.min(...samples.map((x) => x.gain));
  const lastGain = samples[samples.length - 1].gain;
  check(low >= 0 && minGain < 0.45 && samples.slice(low).some((x) => x.duck === 1), `lab: the voice goes down (gain ${minGain.toFixed(2)})…`, { low, minGain });
  check(lastGain > 0.95 && samples[samples.length - 1].duck === 1, `lab: …and back up (gain ${lastGain.toFixed(2)}), shown by agent.debug().duck`, lastGain);
  check(await until(async () => (await evs()).some((e) => e.type === 'bot.end'), 12000), 'lab: the agent finishes what it was saying');
  await page.click('#stop');
  await page.close();
  await browser2.close();
}

// =========================== 4. the lab window: a slow model (fillers), a silent person (away) ==========
// A 2nd simulated server whose model takes 1.5 s more to answer (MOCK_LLM_DELAY_MS), and a mic with no speech.
{
  const PORT2 = 20500 + Math.floor(Math.random() * 400);
  const srv2 = spawn(process.execPath, [join(ROOT, '2_qvac_local', 'src', 'server.mjs'), '--mock', '--port', String(PORT2)],
    { env: { ...process.env, MOCK_LLM_DELAY_MS: '1500' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv2.stdout.on('data', (d) => serverLog.push('[slow] ' + String(d)));
  srv2.stderr.on('data', (d) => serverLog.push('[slow] ' + String(d)));
  const base2 = `http://127.0.0.1:${PORT2}`;
  await until(async () => { try { return (await (await fetch(`${base2}/health`)).json()).models === 'ready'; } catch { return false; } }, 10000);
  const browser3 = await launch(makeFakeMicWav(join(tmpdir(), 'voice-fake-mic-quiet.wav'), { lead: 1, speech: 0, tail: 5 }));
  const page = await browser3.newPage();
  page.on('pageerror', (e) => errors.push('lab (slow): ' + e));
  await page.goto(base2 + '/');
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.evaluate(() => { window.__ev = []; window.agent.on('*', (e) => window.__ev.push(JSON.parse(JSON.stringify(e)))); });
  const evs = () => page.evaluate(() => window.__ev);
  // — the local voice engine: Parler hides the preset voices and shows its description —
  const shown = (sel) => page.evaluate((x) => { const el = document.querySelector(x).closest('label'); return el.style.display !== 'none'; }, sel);
  check(await shown('#localVoices') && !(await shown('[data-k="voiceDescription"]')), 'lab: Supertonic: the F/M voice picker is shown, no description');
  await setField(page, 'localVoiceEngine', 'parler');
  check(!(await shown('#localVoices')) && (await shown('[data-k="voiceDescription"]')) && !(await shown('[data-k="localSpeed"]')) && (await page.evaluate(() => window.agent.settings.localVoiceEngine)) === 'parler',
    'lab: "Local voice engine" → Parler: "Voice description (Parler)" shown, voice picker hidden');
  await setField(page, 'localVoiceEngine', 'chatterbox');
  check(!(await shown('#localVoices')) && !(await shown('[data-k="voiceDescription"]')) && (await shown('[data-k="localSpeed"]')), 'lab: Chatterbox: no voice picker, no description, a speed');
  await setField(page, 'localVoiceEngine', 'supertonic');
  // — spoken fillers —
  await setField(page, 'greeting', '');
  await setField(page, 'fillerLines', 'Hmm, let me see…');
  await setField(page, 'fillerAfterMs', 600);
  check(await page.evaluate(() => window.agent.settings.fillerLines === 'Hmm, let me see…' && window.agent.settings.fillerAfterMs === 600
    && document.querySelector('[data-out="fillerAfterMs"]').textContent === '600 ms'), 'lab: "Filler lines (said while it thinks, separated by |)" and "Say a filler after (ms)" set the fillers');
  await page.click('#start');
  check(await until(() => page.evaluate(() => window.agent.state === 'listening'), 8000), 'lab (slow model): conversation open');
  await sleep(600);                                          // the server synthesizes the filler in the background
  await page.evaluate(() => { window.__lv = []; window.__lvTimer = setInterval(() => window.__lv.push({ state: window.agent.state, bot: window.agent.levels().bot }), 20); });
  await page.fill('#sayText', 'Tell me about the storm.');
  await page.click('#sayForm button');
  const turnEv = await until(async () => (await evs()).find((e) => e.type === 'turn' && /storm/.test(e.user || '')), 15000);
  await page.evaluate(() => clearInterval(window.__lvTimer));
  {
    const all = await evs();
    const iFiller = all.findIndex((e) => e.type === 'bot.filler');
    const iStart = all.findIndex((e, i) => e.type === 'bot.start' && i > iFiller);
    const filler = all[iFiller];
    check(filler && filler.state === 'thinking' && filler.text === 'Hmm, let me see…', 'lab: the bot.filler event fires while the agent is "thinking"', filler);
    const iState = all.findIndex((e, i) => e.type === 'state' && i > iFiller);           // the first state change after the filler
    check(iFiller >= 0 && iStart > iFiller && all[iState].state === 'speaking' && iState === iStart - 1,
      'lab: then bot.start (the filler is not the start of the reply)', all.slice(Math.max(0, iFiller - 2), iStart + 1).map((e) => e.type + ':' + e.state));
    const ms = (turnEv && turnEv.ms) || {};
    check(ms.filler >= 500 && ms.firstSound > ms.filler && all[iStart].waitMs === ms.firstSound,
      `lab: the turn measures include filler (${ms.filler} ms) < firstSound (${ms.firstSound} ms, the reply's wait)`, ms);
    const lv = await page.evaluate(() => window.__lv);
    const maxThinking = Math.max(0, ...lv.filter((x) => x.state === 'thinking').map((x) => x.bot));
    check(maxThinking > 0.02, `lab: the filler plays through the voice output (level ${maxThinking.toFixed(2)} while thinking)`);
  }
  await until(() => page.evaluate(() => window.agent.state === 'listening'), 15000);

  // — the person stays silent: user.away, and the reprompt line said once (through {type:'say'}) —
  const n0 = (await evs()).length;
  await setField(page, 'repromptLine', 'Are you still there?');
  await setField(page, 'awayAfterMs', 1500);
  check(await page.evaluate(() => window.agent.settings.awayAfterMs === 1500 && document.querySelector('[data-out="awayAfterMs"]').textContent === '1500 ms'),
    'lab: "Away after (ms)" and "Reprompt line (said once when the person stays silent)" set the away settings');
  const second = await until(async () => (await evs()).slice(n0).filter((e) => e.type === 'user.away').length >= 2, 12000);
  {
    const after = (await evs()).slice(n0);
    const aways = after.filter((e) => e.type === 'user.away');
    const iAway1 = after.findIndex((e) => e.type === 'user.away');
    const iAway2 = after.findIndex((e, i) => e.type === 'user.away' && i > iAway1);
    const between = after.slice(iAway1, iAway2);
    const end = between.find((e) => e.type === 'bot.end');
    check(aways[0] && aways[0].count === 1 && aways[0].afterMs === 1500 && aways[0].state === 'listening', 'lab: user.away (count 1) after 1.5 s of silence', aways[0]);
    check(between.some((e) => e.type === 'bot.start') && end && end.text === 'Are you still there?', 'lab: the agent says the reprompt line ({type:"say"}: an agent turn)', between.map((e) => e.type));
    check(second && aways[1].count === 2 && !after.slice(iAway2).some((e) => e.type === 'bot.start'), 'lab: user.away again (count 2), without speaking', aways.map((e) => e.count));
    check(!after.some((e) => e.type === 'user.text' || e.type === 'user.start'), 'lab: no user turn');
  }
  await setField(page, 'awayAfterMs', 0);
  await page.click('#stop');
  await page.close();
  await browser3.close();
  srv2.kill();
}

check(errors.length === 0, 'no JavaScript error', errors.slice(0, 5));
srv.kill();
const failed = summary();
if (failed) console.log('\n--- server log ---\n' + serverLog.join('').slice(-3000));
process.exit(failed ? 1 : 0);
