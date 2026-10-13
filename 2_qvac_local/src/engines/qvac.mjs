// QVAC engine: speech recognition (Whisper + Silero VAD), language model (llama.cpp) and voice
// (Supertonic, Parler or Chatterbox), all local, through the @qvac/sdk SDK (tested against version 0.21 of its source code).
//
// Interface shared by the engines (see engines/mock.mjs):
//   prepare(settings, onProgress)                      loads / reloads the models for these settings
//   openAsr(opts, {onVad, onText, onEndOfTurn, onError}) → {write(pcmS16le16k), close()}
//   generate({system, history, temperature, onDelta})   → {done: Promise<{text, firstTokenMs}>, cancel()}
//   speak({voice, speed, language, engine, description}) → {write(phrase), end(), cancel(), frames: AsyncIterable}
//
// The three local voice engines (setting localVoiceEngine), from QVAC 0.21's text-to-speech docs and schemas:
//   supertonic  fast, 10 preset voices (F1–F5, M1–M5), 31 languages; voice, speed and language at load time.
//   parler      English only; the voice is DESCRIBED in words, per request ("description"), or a template
//               speaker ("voice": Laura) when there is no description — never both. 44.1 kHz.
//   chatterbox  multilingual (not ja/zh here: they need extra tokenizer assets); a T3 model + an S3Gen companion,
//               optional voice cloning from a WAV (referenceAudio in config.json). 24 kHz. Every output carries
//               Resemble's Perth watermark.
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncQueue, clamp, num } from '../util.mjs';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const VOICE_ENGINES = ['supertonic', 'parler', 'chatterbox'];
const SUPERTONIC_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];
// Chatterbox multilingual languages, minus ja and zh (they need mecabDictSrc / cangjieTsvSrc)
const CHATTERBOX_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'tr', 'sv', 'da', 'fi', 'no', 'el', 'ms', 'sw', 'ar', 'ko', 'he', 'ru', 'hi'];
const NATIVE_RATE = { supertonic: 44100, parler: 44100, chatterbox: 24000 };
export function voiceEngineOf(s) { return VOICE_ENGINES.includes(s && s.localVoiceEngine) ? s.localVoiceEngine : 'supertonic'; }

