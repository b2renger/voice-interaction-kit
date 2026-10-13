// VoiceAgent — cables.gl op: follows the conversation running in the Voice Lab app, and drives it.
// The app is the brain: it listens, thinks and speaks (local QVAC engine or Gemini Live), with its persona,
// knowledge and settings. This op is one of its clients, like a p5.js sketch or a web page: it gets the
// states, texts, levels, choices and mood, and sends Start, Stop, text, context, choices.
// Paste ALL of this file into the op's code editor. The Voice Lab app must be open on this computer.
// How to use: 1_cables_gemini_live/README.md. The messages: CONTRACT.md, "The clients protocol".

// ---- Connection ---------------------------------------------------------------
const inUrl = op.inString('App address', 'ws://localhost:8790/events');
const inStart = op.inTriggerButton('Start');
const inStop = op.inTriggerButton('Stop');
op.setPortGroup('Connection', [inUrl, inStart, inStop]);

// ---- Actions (calls to action) -------------------------------------------------
const inText = op.inString('Text', '');
const inSendText = op.inTriggerButton('Send text');
const inContext = op.inString('Context', '');
const inSendContext = op.inTriggerButton('Send context');
const inChoiceIndex = op.inInt('Choice index', 0);
const inChoose = op.inTriggerButton('Choose');
const inInterrupt = op.inTriggerButton('Interrupt');
const inToolResult = op.inString('Tool result', '');
const inSendToolResult = op.inTriggerButton('Send tool result');
op.setPortGroup('Actions', [inText, inSendText, inContext, inSendContext, inChoiceIndex, inChoose, inInterrupt, inToolResult, inSendToolResult]);

// Render → Next: kept so the op can sit in a render chain, as before.
const inRender = op.inTrigger('Render');
op.setPortGroup('Advanced', [inRender]);

// ---- Outputs ------------------------------------------------------------------
const outNext = op.outTrigger('Next');
const outApp = op.outBoolNum('App connected');
const outName = op.outString('Agent name');
const outEngine = op.outString('Engine');
const outState = op.outString('State');
const outConnected = op.outBoolNum('Connected');
const outListening = op.outBoolNum('Listening');
const outHearing = op.outBoolNum('Hearing');
const outThinking = op.outBoolNum('Thinking');
const outSpeaking = op.outBoolNum('Speaking');
const outUserLevel = op.outNumber('Mic level');
const outBotLevel = op.outNumber('Voice level');
const outUserText = op.outString('User text');
const outBotText = op.outString('Agent text');
const outLastUser = op.outString('Last user text');
const outLastBot = op.outString('Last agent reply');
const outConversation = op.outArray('Conversation');
const outChoices = op.outArray('Choices');
const outQuestion = op.outString('Question');
const outMood = op.outString('Mood');
const outToolCall = op.outObject('Tool call');
const outToolName = op.outString('Tool name');
const outWait = op.outNumber('Wait (ms)');
const outTurnProb = op.outNumber('Turn probability (local)');
const outTiming = op.outObject('Turn timing');
const outStatus = op.outString('Status');
const outError = op.outString('Error');
const outEvent = op.outObject('Event');

const trig = {
  any: op.outTrigger('On event'),
  state: op.outTrigger('On state change'),
  userStart: op.outTrigger('On user start'),
  userEnd: op.outTrigger('On user end'),
  away: op.outTrigger('On away'),
  thinking: op.outTrigger('On thinking'),
  botStart: op.outTrigger('On reply start'),
  botEnd: op.outTrigger('On reply end'),
  filler: op.outTrigger('On filler'),
  interrupted: op.outTrigger('On interruption'),
  interruptPending: op.outTrigger('On interruption pending'),
  interruptCancelled: op.outTrigger('On interruption cancelled'),
  notUnderstood: op.outTrigger('On not understood'),
  turn: op.outTrigger('On turn'),
  choices: op.outTrigger('On choices'),
  mood: op.outTrigger('On mood'),
  tool: op.outTrigger('On tool call'),
  error: op.outTrigger('On error'),
};

// ---- what the app sends --------------------------------------------------------
let choices = [];
let conversation = [];

function paintState(s) {
  outState.set(s);
  outConnected.set(['listening', 'hearing', 'thinking', 'speaking'].indexOf(s) >= 0);
  outListening.set(s === 'listening');
  outHearing.set(s === 'hearing');
  outThinking.set(s === 'thinking');
  outSpeaking.set(s === 'speaking');
  op.setUiAttrib({ extendTitle: s });
}
paintState('idle');

function showChoices(question, options) {
  choices = Array.isArray(options) ? options : [];
  outQuestion.set(question || '');
  outChoices.setRef(choices);
}

/** The snapshot sent on connecting, and again when the lab window opens or closes. */
function onHello(m) {
  outApp.set(!!m.app);
  op.setUiError('app', m.app ? null : 'The Voice Lab app is running, but its window is closed.', 1);
  outName.set(m.name || '');
  outEngine.set(m.engine || '');
  paintState(m.state || 'idle');
  outLastUser.set(m.userText || '');
  outLastBot.set(m.botText || '');
  showChoices(m.question, m.choices);
  outMood.set(m.mood || 'neutral');
  outStatus.set(m.status || '');
  outUserLevel.set((m.levels && m.levels.user) || 0);
  outBotLevel.set((m.levels && m.levels.bot) || 0);
}

