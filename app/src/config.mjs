// The backend configuration: config.json merged with the default values.
import { readFileSync, existsSync } from 'node:fs';

export function loadConfig(file) {
  const base = {
    port: 8790, host: '127.0.0.1', download: 'http', warmup: true,
    // the pages that can open a conversation (cables.gl, the lab window, offline cables); ["*"] = all
    allowedOrigins: ['https://cables.gl', 'https://sandbox.cables.gl', 'https://dev.cables.gl', 'http://localhost:*', 'http://127.0.0.1:*', 'cables:*', 'file:*', 'https://editor.p5js.org', 'https://preview.p5js.org'],
    models: {
      // choices: the models the window offers (QVAC catalogue names, Hugging Face downloads); src is the default
      asr: {
        src: 'WHISPER_SMALL_Q8_0', vad: 'VAD_SILERO_5_1_2', language: 'en', useGpu: true, threads: 4,
        choices: [
          { src: 'WHISPER_TINY_Q8_0', label: 'Whisper tiny — the fastest, more mistakes' },
          { src: 'WHISPER_BASE_Q8_0', label: 'Whisper base — fast, a few mistakes' },
          { src: 'WHISPER_SMALL_Q8_0', label: 'Whisper small — accurate' },
          { src: 'WHISPER_LARGE_V3_TURBO', label: 'Whisper large v3 turbo — the most accurate, slow without a graphics card' },
        ],
      },
      llm: {
        src: 'QWEN3_1_7B_INST_Q4', ctxSize: 4096, maxTokens: 320, thinking: false, useGpu: true,
        choices: [
          { src: 'QWEN3_600M_INST_Q4', label: 'Qwen3 0.6B — the fastest, simple replies' },
          { src: 'LLAMA_3_2_1B_INST_Q4_0', label: 'Llama 3.2 1B — fast, best in English' },
          { src: 'QWEN3_1_7B_INST_Q4', label: 'Qwen3 1.7B — balanced' },
          { src: 'QWEN3_4B_Q4_K_M', label: 'Qwen3 4B — smarter, slower: a graphics card helps' },
          { src: 'QWEN3_8B_INST_Q4_K_M', label: 'Qwen3 8B — the smartest here, needs a strong graphics card' },
        ],
      },
      // the decision model (docs/DESIGN.md, 3): an embedding model, and the range of its cosines (unrelated → same
      // meaning) when it compares two sentences, and when it searches the knowledge (agent/matcher.mjs)
      decide: { src: 'EMBEDDINGGEMMA_300M_Q8_0', name: 'EmbeddingGemma 300M', calibration: { similar: [0.55, 0.95], search: [0.35, 0.7] }, useGpu: true },
      tts: {
        src: 'TTS_MULTILINGUAL_SUPERTONIC3_Q8_0', engine: 'supertonic', language: 'en', voice: 'F1', speed: 1, steps: 5, useGpu: true, mode: 'sentence',
        // the other local voice engines (setting localVoiceEngine): Parler (a voice described in words, English)
        // and Chatterbox (multilingual; referenceAudio = optional path of a WAV file to clone a voice)
        parler: { src: 'TTS_MINI_V1_EN_PARLER_TTS_Q8_0', voice: 'Laura' },
        chatterbox: { src: 'TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0', s3gen: 'TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0', referenceAudio: '' },
      },
    },
    // Smart Turn, the end-of-turn model (setting turnDetection: 'smart'): a path relative to the app folder, or absolute
    turn: { smartTurn: { model: 'models/smart-turn-v3.2-cpu.onnx', threshold: 0.5, threads: 1 } },
    defaults: { language: 'en', localVoice: 'F1', localSpeed: 1, endSilenceMs: 800, startSensitivity: 'high', endSensitivity: 'high' },
  };
  if (!existsSync(file)) return base;
  let user;
  try { user = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`✖ ${file} is not valid JSON: ${e.message}`); process.exit(1); }
  return mergeConfig(base, user);
}

/** A config.json over another one: each section is merged, not replaced. */
export function mergeConfig(base, user) {
  const m = (user && user.models) || {};
  const tts = m.tts || {};
  const turn = (user && user.turn) || {};
  const bt = base.models.tts || {};
  return {
    ...base, ...user,
    models: {
      asr: { ...base.models.asr, ...m.asr },
      llm: { ...base.models.llm, ...m.llm },
      decide: { ...base.models.decide, ...m.decide },
      tts: { ...bt, ...tts, parler: { ...bt.parler, ...tts.parler }, chatterbox: { ...bt.chatterbox, ...tts.chatterbox } },
    },
    turn: { ...base.turn, ...turn, smartTurn: { ...(base.turn || {}).smartTurn, ...turn.smartTurn } },
    defaults: { ...base.defaults, ...((user && user.defaults) || {}) },
  };
}
