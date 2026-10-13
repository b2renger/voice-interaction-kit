// A FAKE @qvac/sdk: same function names and data shapes as version 0.21
// (read from its source code), without any model. It also checks the options it is given.
// Used to test the adapter 2_qvac_local/src/engines/qvac.mjs: QVAC_SDK=<path of this file>.
import { writeFileSync } from 'node:fs';
export const calls = [];
// When the process exits, the report (calls + problems) is written for the test.
if (process.env.FAKE_QVAC_REPORT) process.on('exit', () => { try { writeFileSync(process.env.FAKE_QVAC_REPORT, JSON.stringify({ calls, problems })); } catch { /* */ } });
const problems = [];
export function getProblems() { return problems.slice(); }
const need = (cond, what) => { if (!cond) problems.push(what); };

const entry = (name, source, path) => ({ name, src: `registry://${source}/${path}`, registrySource: source, registryPath: path });
export const WHISPER_SMALL_Q8_0 = entry('WHISPER_SMALL_Q8_0', 'hf', 'ggerganov/whisper.cpp/resolve/x/ggml-small-q8_0.bin');
export const VAD_SILERO_5_1_2 = entry('VAD_SILERO_5_1_2', 'hf', 'ggml-org/whisper-vad/resolve/x/ggml-silero-v5.1.2.bin');
export const QWEN3_1_7B_INST_Q4 = entry('QWEN3_1_7B_INST_Q4', 'hf', 'unsloth/Qwen3-1.7B-GGUF/resolve/x/Qwen3-1.7B-Q4_0.gguf');
export const TTS_MULTILINGUAL_SUPERTONIC3_Q8_0 = entry('TTS_MULTILINGUAL_SUPERTONIC3_Q8_0', 's3', 'qvac_models_compiled/ggml/supertonic/x/supertonic3-q8_0.gguf');
export const TTS_MINI_V1_EN_PARLER_TTS_Q8_0 = entry('TTS_MINI_V1_EN_PARLER_TTS_Q8_0', 's3', 'qvac_models_compiled/ggml/parler-tts/x/parler-mini-v1-q8_0.gguf');
export const TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0 = entry('TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0', 's3', 'qvac_models_compiled/ggml/chatterbox/x/chatterbox-t3-mtl-q4_0.gguf');
export const TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0 = entry('TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0', 's3', 'qvac_models_compiled/ggml/chatterbox/x/chatterbox-s3gen-mtl-q4_0.gguf');

// Text-to-speech, per engine (QVAC 0.21: docs ai-capabilities/text-to-speech.mdx, schemas/text-to-speech.ts).
// The load schemas are STRICT: an unknown key is refused.
const LAVASR = ['lavasrDenoiserModelSrc', 'lavasrEnhancerModelSrc'];
const TTS_LOAD_KEYS = {
  supertonic: ['ttsEngine', 'language', 'voice', 'ttsSpeed', 'pace', 'ttsNumInferenceSteps', 'useGPU', 'outputSampleRate', 'threads', 'nGpuLayers', 'seed', 'vulkanCacheDir', 'backendsDir', 'openclCacheDir', ...LAVASR],
  parler: ['ttsEngine', 'description', 'voiceDescription', 'voice', 'emotion', 'pitch', 'pace', 'expressivity', 'noise', 'reverb', 'quality', 'useGPU', 'outputSampleRate', 'streamChunkTokens', 'streamFirstChunkTokens', 'threads', 'nGpuLayers', 'seed', 'temperature', 'topK', 'topP', 'maxFrames', 'minNewTokens', 'normalizeNumbers', 'backendsDir', ...LAVASR],
  chatterbox: ['ttsEngine', 'language', 'voice', 'useGPU', 'outputSampleRate', 'ttsSpeed', 'nCtx', 'kvCacheType', 'streamChunkTokens', 'streamFirstChunkTokens', 'cfmSteps', 'cfgRate', 'threads', 'nGpuLayers', 'seed', 'backendsDir', 'openclCacheDir', 's3genModelSrc', 'referenceAudioSrc', 'mecabDictSrc', 'cangjieTsvSrc', ...LAVASR],
};
const SUPERTONIC_LANGUAGES = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'];
const CHATTERBOX_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'ja', 'pt', 'nl', 'pl', 'tr', 'sv', 'da', 'fi', 'no', 'el', 'ms', 'sw', 'ar', 'ko', 'he', 'ru', 'zh', 'hi'];
// Parler's free-text description and its voice-template fields: Parler only, and never together
const PARLER_DESCRIPTION = ['description', 'voiceDescription'];
const PARLER_TEMPLATE = ['voice', 'emotion', 'pitch', 'pace', 'expressivity', 'noise', 'reverb', 'quality'];
const TTS_RATE = { supertonic: 44100, parler: 44100, chatterbox: 24000 };
const MODEL_ENGINE = (name) => (/PARLER/.test(name) ? 'parler' : /CHATTERBOX/.test(name) ? 'chatterbox' : /SUPERTONIC/.test(name) ? 'supertonic' : null);
const srcName = (src) => (typeof src === 'string' ? src : src && src.name);

