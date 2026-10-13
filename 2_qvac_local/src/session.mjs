// A conversation: what happens between a browser (cables op or lab window) and the local engine.
// Protocol: see CONTRACT.md ("Local engine"). Incoming audio: 16-bit PCM, mono, 16 kHz, in binary frames.
// Outgoing audio: binary frames [u32 sample rate][u32 turn id][16-bit mono PCM].
import { ReplyParser, systemPrompt, heardNothing, speakable, trimHistory, classifyInterjection } from './text.mjs';
import { delay, clamp, num, progressText } from './util.mjs';

const DEFAULTS = {
  name: 'Ada', persona: '', language: 'en', greeting: '', shortAnswers: true, creativity: 1,
  localVoice: 'F1', localSpeed: 1, endSilenceMs: 800, startSensitivity: 'high', endSensitivity: 'high',
  interruptible: true, repairLine: '', replyDelayMs: 0, uiTools: true,
  turnDetection: 'silence', interruptAfterMs: 0, fillerLines: '', fillerAfterMs: 1200,
  localVoiceEngine: 'supertonic', voiceDescription: '',
};
const ASR_KEYS = ['language', 'endSilenceMs', 'startSensitivity', 'endSensitivity'];
const VOICE_ENGINES = ['supertonic', 'parler', 'chatterbox'];
const voiceEngine = (s) => (VOICE_ENGINES.includes(s.localVoiceEngine) ? s.localVoiceEngine : 'supertonic');
/** The settings a voice model is LOADED with (a change reloads it). Parler's description is per request. */
const TTS_KEYS = {
  supertonic: ['localVoiceEngine', 'language', 'localVoice', 'localSpeed'],
  parler: ['localVoiceEngine'],
  chatterbox: ['localVoiceEngine', 'language', 'localSpeed'],
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
// Spoken fillers ("Hmm, let me see…") while a slow reply is prepared: their audio frames carry this turn id
export const FILLER_TURN_ID = 0xFFFFFFFF;
const FILLER_CACHE = new Map();   // synthesized fillers, per voice and text (shared by the conversations)
const FILLER_CACHE_MAX = 40;
/** The filler phrases of the setting fillerLines ("Hmm, let me see…|Good question…"). */
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
    this.history = [];
    this.context = [];
    this.asr = null;
    this.userText = '';
    this.eotTimer = 0;
    this.vadSpeaking = false;
    this.segPending = 0;          // finished speech segments whose text has not arrived yet
    this.turnId = 0;
    this.bot = null;              // the reply in progress: {id, phase, abort, gen, tts}
    this.pendingUser = null;      // what was heard while the agent was speaking (not interruptible)
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
    ws.on('message', (data, binary) => this.onMessage(data, binary));
    ws.on('close', () => this.close('disconnected'));
  }

  send(o) { if (!this.closed) this.ws.sendJson(o); }
  status(text, progress) { this.send({ type: 'status', text, progress: progress == null ? null : progress }); }

  onMessage(data, binary) {
    if (binary) {
      if (this.asr) this.asr.write(data);
      if (this.s.turnDetection === 'smart') this.keepTurnAudio(data);
      return;
    }
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m && m.type) {
      case 'start': this.start(m.settings || {}).catch((e) => this.fatal(e)); break;
      case 'settings': this.updateSettings(m.settings || {}).catch((e) => this.error('settings', e.message)); break;
      case 'text': this.onTyped(String(m.text || '')); break;
      case 'say': this.onSay(String(m.text || '')); break;
      case 'context': this.addContext(String(m.text || '')); break;
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
    this.status('Preparing the models…', 0);
    await this.lock(() => this.engine.prepare(this.s, (p) => this.status(progressText(p), p.progress)));
    if (this.closed) return;                          // the page left during loading
    if (typeof this.engine.newConversation === 'function') this.engine.newConversation();
    this.openAsr();
    this.started = true;
    this.status('', null);
    this.send({ type: 'ready', ...this.engine.info() });
    this.log(`▸ conversation opened (${this.s.name || 'agent'}, voice ${voiceEngine(this.s)}${voiceEngine(this.s) === 'supertonic' ? ' ' + this.s.localVoice : ''}, ${this.s.language})`);
    if (parlerNotEnglish(this.s)) this.status(PARLER_ENGLISH_ONLY, null);
    this.useTurnDetection();
    const greeting = String(this.s.greeting || '').trim();
    if (greeting) this.sayFixed(greeting, true);
    this.warmFillers();
  }

  async updateSettings(patch) {
    const prev = this.s;
    this.s = { ...this.s, ...patch };
    if (!this.started) return;
    const changed = (keys) => keys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(this.s[k]));
    const asrChanged = changed(ASR_KEYS);
    const ttsChanged = changed(TTS_KEYS[voiceEngine(this.s)]);
    if (asrChanged && this.asr) { this.asr.close(); this.asr = null; }   // close BEFORE reloading the model
    if (asrChanged || ttsChanged) {
      this.status('New settings: reloading…', null);
      await this.lock(() => this.engine.prepare(this.s, (p) => this.status(progressText(p), p.progress)));
      if (this.closed) return;
      this.status('', null);
    }
    if (parlerNotEnglish(this.s) && (!parlerNotEnglish(prev) || changed(['language']))) this.status(PARLER_ENGLISH_ONLY, null);
    if (asrChanged && !this.closed && !this.asr) this.openAsr();
    if (changed(['turnDetection'])) this.useTurnDetection();
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
    if (this.s.turnDetection === 'smart') this.turnAudio.inTurn = true;
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
    this.userText = '';
    this.turnAudio.inTurn = false;
    this.turnSeq++;
    const smartTurnMs = this.marks.smartTurnMs;
    this.marks.smartTurnMs = null;
    const asrMs = this.marks.eotAt ? Math.max(0, Date.now() - this.marks.eotAt) : null;
    if (heardNothing(text)) {
      this.send({ type: 'not.understood', text });
      const repair = String(this.s.repairLine || '').trim();
      if (repair && !this.bot) this.sayFixed(repair, false);
      return;
    }
    if (this.bot) {                                   // the agent is speaking and can't be interrupted: keep it for later
      this.pendingUser = text;
      return;
    }
    this.send({ type: 'user.text', text });
    this.respond(text, { asrMs, smartTurnMs });
  }

  onTyped(text) {
    const t = text.trim();
    if (!t) return;
    if (this.bot) this.interrupt('client');
    this.respond(t, { asrMs: null });
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
  async respond(userText, timing) {
    this.endDuck();
    const id = ++this.turnId;
    const abort = new AbortController();
    const bot = { id, phase: 'thinking', abort, gen: null, tts: null, said: [], parser: new ReplyParser() };
    this.bot = bot;
    this.history.push({ role: 'user', content: userText });
    const t0 = Date.now();
    this.scheduleFiller(bot);                         // counted from the end of the user's turn (reply delay included)
    const ms = { asr: timing.asrMs };
    if (timing.smartTurnMs != null) ms.smartTurn = timing.smartTurnMs;     // Smart Turn's inference time

    if (!(await delay(clamp(num(this.s.replyDelayMs, 0), 0, 10000), abort.signal))) return;
    this.send({ type: 'thinking', turnId: id });

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
    const onDelta = (d) => {
      if (abort.signal.aborted) return;
      const out = parser.push(d);
      for (const ui of out.ui) this.send(ui);
      if (out.changed) this.send({ type: 'bot.text', text: parser.text, turnId: id });
      for (const s of out.sentences) tts.write(s);
    };
    const system = systemPrompt(this.s, 'local') + (this.context.length ? `\n\nWhat the interface knows right now: ${this.context.join('; ')}` : '');
    let result = null;
    try {
      bot.gen = this.engine.generate({ system, history: trimHistory(this.history), temperature: num(this.s.creativity, 1) * 0.7, onDelta });
      result = await bot.gen.done;
    } catch (e) {
      if (!abort.signal.aborted) this.error('llm', `Language model: ${e.message}`);
    }
    if (abort.signal.aborted) return;
    const tail = parser.end();
    for (const ui of tail.ui) this.send(ui);
    for (const s of tail.sentences) tts.write(s);
    tts.end();
    if (result) ms.firstToken = result.firstTokenMs;
    await pump;
    if (abort.signal.aborted) return;
    const text = parser.text;
    if (text) this.history.push({ role: 'assistant', content: text });
    else this.history.pop();                         // no reply: don't teach the model an empty turn
    ms.reply = Date.now() - t0;
    this.send({ type: 'bot.done', turnId: id, text });
    this.send({ type: 'timing', turnId: id, ms });
    bot.phase = 'playing';
    // the browser says when it has finished playing; without news, consider it finished a bit later
    bot.safety = setTimeout(() => this.onPlaybackEnded(id), 60000);
    if (!bot.audio) this.onPlaybackEnded(id);
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

  /** The voice settings of a synthesis. */
  voiceParams() {
    return {
      voice: this.s.localVoice, speed: this.s.localSpeed, language: this.s.language,
      engine: voiceEngine(this.s), description: String(this.s.voiceDescription || '').trim(),
    };
  }

  // — spoken fillers ——————————————————————————————————————————————————————————————
  /** If the reply is slow, a filler is said after fillerAfterMs (at most one per turn). */
  scheduleFiller(bot) {
    const lines = fillerPhrases(this.s.fillerLines);
    const after = Math.round(clamp(num(this.s.fillerAfterMs, 1200), 0, 30000));
    if (!lines.length || !after) return;
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
    const s = this.s;
    return JSON.stringify([voiceEngine(s), s.localVoice, num(s.localSpeed, 1), s.language, String(s.voiceDescription || '').trim(), text]);
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
    if (this.warming || this.closed || !this.started || !fillerPhrases(this.s.fillerLines).length) return;
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
      this.pendingUser = null;
      this.send({ type: 'user.text', text: t });
      this.respond(t, { asrMs: null });
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
    if (this.asr) { this.asr.close(); this.asr = null; }
    try { this.ws.close(1000, why); } catch { /* closed */ }
    this.log(`▸ conversation closed (${why})`);
  }
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
