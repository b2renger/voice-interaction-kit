// =============================================================================
// The ports of the cables.gl "VoiceAgent" op.
// (build.mjs pastes this file AFTER common/voice-core.js; the result,
//  VoiceAgent.op.js, is what you paste into the cables op editor.)
// =============================================================================

// ---- dropdown labels ↔ core values -------------------------------------------
const ENGINE_LABELS = { 'Gemini Live': 'gemini', 'Local (QVAC)': 'local' };
const SENS_LABELS = { 'high': 'high', 'low': 'low' };
const EARCON_LABELS = { 'off': 'off', 'soft': 'soft', 'clear': 'clear' };
const THINK_LABELS = { 'off': 'off', 'tick': 'tick', 'hum': 'hum' };
const TURN_LABELS = { 'silence only': 'silence', 'silence + Smart Turn': 'smart' };
const VOICE_ENGINE_LABELS = { 'Supertonic': 'supertonic', 'Parler': 'parler', 'Chatterbox': 'chatterbox' };
const D = VoiceCore.DEFAULTS;
const KEY_STORE = 'voiceAgent.geminiKey';

// ---- Connection ---------------------------------------------------------------
const inEngine = op.inDropDown('Engine', Object.keys(ENGINE_LABELS), 'Gemini Live');
const inStart = op.inTriggerButton('Start');
const inStop = op.inTriggerButton('Stop');
const inModel = op.inString('Gemini model', D.geminiModel);
const inApiKey = op.inString('Gemini API key', '');
const inRemember = op.inBool('Remember key (this browser)', false);
const inTokenUrl = op.inString('Token server', '');
const inServerUrl = op.inString('Local server', D.serverUrl);
inApiKey.ignoreValueSerialize = true;           // the key is NEVER saved in the patch
op.setPortGroup('Connection', [inEngine, inStart, inStop, inModel, inApiKey, inRemember, inTokenUrl, inServerUrl]);

// ---- Persona ------------------------------------------------------------------
const inName = op.inString('Name', D.name);
const inPersona = op.inStringEditor('Persona', D.persona, 'text');
const inLanguage = op.inDropDown('Language', Object.keys(VoiceCore.LANGUAGES), D.language);
const inGreeting = op.inString('Greeting', D.greeting);
const inShort = op.inBool('Short answers', D.shortAnswers);
const inCreativity = op.inFloatSlider('Creativity', D.creativity, 0, 2);
op.setPortGroup('Persona', [inName, inPersona, inLanguage, inGreeting, inShort, inCreativity]);

// ---- Voice --------------------------------------------------------------------
const inGeminiVoice = op.inDropDown('Gemini voice', VoiceCore.GEMINI_VOICES.map((v) => v[0]), D.geminiVoice);
const inStyle = op.inString('Speaking style (Gemini)', D.speakingStyle);
const inVoiceEngine = op.inDropDown('Local voice engine', Object.keys(VOICE_ENGINE_LABELS), 'Supertonic');
const inLocalVoice = op.inDropDown('Local voice', VoiceCore.LOCAL_VOICES, D.localVoice);
const inLocalSpeed = op.inFloatSlider('Speed (local)', D.localSpeed, 0.5, 2);
const inVoiceDesc = op.inString('Voice description (Parler)', D.voiceDescription);
const inVolume = op.inFloatSlider('Volume', D.volume, 0, 2);
const inPlayVoice = op.inBool('Play through speakers', D.playVoice);
op.setPortGroup('Voice', [inGeminiVoice, inStyle, inVoiceEngine, inLocalVoice, inLocalSpeed, inVoiceDesc, inVolume, inPlayVoice]);

