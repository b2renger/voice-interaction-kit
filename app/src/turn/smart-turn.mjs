// Smart Turn v3.2 (Daily, BSD-2, via Pipecat): an 8 MB int8 ONNX model that listens to the last ≤ 8 s
// of the person's turn and gives the probability that they have FINISHED speaking.
// The session asks it after each short silence (end of a speech segment): "complete" ends the turn
// right away, otherwise the usual end-of-turn silence (endSilenceMs) stays the fallback.
//
//   createSmartTurn({modelPath, threads, threshold, log}) →
//     {name, ready(): Promise<boolean>, predict(float32At16k): Promise<{probability, complete, ms}>, close()}
//
// The runtime, onnxruntime-node, is an OPTIONAL dependency loaded with import() only when a session
// first asks for Smart Turn: if it (or the model) is missing, ready() resolves false, the reason is
// logged once, and the app keeps working with silence only.
//
// Test hook: SMART_TURN_FAKE = complete | incomplete | a number 0..1 → a fake runner, no onnxruntime.
import { existsSync } from 'node:fs';
import { smartTurnFeatures, N_MELS, N_FRAMES } from './whisper-features.mjs';

export const SMART_TURN_UNAVAILABLE = 'Smart Turn is unavailable here: using silence only.';

/**
 * @param {{modelPath?: string, threads?: number, threshold?: number, log?: (m: string) => void}} [o]
 */
export function createSmartTurn({ modelPath, threads = 1, threshold = 0.5, log = () => {} } = {}) {
  const th = Number.isFinite(Number(threshold)) ? Number(threshold) : 0.5;
  const fake = process.env.SMART_TURN_FAKE;
  if (fake) return fakeSmartTurn(String(fake).trim().toLowerCase(), th, log);

  let session = null;
  let ort = null;
  let logged = false;
  const fail = (e) => {
    if (!logged) { logged = true; log(`Smart Turn unavailable (${e && e.message ? e.message : e}): using silence only.`); }
    return false;
  };
  const loading = (async () => {
    try {
      if (!modelPath) throw new Error('no model path in config.json (turn.smartTurn.model)');
      if (!existsSync(modelPath)) throw new Error(`model not found: ${modelPath}`);
      let mod;
      try { mod = await import('onnxruntime-node'); } catch (e) {
        throw new Error(`the onnxruntime-node runtime is not installed (${String(e && e.message).split('\n')[0]})`);
      }
      ort = mod.default && mod.default.InferenceSession ? mod.default : mod;
      session = await ort.InferenceSession.create(modelPath, {
        executionMode: 'sequential',
        interOpNumThreads: 1,
        intraOpNumThreads: Math.max(1, Math.round(Number(threads) || 1)),
        graphOptimizationLevel: 'all',
      });
      log(`▸ Smart Turn ready (${modelPath.split(/[\\/]/).pop()}, ${Math.max(1, Math.round(Number(threads) || 1))} thread)`);
      return true;
    } catch (e) { return fail(e); }
  })();

  return {
    name: 'smart-turn-v3.2',
    ready: () => loading,
    async predict(audio) {
      if (!(await loading) || !session) throw new Error(SMART_TURN_UNAVAILABLE);
      const t0 = performance.now();
      const features = smartTurnFeatures(audio instanceof Float32Array ? audio : Float32Array.from(audio || []));
      const tensor = new ort.Tensor('float32', features, [1, N_MELS, N_FRAMES]);
      const out = await session.run({ input_features: tensor });
      const logits = out.logits || out[Object.keys(out)[0]];
      const probability = clamp01(Number(logits.data[0]));
      return { probability, complete: probability > th, ms: Math.round(performance.now() - t0) };
    },
    async close() {
      try { if (session && session.release) await session.release(); } catch { /* released */ }
      session = null;
    },
  };
}

function fakeSmartTurn(value, threshold, log) {
  const p = value === 'complete' ? 0.95 : value === 'incomplete' ? 0.05 : Number(value);
  const ok = Number.isFinite(p) && p >= 0 && p <= 1;
  if (!ok) log(`Smart Turn: SMART_TURN_FAKE must be "complete", "incomplete" or a number from 0 to 1 (got "${value}").`);
  return {
    name: `smart-turn-v3.2 (fake: ${value})`,
    ready: async () => ok,
    async predict() {
      if (!ok) throw new Error(SMART_TURN_UNAVAILABLE);
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 1));
      return { probability: p, complete: p > threshold, ms: Math.max(1, Math.round(performance.now() - t0)) };
    },
    async close() {},
  };
}

function clamp01(v) { return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
