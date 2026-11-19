// A conversation: what happens between a browser (the studio) and the local engine.
// Protocol: see CONTRACT.md ("Local engine"). Incoming audio: 16-bit PCM, mono, 16 kHz, in binary frames.
// Outgoing audio: binary frames [u32 sample rate][u32 turn id][16-bit mono PCM].
import { ReplyParser, systemPrompt, translatePrompt, LANGUAGES, heardNothing, speakable, trimHistory, classifyInterjection, refusalLine, outsideLine } from './text.mjs';
import { delay, clamp, num, progressText } from './util.mjs';
import { fill } from './agent/knowledge.mjs';
import { knowledgePrompt } from './agent/decide.mjs';
import { VOICE_KEYS } from './agent/voices.mjs';
import { oscArgs, oscTargets, sendOsc, listenOsc, oscPort, oscFires, oscValue, liveDataPrompt } from './osc.mjs';
import { voiced, MIN_SECONDS } from './speakers/speakers.mjs';

const DEFAULTS = {
  name: 'Ada', persona: '', language: 'en', greeting: '', shortAnswers: true, creativity: 1,
  localVoice: 'F1', localSpeed: 1, endSilenceMs: 800, startSensitivity: 'high', endSensitivity: 'high',
  interruptible: true, repairLine: '', replyDelayMs: 0, uiTools: true,
  turnDetection: 'silence', interruptAfterMs: 0, fillerLines: '', fillerAfterMs: 1200,
  localVoiceEngine: 'supertonic', voiceDescription: '',
  zonosVoice: '', voiceDesign: '',   // the Zonos voice: one of its voices (id or name), and its design ("age +1.5, deep 3")
  // the models (config.json "choices"; '' = the config's), or an LLM farm on the network instead of the local model
  // the language model: 'local' (QVAC: localLlm), or 'farm' / 'service' (llmUrl, llmModel, llmKey)
  localAsr: '', localLlm: '', llm: 'local', llmUrl: '', llmModel: '', llmKey: '',
  oscTo: '127.0.0.1:10000',      // where the patterns' OSC messages go (this computer's setting): "host:port, host:port"
  oscIn: '',                    // the UDP port sensors and buttons send OSC to (this computer's setting); '' = not listening
  agent: '',                    // the agent (its folder name): its knowledge and its patterns (docs/DESIGN.md)
};
const ASR_KEYS = ['language', 'endSilenceMs', 'startSensitivity', 'endSensitivity', 'localAsr'];
const LLM_KEYS = ['localLlm', 'llm'];        // a change loads (or frees) the local language model
const VOICE_ENGINES = ['supertonic', 'parler', 'chatterbox', 'zonos'];
const voiceEngine = (s) => (VOICE_ENGINES.includes(s.localVoiceEngine) ? s.localVoiceEngine : 'supertonic');
/** The settings a voice model is LOADED with (a change reloads it). Parler's description is per request. */
const TTS_KEYS = {
  supertonic: ['localVoiceEngine', 'language', 'localVoice', 'localSpeed'],
  parler: ['localVoiceEngine'],
  chatterbox: ['localVoiceEngine', 'language', 'localSpeed'],
  zonos: ['localVoiceEngine'],          // its voice and design go with each sentence; the switch checks its server
};
export const PARLER_ENGLISH_ONLY = 'Parler only speaks English: replies will sound English-accented.';
const parlerNotEnglish = (s) => voiceEngine(s) === 'parler' && (s.language || 'en') !== 'en';
const TEXT_GRACE_MS = 2500;   // if the end of turn arrives before the text, wait for it up to this long
// Smart Turn (turnDetection 'smart'): the audio of the turn, from a little before its first speech
const IN_RATE = 16000;
const PRE_SPEECH_SAMPLES = IN_RATE * 0.5;      // 500 ms before the first speech of the turn
const TURN_AUDIO_SAMPLES = IN_RATE * 8.5;      // at most 8.5 s (the model looks at the last 8 s)
export const SMART_TURN_UNAVAILABLE = 'Smart Turn is unavailable here: using silence only.';
// Talking over the agent with interruptAfterMs > 0: it lowers its voice ("duck") first
const DUCK_TEXT_WAIT_MS = 1500;   // after a short burst, wait this long (at most) for its text
// OSC in: the latest value of at most this many addresses; a pattern it fires speaks after this long a pause
const OSC_VALUES_MAX = 30;
export const OSC_PAUSE_MS = 1500;
const OSC_SHOW_MS = 200;          // {type:'osc.in'}: at most one per address in this time (the last one always)
// Spoken fillers ("Hmm, let me see…") while a slow reply is prepared: their audio frames carry this turn id
export const FILLER_TURN_ID = 0xFFFFFFFF;
const FILLER_CACHE = new Map();   // synthesized fillers, per voice and text (shared by the conversations)
const FILLER_CACHE_MAX = 40;
/** The filler phrases of the setting fillerLines ("Hmm, let me see…|Good question…"). */
/**
 * Who the language model is talking with (Settings → People), one sentence of the system prompt; '' for a moment
 * (nobody speaks). Measured with Qwen3 1.7B, a family of 4 in a car, French and English: this keeps the replies as
 * natural as with nobody recorded. A note after the person's words made it repeat their question; their name before
 * them ("[Léo] …") made it write "[Papa] …" itself; the list of everyone recognized made it narrate the family.
 * It rarely says a name by itself: {speaker} in a line to say does.
 */
export function peoplePrompt(speaker) {
  return speaker == null ? '' : speaker ? `You are talking with ${speaker} right now.` : 'You are talking with someone whose voice you do not recognize.';
}

export function fillerPhrases(lines) {
  return String(lines || '').split('|').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20);
}