// ---- Turn-taking --------------------------------------------------------------
const inEndSilence = op.inInt('End silence (ms)', D.endSilenceMs);
const inStartSens = op.inDropDown('Start sensitivity', Object.keys(SENS_LABELS), 'high');
const inEndSens = op.inDropDown('End sensitivity', Object.keys(SENS_LABELS), 'high');
const inInterruptible = op.inBool('Interruptible', D.interruptible);
const inListenWhile = op.inBool('Listen while speaking', D.listenWhileSpeaking);
const inMicMuted = op.inBool('Mic muted', D.micMuted);
const inTurnDetect = op.inDropDown('End of turn (local)', Object.keys(TURN_LABELS), 'silence only');
const inInterruptAfter = op.inInt('Interrupt after (ms) (local)', D.interruptAfterMs);
const inAwayAfter = op.inInt('Away after (ms)', D.awayAfterMs);
const inReprompt = op.inString('Reprompt line', D.repromptLine);
op.setPortGroup('Turn-taking', [inEndSilence, inStartSens, inEndSens, inInterruptible, inListenWhile, inMicMuted, inTurnDetect,
  inInterruptAfter, inAwayAfter, inReprompt]);

// ---- Feedback -----------------------------------------------------------------
const inReplyDelay = op.inInt('Reply delay (ms)', D.replyDelayMs);
const inEarcons = op.inDropDown('Earcons', Object.keys(EARCON_LABELS), 'soft');
const inThinking = op.inDropDown('Thinking sound', Object.keys(THINK_LABELS), 'off');
const inRepair = op.inString('Repair line (local)', D.repairLine);
const inFillerLines = op.inString('Filler lines (local)', D.fillerLines);
const inFillerAfter = op.inInt('Filler after (ms) (local)', D.fillerAfterMs);
op.setPortGroup('Feedback', [inReplyDelay, inEarcons, inThinking, inRepair, inFillerLines, inFillerAfter]);

// ---- Actions (calls to action) -------------------------------------------------
const inUiTools = op.inBool('On-screen choices and mood', D.uiTools);
const inTools = op.inStringEditor('Tools (JSON)', '', 'json');
const inText = op.inString('Text', '');
const inSendText = op.inTriggerButton('Send text');
const inContext = op.inString('Context', '');
const inSendContext = op.inTriggerButton('Send context');
const inChoiceIndex = op.inInt('Choice index', 0);
const inChoose = op.inTriggerButton('Choose');
const inInterrupt = op.inTriggerButton('Interrupt');
const inToolResult = op.inString('Tool result', '');
const inSendToolResult = op.inTriggerButton('Send tool result');
op.setPortGroup('Actions', [inUiTools, inTools, inText, inSendText, inContext, inSendContext, inChoiceIndex, inChoose, inInterrupt, inToolResult, inSendToolResult]);

// ---- Advanced -----------------------------------------------------------------
const inRender = op.inTrigger('Render');
const inEndpoint = op.inString('Gemini endpoint (advanced)', '');
op.setPortGroup('Advanced', [inRender, inEndpoint]);

// ---- Outputs ------------------------------------------------------------------
const outNext = op.outTrigger('Next');
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
const outVoiceNode = op.outObject('Voice (audio)', null, 'audioNode');
const outMicNode = op.outObject('Mic (audio)', null, 'audioNode');

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

// ---- the remembered key -------------------------------------------------------
function storage() { try { return window.localStorage; } catch (e) { return null; } }
(function restoreKey() {
  const st = storage();
  const saved = st ? st.getItem(KEY_STORE) : null;
  if (saved && !inApiKey.get()) inApiKey.set(saved);
})();
function rememberKey() {
  const st = storage();
  if (!st) return;
  if (inRemember.get() && inApiKey.get()) st.setItem(KEY_STORE, String(inApiKey.get()));
  if (!inRemember.get()) st.removeItem(KEY_STORE);
}