const handlers = {
  state: (ev) => {
    paintState(ev.state);
    if (ev.state === 'connecting') { outError.set(''); op.setUiError('error', null); }
    trig.state.trigger();
  },
  connecting: () => { conversation = []; outConversation.setRef(conversation); },
  start: (ev) => outEngine.set(ev.engine || ''),
  status: (ev) => { outStatus.set(ev.text); op.setUiError('status', ev.text ? ev.text : null, 0); },
  'user.start': () => { outUserText.set(''); trig.userStart.trigger(); },
  'user.partial': (ev) => outUserText.set(ev.text),
  'user.text': (ev) => { outUserText.set(ev.text); outLastUser.set(ev.text); },
  'user.end': () => trig.userEnd.trigger(),
  'user.away': () => trig.away.trigger(),
  thinking: () => { outBotText.set(''); showChoices('', []); trig.thinking.trigger(); },
  'bot.start': (ev) => { if (ev.waitMs != null) outWait.set(ev.waitMs); trig.botStart.trigger(); },
  'bot.text': (ev) => outBotText.set(ev.text),
  'bot.end': (ev) => { outLastBot.set(ev.text); trig.botEnd.trigger(); },
  'bot.filler': () => trig.filler.trigger(),
  interrupted: () => trig.interrupted.trigger(),
  'interruption.pending': () => trig.interruptPending.trigger(),
  'interruption.cancelled': () => trig.interruptCancelled.trigger(),
  'not.understood': () => trig.notUnderstood.trigger(),
  turn: (ev) => {
    const rec = Object.assign({}, ev); delete rec.type; delete rec.state; delete rec.t;
    conversation = conversation.concat([rec]);
    outTiming.setRef(ev.ms);
    outConversation.setRef(conversation);
    trig.turn.trigger();
  },
  'ui.choices': (ev) => { showChoices(ev.question, ev.options); trig.choices.trigger(); },
  'ui.mood': (ev) => { outMood.set(ev.mood); trig.mood.trigger(); },
  'turn.prediction': (ev) => outTurnProb.set(ev.probability),
  'tool.call': (ev) => {
    outToolName.set(ev.name);
    outToolCall.setRef({ id: ev.id, name: ev.name, args: ev.args });
    trig.tool.trigger();
  },
  error: (ev) => {
    outError.set(ev.message);
    op.setUiError('error', ev.message, ev.fatal ? 2 : 1);
    trig.error.trigger();
  },
  ended: () => {
    outUserLevel.set(0); outBotLevel.set(0);
    op.setUiError('status', null);
  },
};

// ---- the connection to the app (it comes back on its own) ------------------------
let ws = null;
let retry = 0;
let closed = false;

function connect() {
  clearTimeout(retry);
  if (ws) { ws.onclose = null; ws.close(); }
  const url = String(inUrl.get() || '');
  try { ws = new WebSocket(url); } catch (e) { op.setUiError('app', 'Invalid app address: ' + url, 2); return; }
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.type === 'hello') return onHello(m);
    if (m.type === 'levels') { outUserLevel.set(m.user); outBotLevel.set(m.bot); return; }
    outEvent.setRef(m);
    if (handlers[m.type]) handlers[m.type](m);
    trig.any.trigger();
  };
  ws.onclose = () => {
    outApp.set(false);
    op.setUiError('app', 'Cannot reach the Voice Lab app at ' + url + ': open the app (it reconnects on its own).', 1);
    if (!closed) retry = setTimeout(connect, 2000);
  };
}
connect();
inUrl.onChange = connect;

function send(m) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
  op.setUiError('error', 'Not connected to the Voice Lab app.', 1);
  return false;
}

// ---- the inputs: commands for the app --------------------------------------------
inStart.onTriggered = () => send({ type: 'start' });
inStop.onTriggered = () => send({ type: 'stop' });
inInterrupt.onTriggered = () => send({ type: 'interrupt' });
inSendText.onTriggered = () => { if (String(inText.get() || '').trim()) send({ type: 'text', text: String(inText.get()) }); };
inSendContext.onTriggered = () => { if (String(inContext.get() || '').trim()) send({ type: 'context', text: String(inContext.get()) }); };
inChoose.onTriggered = () => {
  const i = Math.round(Number(inChoiceIndex.get()) || 0);
  if (choices[i] !== undefined) send({ type: 'choose', option: String(choices[i]) });
};
inSendToolResult.onTriggered = () => {
  const call = outToolCall.get();
  if (!call || !call.id) return;
  let result = inToolResult.get();
  try { result = JSON.parse(result); } catch (e) { /* plain text */ }
  send({ type: 'tool.result', id: call.id, result });
};
inRender.onTriggered = () => outNext.trigger();

op.onDelete = () => {
  closed = true;
  clearTimeout(retry);
  if (ws) { ws.onclose = null; ws.close(); }
};