let nextId = 1;
const models = new Map();
const running = new Map();

export async function loadModel(o) {
  const mc = o.modelConfig || {};
  calls.push({
    fn: 'loadModel', modelType: o.modelType, fallbackSrc: o.fallbackSrc, src: typeof o.modelSrc === 'string' ? o.modelSrc : o.modelSrc && o.modelSrc.name,
    modelConfig: { ...mc, ...(mc.s3genModelSrc ? { s3genModelSrc: srcName(mc.s3genModelSrc) } : {}) },
  });
  need(o.modelSrc, 'loadModel without modelSrc');
  need(['whisper', 'llm', 'tts'].includes(o.modelType), `unexpected modelType: ${o.modelType}`);
  const c = o.modelConfig || {};
  if (o.modelType === 'whisper') {
    need(c.vadModelSrc, 'whisper without vadModelSrc (required for streaming)');
    need(c.audio_format === 's16le', 'whisper: audio_format must be s16le (the browser sends 16-bit PCM)');
    need(c.vad_params && c.vad_params.min_silence_duration_ms > 0, 'whisper: vad_params.min_silence_duration_ms missing');
    need(c.contextParams && typeof c.contextParams.use_gpu === 'boolean', 'whisper: contextParams.use_gpu missing');
  }
  if (o.modelType === 'tts') {
    const eng = c.ttsEngine;
    need(TTS_LOAD_KEYS[eng], `tts: unknown ttsEngine ${eng}`);
    if (TTS_LOAD_KEYS[eng]) {
      const unknown = Object.keys(c).filter((k) => !TTS_LOAD_KEYS[eng].includes(k));
      need(!unknown.length, `tts (${eng}): keys refused by the strict load schema: ${unknown.join(', ')}`);
    }
    const modelEngine = MODEL_ENGINE(srcName(o.modelSrc) || '');
    need(!modelEngine || modelEngine === eng, `tts: a ${modelEngine} model loaded with ttsEngine ${eng}`);
    if (eng === 'supertonic') {
      need(!(c.ttsSpeed !== undefined && c.pace !== undefined), 'tts: ttsSpeed and pace are mutually exclusive');
      need(/^[FM][1-5]$/.test(c.voice), `tts: unexpected voice ${c.voice}`);
      need(SUPERTONIC_LANGUAGES.includes(c.language || 'en'), `tts (supertonic): unsupported language ${c.language}`);
    }
    if (eng === 'parler') {
      const desc = PARLER_DESCRIPTION.filter((k) => c[k] !== undefined);
      need(!(desc.length && PARLER_TEMPLATE.some((k) => c[k] !== undefined)), 'tts (parler): description and the voice-template fields are mutually exclusive');
    }
    if (eng === 'chatterbox') {
      need(c.s3genModelSrc, 'tts (chatterbox): s3genModelSrc is required');
      need(CHATTERBOX_LANGUAGES.includes(c.language || 'en'), `tts (chatterbox): unsupported language ${c.language}`);
      need(c.language !== 'ja' || c.mecabDictSrc, 'tts (chatterbox): mecabDictSrc is required when Chatterbox language is "ja"');
      need(c.language !== 'zh' || c.cangjieTsvSrc, 'tts (chatterbox): cangjieTsvSrc is required when Chatterbox language is "zh"');
      need(c.ttsSpeed === undefined || (c.ttsSpeed >= 0.25 && c.ttsSpeed <= 4), `tts (chatterbox): ttsSpeed out of 0.25–4 (${c.ttsSpeed})`);
    }
  }
  if (o.modelType === 'llm') need(c.ctx_size > 0, 'llm: ctx_size missing');
  if (o.onProgress) { o.onProgress({ percentage: 50, downloaded: 5e6, total: 1e7 }); o.onProgress({ percentage: 100, downloaded: 1e7, total: 1e7 }); }
  const id = `m${nextId++}`;
  models.set(id, { type: o.modelType, config: c });
  return id;
}