// ---- the settings read from the ports -----------------------------------------
function readSettings() {
  return {
    engine: ENGINE_LABELS[inEngine.get()] || 'gemini',
    name: String(inName.get() || ''),
    persona: String(inPersona.get() || ''),
    language: String(inLanguage.get() || 'en'),
    greeting: String(inGreeting.get() || ''),
    shortAnswers: !!inShort.get(),
    creativity: Number(inCreativity.get()),
    speakingStyle: String(inStyle.get() || ''),
    geminiVoice: String(inGeminiVoice.get() || D.geminiVoice),
    localVoiceEngine: VOICE_ENGINE_LABELS[inVoiceEngine.get()] || 'supertonic',
    localVoice: String(inLocalVoice.get() || D.localVoice),
    voiceDescription: String(inVoiceDesc.get() || ''),
    localSpeed: Number(inLocalSpeed.get()),
    volume: Number(inVolume.get()),
    playVoice: !!inPlayVoice.get(),
    endSilenceMs: Number(inEndSilence.get()),
    startSensitivity: SENS_LABELS[inStartSens.get()] || 'high',
    endSensitivity: SENS_LABELS[inEndSens.get()] || 'high',
    turnDetection: TURN_LABELS[inTurnDetect.get()] || 'silence',
    interruptAfterMs: Number(inInterruptAfter.get()) || 0,
    interruptible: !!inInterruptible.get(),
    listenWhileSpeaking: !!inListenWhile.get(),
    micMuted: !!inMicMuted.get(),
    awayAfterMs: Number(inAwayAfter.get()) || 0,
    repromptLine: String(inReprompt.get() || ''),
    replyDelayMs: Number(inReplyDelay.get()),
    earcons: EARCON_LABELS[inEarcons.get()] || 'soft',
    thinkingSound: THINK_LABELS[inThinking.get()] || 'off',
    repairLine: String(inRepair.get() || ''),
    fillerLines: String(inFillerLines.get() || ''),
    fillerAfterMs: Number(inFillerAfter.get()) || 0,
    uiTools: !!inUiTools.get(),
    extraTools: String(inTools.get() || ''),
    geminiModel: String(inModel.get() || D.geminiModel),
    apiKey: String(inApiKey.get() || ''),
    tokenUrl: String(inTokenUrl.get() || ''),
    geminiEndpoint: String(inEndpoint.get() || ''),
    serverUrl: String(inServerUrl.get() || D.serverUrl),
  };
}

// ---- the agent ----------------------------------------------------------------
function sharedAudioContext() {
  if (typeof CABLES !== 'undefined' && CABLES.WEBAUDIO && CABLES.WEBAUDIO.createAudioContext) return CABLES.WEBAUDIO.createAudioContext(op);
  if (!window.audioContext) window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return window.audioContext;
}
const agent = VoiceCore.createVoiceAgent({ settings: readSettings(), getAudioContext: sharedAudioContext });
op.voiceAgent = agent;                          // for a JavaScript op that wants to go further
let choices = [];

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