export class Session {
  /**
   * @param {import('./ws.mjs').WebSocketConnection} ws
   * @param {any} engine @param {(fn: () => Promise<any>) => Promise<any>} prepareLock @param {(m: string) => void} log
   */
  constructor(ws, engine, prepareLock, log) {
    this.ws = ws; this.engine = engine; this.lock = prepareLock; this.log = log;
    this.s = { ...DEFAULTS };
    this.voice = null;            // the saved voice a pattern switched to ({id, name, settings}); null: the agent's own
    this.lang = '';               // the conversation's language when it is not the agent's (Talk, a pattern, a client)
    this.history = [];
    this.context = [];
    this.stage = '';              // the agent's current stage
    this.focus = null;            // the entry in focus {table, key}: the last one found
    this.asr = null;
    this.userText = '';
    this.eotTimer = 0;
    this.vadSpeaking = false;
    this.segPending = 0;          // finished speech segments whose text has not arrived yet
    this.turnId = 0;
    this.bot = null;              // the reply in progress: {id, phase, abort, gen, tts}
    this.pendingUser = null;      // what was heard while the agent was speaking (not interruptible)
    this.pendingSpeaker = null;   // … and who said it (Settings → People)
    this.started = false;
    this.closed = false;
    this.marks = {};
    // Smart Turn
    this.smart = null;            // the end-of-turn model, once ready
    this.smartLoading = false;
    this.smartWarned = false;     // "unavailable" was said once
    this.smartEnded = false;      // Smart Turn ended the turn: the engine's end of turn that follows is ignored
    this.turnSeq = 0;             // changes with each new speech and each finished turn (late predictions are dropped)
    this.turnAudio = { chunks: [], samples: 0, inTurn: false };
    // talking over the agent (interruptAfterMs > 0)
    this.duck = null;             // {turnId, prefix, timer, wait, eotSeen}: the agent's voice is lowered
    this.skipEot = false;         // the engine's end of turn that follows a backchannel or a "stop" is ignored
    // spoken fillers
    this.lastFiller = '';
    this.fillerJobs = new Map();  // syntheses in progress, per cache key
    this.warming = null;
    // OSC in (oscIn): the listener, the latest values, each pattern's memory, the patterns waiting for a pause
    this.oscIn = null;
    this.oscPort = 0;
    this.oscValues = new Map();   // address → {value, at}, the most recent last
    this.oscEdges = new Map();    // pattern id → {fired}
    this.oscQueue = new Map();    // pattern id → {address, value}: fired, waiting for a pause to speak
    this.oscShown = new Map();    // address → {at, timer, args}
    this.oscTimer = 0;
    this.oscFreeSince = 0;
    ws.on('message', (data, binary) => this.onMessage(data, binary));
    ws.on('close', () => this.close('disconnected'));
  }

  send(o) { if (!this.closed) this.ws.sendJson(o); }
  status(text, progress) { this.send({ type: 'status', text, progress: progress == null ? null : progress }); }