export async function createQvacEngine(config, log) {
  let sdk;
  try {
    // QVAC_SDK lets the tests plug in a fake SDK (tests/fake-qvac-sdk.mjs).
    sdk = await import(process.env.QVAC_SDK || '@qvac/sdk');
  } catch (e) {
    throw new Error(`The QVAC SDK is not installed: run "npm install" in the 2_qvac_local folder. (${e.message})`);
  }
  const M = config.models;
  const st = {
    asr: null, asrKey: '', llm: null, llmKey: '', tts: null, ttsKey: '', ttsRate: 44100, ttsEngine: 'supertonic', ttsSrc: String(M.tts.src),
    asrClosing: null, asrDrainedAt: 0,
  };
  // QVAC releases a recognition stream a little AFTER it has drained: leave it that time before
  // opening another one or unloading the model.
  const ASR_RELEASE_MS = 300;
  const asrReleased = async () => {
    if (st.asrClosing) await st.asrClosing;
    const wait = st.asrDrainedAt ? ASR_RELEASE_MS - (Date.now() - st.asrDrainedAt) : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };

  /** A catalogue entry's Hugging Face address, or null. Some catalogue paths point at the web page (/blob/), not the file. */
  const hfUrl = (c) => (c.registrySource === 'hf' && c.registryPath ? `https://huggingface.co/${c.registryPath.replace('/blob/', '/resolve/')}` : null);

  /** A model source: a name from the QVAC catalogue (e.g. WHISPER_SMALL_Q8_0), a local path or a URL. */
  function source(name, modelType) {
    const c = sdk[name];
    if (!c || typeof c !== 'object' || !c.src) return { modelSrc: name, modelType };
    const http = hfUrl(c);
    if (config.download === 'http' && http) return { modelSrc: http, modelType };
    if (config.download !== 'p2p' && http) return { modelSrc: c, modelType, fallbackSrc: http };
    return { modelSrc: c, modelType };
  }
  /** A companion file (Chatterbox's S3Gen…): the catalogue entry itself, or a local path / URL. */
  function asset(name) {
    const c = sdk[name];
    if (c && typeof c === 'object' && c.src) return c;
    return localPath(name);
  }
  /** A path relative to the app folder becomes absolute; URLs and absolute paths stay as they are. */
  function localPath(p) {
    const v = String(p || '');
    if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || isAbsolute(v)) return v;
    return join(APP_DIR, v);
  }
  // A companion file takes no fallbackSrc, so unless "p2p" Silero comes straight from Hugging Face.
  function vadSource() {
    const c = sdk[M.asr.vad];
    if (!c || !c.src) return M.asr.vad;
    return (config.download !== 'p2p' && hfUrl(c)) || c;
  }

  async function load(stage, src, modelConfig, onProgress) {
    const t0 = Date.now();
    let last = { stage, progress: 0 };
    let lastAt = t0;
    const report = (p) => { last = p; lastAt = Date.now(); if (onProgress) onProgress(p); };
    report(last);
    // No news (a stalled download, the peer-to-peer registry, loading into memory): say how long, every second.
    const tick = setInterval(() => {
      const waitS = Math.round((Date.now() - lastAt) / 1000);
      if (waitS >= 3 && onProgress) onProgress({ ...last, waitS });
    }, 1000);
    try {
      const id = await sdk.loadModel({
        ...src,
        modelConfig,
        onProgress: (p) => report({ stage, progress: p.percentage, downloaded: p.downloaded, total: p.total }),
      });
      if (onProgress) onProgress({ stage, progress: 100 });
      log(`▸ ${stage}: ready (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      return id;
    } catch (e) {
      if (!/registry/i.test(e.message)) throw e;
      throw new Error(`Could not download a model (${stage}) from QVAC's peer-to-peer network: this network seems to block it. `
        + `Connect once to another network (home Wi-Fi, a phone hotspot) and restart Voice Lab: the model then stays on this computer. (${e.message})`);
    } finally {
      clearInterval(tick);
    }
  }
  async function unload(id) {
    if (!id) return;
    try { await sdk.unloadModel({ modelId: id, autoClose: false }); } catch (e) { log(`(unloading: ${e.message})`); }
  }

  return {
    name: 'qvac',
    info() {
      return {
        engine: 'qvac',
        voiceEngine: st.ttsEngine,
        // only Supertonic has preset voices: an interface hides its voice picker otherwise
        voices: st.ttsEngine === 'supertonic' ? (M.tts.voices || SUPERTONIC_VOICES) : [],
        models: { asr: String(M.asr.src), llm: String(M.llm.src), tts: st.ttsSrc },
      };
    },

    async prepare(s, onProgress) {
      // — speech recognition: language and sensitivity are load-time settings —
      const endSilence = clamp(num(s.endSilenceMs, 800), 200, 5000);
      const asrConfig = {
        vadModelSrc: vadSource(),
        audio_format: 's16le',
        language: s.language || M.asr.language || 'en',
        strategy: 'greedy',
        n_threads: M.asr.threads || 4,
        no_timestamps: true,
        suppress_blank: true,
        suppress_nst: true,
        temperature: 0,
        vad_params: {
          threshold: s.startSensitivity === 'low' ? 0.6 : 0.45,
          min_speech_duration_ms: 250,
          // a sentence is transcribed after this silence; it stays shorter than the end of turn
          min_silence_duration_ms: Math.min(s.endSensitivity === 'low' ? 500 : 300, Math.max(150, endSilence - 150)),
          max_speech_duration_s: 30,
          speech_pad_ms: 100,
        },
        contextParams: { use_gpu: M.asr.useGpu !== false },
      };
      const asrKey = JSON.stringify(asrConfig);
      if (asrKey !== st.asrKey) {
        await asrReleased();                             // the current stream must be released before unloading the model
        await unload(st.asr);
        st.asr = await load('speech recognition', source(M.asr.src, 'whisper'), asrConfig, onProgress);
        st.asrKey = asrKey;
      }
      // — the language model: loaded once —
      const llmConfig = { ctx_size: M.llm.ctxSize || 4096, device: M.llm.useGpu === false ? 'cpu' : 'gpu' };
      if (M.llm.thinking === false) llmConfig.reasoning_budget = 0;      // Qwen3: no reasoning = fast replies
      const llmKey = JSON.stringify(llmConfig);
      if (llmKey !== st.llmKey) {
        await unload(st.llm);
        st.llm = await load('language model', source(M.llm.src, 'llm'), llmConfig, onProgress);
        st.llmKey = llmKey;
      }
      // — the voice: the engine, and its load-time settings —
      const engine = voiceEngineOf(s);
      const speed = clamp(num(s.localSpeed, M.tts.speed || 1), 0.5, 2);
      let ttsSrc; let ttsConfig;
      if (engine === 'parler') {
        // the voice is chosen per request (a description, or the template speaker)
        const P = M.tts.parler || {};
        ttsSrc = String(P.src || 'TTS_MINI_V1_EN_PARLER_TTS_Q8_0');
        ttsConfig = { ttsEngine: 'parler', seed: P.seed == null ? 42 : Number(P.seed), useGPU: (P.useGpu == null ? M.tts.useGpu : P.useGpu) !== false };
      } else if (engine === 'chatterbox') {
        const C = M.tts.chatterbox || {};
        ttsSrc = String(C.src || 'TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0');
        ttsConfig = {
          ttsEngine: 'chatterbox',
          language: CHATTERBOX_LANGUAGES.includes(s.language) ? s.language : 'en',
          s3genModelSrc: asset(C.s3gen || 'TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0'),
          ttsSpeed: speed,
          useGPU: (C.useGpu == null ? M.tts.useGpu : C.useGpu) !== false,
        };
        if (String(C.referenceAudio || '').trim()) ttsConfig.referenceAudioSrc = localPath(String(C.referenceAudio).trim());
      } else {
        ttsSrc = String(M.tts.src);
        ttsConfig = {
          ttsEngine: 'supertonic',
          language: s.language || M.tts.language || 'en',
          voice: s.localVoice || M.tts.voice || 'F1',
          ttsSpeed: speed,
          ttsNumInferenceSteps: M.tts.steps || 5,
          useGPU: M.tts.useGpu !== false,
        };
      }
      const ttsKey = JSON.stringify([ttsSrc, ttsConfig]);
      if (ttsKey !== st.ttsKey) {
        await unload(st.tts);
        st.tts = null; st.ttsKey = '';
        st.tts = await load(`voice (${engine})`, source(ttsSrc, 'tts'), ttsConfig, onProgress);
        st.ttsKey = ttsKey; st.ttsEngine = engine; st.ttsSrc = ttsSrc; st.ttsRate = NATIVE_RATE[engine];
      }
    },

    // Only one recognition stream at a time per model: QVAC refuses to open a second one until the
    // previous one has finished closing. So we close cleanly (end, then let the stream drain)
    // and the next stream waits for that close.
    openAsr(opts, cb) {
      let closed = false;
      let session = null;
      const queued = [];
      let markDrained;
      const drained = new Promise((r) => { markDrained = r; });
      let drainedOnce = false;
      const doneDraining = () => { if (drainedOnce) return; drainedOnce = true; st.asrDrainedAt = Date.now(); markDrained(); };
      const previous = asrReleased();
      st.asrClosing = drained;
      const params = { modelId: st.asr, emitVadEvents: true, endOfTurnSilenceMs: clamp(num(opts.endSilenceMs, 800), 200, 5000) };
      const open = async () => {
        await previous;
        if (closed) { doneDraining(); return; }
        let s;
        try { s = await sdk.transcribeStream(params); } catch (e) {
          // a close still in progress on QVAC's side: try once more, a little later
          if (closed) { doneDraining(); return; }
          await new Promise((r) => setTimeout(r, 600));
          s = await sdk.transcribeStream(params);
        }
        if (closed) { try { s.end(); } catch { /* closed */ } }
        session = s;
        for (const b of queued.splice(0)) { if (!closed) s.write(b); }
        try {
          for await (const ev of s) {
            if (closed) continue;                      // drain the stream to the end
            if (ev.type === 'text') cb.onText(String(ev.text || ''));
            else if (ev.type === 'vad') cb.onVad(!!ev.speaking);
            else if (ev.type === 'endOfTurn') cb.onEndOfTurn();
          }
        } catch (e) { if (!closed) cb.onError(e); }
        doneDraining();
      };
      open().catch((e) => { doneDraining(); if (!closed) cb.onError(e); });
      return {
        write(buf) {
          if (closed) return;
          if (session) session.write(buf); else if (queued.length < 600) queued.push(buf);
        },
        close() {
          if (closed) return;
          closed = true;
          try { if (session) session.end(); } catch { /* closed */ }
          // safety net: if the stream does not drain, destroy it
          setTimeout(() => { try { if (session) session.destroy(); } catch { /* closed */ } doneDraining(); }, 3000);
        },
      };
    },

    generate({ system, history, temperature, onDelta }) {
      const t0 = Date.now();
      const run = sdk.completion({
        modelId: st.llm,
        history: [{ role: 'system', content: system }, ...history],
        stream: true,
        generationParams: { temp: clamp(num(temperature, 0.7), 0, 2), predict: M.llm.maxTokens || 320 },
      });
      let cancelled = false;
      const done = (async () => {
        let text = '';
        let firstTokenMs = null;
        try {
          for await (const ev of run.events) {
            if (cancelled) break;
            if (ev.type === 'contentDelta' && ev.text) {
              if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
              text += ev.text;
              onDelta(ev.text);
            } else if (ev.type === 'completionDone') break;
          }
        } catch (e) { if (!cancelled) throw e; }
        try { await run.final; } catch { /* cancelled */ }
        return { text, firstTokenMs, cancelled };
      })();
      return {
        done,
        cancel() {
          if (cancelled) return;
          cancelled = true;
          sdk.cancel({ requestId: run.requestId }).catch(() => {});
        },
      };
    },

    speak(o = {}) {
      const q = new AsyncQueue();
      let cancelled = false;
      let current = null;
      let chain = Promise.resolve();
      const mode = M.tts.mode || 'sentence';
      // Parler: the voice per request — a free-text description, OR the template speaker (never both)
      const voiceFields = {};
      if (st.ttsEngine === 'parler') {
        const description = String(o.description || '').trim();
        if (description) voiceFields.description = description;
        else voiceFields.voice = String((M.tts.parler && M.tts.parler.voice) || 'Laura');
      }
      if (mode === 'stream') return streamSpeak();
      // One sentence at a time: we know exactly which sentence is being said (captions), and can cut cleanly.
      return {
        frames: q,
        write(sentence) {
          chain = chain.then(async () => {
            if (cancelled) return;
            const r = sdk.textToSpeech({ modelId: st.tts, text: sentence, inputType: 'text', stream: false, ...voiceFields });
            current = r;
            let samples;
            try { samples = await r.buffer; } catch (e) { if (!cancelled) q.fail(e); return; }
            const rate = (await r.sampleRate) || st.ttsRate;
            current = null;
            if (cancelled || !samples || !samples.length) return;
            const pcm = Int16Array.from(samples);
            const frame = Math.round(rate * 0.25);
            for (let i = 0; i < pcm.length; i += frame) q.push({ pcm: pcm.subarray(i, i + frame), sampleRate: rate, text: i === 0 ? sentence : '' });
          });
        },
        end() { chain = chain.then(() => q.end(), () => q.end()); },
        cancel() {
          cancelled = true;
          if (current && current.requestId) sdk.cancel({ requestId: current.requestId }).catch(() => {});
          q.end();
        },
      };

      // Variant: continuous streaming voice (textToSpeechStream). Setting "tts.mode": "stream".
      function streamSpeak() {
        let session = null;
        const ready = sdk.textToSpeechStream({ modelId: st.tts, inputType: 'text', accumulateSentences: true, sentenceDelimiterPreset: 'latin', ...voiceFields })
          .then((s) => {
            session = s;
            if (cancelled) { try { s.destroy(); } catch { /* closed */ } q.end(); return s; }
            (async () => {
              try {
                for await (const m of s) {
                  if (cancelled) break;
                  if (m.buffer && m.buffer.length) q.push({ pcm: Int16Array.from(m.buffer), sampleRate: m.sampleRate || st.ttsRate, text: m.sentenceChunk || '' });
                  if (m.done) break;
                }
              } catch (e) { if (!cancelled) q.fail(e); }
              q.end();
            })();
            return s;
          }, (e) => { q.fail(e); return null; });
        return {
          frames: q,
          write(sentence) { ready.then((s) => { if (s && !cancelled) s.write(`${sentence} `); }); },
          end() { ready.then((s) => { if (s && !cancelled) s.end(); }); },
          cancel() {
            cancelled = true;
            if (session) { sdk.cancel({ requestId: session.requestId }).catch(() => {}); try { session.destroy(); } catch { /* closed */ } }
            q.end();
          },
        };
      }
    },

    async close() {
      for (const id of [st.asr, st.llm, st.tts]) await unload(id);
      try { await sdk.close(); } catch { /* closed */ }
    },
  };
}