const offs = [
  agent.on('*', (ev) => { outEvent.setRef(ev); trig.any.trigger(); }),
  agent.on('state', (ev) => {
    paintState(ev.state);
    if (ev.state === 'connecting') { outError.set(''); op.setUiError('error', null); }
    trig.state.trigger();
  }),
  agent.on('start', () => {
    outVoiceNode.setRef(agent.outputNode);
    outMicNode.setRef(agent.micNode);
    op.setUiError('restart', null);
  }),
  agent.on('status', (ev) => {
    outStatus.set(ev.text);
    op.setUiError('status', ev.text ? ev.text : null, 0);
  }),
  agent.on('user.start', () => { outUserText.set(''); trig.userStart.trigger(); }),
  agent.on('user.partial', (ev) => outUserText.set(ev.text)),
  agent.on('user.text', (ev) => { outUserText.set(ev.text); outLastUser.set(ev.text); }),
  agent.on('user.end', () => trig.userEnd.trigger()),
  agent.on('user.away', () => trig.away.trigger()),
  agent.on('thinking', () => { outBotText.set(''); trig.thinking.trigger(); }),
  agent.on('bot.start', (ev) => { if (ev.waitMs != null) outWait.set(ev.waitMs); trig.botStart.trigger(); }),
  agent.on('bot.text', (ev) => outBotText.set(ev.text)),
  agent.on('bot.end', (ev) => { outLastBot.set(ev.text); trig.botEnd.trigger(); }),
  agent.on('bot.filler', () => trig.filler.trigger()),
  agent.on('interrupted', () => trig.interrupted.trigger()),
  agent.on('interruption.pending', () => trig.interruptPending.trigger()),
  agent.on('interruption.cancelled', () => trig.interruptCancelled.trigger()),
  agent.on('not.understood', () => trig.notUnderstood.trigger()),
  agent.on('turn', (ev) => {
    outTiming.setRef(ev.ms);
    outConversation.setRef(agent.conversation());
    trig.turn.trigger();
  }),
  agent.on('ui.choices', (ev) => {
    choices = ev.options || [];
    outQuestion.set(ev.question || '');
    outChoices.setRef(choices);
    trig.choices.trigger();
  }),
  agent.on('ui.mood', (ev) => { outMood.set(ev.mood); trig.mood.trigger(); }),
  agent.on('turn.prediction', (ev) => outTurnProb.set(ev.probability)),
  agent.on('tool.call', (ev) => {
    outToolName.set(ev.name);
    outToolCall.setRef({ id: ev.id, name: ev.name, args: ev.args });
    trig.tool.trigger();
  }),
  agent.on('error', (ev) => {
    outError.set(ev.message);
    op.setUiError('error', ev.message, ev.fatal ? 2 : 1);
    trig.error.trigger();
  }),
  agent.on('ended', () => {
    outUserLevel.set(0); outBotLevel.set(0);
    op.setUiError('restart', null);
    op.setUiError('status', null);
  }),
];

// ---- the inputs -----------------------------------------------------------------
let pending = 0;
function settingsChanged() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    rememberKey();
    const r = agent.update(readSettings());
    if (r.needsRestart) op.setUiError('restart', 'Setting changed: click Start to restart the session with this setting.', 0);
  }, 150);
}
[inEngine, inModel, inApiKey, inRemember, inTokenUrl, inServerUrl, inName, inPersona, inLanguage, inGreeting, inShort, inCreativity,
  inGeminiVoice, inStyle, inLocalVoice, inLocalSpeed, inVolume, inPlayVoice, inEndSilence, inStartSens, inEndSens, inInterruptible,
  inListenWhile, inMicMuted, inReplyDelay, inEarcons, inThinking, inRepair, inUiTools, inTools, inEndpoint,
  inTurnDetect, inInterruptAfter, inFillerLines, inFillerAfter, inAwayAfter, inReprompt, inVoiceEngine, inVoiceDesc].forEach((p) => { p.onChange = settingsChanged; });

inStart.onTriggered = () => {
  clearTimeout(pending);
  rememberKey();
  op.setUiError('restart', null);
  agent.update(readSettings());
  agent.start();
};
inStop.onTriggered = () => agent.stop('stop');
inSendText.onTriggered = () => agent.sendText(inText.get());
inSendContext.onTriggered = () => agent.sendContext(inContext.get());
inInterrupt.onTriggered = () => agent.interrupt();
inChoose.onTriggered = () => {
  const i = Math.round(Number(inChoiceIndex.get()) || 0);
  if (choices[i] !== undefined) agent.choose(choices[i]);
};
inSendToolResult.onTriggered = () => {
  const call = outToolCall.get();
  if (!call || !call.id) return;
  let result = inToolResult.get();
  try { result = JSON.parse(result); } catch (e) { /* plain text */ }
  agent.sendToolResult(call.id, result);
};

// ---- on every frame: the levels ------------------------------------------------
function updateLevels() {
  const l = agent.levels();
  outUserLevel.set(l.user);
  outBotLevel.set(l.bot);
}
inRender.onTriggered = () => { updateLevels(); outNext.trigger(); };
op.onAnimFrame = updateLevels;

op.onDelete = () => {
  clearTimeout(pending);
  offs.forEach((f) => f());
  agent.stop('deleted');
  if (op.patch && op.patch.removeOnAnimFrame) op.patch.removeOnAnimFrame(op);
};