  onMessage(data, binary) {
    if (binary) {
      if (this.asr) this.asr.write(data);
      if (this.keepsAudio) this.keepTurnAudio(data);
      return;
    }
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m && m.type) {
      case 'start': this.start(m.settings || {}).catch((e) => this.fatal(e)); break;
      case 'settings': this.updateSettings(m.settings || {}).catch((e) => this.error('settings', e.message)); break;
      case 'text': this.onTyped(String(m.text || ''), typeof m.speaker === 'string' ? m.speaker.slice(0, 40) : undefined); break;
      case 'say': this.onSay(String(m.text || '')); break;
      case 'context': this.addContext(String(m.text || '')); break;
      case 'signal': this.onSignal(String(m.name || '').slice(0, 80), m.value == null ? '' : String(m.value).slice(0, 2000)); break;
      case 'language': this.setLanguage(String(m.language || '')).catch((e) => this.error('language', e.message)); break;
      case 'interrupt': this.interrupt('client'); break;
      case 'playback': if (m.state === 'ended') this.onPlaybackEnded(Number(m.turnId) || 0); break;
      case 'tool.result': this.log(`(tool result ignored by the local engine: ${m.id})`); break;
      case 'stop': this.close('stop'); break;
      default: break;
    }
  }

  // — start and settings ——————————————————————————————————————————————————————
  async start(settings) {
    this.s = { ...DEFAULTS, ...settings };
    this.voice = null;                                // a new conversation starts in the agent's own voice
    this.lang = '';                                   // and in its own language
    this.status('Preparing the models…', 0);
    await this.lock(() => this.engine.prepare(this.s, (p) => this.status(progressText(p), p.progress)));
    if (this.closed) return;                          // the page left during loading
    if (typeof this.engine.newConversation === 'function') this.engine.newConversation();
    this.openAsr();
    this.started = true;
    this.status('', null);
    this.send({ type: 'ready', ...this.engine.info() });
    this.send({ type: 'language', language: this.language, own: true });
    this.oscValues.clear();                           // the values of another conversation are old news
    this.listenOsc();
    this.log(`▸ conversation opened (${this.s.name || 'agent'}, voice ${voiceEngine(this.s)}${voiceEngine(this.s) === 'supertonic' ? ' ' + this.s.localVoice : ''}, ${this.s.language}${remoteOf(this.s) ? `, ${this.s.llm === 'farm' ? 'LLM farm' : 'service'} ${this.s.llmUrl} ${this.s.llmModel}` : ''})`);
    if (parlerNotEnglish(this.s)) this.status(PARLER_ENGLISH_ONLY, null);
    this.voiceFallbackNote();
    this.useTurnDetection();
    // the agent: its first stage, then its "start" pattern if it has one, otherwise the greeting
    const moment = await this.enterAgent();
    if (this.closed) return;
    if (moment) { this.announce(moment); this.perform(this.newBot('speaking'), moment).catch((e) => this.error('start', e.message)); } else {
      const greeting = String(this.s.greeting || '').trim();
      if (greeting) this.sayFixed(greeting, true);
    }
    this.warmFillers();
  }

  /** The agent of the settings: back to its first stage, its embeddings computed ahead; returns its "start" pattern, or null. */
  async enterAgent() {
    const decider = this.engine.decider;
    this.focus = null;
    this.stage = '';
    this.oscEdges.clear(); this.oscQueue.clear();     // its OSC patterns start armed, none waiting
    if (!this.s.agent || !decider) return null;
    const id = String(this.s.agent);
    try {
      this.stage = decider.startStage(id);
      if (this.stage) this.send({ type: 'stage', stage: this.stage, from: '' });
      decider.warm(id);
      return await decider.onMoment(id, 'start', { stage: this.stage });
    } catch (e) {
      this.log(`(agent "${id}": ${e.message})`);
      return null;
    }
  }

  /**
   * One change after the other. Otherwise a 2nd change arriving during a reload finds the recognition stream
   * already closed, so it doesn't close the one the 1st reopens, and its own reload waits forever for it to drain.
   */
  updateSettings(patch) {
    const run = (this.settingsDone || Promise.resolve()).then(() => this.applySettings(patch));
    this.settingsDone = run.catch(() => {});
    return run;
  }

  async applySettings(patch) {
    const prev = this.vs;
    const own = this.s;
    this.s = { ...this.s, ...patch };
    // the voice edited in the studio during a conversation is the one to hear: it ends a pattern's change of
    // voice (another agent too)
    if (this.voice && ['agent', ...VOICE_KEYS].some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(own[k]))) {
      this.voice = null;
      if (this.started) this.send({ type: 'voice', voice: '', name: '' });
    }
    // so does the agent's language (or another agent): the conversation goes back to it
    if (this.lang && ['agent', 'language'].some((k) => k in patch && patch[k] !== own[k])) this.lang = '';
    if (!this.started) return;
    const changed = (keys) => keys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(this.vs[k]));
    if (changed(['language'])) this.send({ type: 'language', language: this.language, own: !this.lang });
    const asrChanged = changed(ASR_KEYS);
    const ttsChanged = changed(TTS_KEYS[voiceEngine(this.vs)]);
    if (asrChanged && this.asr) { this.asr.close(); this.asr = null; }   // close BEFORE reloading the model
    if (asrChanged || ttsChanged || changed(LLM_KEYS)) {
      this.status('New settings: reloading…', null);
      await this.lock(() => this.engine.prepare(this.vs, (p) => this.status(progressText(p), p.progress)));
      if (this.closed) return;
      this.status('', null);
    }
    if (parlerNotEnglish(this.vs) && (!parlerNotEnglish(prev) || changed(['language']))) this.status(PARLER_ENGLISH_ONLY, null);
    if (changed(['localVoiceEngine'])) this.voiceFallbackNote();
    if (asrChanged && !this.closed && !this.asr) this.openAsr();
    if (changed(['turnDetection'])) this.useTurnDetection();
    if (changed(['oscIn'])) this.listenOsc();
    if (changed(['agent'])) this.enterAgent();
    this.warmFillers();
  }

  /** turnDetection 'smart': load Smart Turn the first time (shared by the server). Unavailable → silence only. */
  async useTurnDetection() {
    if (this.s.turnDetection !== 'smart' || this.smart || this.smartLoading || this.closed) return;
    if (typeof this.engine.smartTurn !== 'function') { this.smartUnavailable(); return; }
    this.smartLoading = true;
    try {
      const st = await this.engine.smartTurn();
      const ok = !!st && (await st.ready());
      if (this.closed) return;
      if (ok) { this.smart = st; this.log(`▸ end of turn: silence + ${st.name}`); } else this.smartUnavailable();
    } catch (e) {
      this.log(`(Smart Turn: ${e.message})`);
      this.smartUnavailable();
    } finally { this.smartLoading = false; }
  }

  smartUnavailable() {
    if (this.smartWarned || this.closed) return;
    this.smartWarned = true;
    this.status(SMART_TURN_UNAVAILABLE, null);
  }

  openAsr() {
    this.asr = this.engine.openAsr(
      { endSilenceMs: this.s.endSilenceMs, startSensitivity: this.s.startSensitivity, endSensitivity: this.s.endSensitivity },
      {
        onVad: (speaking) => this.onVad(speaking),
        onText: (text) => this.onText(text),
        onEndOfTurn: () => this.onEndOfTurn(),
        onError: (e) => this.error('asr', `Speech recognition: ${e.message}`),
      },
    );
  }

  // — what the person says ————————————————————————————————————————————————————
  onVad(speaking) {
    const was = this.vadSpeaking;
    this.vadSpeaking = speaking;
    if (was && !speaking) this.segPending++;          // a segment just ended: its text is on its way
    if (was === speaking) return;                     // Whisper repeats the state on every pass: only send changes
    this.send({ type: 'vad', speaking });
    if (!speaking) { this.onSegmentEnd(); return; }
    this.marks.speechAt = Date.now();
    this.turnSeq++;                                   // new speech: a prediction still running no longer applies
    this.smartEnded = false;
    this.skipEot = false;
    if (this.keepsAudio) this.turnAudio.inTurn = true;
    if (this.bot && this.s.interruptible !== false) this.speechOverBot();
  }

  /** The end of a speech segment (a short silence). With Smart Turn: is the person done? */
  onSegmentEnd() {
    const d = this.duck;
    if (d) {                                          // over a lowered agent: its text will tell what it was
      clearTimeout(d.wait);
      d.wait = setTimeout(() => this.classifyDuck(), DUCK_TEXT_WAIT_MS);
      return;
    }
    if (this.s.turnDetection === 'smart' && this.smart && !this.bot) this.predictTurn();
  }

  // — talking over the agent ——————————————————————————————————————————————————————
  /**
   * Someone speaks while the agent speaks (and it can be interrupted). interruptAfterMs = 0: it stops at once.
   * Otherwise it lowers its voice, and only stops if the person is still talking after interruptAfterMs.
   */
  speechOverBot() {
    const after = Math.round(clamp(num(this.s.interruptAfterMs, 0), 0, 2000));
    if (!after) { this.interrupt('user'); return; }
    const d = this.duck;
    if (d && d.turnId === this.bot.id) {              // talking again while lowered: a new countdown
      clearTimeout(d.timer); clearTimeout(d.wait); d.wait = 0;
      d.timer = setTimeout(() => this.onDuckTimer(), after);
      return;
    }
    this.endDuck();
    this.duck = { turnId: this.bot.id, prefix: this.userText, timer: setTimeout(() => this.onDuckTimer(), after), wait: 0, eotSeen: false };
    this.send({ type: 'bot.duck', turnId: this.bot.id });
  }

  onDuckTimer() {
    const d = this.duck;
    if (!d) return;
    d.timer = 0;
    if (!this.vadSpeaking) return;                    // the burst ended in time: its text decides
    this.endDuck();
    this.interrupt('user');                           // still talking: a real interruption, their speech is the next turn
    if (this.userText) this.send({ type: 'user.partial', text: this.userText });
  }

  /** The burst over the lowered agent has ended and its text is here (or late): carry on, stop, or reply? */
  classifyDuck() {
    const d = this.duck;
    if (!d) return;
    this.endDuck();
    const text = this.userText.slice(d.prefix.length).trim();
    const kind = classifyInterjection(text);
    this.log(`▸ over the agent: "${text}" → ${kind}`);
    if (kind === 'noise' || kind === 'backchannel') {
      this.forgetSpeech(d);
      this.send({ type: 'bot.unduck', turnId: d.turnId, reason: kind, text });
      return;
    }
    if (kind === 'stop') {                            // it stops and listens: no reply
      this.forgetSpeech(d);
      this.interrupt('user');
      this.history.push({ role: 'user', content: text });
      this.send({ type: 'user.text', text, reply: false });
      return;
    }
    this.interrupt('user');                           // a real interruption: a normal user turn
    if (this.userText) this.send({ type: 'user.partial', text: this.userText });
    if (d.eotSeen) this.endOfTurn();                  // the engine already said the turn was over
    else if (this.s.turnDetection === 'smart' && this.smart) this.predictTurn();
  }

  /** What was said over the agent is not a user turn: drop its text, and the end of turn that will follow. */
  forgetSpeech(d) {
    this.userText = d.prefix;
    this.turnAudio.inTurn = false;
    this.turnSeq++;
    if (!d.eotSeen) this.skipEot = true;
  }

  endDuck() {
    const d = this.duck;
    if (!d) return;
    clearTimeout(d.timer); clearTimeout(d.wait);
    this.duck = null;
  }

  async predictTurn() {
    const seq = this.turnSeq;
    const audio = this.turnPcm();
    if (!audio.length) return;
    let r;
    try { r = await this.smart.predict(audio); } catch (e) { this.log(`(Smart Turn: ${e.message})`); return; }
    // too late: new speech, the turn already ended, or the agent is speaking
    if (this.closed || seq !== this.turnSeq || this.bot || this.vadSpeaking) return;
    this.marks.smartTurnMs = r.ms;
    this.send({ type: 'turn.prediction', probability: r.probability, complete: r.complete, ms: r.ms });
    if (!r.complete || this.eotTimer) return;          // incomplete: the end-of-turn silence decides
    this.smartEnded = true;                            // the engine's own end of turn will follow: ignore it
    this.endOfTurn();
  }

  /** The turn's audio is kept for Smart Turn, and to recognize who speaks (people recorded in Settings → People). */
  get keepsAudio() { return this.s.turnDetection === 'smart' || this.peopleOn; }
  get peopleOn() { return !!(this.engine.people && this.engine.people.size); }

  /**
   * Who said this turn: {name ('' someone not recognized), closest, score, short}, or null when nobody is recorded
   * on this computer. Too short to tell: someone not recognized.
   */
  async whoSpoke(audio) {
    if (!audio || !this.peopleOn || typeof this.engine.speakerModel !== 'function') return null;
    try {
      const model = await this.engine.speakerModel();
      if (!(await model.ready())) return null;
      const v = voiced(audio);
      if (v.seconds < MIN_SECONDS) return { name: '', closest: '', score: null, short: true };
      return { ...this.engine.people.identify(await model.embed(v.audio), v.seconds), short: false };
    } catch (e) {
      this.log(`(who is speaking: ${e.message})`);
      return null;
    }
  }

  /** The audio of the current turn (16-bit PCM, 16 kHz): 500 ms before its first speech, at most 8.5 s. */
  keepTurnAudio(buf) {
    const ta = this.turnAudio;
    const b = Buffer.from(buf);
    ta.chunks.push(b);
    ta.samples += b.length >> 1;
    const keep = ta.inTurn ? TURN_AUDIO_SAMPLES : PRE_SPEECH_SAMPLES;
    while (ta.chunks.length > 1 && ta.samples - (ta.chunks[0].length >> 1) >= keep) ta.samples -= ta.chunks.shift().length >> 1;
  }

  turnPcm() {
    const all = Buffer.concat(this.turnAudio.chunks);
    const n = all.length >> 1;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = all.readInt16LE(i * 2) / 32768;
    return out;
  }

  onText(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    this.userText = this.userText ? `${this.userText} ${t}` : t;
    this.segPending = Math.max(0, this.segPending - 1);
    this.marks.textAt = Date.now();
    if (this.duck) {                                  // said over the lowered agent: nothing shown until we know what it is
      if (this.segPending === 0 && !this.vadSpeaking) this.classifyDuck();
      return;
    }
    this.send({ type: 'user.partial', text: this.userText });
    if (this.eotTimer && this.segPending === 0) { clearTimeout(this.eotTimer); this.eotTimer = 0; this.finishUserTurn(); }
  }

  /** The engine's end of turn (silence of endSilenceMs). */
  onEndOfTurn() {
    if (this.smartEnded) { this.smartEnded = false; return; }    // Smart Turn already ended this turn
    if (this.skipEot) { this.skipEot = false; return; }          // the end of a backchannel or of a "stop"
    if (this.duck) { this.duck.eotSeen = true; return; }        // decided once the text is classified
    this.endOfTurn();
  }

  /** The end of the person's turn (engine silence or Smart Turn): waits for the text still on its way. */
  endOfTurn() {
    this.marks.eotAt = Date.now();
    // On a slow machine, the end of turn can arrive before the text of the last segment: wait for it.
    if (this.userText && this.segPending === 0) { this.finishUserTurn(); return; }
    clearTimeout(this.eotTimer);
    this.eotTimer = setTimeout(() => { this.eotTimer = 0; this.segPending = 0; this.finishUserTurn(); }, TEXT_GRACE_MS);
  }

  finishUserTurn() {
    const text = this.userText.trim();
    const audio = this.peopleOn ? this.turnPcm() : null;     // its voice, to recognize who spoke
    this.userText = '';
    this.turnAudio.inTurn = false;
    this.turnSeq++;
    const smartTurnMs = this.marks.smartTurnMs;
    this.marks.smartTurnMs = null;
    const asrMs = this.marks.eotAt ? Math.max(0, Date.now() - this.marks.eotAt) : null;
    if (heardNothing(text)) {
      this.send({ type: 'not.understood', text });
      const repair = String(this.s.repairLine || '').trim();
      if (repair && !this.bot) this.translated(repair).then((t) => { if (!this.bot && !this.closed) this.sayFixed(t, false); });
      return;
    }
    this.whoSpoke(audio).then((who) => {
      if (this.closed) return;
      if (who) this.send({ type: 'speaker', name: who.name, closest: who.closest, score: who.score, short: who.short });
      const speaker = who ? who.name : null;
      if (this.bot) {                                 // the agent is speaking and can't be interrupted: keep it for later
        this.pendingUser = text;
        this.pendingSpeaker = speaker;
        return;
      }
      this.send({ type: 'user.text', text, ...(who ? { speaker } : {}) });
      this.respond(text, { asrMs, smartTurnMs, speaker });
    });
  }

  /** Typed text; `speaker`: as if this person had said it (the studio's test of a pattern kept for some people). */
  onTyped(text, speaker) {
    const t = text.trim();
    if (!t) return;
    if (this.bot) this.interrupt('client');
    this.respond(t, { asrMs: null, speaker: speaker !== undefined ? speaker.trim() : this.peopleOn ? '' : null });
  }

  /** {type:'say'}: the agent says this line as written (a reprompt…): an agent turn, kept in the history. */
  onSay(text) {
    const t = text.trim();
    if (!t || !this.started || this.closed) return;
    const bot = this.bot;
    if (bot && bot.phase === 'playing') this.onPlaybackEnded(bot.id);   // finished, only the "played" news is missing
    if (this.bot) this.interrupt('client');
    this.sayFixed(t, true);
  }

  addContext(text) {
    const t = text.trim();
    if (!t) return;
    this.context.push(t);
    if (this.context.length > 5) this.context.shift();
  }

  // — the reply ———————————————————————————————————————————————————————————————
  /** A new turn of the agent (it replaces any other). */
  newBot(phase) {
    this.endDuck();
    const bot = { id: ++this.turnId, phase, abort: new AbortController(), gen: null, tts: null, said: [], parser: new ReplyParser() };
    this.bot = bot;
    return bot;
  }

  async respond(userText, timing) {
    const bot = this.newBot('thinking');
    const speaker = timing.speaker == null ? null : timing.speaker;  // who said it (Settings → People)
    this.history.push({ role: 'user', content: userText });
    const t0 = Date.now();
    this.scheduleFiller(bot);                         // counted from the end of the user's turn (reply delay included)
    const ms = { asr: timing.asrMs };
    if (timing.smartTurnMs != null) ms.smartTurn = timing.smartTurnMs;     // Smart Turn's inference time

    if (!(await delay(clamp(num(this.s.replyDelayMs, 0), 0, 10000), bot.abort.signal))) return;
    this.send({ type: 'thinking', turnId: bot.id });
    // the decision model first: a pattern, the stage's "otherwise", or a free answer (docs/DESIGN.md, 3)
    const d = await this.decide(userText, speaker);
    if (bot.abort.signal.aborted) return;
    if (d) ms.decide = d.ms;
    await this.perform(bot, d, { userText, speaker, t0, ms });
  }

  /** What the agent decides to do with this sentence (null without an agent, or if the decision fails). */
  async decide(text, speaker = null) {
    const decider = this.engine.decider;
    if (!this.s.agent || !decider) return null;
    try {
      // a choice button arrives as '(The user chose: "Paintings")': decide on the option itself
      const chose = /^\(The user chose: "([\s\S]*)"\)$/.exec(String(text).trim());
      const d = await decider.decide(String(this.s.agent), chose ? chose[1] : text, { stage: this.stage, focus: this.focus, speaker });
      this.announce(d);
      return d;
    } catch (e) {
      this.log(`(decision model: ${e.message})`);
      return null;
    }
  }

  /** The decision, explained, for the studio and the clients. */
  announce(d) {
    this.send({
      type: 'decision', text: d.text, stage: d.stage, kind: d.kind, pattern: d.pattern, score: d.score, example: d.example,
      entry: d.entry, candidates: d.candidates, matcher: d.matcher, ms: d.ms,
      ...(d.speaker != null ? { speaker: d.speaker } : {}), ...(d.who && d.who.length ? { who: d.who } : {}),
    });
    if (d.pattern) this.log(`▸ decided: ${d.pattern.name}${d.score != null ? ` (${d.score})` : ''}${d.entry ? ` · ${d.entry.key}` : ''}`);
  }

  /**
   * Does what was decided, in one turn of the agent: the interface actions at once (choices, mood, signals, stage),
   * then the speech in order (fixed lines, and the language model's answers). No decision: a free answer.
   */
  async perform(bot, d, { userText = '', speaker = null, t0 = Date.now(), ms = {} } = {}) {
    const { id, abort } = bot;
    const actions = d ? d.then : [];
    const plan = d && d.kind === 'denied' ? [{ do: 'say', said: refusalLine(this.language, d.speaker, d.who) }]   // not for this person
      : d && d.kind === 'outside' ? [{ do: 'say', said: outsideLine(this.language) }]   // the agent keeps to its subject
      : d && d.kind !== 'free' ? actions.filter((a) => a.do === 'say' || a.do === 'answer') : [{ do: 'answer', instruction: '' }];
    if (d && d.entry) this.focus = d.entry;
    // the placeholders: {said}, {speaker}; {value}, {address} (OSC in)
    const vars = { said: userText, speaker: speaker || '', ...(d && d.vars) };
    for (const a of actions) this.act(a, d, vars);
    // a change of language, then of voice: this very reply is said in the new ones (the last change wins)
    const language = actions.filter((a) => a.do === 'language').pop();
    if (language) { await this.setLanguage(language.language); if (abort.signal.aborted || this.closed) return; }
    const voice = actions.filter((a) => a.do === 'voice').pop();
    if (voice) { await this.switchVoice(voice.voice); if (abort.signal.aborted || this.closed) return; }

    const tts = this.engine.speak(this.voiceParams());
    bot.tts = tts;
    let index = 0;
    const pump = (async () => {
      try {
        for await (const f of tts.frames) {
          if (abort.signal.aborted) break;
          if (ms.firstAudio == null) ms.firstAudio = Date.now() - t0;
          if (f.text) { bot.said.push(f.text); this.send({ type: 'bot.sentence', text: f.text, index: index++, turnId: id }); }
          this.sendAudio(id, f.sampleRate, f.pcm);
          bot.phase = 'speaking';
        }
      } catch (e) { if (!abort.signal.aborted) this.error('tts', `Voice: ${e.message}`); }
    })();

    const parser = bot.parser;
    const onDelta = (delta) => {
      if (abort.signal.aborted) return;
      const out = parser.push(delta);
      for (const ui of out.ui) this.send(ui);
      if (out.changed) this.send({ type: 'bot.text', text: parser.text, turnId: id });
      for (const s of out.sentences) tts.write(s);
    };
    for (const step of plan) {
      if (abort.signal.aborted) return;
      if (step.do === 'say' && step.said) { onDelta(`${step.said} `); continue; }   // already in the conversation's language
      if (step.do === 'say') {
        const line = fill(pickLine(step.text), d && d.entryCells, vars);
        if (line) onDelta(`${await this.translated(line, bot)} `);
        continue;
      }
      let result = null;
      try {
        const system = this.systemFor(d, step.instruction && fill(step.instruction, d && d.entryCells, vars), parser.text, speaker);
        bot.gen = this.engine.generate({ system, history: this.withLiveData(trimHistory(this.history)), temperature: num(this.s.creativity, 1) * 0.7, onDelta, remote: remoteOf(this.s) });
        result = await bot.gen.done;
      } catch (e) {
        if (!abort.signal.aborted) this.error('llm', `Language model: ${e.message}`);
      }
      if (result && ms.firstToken == null) ms.firstToken = result.firstTokenMs;
    }
    if (abort.signal.aborted) return;
    const tail = parser.end();
    for (const ui of tail.ui) this.send(ui);
    for (const s of tail.sentences) tts.write(s);
    tts.end();
    await pump;
    if (abort.signal.aborted) return;
    const text = parser.text;
    if (text) this.history.push({ role: 'assistant', content: text });
    else if (userText) this.history.pop();            // no reply: don't teach the model an empty turn
    ms.reply = Date.now() - t0;
    this.send({ type: 'bot.done', turnId: id, text });
    this.send({ type: 'timing', turnId: id, ms });
    bot.phase = 'playing';
    // the browser says when it has finished playing; without news, consider it finished a bit later
    bot.safety = setTimeout(() => this.onPlaybackEnded(id), 60000);
    if (!bot.audio) this.onPlaybackEnded(id);
  }

  /** An interface action of a pattern: choices, mood, a signal to the clients, an OSC message, another stage. */
  act(a, d, vars) {
    const entry = d && d.entryCells;
    if (a.do === 'choices') {
      const options = a.options.map((o) => fill(o, entry, vars)).filter(Boolean);
      if (options.length) this.send({ type: 'ui.choices', question: fill(a.question, entry, vars), options });
    } else if (a.do === 'mood') {
      this.send({ type: 'ui.mood', mood: a.mood });
    } else if (a.do === 'signal') {
      this.send({ type: 'signal', name: a.name, value: fill(a.value, entry, vars) });
    } else if (a.do === 'osc' && a.address) {
      const targets = oscTargets(this.s.oscTo);
      // the address too can be filled from the entry: /vik/{scene} → /vik/Grove (an OSC address has no spaces)
      const address = fill(a.address, entry, vars).replace(/\s+/g, '');
      const args = oscArgs(fill(a.value, entry, vars));
      if (targets.length) sendOsc(targets, address, args, (m) => this.log(m));
      this.send({ type: 'osc', address, args: args.map((x) => x.value), to: targets.map((t) => `${t.host}:${t.port}`) });
    } else if (a.do === 'go') {
      this.goTo(a.stage);
    }
  }

  /** Moves to another stage of the agent (an unknown stage is ignored). */
  goTo(stage) {
    const decider = this.engine.decider;
    if (!stage || stage === this.stage || !this.s.agent || !decider) return;
    if (!decider.hasStage(String(this.s.agent), stage)) { this.log(`(no stage "${stage}": ignored)`); return; }
    const from = this.stage;
    this.stage = stage;
    this.send({ type: 'stage', stage, from });
  }

  /**
   * The system prompt of an answer: the persona, the interface's context, the knowledge, who is speaking (Settings →
   * People; speaker null: a moment, nobody speaks), the pattern's instruction.
   */
  systemFor(d, instruction, saidSoFar, speaker = null) {
    const parts = [systemPrompt({ ...this.s, language: this.language }, 'local')];
    if (this.context.length) parts.push(`What the interface knows right now: ${this.context.join('; ')}`);
    const k = knowledgePrompt(d ? d.knowledge : []);
    if (k) parts.push(k);
    if (this.peopleOn && speaker != null) parts.push(peoplePrompt(speaker));
    const live = liveDataPrompt(this.oscValues);       // late: a small model trusts the latest text it read
    if (live) parts.push(live);
    if (instruction) parts.push(`For this reply: ${instruction}`);
    if (saidSoFar) parts.push(`You have just said: "${saidSoFar}". Go on from there, without repeating it.`);
    return parts.join('\n\n');
  }

  /** A client's signal (a sensor, a button): the pattern "when a client sends this signal", if there is one. */
  async onSignal(name, value) {
    const decider = this.engine.decider;
    if (!this.started || this.closed || !name) return;
    this.addContext(`signal "${name}"${value != null && value !== '' ? ` = ${String(value).slice(0, 200)}` : ''}`);
    if (!this.s.agent || !decider) return;
    let d = null;
    try { d = await decider.onMoment(String(this.s.agent), 'signal', { stage: this.stage, focus: this.focus }, name); } catch (e) { this.log(`(signal: ${e.message})`); }
    if (!d || this.closed) return;
    this.announce(d);
    const bot = this.bot;
    if (bot && bot.phase === 'playing') this.onPlaybackEnded(bot.id);     // finished, only the "played" news is missing
    if (this.bot) this.interrupt('client');
    this.perform(this.newBot('speaking'), d).catch((e) => this.error('signal', e.message));
  }

  // — OSC in ————————————————————————————————————————————————————————————————————
  /**
   * The live data again, after the last thing said to the model (this request only, not the history): measured with
   * Qwen3 1.7B, a value in the system prompt loses to the same number said a few turns earlier ("28.2 degrees").
   */
  /** The live data again after the person's last words, for this request only: a small model trusts what it read last. */
  withLiveData(history) {
    const live = liveDataPrompt(this.oscValues);
    const last = history[history.length - 1];
    if (!live || !last || last.role !== 'user') return history;
    return [...history.slice(0, -1), { role: 'user', content: `${last.content}\n\n(${live})` }];
  }

  /** Listens on the port of the setting oscIn, during the conversation (none: not listening). */
  listenOsc() {
    const port = oscPort(this.s.oscIn);
    if (this.oscIn && port === this.oscPort) return;
    if (this.oscIn) { this.oscIn.close(); this.oscIn = null; }
    this.oscPort = port;
    if (!port || this.closed || !this.started) return;
    this.oscIn = listenOsc(port, (m) => this.onOscIn(m.address, m.args), (e) => {
      this.oscIn = null;
      const why = e.code === 'EADDRINUSE' ? `port ${port} is already used by another program` : e.message;
      this.error('osc', `OSC: VIK cannot listen (${why}). Choose another port in Settings → OSC.`);
    });
    this.log(`▸ OSC: listening on port ${port}`);
  }

  /**
   * A message from a sensor or a button: its value is now what the language model reads for that address, and the
   * patterns "when an OSC message arrives" at that address fire if their condition is met (osc.mjs, oscFires).
   */
  onOscIn(address, args) {
    if (!this.started || this.closed) return;
    const value = oscValue(args);
    this.oscValues.delete(address);
    this.oscValues.set(address, { value, at: Date.now() });
    if (this.oscValues.size > OSC_VALUES_MAX) this.oscValues.delete(this.oscValues.keys().next().value);
    this.showOscIn(address, args);
    const decider = this.engine.decider;
    if (!this.s.agent || !decider) return;
    let patterns = [];
    try { patterns = decider.oscPatterns(String(this.s.agent), this.stage, address); } catch (e) { this.log(`(OSC: ${e.message})`); }
    for (const p of patterns) {
      if (!this.oscEdges.has(p.id)) this.oscEdges.set(p.id, { fired: false });
      if (!oscFires(p.when, value, this.oscEdges.get(p.id))) continue;
      this.oscQueue.delete(p.id);
      this.oscQueue.set(p.id, { address, value });
      this.log(`▸ OSC ${address} ${value}: ${p.name}, at the next pause`);
    }
    if (this.oscQueue.size && !this.oscTimer) this.oscTimer = setTimeout(() => this.oscTurn(), 100);
  }

  /** {type:'osc.in', address, args}: what arrives, for Settings and the clients; a stream is thinned out. */
  showOscIn(address, args) {
    let t = this.oscShown.get(address);
    if (!t) {
      if (this.oscShown.size >= OSC_VALUES_MAX) return;
      t = { at: 0, timer: 0, args };
      this.oscShown.set(address, t);
    }
    t.args = args;
    if (t.timer) return;
    t.timer = setTimeout(() => { t.timer = 0; t.at = Date.now(); this.send({ type: 'osc.in', address, args: t.args }); }, Math.max(0, t.at + OSC_SHOW_MS - Date.now()));
  }

  /**
   * The patterns an OSC message fired speak one after the other, each at a pause: the agent silent and nobody
   * talking for OSC_PAUSE_MS. A pattern that fires again meanwhile waits with its latest value.
   */
  oscTurn() {
    this.oscTimer = 0;
    if (this.closed || !this.oscQueue.size) return;
    const free = this.started && !this.bot && !this.vadSpeaking && !this.userText.trim() && !this.pendingUser && !this.duck;
    const now = Date.now();
    if (!free) this.oscFreeSince = 0; else if (!this.oscFreeSince) this.oscFreeSince = now;
    if (free && now - this.oscFreeSince >= OSC_PAUSE_MS) {
      const [id, m] = this.oscQueue.entries().next().value;
      this.oscQueue.delete(id);
      let d = null;
      try { d = this.engine.decider.oscMoment(String(this.s.agent), id, { stage: this.stage, focus: this.focus }, `${m.address} ${m.value}`.trim()); } catch (e) { this.log(`(OSC: ${e.message})`); }
      if (d) {                                        // (null: its stage is over, or it was switched off)
        d.vars = { value: m.value, address: m.address };
        this.oscFreeSince = 0;
        // the model replies to the message, not to its own last words (as a choice is "(The user chose: …)")
        this.history.push({ role: 'user', content: `(OSC message: ${d.text})` });
        this.announce(d);
        this.perform(this.newBot('speaking'), d).catch((e) => this.error('osc', e.message));
      }
    }
    if (this.oscQueue.size) this.oscTimer = setTimeout(() => this.oscTurn(), 100);
  }

  /** A fixed line (greeting, repair line), said without going through the model. */
  sayFixed(text, remember) {
    this.endDuck();
    const id = ++this.turnId;
    const abort = new AbortController();
    const bot = { id, phase: 'speaking', abort, gen: null, tts: null, said: [] };
    this.bot = bot;
    const tts = this.engine.speak(this.voiceParams());
    bot.tts = tts;
    this.send({ type: 'bot.text', text, turnId: id });
    (async () => {
      let index = 0;
      try {
        for await (const f of tts.frames) {
          if (abort.signal.aborted) return;
          if (f.text) this.send({ type: 'bot.sentence', text: f.text, index: index++, turnId: id });
          this.sendAudio(id, f.sampleRate, f.pcm);
        }
      } catch (e) { this.error('tts', `Voice: ${e.message}`); }
      if (abort.signal.aborted) return;
      if (remember) this.history.push({ role: 'assistant', content: text });
      this.send({ type: 'bot.done', turnId: id, text });
      bot.phase = 'playing';
      bot.safety = setTimeout(() => this.onPlaybackEnded(id), 30000);
      if (!bot.audio) this.onPlaybackEnded(id);
    })();
    const { sentences } = new ReplyParser().push(text, true);
    for (const s of (sentences.length ? sentences : [speakable(text)])) tts.write(s);
    tts.end();
  }

  /**
   * The settings the voice speaks with: the agent's, or, after a pattern's "Change voice", those of the saved
   * voice it switched to (this.voice), for the rest of the conversation or until the next change.
   */
  get vs() {
    const s = this.voice ? { ...this.s, ...this.voice.settings } : this.s;
    return this.lang ? { ...s, language: this.lang } : s;
  }

  /** The conversation's language: the agent's, until the Talk view, a pattern or a client changes it. */
  get language() { return this.lang || this.s.language || 'en'; }

  /** Another language (a code of LANGUAGES), or '' for the agent's own. Queued with the changes of settings. */
  setLanguage(code) {
    const run = (this.settingsDone || Promise.resolve()).then(() => this.switchLanguage(code));
    this.settingsDone = run.catch(() => {});
    return run;
  }

  /**
   * Speech recognition and the voice are loaded for a language: they reload (the reply waits for them).
   * The language model answers in it, and the fixed lines are translated into it (translated()).
   * The clients are told: {type:'language', language, own}.
   */
  async switchLanguage(code) {
    if (!this.started || this.closed) return;
    if (code && !Object.hasOwn(LANGUAGES, code)) { this.log(`(no language "${code}": the language stays)`); return; }
    const lang = code === (this.s.language || 'en') ? '' : code;
    if (lang === this.lang) return;
    const before = this.vs;
    this.lang = lang;
    const after = this.vs;
    this.send({ type: 'language', language: this.language, own: !lang });
    this.log(`▸ language: ${LANGUAGES[this.language] || this.language}${lang ? '' : " (the agent's own)"}`);
    const changed = (keys) => keys.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    const asrChanged = changed(ASR_KEYS);
    if (!asrChanged && !changed(TTS_KEYS[voiceEngine(after)])) return;
    if (asrChanged && this.asr) { this.asr.close(); this.asr = null; }   // close BEFORE reloading the model
    this.status('Changing language…', null);
    await this.lock(() => this.engine.prepare(after, (p) => this.status(progressText(p), p.progress)));
    if (this.closed) return;
    this.status('', null);
    if (parlerNotEnglish(after)) this.status(PARLER_ENGLISH_ONLY, null);
    if (asrChanged && !this.asr) this.openAsr();
  }

  /**
   * A fixed line (a pattern's "say", the repair line) in the conversation's language: as written in the
   * agent's own language, translated by the language model in another one (as written if that fails).
   */
  async translated(text, bot = null) {
    if (!this.lang || !text) return text;
    let out = '';
    try {
      const gen = this.engine.generate({ system: translatePrompt(this.language), history: [{ role: 'user', content: text }],
        temperature: 0.2, onDelta: (x) => { out += x; }, remote: remoteOf(this.s) });
      if (bot) bot.gen = gen;
      await gen.done;
    } catch (e) { this.log(`(translation: ${e.message})`); }
    return out.trim() || text;
  }

  /** The voice settings of a synthesis. */
  voiceParams() {
    const s = this.vs;
    return {
      voice: s.localVoice, speed: s.localSpeed, language: s.language,
      engine: voiceEngine(s), description: String(s.voiceDescription || '').trim(),
      zonosVoice: String(s.zonosVoice || '').trim(), design: String(s.voiceDesign || '').trim(),
    };
  }

  /**
   * A pattern's "Change voice": from this reply on, the agent speaks with one of its saved voices (id), or with
   * its own again (''). A voice of the engine already loaded changes at once; another engine is loaded first
   * (the reply waits for it). An unknown voice changes nothing. The clients are told: {type:'voice', voice, name}.
   */
  async switchVoice(id) {
    const decider = this.engine.decider;
    const saved = id && decider && typeof decider.voice === 'function' ? decider.voice(String(this.s.agent), id) : null;
    if (id && !saved) { this.log(`(no saved voice "${id}": the voice stays)`); return; }
    if ((this.voice ? this.voice.id : '') === (saved ? saved.id : '')) return;
    const before = this.vs;
    this.voice = saved;
    const after = this.vs;
    this.send({ type: 'voice', voice: saved ? saved.id : '', name: saved ? saved.name : '' });
    this.log(`▸ voice: ${saved ? saved.name : "the agent's own"}`);
    const loaded = (s) => JSON.stringify(TTS_KEYS[voiceEngine(s)].map((k) => s[k]));
    if (voiceEngine(before) !== voiceEngine(after) || loaded(before) !== loaded(after)) {
      this.status('Changing voice…', null);
      await this.lock(() => this.engine.prepare(after, (p) => this.status(progressText(p), p.progress)));
      if (this.closed) return;
      this.status('', null);
      if (parlerNotEnglish(after)) this.status(PARLER_ENGLISH_ONLY, null);
      this.voiceFallbackNote();
    }
    this.warmFillers();
  }

  /** The chosen voice could not be used (Zonos without its server): say which voice speaks instead. */
  voiceFallbackNote() {
    const note = this.engine.info().voiceFallback;
    if (note) { this.status(note, null); this.log(`(${note})`); }
  }

  // — spoken fillers ——————————————————————————————————————————————————————————————
  /** If the reply is slow, a filler is said after fillerAfterMs (at most one per turn). */
  scheduleFiller(bot) {
    const lines = fillerPhrases(this.s.fillerLines);
    const after = Math.round(clamp(num(this.s.fillerAfterMs, 1200), 0, 30000));
    if (!lines.length || !after || this.lang) return;     // written in the agent's language: not in another one
    bot.fillerTimer = setTimeout(() => { this.sayFiller(bot, lines).catch((e) => this.log(`(filler: ${e.message})`)); }, after);
  }

  async sayFiller(bot, lines) {
    const waiting = () => this.bot === bot && !bot.abort.signal.aborted && !bot.audio && bot.phase === 'thinking';
    if (!waiting() || bot.filler) return;
    bot.filler = true;
    const text = lines.length >= 2 ? pick(lines.filter((l) => l !== this.lastFiller)) : lines[0];
    this.lastFiller = text;
    const clip = await this.fillerClip(text);         // ready at once when cached
    if (!clip || !waiting()) return;                  // the reply's voice is already there: no filler
    this.send({ type: 'bot.filler', text, turnId: bot.id });
    const frame = Math.round(clip.rate * 0.25);       // all at once: never mixed with the reply's frames
    for (let i = 0; i < clip.pcm.length; i += frame) this.sendAudio(FILLER_TURN_ID, clip.rate, clip.pcm.subarray(i, i + frame));
    this.log(`▸ filler (turn ${bot.id}): "${text}"`);
  }

  fillerKey(text) {
    const s = this.vs;
    return JSON.stringify([voiceEngine(s), s.localVoice, num(s.localSpeed, 1), s.language, String(s.voiceDescription || '').trim(),
      voiceEngine(s) === 'zonos' ? [String(s.zonosVoice || '').trim(), String(s.voiceDesign || '').trim()] : 0, text]);
  }

  /** The audio of a filler in the current voice: from the cache, or synthesized now. */
  fillerClip(text) {
    const key = this.fillerKey(text);
    const hit = FILLER_CACHE.get(key);
    if (hit) return Promise.resolve(hit);
    if (this.fillerJobs.has(key)) return this.fillerJobs.get(key);
    const job = (async () => {
      const tts = this.engine.speak(this.voiceParams());
      tts.write(speakable(text) || text);
      tts.end();
      const parts = []; let rate = 24000; let n = 0;
      for await (const f of tts.frames) { parts.push(f.pcm); rate = f.sampleRate; n += f.pcm.length; }
      if (!n) return null;
      const pcm = new Int16Array(n); let o = 0;
      for (const p of parts) { pcm.set(p, o); o += p.length; }
      const clip = { pcm, rate };
      FILLER_CACHE.set(key, clip);
      while (FILLER_CACHE.size > FILLER_CACHE_MAX) FILLER_CACHE.delete(FILLER_CACHE.keys().next().value);
      return clip;
    })().catch((e) => { this.log(`(filler "${text}": ${e.message})`); return null; })
      .finally(() => this.fillerJobs.delete(key));
    this.fillerJobs.set(key, job);
    return job;
  }

  /**
   * Synthesizes the fillers of the current settings in the background, so they play at once.
   * One at a time, when the agent is not replying (a voice model synthesizes one text at a time), and never
   * during a model reload (the preparation lock).
   */
  warmFillers() {
    if (this.warming || this.closed || !this.started || this.lang || !fillerPhrases(this.s.fillerLines).length) return;
    const failed = new Set();
    this.warming = (async () => {
      for (;;) {
        if (this.closed) return;
        const todo = fillerPhrases(this.s.fillerLines).filter((t) => !FILLER_CACHE.has(this.fillerKey(t)) && !failed.has(this.fillerKey(t)));
        if (!todo.length) return;
        while (this.bot && !this.closed) await delay(150);          // a reply goes first
        if (this.closed) return;
        const key = this.fillerKey(todo[0]);
        const clip = await this.lock(() => this.fillerClip(todo[0]));
        if (!clip) failed.add(key);
      }
    })().catch((e) => this.log(`(fillers: ${e.message})`)).finally(() => { this.warming = null; });
  }

  sendAudio(turnId, rate, pcm) {
    if (this.closed || !pcm || !pcm.length) return;
    if (this.bot && this.bot.id === turnId) this.bot.audio = true;
    const head = Buffer.alloc(8);
    head.writeUInt32LE(rate >>> 0, 0);
    head.writeUInt32LE(turnId >>> 0, 4);
    this.ws.send(Buffer.concat([head, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]));
  }

  onPlaybackEnded(turnId) {
    const bot = this.bot;
    if (!bot || bot.id !== turnId || bot.phase !== 'playing') return;
    clearTimeout(bot.safety);
    this.bot = null;
    const d = this.duck;
    if (d && d.turnId === turnId) {                   // the reply ended while lowered: it simply ends,
      this.endDuck();                                 // and what the person says is an ordinary turn
      if (this.userText.trim()) this.send({ type: 'user.partial', text: this.userText });
      if (d.eotSeen) this.endOfTurn();
    }
    if (this.pendingUser) {
      const t = this.pendingUser;
      const speaker = this.pendingSpeaker;
      this.pendingUser = null;
      this.pendingSpeaker = null;
      this.send({ type: 'user.text', text: t, ...(speaker != null ? { speaker } : {}) });
      this.respond(t, { asrMs: null, speaker });
    }
  }

  interrupt(by) {
    this.endDuck();
    const bot = this.bot;
    if (!bot) return;
    this.bot = null;
    clearTimeout(bot.safety);
    clearTimeout(bot.fillerTimer);
    bot.abort.abort();
    try { if (bot.gen) bot.gen.cancel(); } catch { /* finished */ }
    try { if (bot.tts) bot.tts.cancel(); } catch { /* finished */ }
    const said = bot.said.join(' ').trim();
    // the model remembers what it had time to say, and that it was interrupted
    if (bot.parser && said) this.history.push({ role: 'assistant', content: `${said} […]` });
    this.send({ type: 'interrupted', turnId: bot.id, by });
    this.log(`▸ interrupted (${by}) at turn ${bot.id}`);
  }

  // — end and errors ——————————————————————————————————————————————————————————
  error(code, message) { this.log(`✖ ${message}`); this.send({ type: 'error', code, message, fatal: false }); }
  fatal(e) {
    this.log(`✖ ${e.message}`);
    this.send({ type: 'error', code: 'server', message: e.message, fatal: true });
    this.close('error');
  }

  close(why) {
    if (this.closed) return;
    this.interrupt('end');
    this.closed = true;
    this.endDuck();
    clearTimeout(this.eotTimer);
    clearTimeout(this.oscTimer);
    if (this.oscIn) { this.oscIn.close(); this.oscIn = null; }
    for (const t of this.oscShown.values()) clearTimeout(t.timer);
    if (this.asr) { this.asr.close(); this.asr = null; }
    try { this.ws.close(1000, why); } catch { /* closed */ }
    this.log(`▸ conversation closed (${why})`);
  }
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
/** The language model elsewhere (an LLM farm, a service), or null for the local one. */
export function remoteOf(s) {
  if (s.llm !== 'farm' && s.llm !== 'service') return null;
  return { kind: s.llm, url: String(s.llmUrl || ''), model: String(s.llmModel || ''), key: String(s.llmKey || '') };
}
/** A line of a "say" action: several lines separated by | → one of them, at random. */
function pickLine(text) { const l = String(text || '').split('|').map((x) => x.trim()).filter(Boolean); return l.length ? pick(l) : ''; }