export async function unloadModel({ modelId, autoClose }) {
  calls.push({ fn: 'unloadModel', modelId, autoClose });
  need(autoClose === false, 'unloadModel: autoClose:false expected in a server (otherwise the worker closes)');
  const m = models.get(modelId);
  need(!(m && m.streamActive), 'unloadModel: the model still has an open recognition stream');
  models.delete(modelId);
}

export async function cancel({ requestId }) {
  calls.push({ fn: 'cancel', requestId });
  const r = running.get(requestId);
  if (r) r.cancel();
}

export async function close() { calls.push({ fn: 'close' }); }

class Queue {
  constructor() { this.items = []; this.wait = null; this.ended = false; }
  push(x) { if (this.wait) { const w = this.wait; this.wait = null; w({ value: x, done: false }); } else this.items.push(x); }
  end() { this.ended = true; if (this.wait) { const w = this.wait; this.wait = null; w({ value: undefined, done: true }); } }
  [Symbol.asyncIterator]() {
    const done = () => { if (this.onDrained) this.onDrained(); return { done: true, value: undefined }; };
    return {
      next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false })
        : this.ended ? Promise.resolve(done())
          : new Promise((r) => { this.wait = (x) => r(x.done ? done() : x); }),
    };
  }
}

export async function transcribeStream(o) {
  calls.push({ fn: 'transcribeStream', o: { ...o } });
  const m = models.get(o.modelId);
  need(m && m.type === 'whisper', 'transcribeStream on a model that is not whisper');
  need(o.emitVadEvents === true, 'transcribeStream: emitVadEvents expected');
  need(o.endOfTurnSilenceMs > 0, 'transcribeStream: endOfTurnSilenceMs expected');
  // Like QVAC: one stream at a time per model. The previous one is only released a little AFTER it drains.
  if (m.streamActive) {
    calls.push({ fn: 'transcribeStream:refused' });
    m.refusals = (m.refusals || 0) + 1;
    need(m.refusals < 2, 'transcribeStream: refused twice in a row (STREAMING_SESSION_ACTIVE)');
    throw Object.assign(new Error('A streaming session is already active for this model'), { code: 'STREAMING_SESSION_ACTIVE' });
  }
  m.refusals = 0;
  m.streamActive = true;
  const release = () => setTimeout(() => { m.streamActive = false; }, 80);
  let released = false;
  const releaseOnce = () => { if (!released) { released = true; release(); } };
  const q = new Queue();
  q.onDrained = releaseOnce;
  let speaking = false; let above = 0; let below = 0; let seg = 0; let eot = true; let carry = Buffer.alloc(0);
  const BLOCK = 1600;
  let n = 0;
  return {
    write(buf) {
      need(buf instanceof Uint8Array, 'write: Uint8Array expected');
      carry = carry.length ? Buffer.concat([carry, buf]) : Buffer.from(buf);
      while (carry.length >= BLOCK) {
        const b = carry.subarray(0, BLOCK); carry = carry.subarray(BLOCK);
        let s = 0; for (let i = 0; i < b.length; i += 2) { const v = b.readInt16LE(i) / 32768; s += v * v; }
        const level = Math.sqrt(s / (b.length / 2));
        if (level > 0.03) { above += 50; below = 0; if (!speaking && above >= 150) { speaking = true; seg = 0; eot = false; q.push({ type: 'vad', speaking: true, probability: 1, source: 'silero' }); } if (speaking) seg += 50; }
        else {
          above = 0; below += 50;
          if (speaking && below >= 300) { speaking = false; q.push({ type: 'vad', speaking: false, probability: 0, source: 'silero' }); q.push({ type: 'text', text: ` Sentence ${++n} heard by the fake whisper.` }); }
          if (!speaking && !eot && below >= o.endOfTurnSilenceMs) { eot = true; q.push({ type: 'endOfTurn', source: 'whisper', silenceDurationMs: below }); }
        }
      }
    },
    end() { q.end(); },
    destroy() { q.end(); releaseOnce(); },
    [Symbol.asyncIterator]() { return q[Symbol.asyncIterator](); },
  };
}

