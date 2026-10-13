/* =============================================================================
 * voice-core.js — the shared core of the two voice-interaction prototypes.
 *
 * It runs in the browser (inside a cables.gl op, or in the lab window of the
 * QVAC backend). It handles everything the two engines have in common:
 *   - the microphone (capture, level, client-side speech detection),
 *   - the bot's voice (playback, level, interruption),
 *   - the state machine of a turn (listening → hearing → thinking → speaking),
 *   - interface sounds (earcons) and the "thinking" sound,
 *   - the shared event vocabulary (see CONTRACT.md).
 *
 * Two engines:
 *   - "gemini": the Gemini Live API (WebSocket, native voice, online);
 *   - "local":  the QVAC backend in the 2_qvac_local folder (local WebSocket).
 *
 * No dependencies. This file defines a single constant: VoiceCore.
 * ========================================================================== */
// eslint-disable-next-line no-unused-vars
const VoiceCore = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Vocabulary
  // ---------------------------------------------------------------------------

  /** The states of a conversation, in the order of a turn. */
  const STATES = ['idle', 'connecting', 'listening', 'hearing', 'thinking', 'speaking', 'ended', 'error'];

  /** All events (see CONTRACT.md). A name missing from this list is rejected. */
  const EVENTS = [
    'state', 'connecting', 'start', 'listening', 'status',
    'user.start', 'user.end', 'user.cancel', 'user.partial', 'user.text', 'not.understood',
    'thinking', 'bot.start', 'bot.text', 'bot.sentence', 'bot.end', 'interrupted', 'turn',
    'ui.choices', 'ui.mood', 'tool.call', 'tool.cancel', 'timing', 'error', 'ended',
    'turn.prediction', 'interruption.pending', 'interruption.cancelled', 'bot.filler', 'user.away',
  ];
  const EVENT_SET = new Set(EVENTS);

  /** Gemini's 30 prebuilt voices (name, character as described by Google). */
  const GEMINI_VOICES = [
    ['Zephyr', 'bright'], ['Puck', 'upbeat'], ['Charon', 'informative'], ['Kore', 'firm'],
    ['Fenrir', 'excitable'], ['Leda', 'youthful'], ['Orus', 'firm'], ['Aoede', 'breezy'],
    ['Callirrhoe', 'easy-going'], ['Autonoe', 'bright'], ['Enceladus', 'breathy'], ['Iapetus', 'clear'],
    ['Umbriel', 'easy-going'], ['Algieba', 'smooth'], ['Despina', 'smooth'], ['Erinome', 'clear'],
    ['Algenib', 'gravelly'], ['Rasalgethi', 'informative'], ['Laomedeia', 'upbeat'], ['Achernar', 'soft'],
    ['Alnilam', 'firm'], ['Schedar', 'even'], ['Gacrux', 'mature'], ['Pulcherrima', 'forward'],
    ['Achird', 'friendly'], ['Zubenelgenubi', 'casual'], ['Vindemiatrix', 'gentle'], ['Sadachbia', 'lively'],
    ['Sadaltager', 'knowledgeable'], ['Sulafat', 'warm'],
  ];

  /** The Supertonic voices (QVAC's local TTS engine): F = female, M = male. */
  const LOCAL_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];

  /** The local voice engines (QVAC): Supertonic (preset voices), Parler (a voice described in words, English),
   *  Chatterbox (multilingual, can clone a voice). */
  const LOCAL_VOICE_ENGINES = ['supertonic', 'parler', 'chatterbox'];

  /** The moods an agent can show (set_mood tool / [[mood: …]] tag). */
  const MOODS = ['neutral', 'happy', 'curious', 'focused', 'sorry', 'surprised', 'excited'];

  const LANGUAGES = { en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese' };

  /** The default settings. Each key is described in CONTRACT.md. */
  const DEFAULTS = {
    engine: 'gemini',                 // 'gemini' | 'local'
    // — persona —
    name: 'Ada',
    persona: 'You are a curious, warm museum guide. You help visitors discover the artworks.',
    language: 'en',
    greeting: '',                     // what the agent says first ('' = waits to be spoken to)
    shortAnswers: true,               // short spoken answers
    creativity: 1,                    // 0 = predictable, 2 = unpredictable (temperature)
    speakingStyle: '',                // Gemini: voice style asked for in the prompt ("slow, calm")
    // — voice —
    geminiVoice: 'Kore',
    localVoiceEngine: 'supertonic',   // local: 'supertonic' | 'parler' | 'chatterbox' (a change reloads the voice)
    localVoice: 'F1',                 // Supertonic only
    localSpeed: 1,                    // speed of the local voice (0.5 – 2): Supertonic and Chatterbox
    voiceDescription: '',             // Parler only: the voice described in words, applied to each sentence
    // — turn-taking —
    endSilenceMs: 800,                // silence that ends a turn (patient ↔ impatient)
    startSensitivity: 'high',         // 'high' | 'low': how easily the start of speech is detected
    endSensitivity: 'high',           // 'high' | 'low': how quickly speech is judged finished
    turnDetection: 'silence',         // local: 'silence' (the end silence decides) | 'smart' (+ the Smart Turn
                                      // model: a finished sentence ends the turn at once, a pause waits for the silence)
    prefixPaddingMs: 20,              // minimum speech before a start counts (Gemini)
    interruptible: true,              // can the agent be interrupted?
    interruptAfterMs: 0,              // local: 0 = any speech over the agent stops it at once; above 0 (to 2000), it
                                      // first lowers its voice and only stops if the person keeps talking this long
                                      // ("mm-hm" → it carries on, "stop" → it stops and listens)
    listenWhileSpeaking: true,        // false = the mic is cut while the agent speaks (half-duplex)
    micMuted: false,
    awayAfterMs: 0,                   // both: silence while listening before "user.away" (0 = never); it fires again
                                      // after each further silence of this length (count 1, 2, …)
    repromptLine: '',                 // both: what the agent says ONCE when the person stays silent (count 1)
    // — feedback —
    replyDelayMs: 0,                  // delay added before the voice starts: latency as a design material
    earcons: 'soft',                  // 'off' | 'soft' | 'clear': small interface sounds
    thinkingSound: 'off',             // 'off' | 'tick' | 'hum': sound while thinking
    repairLine: '',                   // line said when nothing was understood (local engine)
    fillerLines: '',                  // local: short phrases said while a slow reply is prepared, separated by |
                                      // ("Hmm, let me see…|Good question…"); '' = no filler
    fillerAfterMs: 1200,              // local: say a filler if the reply's voice has not started this long after
                                      // the end of the person's turn (0 = never)
    volume: 1,
    playVoice: true,                  // false = the voice does not go to the speakers (only to the audio node)
    // — actions / calls to action —
    uiTools: true,                    // the agent can show choices and a mood
    extraTools: '',                   // JSON: extra function declarations (Gemini)
    // — connection —
    geminiModel: 'gemini-3.8-live',
    apiKey: '',
    tokenUrl: '',                     // e.g. http://localhost:8787/token (token server)
    geminiEndpoint: '',               // advanced: another WebSocket address (proxy, tests)
    serverUrl: 'ws://localhost:8790/voice',
  };

  /** The settings a running session cannot take without restarting. */
  const RESTART_KEYS = {
    gemini: ['engine', 'name', 'persona', 'language', 'greeting', 'shortAnswers', 'creativity', 'speakingStyle',
      'geminiVoice', 'endSilenceMs', 'startSensitivity', 'endSensitivity', 'prefixPaddingMs', 'interruptible',
      'uiTools', 'extraTools', 'geminiModel', 'apiKey', 'tokenUrl', 'geminiEndpoint'],
    local: ['engine', 'serverUrl'],
  };

  /** The settings sent to the local backend (the rest only concerns the browser). */
  const LOCAL_KEYS = ['name', 'persona', 'language', 'greeting', 'shortAnswers', 'creativity', 'localVoice',
    'localSpeed', 'endSilenceMs', 'startSensitivity', 'endSensitivity', 'interruptible', 'repairLine',
    'replyDelayMs', 'uiTools', 'turnDetection', 'interruptAfterMs', 'fillerLines', 'fillerAfterMs',
    'localVoiceEngine', 'voiceDescription'];

  const GEMINI_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService';
  const IN_RATE = 16000;              // what both engines listen to
  const SEND_EVERY_SAMPLES = 1600;    // one send every 100 ms
  const NO_REPLY_MS = { gemini: 10000, local: 90000 };
  const FILLER_TURN = 0xFFFFFFFF;     // the turn id of a filler's audio frames (local engine): not part of the reply
  const DUCK_LEVEL = 0.3;             // the agent's voice while someone talks over it (interruptAfterMs > 0)
  const DUCK_DOWN_S = 0.08;           // ramp down…
  const DUCK_UP_S = 0.15;             // …and back up

  // ---------------------------------------------------------------------------
  // Pure helpers (testable without a browser)
  // ---------------------------------------------------------------------------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  /** The shared system prompt: persona + rules for speech. The local backend has the same function. */
  function systemPrompt(s, engine) {
    const lines = [];
    const name = String(s.name || '').trim();
    lines.push(name ? `Your name is ${name}.` : '');
    lines.push(String(s.persona || '').trim());
    lines.push('');
    lines.push('Rules: you are talking out loud with a person, in a spoken conversation.');
    lines.push(`- Always answer in ${LANGUAGES[s.language] || s.language || 'English'}.`);
    if (s.shortAnswers) lines.push('- Short answers: one to three sentences, one question at a time.');
    lines.push('- No lists, no markdown, no emoji: everything you write is spoken out loud.');
    if (s.speakingStyle && engine === 'gemini') lines.push(`- Your way of speaking: ${String(s.speakingStyle).trim()}.`);
    if (s.uiTools) {
      if (engine === 'gemini') {
        lines.push('- When you offer options, say them and call show_choices to show them as buttons.');
        lines.push(`- When your mood changes, call set_mood (${MOODS.join(', ')}).`);
      } else {
        lines.push('- When you offer options, say them, then end with [[choices: option 1 | option 2]].');
        lines.push(`- When your mood changes, add [[mood: ${MOODS[1]}]] (${MOODS.join(', ')}).`);
      }
    }
    return lines.filter((l, i) => l !== '' || i > 1).join('\n').trim();
  }

  /** The tools declared to Gemini: the interface ones + those from the "extraTools" JSON. */
  function geminiTools(s) {
    const decls = [];
    if (s.uiTools) {
      decls.push({
        name: 'show_choices',
        description: 'Shows choice buttons on screen when you offer options. Also say the options out loud.',
        behavior: 'NON_BLOCKING',
        parameters: {
          type: 'OBJECT',
          properties: {
            question: { type: 'STRING', description: 'The question, in a few words.' },
            options: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Two to four short options.' },
          },
          required: ['options'],
        },
      });
      decls.push({
        name: 'set_mood',
        description: 'Tells the interface your mood so it can show it.',
        behavior: 'NON_BLOCKING',
        parameters: { type: 'OBJECT', properties: { mood: { type: 'STRING', enum: MOODS.slice() } }, required: ['mood'] },
      });
    }
    const extra = parseExtraTools(s.extraTools);
    if (extra.error) return { tools: decls.length ? [{ functionDeclarations: decls }] : [], error: extra.error };
    for (const d of extra.list) decls.push(d);
    return { tools: decls.length ? [{ functionDeclarations: decls }] : [], error: null };
  }

  /** extraTools: an array of declarations, or {functionDeclarations:[…]}, or ''. */
  function parseExtraTools(text) {
    const t = String(text || '').trim();
    if (!t) return { list: [], error: null };
    let v;
    try { v = JSON.parse(t); } catch (e) { return { list: [], error: 'The tools JSON is invalid: ' + e.message }; }
    const list = Array.isArray(v) ? v : (v && Array.isArray(v.functionDeclarations) ? v.functionDeclarations : null);
    if (!list) return { list: [], error: 'Tools must be an array of function declarations.' };
    const bad = list.find((d) => !d || typeof d.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(d.name));
    if (bad) return { list: [], error: 'Each tool needs a "name" (letters, digits, _).' };
    return { list, error: null };
  }

  /** The Gemini Live `setup` message for these settings. */
  function geminiSetup(s, resumeHandle) {
    const t = geminiTools(s);
    const setup = {
      model: 'models/' + String(s.geminiModel || DEFAULTS.geminiModel).replace(/^models\//, ''),
      generationConfig: {
        responseModalities: ['AUDIO'],
        temperature: clamp(num(s.creativity, 1), 0, 2),
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: s.geminiVoice || DEFAULTS.geminiVoice } } },
      },
      systemInstruction: { parts: [{ text: systemPrompt(s, 'gemini') }] },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: s.startSensitivity === 'low' ? 'START_SENSITIVITY_LOW' : 'START_SENSITIVITY_HIGH',
          endOfSpeechSensitivity: s.endSensitivity === 'low' ? 'END_SENSITIVITY_LOW' : 'END_SENSITIVITY_HIGH',
          prefixPaddingMs: Math.round(clamp(num(s.prefixPaddingMs, 20), 0, 2000)),
          silenceDurationMs: Math.round(clamp(num(s.endSilenceMs, 800), 100, 5000)),
        },
        activityHandling: s.interruptible === false ? 'NO_INTERRUPTION' : 'START_OF_ACTIVITY_INTERRUPTS',
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
      contextWindowCompression: { slidingWindow: {} },
    };
    if (t.tools.length) setup.tools = t.tools;
    return { setup, toolsError: t.error };
  }

  /** Base64 ⇄ bytes, in chunks (one call per 32 KB). */
  function bytesToB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToInt16(b64) {
    const bin = atob(b64);
    const n = bin.length >> 1;
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      out[i] = v >= 0x8000 ? v - 0x10000 : v;
    }
    return out;
  }
  function floatToInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const x = clamp(f32[i], -1, 1);
      out[i] = x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff);
    }
    return out;
  }
  function rms(block) {
    let sum = 0;
    for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
    return block.length ? Math.sqrt(sum / block.length) : 0;
  }

  /** Stateful resampler (window average = low-pass): browser rate → 16 kHz. */
  function makeDownsampler(inRate, outRate) {
    const ratio = inRate / outRate;
    let acc = 0; let accN = 0; let index = 0; let edge = ratio;
    return function (input) {
      const out = new Float32Array(Math.ceil(input.length / ratio) + 2);
      let k = 0;
      for (let i = 0; i < input.length; i++) {
        acc += input[i]; accN++; index++;
        if (index >= edge) { out[k++] = acc / accN; acc = 0; accN = 0; edge += ratio; }
      }
      return out.subarray(0, k);
    };
  }

  /**
   * Browser-side speech detector (energy). It does not decide the turn for Gemini
   * (the server does), but it gives IMMEDIATE feedback to the interface ("I hear you").
   */
  function makeClientVad() {
    let noise = 0.006; let calMs = 0; let phase = 'quiet'; let aboveMs = 0; let belowMs = 0; let speechMs = 0;
    return {
      reset() { phase = 'quiet'; aboveMs = 0; belowMs = 0; speechMs = 0; },
      get noise() { return noise; },
      get speaking() { return phase === 'speech'; },
      /** @returns {'start'|'end'|'cancel'|null} */
      step(level, dtMs, o) {
        const sens = o.sensitivity === 'low' ? 0.3 : 0.7;
        const threshold = Math.max(0.012 * (1.6 - sens), noise * (4 - 2.5 * sens)) * (o.botSpeaking ? 4 : 1);
        if (calMs < 500) {                                    // first, listen to the room
          calMs += dtMs;
          noise += (1 - Math.exp(-dtMs / 150)) * (level - noise);
          return null;
        }
        if (phase === 'quiet') {
          if (level > threshold) {
            aboveMs += dtMs;
            if (aboveMs >= 120) { phase = 'speech'; belowMs = 0; speechMs = aboveMs; return 'start'; }
          } else {
            aboveMs = 0;
            if (!o.botSpeaking) noise = clamp(noise + (1 - Math.exp(-dtMs / 1500)) * (level - noise), 0.001, 0.2);
          }
          return null;
        }
        speechMs += dtMs;
        if (level > threshold * 0.6) belowMs = 0; else belowMs += dtMs;
        if (belowMs >= o.endSilenceMs || speechMs > 30000) {
          phase = 'quiet'; aboveMs = 0;
          return speechMs - belowMs >= 300 ? 'end' : 'cancel';
        }
        return null;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Gemini Live engine
  // ---------------------------------------------------------------------------

  const DROP_TAIL_MS = 500;      // window for the tail of an interrupted reply (see clientContent)

  function GeminiEngine(hooks) {
    this.h = hooks; this.ws = null; this.s = null; this.resume = null; this.url = '';
    this.closing = false; this.retries = 0; this.pendingTools = new Map(); this.ready = false;
    this.pendingReject = null;
    // The generation in progress on Gemini's side, and what WE caused:
    this.generating = false;      // from the model's first content until turnComplete / interrupted
    this.ownInterrupt = false;    // we sent a message during a generation: the next "interrupted"
                                  // or "turnComplete" belongs to the old reply, not the new one
    this.dropOldUntil = 0;        // until when to ignore pieces of the old reply already on their way
    this.swallowTurnComplete = false;
    this.contextQueue = [];
  }

  function cancelled() { return fail('cancelled', 'Start cancelled.'); }

  GeminiEngine.prototype.makeUrl = async function (s) {
    const base = String(s.geminiEndpoint || GEMINI_WS).replace(/\/+$/, '');
    if (String(s.tokenUrl || '').trim()) {
      let res;
      try { res = await fetch(String(s.tokenUrl).trim(), { method: 'POST' }); } catch (e) {
        throw fail('token', 'The token server isn\'t responding (' + s.tokenUrl + '). Is it running?');
      }
      let j = null;
      try { j = await res.json(); } catch (e) { j = null; }
      if (!res.ok || !j || !(j.token || j.name)) {
        throw fail('token', 'The token server refused: ' + ((j && j.error) || ('HTTP ' + res.status)));
      }
      return base + '.BidiGenerateContentConstrained?access_token=' + encodeURIComponent(j.token || j.name);
    }
    const key = String(s.apiKey || '').trim();
    if (!key) throw fail('auth', 'You need a Gemini API key, or the address of a token server.');
    return base + '.BidiGenerateContent?key=' + encodeURIComponent(key);
  };

  GeminiEngine.prototype.connect = async function (s) {
    this.s = s; this.closing = false;
    const url = await this.makeUrl(s);
    if (this.closing) throw cancelled();
    this.url = url;
    await this.open(false);
  };

  GeminiEngine.prototype.open = function (resuming) {
    const self = this;
    return new Promise(function (resolve, reject) {
      let settled = false;
      const settle = function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        self.pendingReject = null;
        if (err) reject(err); else resolve();
      };
      if (self.closing) { reject(cancelled()); return; }
      let ws;
      try { ws = new WebSocket(self.url); } catch (e) { reject(fail('network', 'Cannot connect to Gemini: ' + e.message)); return; }
      ws.binaryType = 'arraybuffer';
      self.ws = ws; self.ready = false;
      self.pendingReject = function (err) { try { ws.close(); } catch (e) { /* already closed */ } settle(err); };
      const timer = setTimeout(function () {
        try { ws.close(); } catch (e) { /* already closed */ }
        settle(fail('timeout', 'Gemini isn\'t responding (timed out).'));
      }, 15000);
      ws.onopen = function () {
        const out = geminiSetup(self.s, resuming ? self.resume : null);
        if (out.toolsError) self.h.error('tools', out.toolsError, false);
        ws.send(JSON.stringify({ setup: out.setup }));
      };
      ws.onmessage = function (e) {
        if (self.ws !== ws) return;
        const msg = parseJson(e.data);
        if (!msg) return;
        if (msg.setupComplete !== undefined) {
          self.ready = true; self.retries = 0;
          self.generating = false; self.ownInterrupt = false; self.dropOldUntil = 0; self.swallowTurnComplete = false;
          settle(null);
          if (!resuming && String(self.s.greeting || '').trim()) {
            self.sendText('(The conversation is starting. Open it by saying, in your own words: "' + String(self.s.greeting).trim() + '")', true);
          }
          return;
        }
        self.handle(msg);
      };
      ws.onerror = function () { /* the details arrive in onclose */ };
      ws.onclose = function (e) {
        const why = closeWhy(e);
        if (!settled) { settle(self.closing ? cancelled() : fail(why.code, why.message)); return; }
        if (self.ws !== ws) return;
        self.ready = false;
        if (self.closing) return;
        if (self.resume && self.retries < 3) { self.reconnect('connection closed'); return; }
        self.h.error(why.code, why.message, true);
      };
    });
  };

  GeminiEngine.prototype.reconnect = async function (why) {
    const self = this;
    if (self.closing) return;
    self.retries++;
    self.h.status('Reconnecting to Gemini (' + why + ')…');
    const old = self.ws;
    self.ws = null;
    try { if (old) old.close(); } catch (e) { /* already closed */ }
    try {
      // An ephemeral token expires (30 min): ask for a new one at each reconnection.
      if (String(self.s.tokenUrl || '').trim()) self.url = await self.makeUrl(self.s);
      if (self.closing) return;
      await self.open(true);
      self.h.status('');
    } catch (err) {
      if (self.closing || (err && err.code === 'cancelled')) return;
      if (self.retries < 3 && self.resume) setTimeout(function () { self.reconnect('retrying'); }, 800);
      else self.h.error(err.code || 'network', err.message, true);
    }
  };

  GeminiEngine.prototype.send = function (obj) {
    if (this.ws && this.ready && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
    return false;
  };

  GeminiEngine.prototype.sendAudio = function (int16) {
    this.send({ realtimeInput: { audio: { data: bytesToB64(new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength)), mimeType: 'audio/pcm;rate=16000' } } });
  };

  /**
   * Any clientContent message interrupts the generation in progress (API reference): we prepare for it.
   * Pieces of the old reply that already left the server arrive right after (one network round trip):
   * we ignore them for a short window. It stays short, so it never eats the start of the new reply
   * if Gemini does not confirm the interruption.
   */
  GeminiEngine.prototype.clientContent = function (text, complete) {
    if (this.generating) {
      this.ownInterrupt = true;
      this.dropOldUntil = Date.now() + DROP_TAIL_MS;
    }
    return this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: String(text) }] }], turnComplete: complete !== false } });
  };

  GeminiEngine.prototype.sendText = function (text, complete) { return this.clientContent(text, complete); };

  /** Information that needs no reply. During a generation it waits for the end: otherwise it would cut it off. */
  GeminiEngine.prototype.sendContext = function (text) {
    if (this.generating) { this.contextQueue.push(String(text)); return true; }
    return this.clientContent(text, false);
  };

  GeminiEngine.prototype.flushContext = function () {
    while (this.contextQueue.length && !this.generating) this.clientContent(this.contextQueue.shift(), false);
  };

  /**
   * The person stays silent (awayAfterMs): the model is asked to say the reprompt line in its own words.
   * Nothing is shown or recorded as a user turn: the reply is an ordinary agent turn.
   */
  GeminiEngine.prototype.reprompt = function (line, afterMs) {
    const secs = Math.round(num(afterMs, 0) / 100) / 10;
    return this.clientContent('(The user has been silent for ' + secs + ' seconds. Say, in your own words: "' + String(line).trim() + '")', true);
  };

  /** A stop coming from the interface: the rest of the reply is ignored, and the model is told. */
  GeminiEngine.prototype.interrupt = function (said) {
    this.clientContent('(Note: the user interrupted you after "' + String(said || '').slice(-200) + '". Wait for what they say next.)', false);
  };

  GeminiEngine.prototype.dropping = function () {
    if (this.dropOldUntil && Date.now() > this.dropOldUntil) this.dropOldUntil = 0;
    return this.dropOldUntil > 0;
  };

  GeminiEngine.prototype.handle = function (msg) {
    const h = this.h;
    if (msg.voiceActivity && msg.voiceActivity.type) {
      if (msg.voiceActivity.type === 'ACTIVITY_START') h.remoteSpeech(true);
      if (msg.voiceActivity.type === 'ACTIVITY_END') { h.remoteSpeech(false); h.userTurnEnd(); }
    }
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) {
        const ours = this.ownInterrupt;
        this.generating = false;
        this.ownInterrupt = false;
        this.dropOldUntil = 0;
        this.swallowTurnComplete = true;       // the old reply's turnComplete may follow
        if (!ours) h.interrupted(0, 'user');
        this.flushContext();
      }
      if (sc.inputTranscription && sc.inputTranscription.text) h.userTranscript(sc.inputTranscription.text, 'append');
      const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
      const content = parts.some(function (p) { return p && p.inlineData && p.inlineData.data; }) || !!(sc.outputTranscription && sc.outputTranscription.text);
      const drop = content && this.dropping();
      if (content && !drop) {
        // Content after the window, with no confirmation from Gemini: the old reply stopped without saying so.
        this.ownInterrupt = false;
        this.generating = true; this.swallowTurnComplete = false;
      }
      if (!drop) {
        for (const p of parts) {
          if (p && p.inlineData && p.inlineData.data && /^audio\//.test(p.inlineData.mimeType || 'audio/pcm')) {
            const m = /rate=(\d+)/.exec(p.inlineData.mimeType || '');
            h.botAudio(b64ToInt16(p.inlineData.data), m ? Number(m[1]) : 24000, 0);
          }
        }
        if (sc.outputTranscription && sc.outputTranscription.text) h.botTranscript(sc.outputTranscription.text, true);
      }
      if (sc.turnComplete) {
        if (this.ownInterrupt) {                // the end of the old reply, which we cut off
          this.dropOldUntil = 0; this.ownInterrupt = false; this.generating = false;
        } else if (this.swallowTurnComplete) {
          this.swallowTurnComplete = false;
        } else {
          this.generating = false;
          h.botDone(0);
        }
        this.flushContext();
      }
    }
    if (msg.toolCall && Array.isArray(msg.toolCall.functionCalls)) {
      for (const fc of msg.toolCall.functionCalls) this.onToolCall(fc);
    }
    if (msg.toolCallCancellation && Array.isArray(msg.toolCallCancellation.ids)) {
      for (const id of msg.toolCallCancellation.ids) this.pendingTools.delete(id);
      h.toolCancel(msg.toolCallCancellation.ids);
    }
    if (msg.sessionResumptionUpdate) {
      const u = msg.sessionResumptionUpdate;
      if (u.resumable !== false && u.newHandle) this.resume = u.newHandle;
    }
    if (msg.goAway) {
      const self = this;
      if (self.resume) setTimeout(function () { self.reconnect('session ending'); }, 200);
      else h.status('Gemini will close the session soon (time limit).');
    }
  };

  GeminiEngine.prototype.onToolCall = function (fc) {
    const args = (fc && fc.args) || {};
    const name = String((fc && fc.name) || '');
    if (name === 'show_choices' || name === 'set_mood') {
      if (name === 'show_choices') {
        const options = Array.isArray(args.options) ? args.options.map(String).filter(Boolean).slice(0, 6) : [];
        this.h.ui('choices', { question: String(args.question || ''), options: options });
      } else {
        this.h.ui('mood', { mood: String(args.mood || 'neutral') });
      }
      // SILENT: the model gets the result without talking about it (scheduling goes INSIDE response, as in the docs).
      this.send({ toolResponse: { functionResponses: [{ id: fc.id, name: name, response: { result: 'ok', scheduling: 'SILENT' } }] } });
      return;
    }
    const self = this;
    const timer = setTimeout(function () {
      if (!self.pendingTools.has(fc.id)) return;
      self.sendToolResult(fc.id, { result: 'No response from the interface.' });
    }, 10000);
    this.pendingTools.set(fc.id, { name: name, timer: timer });
    this.h.toolCall({ id: fc.id, name: name, args: args });
  };

  GeminiEngine.prototype.sendToolResult = function (id, result) {
    const p = this.pendingTools.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pendingTools.delete(id);
    const response = result && typeof result === 'object' && !Array.isArray(result) ? result : { result: result };
    return this.send({ toolResponse: { functionResponses: [{ id: id, name: p.name, response: response }] } });
  };

  GeminiEngine.prototype.update = function () { /* nothing live: a setup cannot change during a session */ };
  GeminiEngine.prototype.playbackEnded = function () {};

  GeminiEngine.prototype.close = function () {
    this.closing = true;
    for (const p of this.pendingTools.values()) clearTimeout(p.timer);
    this.pendingTools.clear();
    this.contextQueue = [];
    if (this.pendingReject) this.pendingReject(cancelled());
    try { if (this.ws) this.ws.close(1000, 'stop'); } catch (e) { /* already closed */ }
    this.ws = null;
  };

  function closeWhy(e) {
    const reason = (e && e.reason) ? String(e.reason) : '';
    const code = e ? e.code : 0;
    if (code === 1007 || code === 1008) return { code: 'refused', message: 'Gemini refused the session (' + (reason || 'invalid key, token or setting') + '). Check the API key or the token server, then click Start.' };
    if (code === 1011) return { code: 'server', message: 'Gemini closed the session: ' + (reason || 'quota exceeded or server error') + '.' };
    if (code === 1000) return { code: 'closed', message: 'Session closed' + (reason ? ': ' + reason : '.') };
    return { code: 'network', message: 'Lost the connection to Gemini' + (reason ? ': ' + reason : '') + ' (code ' + code + ').' };
  }

  // ---------------------------------------------------------------------------
  // Local engine (QVAC backend, 2_qvac_local folder)
  // ---------------------------------------------------------------------------

  function LocalEngine(hooks) { this.h = hooks; this.ws = null; this.ready = false; this.closing = false; this.pendingReject = null; }

  LocalEngine.prototype.connect = function (s) {
    const self = this;
    self.closing = false;
    return new Promise(function (resolve, reject) {
      let settled = false;
      self.pendingReject = function (err) { if (!settled) { settled = true; clearTimeout(timer); self.pendingReject = null; reject(err); } };
      let ws;
      try { ws = new WebSocket(String(s.serverUrl || DEFAULTS.serverUrl)); } catch (e) { reject(fail('network', 'Invalid local server address: ' + e.message)); return; }
      ws.binaryType = 'arraybuffer';
      self.ws = ws;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true; try { ws.close(); } catch (e) { /* closed */ }
        reject(fail('timeout', 'The local server isn\'t responding: is the Voice Lab app open?'));
      }, 10000);
      ws.onopen = function () { ws.send(JSON.stringify({ type: 'start', settings: pick(s, LOCAL_KEYS) })); };
      ws.onmessage = function (e) {
        if (typeof e.data !== 'string') { self.onAudio(e.data); return; }
        const m = parseJson(e.data);
        if (!m || typeof m.type !== 'string') return;
        if (m.type === 'status' && !settled) clearTimeout(timer);      // the models are loading: keep waiting
        if (m.type === 'ready') {
          self.ready = true;
          if (!settled) { settled = true; clearTimeout(timer); self.pendingReject = null; resolve(); }
          return;
        }
        if (m.type === 'error' && m.fatal && !settled) { settled = true; clearTimeout(timer); reject(fail(m.code || 'server', m.message)); return; }
        self.onMessage(m);
      };
      ws.onerror = function () {};
      ws.onclose = function (e) {
        clearTimeout(timer);
        self.ready = false;
        if (!settled) { settled = true; self.pendingReject = null; reject(self.closing ? fail('cancelled', 'Start cancelled.') : fail('network', 'No local server at ' + s.serverUrl + ': open the Voice Lab app (or run "npm start" in 2_qvac_local).')); return; }
        if (!self.closing) self.h.error('network', 'The local server closed the connection' + (e.reason ? ': ' + e.reason : '.'), true);
      };
    });
  };

  LocalEngine.prototype.onAudio = function (buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 10) return;
    const dv = new DataView(buf);
    const rate = dv.getUint32(0, true);
    const turnId = dv.getUint32(4, true);
    this.h.botAudio(new Int16Array(buf.slice(8, 8 + ((buf.byteLength - 8) & ~1))), rate, turnId);
  };

  LocalEngine.prototype.onMessage = function (m) {
    const h = this.h;
    if (this.closing) return;
    switch (m.type) {
      case 'status': h.status(m.text || '', m.progress); break;
      case 'vad': h.remoteSpeech(!!m.speaking); break;
      case 'user.partial': h.userTranscript(m.text || '', 'partial'); break;
      case 'user.text':
        if (m.reply === false) { h.userNoReply(m.text || ''); break; }      // a "stop" said over the agent
        h.userTranscript(m.text || '', 'final'); h.userTurnEnd();
        break;
      case 'not.understood': h.notUnderstood(m.text || ''); break;
      case 'thinking': h.thinking(m.turnId); break;
      case 'bot.text': h.botTranscript(m.text || '', false); break;
      case 'bot.sentence': h.botSentence(m.text || '', m.index || 0); break;
      case 'bot.done': h.botDone(m.turnId || 0); break;
      case 'interrupted': h.interrupted(m.turnId || 0, m.by || 'user'); break;
      case 'ui.choices': h.ui('choices', { question: m.question || '', options: Array.isArray(m.options) ? m.options : [] }); break;
      case 'ui.mood': h.ui('mood', { mood: m.mood || 'neutral' }); break;
      case 'tool.call': h.toolCall({ id: m.id, name: m.name, args: m.args || {} }); break;
      case 'timing': h.timing(m.turnId || 0, m.ms || {}); break;
      case 'turn.prediction': h.turnPrediction(m); break;
      case 'bot.filler': h.filler(m.text || ''); break;
      case 'bot.duck': h.duck(true, m); break;
      case 'bot.unduck': h.duck(false, m); break;
      case 'error':
        // Another page took over the conversation: this one is over, and THIS message must stay on screen
        // (the close that follows must not replace it with a generic "connection closed").
        if (m.code === 'replaced') { h.error('replaced', m.message || 'Another page opened a conversation.', true); break; }
        h.error(m.code || 'server', m.message || 'Local server error.', !!m.fatal);
        break;
      default: break;
    }
  };

  LocalEngine.prototype.send = function (o) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; };
  LocalEngine.prototype.sendAudio = function (int16) {
    if (this.ws && this.ready && this.ws.readyState === 1) this.ws.send(int16.slice().buffer);
  };
  LocalEngine.prototype.sendText = function (text) { return this.send({ type: 'text', text: String(text) }); };
  LocalEngine.prototype.sendContext = function (text) { return this.send({ type: 'context', text: String(text) }); };
  LocalEngine.prototype.interrupt = function () { this.send({ type: 'interrupt' }); };
  /** The person stays silent (awayAfterMs): the local server says the line as written, as an agent turn. */
  LocalEngine.prototype.reprompt = function (line) { return this.send({ type: 'say', text: String(line).trim() }); };
  LocalEngine.prototype.sendToolResult = function (id, result) { return this.send({ type: 'tool.result', id: id, result: result }); };
  LocalEngine.prototype.update = function (s) { this.send({ type: 'settings', settings: pick(s, LOCAL_KEYS) }); };
  LocalEngine.prototype.playbackEnded = function (turnId) { this.send({ type: 'playback', state: 'ended', turnId: turnId }); };
  LocalEngine.prototype.close = function () {
    this.closing = true;
    if (this.pendingReject) this.pendingReject(fail('cancelled', 'Start cancelled.'));
    try { this.send({ type: 'stop' }); } catch (e) { /* closed */ }
    try { if (this.ws) this.ws.close(1000, 'stop'); } catch (e) { /* closed */ }
    this.ws = null;
  };

  // ---------------------------------------------------------------------------
  // The agent: mic, voice, states, events
  // ---------------------------------------------------------------------------

  /**
   * @param {{settings?: object, getAudioContext?: () => AudioContext}} [options]
   */
  function createVoiceAgent(options) {
    const opts = options || {};
    let settings = Object.assign({}, DEFAULTS, opts.settings || {});
    const listeners = new Map();
    let state = 'idle';
    let startedAt = 0;
    let ctx = null; let stream = null; let micSrc = null; let proc = null; let sink = null;
    let outGain = null; let analyser = null; let micAnalyserBuf = null;
    let engine = null; let engineName = settings.engine; let active = false; let starting = null; let startGen = 0;
    let down = null; let sendBuf = new Int16Array(SEND_EVERY_SAMPLES); let sendLen = 0;
    const vad = makeClientVad();
    let userLevel = 0; let botLevelSmooth = 0;
    // the bot's voice
    let sources = new Set(); let nextTime = 0; let botStarted = false; let botDoneFlag = false;
    let fillerSources = new Set();          // a filler being said while the agent thinks (local engine)
    let dropBelowTurn = 0; let playTurnId = 0; let gapTimer = 0; let startTimers = [];
    // the current turn
    let turn = newTurn(); const turns = [];
    let remoteHeard = false; let noReplyTimer = 0; let lastSpeechAt = 0; let serverTurnId = 0;
    let thinkingStop = null;
    let duckFactor = 1; let duckPending = false;    // someone talks over the agent: its voice is lowered
    let awayTimer = 0; let awayCount = 0;           // the person stays silent while the agent listens (awayAfterMs)

    function newTurn() { return { user: '', userTextSent: false, typed: false, bot: '', interrupted: false, userStartAt: 0, userEndAt: 0, botStartAt: 0, botEndAt: 0, ms: {} }; }
    function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

    // — events —
    function emit(type, data) {
      if (!EVENT_SET.has(type)) throw new Error('voice-core: unknown event "' + type + '"');
      const ev = Object.assign({ type: type, state: state, t: Math.round(startedAt ? now() - startedAt : 0) }, data || {});
      const run = function (fn) { try { fn(ev); } catch (e) { if (typeof console !== 'undefined') console.error('[voice-core] listener', type, e); } };
      (listeners.get(type) || []).slice().forEach(run);
      (listeners.get('*') || []).slice().forEach(run);
      return ev;
    }
    function on(type, fn) {
      if (type !== '*' && !EVENT_SET.has(type)) throw new Error('voice-core: unknown event "' + type + '"');
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      return function () { off(type, fn); };
    }
    function off(type, fn) {
      const l = listeners.get(type);
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    }
    function setState(next) {
      if (next === state) return;
      const prev = state;
      state = next;
      emit('state', { prev: prev });
      if (next !== 'thinking') stopThinkingSound();
      if (next === 'listening') armAway(); else clearAway();
    }

    // — the person stays silent: "user.away" (and a reprompt, once) —
    function awayMs() { return Math.round(clamp(num(settings.awayAfterMs, 0), 0, 3600000)); }
    function clearAway() { clearTimeout(awayTimer); awayTimer = 0; }
    function armAway() {
      clearAway();
      const ms = awayMs();
      if (!ms || !active || state !== 'listening') return;
      awayTimer = setTimeout(onAway, ms);
    }
    function onAway() {
      awayTimer = 0;
      if (!active || state !== 'listening') return;
      const ms = awayMs();
      awayCount++;
      emit('user.away', { afterMs: ms, count: awayCount });
      const line = String(settings.repromptLine || '').trim();
      if (awayCount === 1 && line && engine && active && state === 'listening') engine.reprompt(line, ms);
      armAway();                                   // the next firing (count 2, 3…) if the silence goes on
    }

    // — interface sounds (earcons) —
    function earcon(kind) {
      if (!ctx || settings.earcons === 'off') return;
      const vol = (settings.earcons === 'clear' ? 0.22 : 0.07) * clamp(num(settings.volume, 1), 0, 2);
      const notes = { ready: [523], heard: [660, 880], error: [196, 165], choices: [784, 988, 1175], done: [880, 660] }[kind];
      if (!notes) return;
      const t0 = ctx.currentTime + 0.01;
      notes.forEach(function (f, i) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t = t0 + i * 0.07;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + 0.14);
      });
    }
    function startThinkingSound() {
      stopThinkingSound();
      if (!ctx || settings.thinkingSound === 'off') return;
      const vol = 0.05 * clamp(num(settings.volume, 1), 0, 2);
      if (settings.thinkingSound === 'hum') {
        const o = ctx.createOscillator(); const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain(); const g = ctx.createGain();
        o.frequency.value = 150; lfo.frequency.value = 3; lfoGain.gain.value = vol * 0.5;
        g.gain.value = 0; g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.3);
        lfo.connect(lfoGain); lfoGain.connect(g.gain); o.connect(g); g.connect(ctx.destination);
        o.start(); lfo.start();
        thinkingStop = function () {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.15);
          o.stop(t + 0.2); lfo.stop(t + 0.2);
        };
      } else {
        const tick = function () {
          const o = ctx.createOscillator(); const g = ctx.createGain(); const t = ctx.currentTime + 0.005;
          o.frequency.value = 1400; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
          o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.04);
        };
        tick();
        const id = setInterval(tick, 450);
        thinkingStop = function () { clearInterval(id); };
      }
    }
    function stopThinkingSound() { if (thinkingStop) { const f = thinkingStop; thinkingStop = null; try { f(); } catch (e) { /* already stopped */ } } }

    // — the voice level: volume × duck factor —
    function voiceGain() { return clamp(num(settings.volume, 1), 0, 2) * duckFactor; }
    function rampGain(seconds) {
      if (!outGain || !ctx) return;
      const g = outGain.gain; const t = ctx.currentTime;
      try { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(voiceGain(), t + seconds); } catch (e) { g.value = voiceGain(); }
    }
    /** Back to full voice, without an event (a real interruption, a new turn, the end of the reply). */
    function resetDuck(seconds) {
      duckPending = false;
      if (duckFactor === 1) return;
      duckFactor = 1;
      rampGain(seconds == null ? 0.05 : seconds);
    }

    // — microphone —
    function onAudioBlock(e) {
      const input = e.inputBuffer.getChannelData(0);
      const dtMs = (input.length / ctx.sampleRate) * 1000;
      const level = settings.micMuted ? 0 : rms(input);
      userLevel = Math.max(level * 4 > userLevel ? clamp(level * 4, 0, 1) : userLevel * 0.85, 0);
      const playing = botIsPlaying();
      // the client-side detector: only while the agent is listening (otherwise it hears its own voice)
      const ev = vad.step(level, dtMs, { sensitivity: settings.startSensitivity, endSilenceMs: clamp(num(settings.endSilenceMs, 800), 200, 5000), botSpeaking: playing });
      if (vad.speaking) lastSpeechAt = now();
      if (ev === 'start' && state === 'listening') userStart('client');
      else if (ev === 'end' && state === 'hearing') clientSilence();
      else if (ev === 'cancel' && state === 'hearing' && !remoteHeard) { setState('listening'); emit('user.cancel'); }
      else if (state === 'hearing' && now() - lastSpeechAt > clamp(num(settings.endSilenceMs, 800), 200, 5000) + 2500) {
        // no sign of speech any more (neither here nor on the server): don't stay stuck on "hearing"
        if (turn.user.trim() && engineName === 'gemini') endUserTurn('timeout');
        else if (!turn.user.trim()) { setState('listening'); emit('user.cancel', { reason: 'silence' }); }
      }
      // send to the engine, in 100 ms packets
      if (!engine || !active || settings.micMuted) return;
      if (playing && settings.listenWhileSpeaking === false) return;
      const pcm = floatToInt16(down(input));
      for (let i = 0; i < pcm.length; i++) {
        sendBuf[sendLen++] = pcm[i];
        if (sendLen === SEND_EVERY_SAMPLES) { engine.sendAudio(sendBuf); sendBuf = new Int16Array(SEND_EVERY_SAMPLES); sendLen = 0; }
      }
    }

    // — the agent's voice —
    function botIsPlaying() { return sources.size > 0 || fillerSources.size > 0 || (ctx && nextTime > ctx.currentTime + 0.01); }
    function pcmBuffer(int16, rate) {
      const buf = ctx.createBuffer(1, int16.length, rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;
      return buf;
    }
    /**
     * A filler ("Hmm, let me see…"), said while the agent thinks. Same output (the levels move), but it is not
     * the reply: the state stays "thinking", and the reply's voice is queued right after it.
     */
    function playFiller(int16, rate) {
      if (!ctx || !active || !int16.length) return;
      if (state !== 'thinking' || botStarted || sources.size) return;       // the reply already speaks: too late
      const src = ctx.createBufferSource();
      src.buffer = pcmBuffer(int16, rate);
      src.connect(outGain);
      const at = Math.max(nextTime, ctx.currentTime + 0.03);
      src.start(at);
      nextTime = at + src.buffer.duration;
      fillerSources.add(src);
      if (turn.ms.filler == null && turn.userEndAt) turn.ms.filler = Math.round(now() + (at - ctx.currentTime) * 1000 - turn.userEndAt);
      src.onended = function () {
        fillerSources.delete(src);
        if (fillerSources.size === 0 && botDoneFlag && state === 'thinking' && sources.size === 0 && !botStarted) silentReplyDone();
      };
    }
    function playPcm(int16, rate, turnId) {
      if (!ctx || !active || !int16.length) return;
      if (turnId === FILLER_TURN) { playFiller(int16, rate); return; }
      if (turnId && turnId < dropBelowTurn) return;
      if (state === 'listening' || state === 'hearing') {          // a reply with no end of turn seen: create one
        if (state === 'hearing' || turn.user) endUserTurn('server');
        else turn.userEndAt = 0;                  // the agent speaks on its own (greeting, follow-up)
      }
      if (turnId) playTurnId = turnId;
      const buf = pcmBuffer(int16, rate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(outGain);
      const first = !botStarted && sources.size === 0;
      let at = Math.max(nextTime, ctx.currentTime + 0.03);
      if (first) {
        const delay = clamp(num(settings.replyDelayMs, 0), 0, 10000) / 1000;
        const sinceEnd = turn.userEndAt ? (now() - turn.userEndAt) / 1000 : 0;
        at = Math.max(at, ctx.currentTime + Math.max(0, delay - sinceEnd));
      }
      src.start(at);
      nextTime = at + buf.duration;
      sources.add(src);
      clearTimeout(gapTimer);
      if (first) {
        const wait = Math.max(0, (at - ctx.currentTime) * 1000);
        startTimers.push(setTimeout(function () { if (sources.has(src)) botStart(); }, wait));
      }
      src.onended = function () {
        sources.delete(src);
        if (sources.size === 0) maybeBotEnd();
      };
    }
    function stopPlayback() {
      startTimers.forEach(clearTimeout); startTimers = [];
      clearTimeout(gapTimer);
      for (const s of sources) { try { s.onended = null; s.stop(); } catch (e) { /* already finished */ } }
      for (const s of fillerSources) { try { s.onended = null; s.stop(); } catch (e) { /* already finished */ } }
      sources = new Set();
      fillerSources = new Set();
      nextTime = 0;
      botStarted = false;
    }
    function botStart() {
      if (botStarted) return;
      botStarted = true;
      clearTimeout(noReplyTimer);
      turn.botStartAt = now();
      sendUserText();
      if (turn.userEndAt) turn.ms.firstSound = Math.round(turn.botStartAt - turn.userEndAt);
      setState('speaking');
      emit('bot.start', { waitMs: turn.ms.firstSound == null ? null : turn.ms.firstSound });
    }
    function maybeBotEnd() {
      if (!botDoneFlag) {                                 // the rest has not arrived yet
        clearTimeout(gapTimer);
        gapTimer = setTimeout(function () {
          if (botIsPlaying()) return;
          if (botDoneFlag) { botEnd(); return; }
          // Still nothing and no announced end (reconnection in the middle of a reply…): don't stay stuck on "speaking".
          gapTimer = setTimeout(function () { if (!botIsPlaying() && state === 'speaking') { botDoneFlag = true; botEnd(); } }, 6500);
        }, 1500);
        return;
      }
      botEnd();
    }
    function botEnd() {
      if (state !== 'speaking' && state !== 'thinking') return;
      stopPlayback();
      resetDuck();
      turn.botEndAt = now();
      if (turn.userEndAt) turn.ms.total = Math.round(turn.botEndAt - turn.userEndAt);
      emit('bot.end', { text: turn.bot });
      closeTurn();
      if (engine) engine.playbackEnded(playTurnId);
      botDoneFlag = false;
      setState('listening');
      emit('listening');
    }
    /** A reply without voice (a tool only), once nothing plays any more. */
    function silentReplyDone() {
      clearTimeout(noReplyTimer);
      if (turn.bot.trim()) botStart();
      botEnd();
    }
    function sendUserText() {
      if (turn.userTextSent || !turn.user.trim()) return;
      turn.userTextSent = true;
      emit('user.text', { text: turn.user.trim() });
    }
    function closeTurn() {
      sendUserText();
      const rec = { user: turn.user.trim(), bot: turn.bot.trim(), interrupted: turn.interrupted, ms: Object.assign({}, turn.ms) };
      if (rec.user || rec.bot) {
        turns.push(rec);
        if (turns.length > 60) turns.shift();
        emit('turn', rec);
      }
      turn = newTurn();
      remoteHeard = false;
    }

    // — the user's turn —
    function userStart(source) {
      if (state !== 'listening') return;
      awayCount = 0;
      lastSpeechAt = now();
      turn = newTurn();
      turn.userStartAt = now();
      setState('hearing');
      emit('user.start', { source: source });
    }
    function endUserTurn(source) {
      resetDuck();
      turn.userEndAt = now();
      if (turn.userStartAt) turn.ms.speech = Math.round(turn.userEndAt - turn.userStartAt);
      botDoneFlag = false; botStarted = false;
      setState('thinking');
      emit('user.end', { source: source, speechMs: turn.ms.speech == null ? null : turn.ms.speech });
      earcon('heard');
      emit('thinking');
      startThinkingSound();
      clearTimeout(noReplyTimer);
      noReplyTimer = setTimeout(function () {
        if (state !== 'thinking') return;
        emit('user.cancel', { reason: 'no-reply' });
        turn = newTurn();
        setState('listening');
        emit('listening');
      }, NO_REPLY_MS[engineName] || 15000);
    }
    function clientSilence() {
      // Gemini decides the end of the turn itself; our local silence is an estimate
      // (its own signal, if it arrives, takes precedence). The local backend is the only judge.
      if (engineName === 'gemini') endUserTurn('client');
      else if (!remoteHeard) { setState('listening'); emit('user.cancel'); }
    }

    // — the hooks the engines call —
    const hooks = {
      status: function (text, progress) { emit('status', { text: String(text || ''), progress: progress == null ? null : Number(progress) }); },
      remoteSpeech: function (speaking) {
        if (speaking) {
          remoteHeard = true;
          lastSpeechAt = now();
          if (state === 'listening') userStart('server');
        }
      },
      userTurnEnd: function () { if (state === 'hearing' || (state === 'listening' && turn.user)) endUserTurn('server'); },
      userTranscript: function (text, mode) {
        lastSpeechAt = now();
        turn.user = mode === 'append' ? turn.user + text : String(text);
        emit('user.partial', { text: turn.user.trim() });
        if (mode === 'final') sendUserText();
      },
      notUnderstood: function (text) {
        emit('not.understood', { text: String(text || '') });
        if (state === 'thinking' || state === 'hearing') { clearTimeout(noReplyTimer); turn = newTurn(); setState('listening'); emit('listening'); }
      },
      thinking: function (turnId) {
        if (turnId) serverTurnId = turnId;
        if (state === 'listening' || state === 'hearing') endUserTurn('server');
      },
      botAudio: function (int16, rate, turnId) { playPcm(int16, rate, turnId); },
      botTranscript: function (text, append) {
        turn.bot = append ? turn.bot + text : text;
        emit('bot.text', { text: turn.bot.trim() });
      },
      botSentence: function (text, index) { emit('bot.sentence', { text: text, index: index }); },
      botDone: function (turnId) {
        if (turnId && turnId < dropBelowTurn) return;
        botDoneFlag = true;
        if (state === 'thinking' && !botIsPlaying() && !botStarted) { silentReplyDone(); return; }   // no voice (tool only)
        if (state === 'speaking' && !botIsPlaying()) botEnd();
      },
      filler: function (text) { if (state === 'thinking') emit('bot.filler', { text: String(text || '') }); },
      interrupted: function (turnId, by) {
        if (by !== 'user') return;                         // our own "Interrupt" (already handled), or the end of the session
        if (turnId && turnId < dropBelowTurn) return;
        if (state !== 'speaking' && state !== 'thinking') return;
        if (state === 'thinking' && turn.typed && !botStarted) return;   // a typed message is pending: nothing to cut
        stopPlayback();
        resetDuck();
        if (turnId) dropBelowTurn = turnId + 1;
        turn.interrupted = true;
        emit('interrupted', { by: 'user', said: turn.bot.trim() });
        if (engine) engine.playbackEnded(playTurnId);
        closeTurn();
        state = 'listening';                     // no event: go straight to "hearing"
        userStart('interruption');
      },
      ui: function (kind, data) {
        if (kind === 'choices') { emit('ui.choices', data); earcon('choices'); }
        if (kind === 'mood') emit('ui.mood', data);
      },
      toolCall: function (call) { emit('tool.call', call); },
      toolCancel: function (ids) { emit('tool.cancel', { ids: ids }); },
      timing: function (turnId, ms) { Object.assign(turn.ms, ms || {}); emit('timing', { turnId: turnId, ms: ms || {} }); },
      /** The local server lowers the agent's voice (someone talks over it), or brings it back (it was "mm-hm"). */
      duck: function (on, m) {
        if (on) {
          if (state !== 'speaking' && state !== 'thinking') return;
          duckFactor = DUCK_LEVEL;
          rampGain(DUCK_DOWN_S);
          duckPending = true;
          emit('interruption.pending', { by: 'user' });
          return;
        }
        const was = duckPending;
        resetDuck(DUCK_UP_S);
        if (was) emit('interruption.cancelled', { reason: String(m.reason || 'backchannel'), text: String(m.text || '') });
      },
      /** What the person said needs no reply (a "stop" said over the agent): their turn ends there. */
      userNoReply: function (text) {
        lastSpeechAt = now();
        clearTimeout(noReplyTimer);
        resetDuck();
        if (!turn.userStartAt) turn.userStartAt = now();
        turn.user = String(text || '');
        emit('user.partial', { text: turn.user.trim() });
        sendUserText();
        emit('user.cancel', { reason: 'stop' });
        closeTurn();
        setState('listening');
        emit('listening');
      },
      turnPrediction: function (m) {
        emit('turn.prediction', { probability: num(m.probability, 0), complete: !!m.complete, ms: m.ms == null ? null : num(m.ms, null) });
      },
      error: function (code, message, fatal) {
        if (fatal) { failHard(code, message); return; }
        emit('error', { code: code, message: message, fatal: false });
        earcon('error');
      },
    };

    // — lifecycle —
    function start() {
      if (starting) return starting;
      const run = (async function () {
        if (active || state === 'connecting') { cleanup(); setState('ended'); emit('ended', { reason: 'restart' }); }
        // Each start has a number: "Stop" (or another start) invalidates it, and this start
        // gives up cleanly as soon as it resumes (after the mic request, the connection…).
        const gen = ++startGen;
        const alive = function () { return gen === startGen; };
        settings = Object.assign({}, DEFAULTS, settings);
        engineName = settings.engine === 'local' ? 'local' : 'gemini';
        startedAt = now();
        awayCount = 0;
        turn = newTurn();
        setState('connecting');
        emit('connecting', { engine: engineName });
        try {
          ctx = (opts.getAudioContext && opts.getAudioContext()) || ctx || new AudioContext();
          if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* waits for a click */ } }
          if (!alive()) return false;
          if (ctx.state === 'suspended') emit('status', { text: 'The browser is blocking sound: click in the page to allow it.', progress: null });
          // the voice
          duckFactor = 1; duckPending = false;
          outGain = ctx.createGain();
          outGain.gain.value = voiceGain();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          micAnalyserBuf = new Float32Array(analyser.fftSize);
          outGain.connect(analyser);
          if (settings.playVoice !== false) outGain.connect(ctx.destination);
          // the mic
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw fail('mic', 'This browser gives no access to the microphone (the page must be https or localhost).');
          let s;
          try {
            s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
          } catch (e) {
            if (!alive()) return false;
            throw fail('mic', e && e.name === 'NotAllowedError'
              ? 'Microphone access was denied. Allow it (icon left of the address bar, or system settings), then click Start.'
              : 'No microphone available (' + (e && e.message) + '). Plug in a microphone or check the system settings, then click Start.');
          }
          if (!alive()) { s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* */ } }); return false; }
          stream = s;
          micSrc = ctx.createMediaStreamSource(stream);
          proc = ctx.createScriptProcessor(2048, 1, 1);
          sink = ctx.createGain(); sink.gain.value = 0;
          micSrc.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
          down = makeDownsampler(ctx.sampleRate, IN_RATE);
          sendLen = 0;
          vad.reset();
          proc.onaudioprocess = onAudioBlock;
          // the engine
          const eng = engineName === 'local' ? new LocalEngine(hooks) : new GeminiEngine(hooks);
          engine = eng;
          active = true;
          await eng.connect(settings);
          if (!alive() || engine !== eng) { try { eng.close(); } catch (e) { /* closed */ } return false; }
          setState('listening');
          emit('start', { engine: engineName });
          emit('listening');
          earcon('ready');
          return true;
        } catch (e) {
          if (!alive() || (e && e.code === 'cancelled')) return false;
          failHard((e && e.code) || 'start', (e && e.message) || String(e));
          return false;
        }
      })();
      starting = run;
      run.then(function () { if (starting === run) starting = null; });
      return run;
    }

    /** An error that stops everything: release the mic, then state "error". */
    function failHard(code, message) {
      const was = active || state === 'connecting';
      cleanup();
      setState('error');
      emit('error', { code: code, message: message, fatal: true });
      earcon('error');
      if (was) emit('ended', { reason: 'error' });
    }

    async function stop(reason) {
      startGen++;                                // a start in progress will give up
      starting = null;
      if (!active && state !== 'connecting') return;
      cleanup();
      setState('ended');
      emit('ended', { reason: reason || 'stop' });
    }

    function cleanup() {
      active = false;
      clearTimeout(noReplyTimer);
      clearAway();
      duckFactor = 1; duckPending = false;
      stopThinkingSound();
      stopPlayback();
      if (engine) { try { engine.close(); } catch (e) { /* closed */ } }
      engine = null;
      if (proc) { proc.onaudioprocess = null; try { proc.disconnect(); } catch (e) { /* */ } }
      if (micSrc) { try { micSrc.disconnect(); } catch (e) { /* */ } }
      if (sink) { try { sink.disconnect(); } catch (e) { /* */ } }
      if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* */ } }); }
      if (outGain) { try { outGain.disconnect(); } catch (e) { /* */ } }
      proc = null; micSrc = null; sink = null; stream = null;
      userLevel = 0; botLevelSmooth = 0;
      if (turn.user || turn.bot) closeTurn();
    }

    /** Changes the settings. Returns {needsRestart}: true if the session must restart to take them. */
    function update(patch) {
      const prev = settings;
      settings = Object.assign({}, settings, patch || {});
      if (outGain && ctx) {
        outGain.gain.setTargetAtTime(voiceGain(), ctx.currentTime, 0.05);
        if (prev.playVoice !== settings.playVoice) {
          try { outGain.disconnect(); } catch (e) { /* */ }
          outGain.connect(analyser);
          if (settings.playVoice !== false) outGain.connect(ctx.destination);
        }
      }
      if (!active) return { needsRestart: false };
      if (prev.awayAfterMs !== settings.awayAfterMs && state === 'listening') armAway();   // a new countdown
      const keys = RESTART_KEYS[engineName] || [];
      const needsRestart = keys.some(function (k) { return JSON.stringify(prev[k]) !== JSON.stringify(settings[k]); }) || settings.engine !== engineName;
      if (engine && engineName === 'local') engine.update(settings);
      return { needsRestart: needsRestart };
    }

    function interrupt() {
      if (state !== 'speaking' && state !== 'thinking') return false;
      const said = turn.bot.trim();
      stopPlayback();
      resetDuck();
      clearTimeout(noReplyTimer);
      if (engine) engine.interrupt(said);
      if (playTurnId || serverTurnId) dropBelowTurn = Math.max(playTurnId, serverTurnId) + 1;
      turn.interrupted = true;
      emit('interrupted', { by: 'client', said: said });
      closeTurn();
      setState('listening');
      emit('listening');
      return true;
    }

    function sendText(text) {
      const t = String(text || '').trim();
      if (!t || !engine || !active) return false;
      awayCount = 0;
      if (state === 'speaking' || state === 'thinking') interrupt();
      turn = newTurn();
      turn.user = t;
      turn.typed = true;
      turn.userTextSent = true;
      turn.userStartAt = now();
      emit('user.text', { text: t, typed: true });
      endUserTurn('text');
      return engine.sendText(t, true) !== false;
    }

    return {
      on: on, off: off, start: start, stop: function (r) { return stop(r || 'stop'); }, update: update,
      interrupt: interrupt, sendText: sendText,
      sendContext: function (text) { return !!(engine && active && engine.sendContext(String(text || ''))); },
      choose: function (option) { return sendText('(The user chose: "' + String(option) + '")'); },
      sendToolResult: function (id, result) { return !!(engine && engine.sendToolResult(id, result)); },
      get state() { return state; },
      get active() { return active; },
      get engine() { return engineName; },
      get settings() { return Object.assign({}, settings); },
      get audioContext() { return ctx; },
      get outputNode() { return outGain; },
      get micNode() { return micSrc; },
      /** The 0..1 levels of the mic and the voice, to read on every frame. */
      levels: function () {
        if (analyser && botIsPlaying()) {
          analyser.getFloatTimeDomainData(micAnalyserBuf);
          const l = clamp(rms(micAnalyserBuf) * 3.5, 0, 1);
          botLevelSmooth = l > botLevelSmooth ? l : botLevelSmooth * 0.82;
        } else botLevelSmooth *= 0.8;
        if (!active) userLevel = 0;
        return { user: userLevel, bot: botLevelSmooth < 0.002 ? 0 : botLevelSmooth };
      },
      conversation: function () { return turns.slice(); },
      debug: function () {
        return {
          state: state, engine: engineName, active: active, playing: botIsPlaying(), sources: sources.size, noise: vad.noise,
          duck: duckFactor, gain: outGain ? outGain.gain.value : null, turn: Object.assign({}, turn),
        };
      },
    };
  }

  // ---------------------------------------------------------------------------
  function fail(code, message) { const e = new Error(message); e.code = code; return e; }
  function parseJson(data) {
    try {
      if (typeof data === 'string') return JSON.parse(data);
      if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data));
    } catch (e) { return null; }
    return null;
  }
  function pick(o, keys) { const r = {}; keys.forEach(function (k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

  return {
    version: '1.0.0',
    STATES: STATES, EVENTS: EVENTS, DEFAULTS: DEFAULTS, GEMINI_VOICES: GEMINI_VOICES, LOCAL_VOICES: LOCAL_VOICES,
    LOCAL_VOICE_ENGINES: LOCAL_VOICE_ENGINES, LOCAL_KEYS: LOCAL_KEYS,
    MOODS: MOODS, LANGUAGES: LANGUAGES, RESTART_KEYS: RESTART_KEYS,
    createVoiceAgent: createVoiceAgent,
    // exposed for tests
    _: { systemPrompt: systemPrompt, geminiSetup: geminiSetup, parseExtraTools: parseExtraTools, bytesToB64: bytesToB64, b64ToInt16: b64ToInt16, floatToInt16: floatToInt16, makeDownsampler: makeDownsampler, makeClientVad: makeClientVad },
  };
})();