export function completion(o) {
  calls.push({ fn: 'completion', history: o.history, generationParams: o.generationParams });
  const m = models.get(o.modelId);
  need(m && m.type === 'llm', 'completion on a model that is not llm');
  need(o.stream === true, 'completion: stream:true expected');
  need(Array.isArray(o.history) && o.history[0] && o.history[0].role === 'system', 'completion: the system prompt must be the first message');
  const requestId = `r${nextId++}`;
  const q = new Queue();
  let cancelled = false;
  const reply = '<think>\n\n</think>\n\nHello, I am the fake model. Would you like to see room A or room B? [[choices: Room A | Room B]]';
  const words = reply.split(/(?<=\s)/);
  let i = 0;
  let rejectFinal; let resolveFinal;
  const final = new Promise((res, rej) => { resolveFinal = res; rejectFinal = rej; });
  final.catch(() => {});
  const tick = () => {
    if (cancelled) { q.push({ type: 'completionDone', stopReason: 'cancelled' }); q.end(); rejectFinal(Object.assign(new Error('cancelled'), { code: 52419 })); return; }
    if (i >= words.length) { q.push({ type: 'completionDone', stopReason: 'eos' }); q.end(); resolveFinal({ contentText: reply }); running.delete(requestId); return; }
    q.push({ type: 'contentDelta', text: words[i++] });
    setTimeout(tick, 15);
  };
  setTimeout(tick, 100);
  running.set(requestId, { cancel() { cancelled = true; } });
  return { requestId, events: q, final };
}

export function textToSpeech(o) {
  const m = models.get(o.modelId);
  const eng = m && m.config && m.config.ttsEngine;
  calls.push({ fn: 'textToSpeech', text: o.text, stream: o.stream, engine: eng, description: o.description, voice: o.voice });
  need(m && m.type === 'tts', 'textToSpeech on a model that is not tts');
  need(typeof o.text === 'string' && o.text.length > 0, 'textToSpeech: empty text');
  need(!/\[\[|<think>|\*\*/.test(o.text), `textToSpeech: the text is not cleaned up (${o.text})`);
  const desc = PARLER_DESCRIPTION.filter((k) => o[k] !== undefined);
  const template = PARLER_TEMPLATE.filter((k) => o[k] !== undefined);
  need(!(desc.length && template.length), 'textToSpeech: description and the voice-template fields (voice…) are mutually exclusive');
  need(desc.every((k) => typeof o[k] === 'string' && o[k].length > 0), 'textToSpeech: an empty description');
  if (eng && eng !== 'parler') need(!desc.length && !template.length, `textToSpeech: ${[...desc, ...template].join(', ')} is Parler-only (refused by ${eng})`);
  const requestId = `r${nextId++}`;
  const rate = TTS_RATE[eng] || 44100;
  const n = Math.round(rate * Math.min(3, 0.05 * o.text.length));
  const samples = new Array(n);
  for (let k = 0; k < n; k++) samples[k] = Math.round(8000 * Math.sin(2 * Math.PI * 180 * k / rate) * Math.sin(Math.PI * k / n));
  let cancelled = false;
  running.set(requestId, { cancel() { cancelled = true; } });
  const buffer = new Promise((res, rej) => setTimeout(() => (cancelled ? rej(new Error('cancelled')) : res(samples)), 40));
  buffer.catch(() => {});
  return { requestId, buffer, sampleRate: Promise.resolve(rate), done: buffer.then(() => true, () => false) };
}

export async function textToSpeechStream(o) {
  calls.push({ fn: 'textToSpeechStream' });
  const q = new Queue();
  const requestId = `r${nextId++}`;
  let chain = Promise.resolve();
  return {
    requestId,
    write(t) {
      chain = chain.then(async () => {
        const voiceFields = Object.fromEntries([...PARLER_DESCRIPTION, ...PARLER_TEMPLATE].filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
        const r = textToSpeech({ modelId: o.modelId, text: String(t).trim(), ...voiceFields });
        const b = await r.buffer.catch(() => []);
        if (b.length) q.push({ type: 'textToSpeechStream', buffer: b, sampleRate: await r.sampleRate, sentenceChunk: String(t).trim(), done: false });
      });
    },
    end() { chain = chain.then(() => { q.push({ buffer: [], done: true }); q.end(); }); },
    destroy() { q.end(); },
    [Symbol.asyncIterator]() { return q[Symbol.asyncIterator](); },
  };
}
