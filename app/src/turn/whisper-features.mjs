// Whisper-style log-mel features for the Smart Turn v3 end-of-turn model.
//
// A faithful JavaScript port of Pipecat's src/pipecat/audio/turn/smart_turn/_whisper_features.py
// (compute_whisper_log_mel_features, do_normalize=True) and of the input preparation in
// local_smart_turn_v3.py (keep the last 8 s, zero-pad at the BEGINNING).
//   Copyright (c) 2024-2026, Daily — BSD 2-Clause License (see ../../models/SMART_TURN_LICENSE.txt).
//   Portions derived by Daily from Hugging Face Transformers (WhisperFeatureExtractor, audio_utils),
//   Copyright 2022-2023 The HuggingFace Inc. team, Apache License 2.0.
//
// PURE module (no dependency, no I/O): tested by tests/test-smart-turn.mjs against fixtures made by
// the Python reference (tests/tools/make_smart_turn_fixtures.py).
//
//   smartTurnInput(audio16k)     → Float32Array(128000): the last 8 s, zero-padded at the beginning
//   whisperLogMel(audio16k)      → Float32Array(80 × 800), row-major [mel][frame] (numpy [80][800] layout)
//   smartTurnFeatures(audio16k)  → whisperLogMel(smartTurnInput(audio16k))

export const SAMPLE_RATE = 16000;
export const N_FFT = 400;
export const HOP_LENGTH = 160;
export const N_MELS = 80;
export const N_SAMPLES = SAMPLE_RATE * 8;          // 128000
export const N_FRAMES = N_SAMPLES / HOP_LENGTH;    // 800 (the 801st frame is dropped, like the reference)
const N_BINS = N_FFT / 2 + 1;                      // 201
const MEL_FLOOR = 1e-10;
const NORM_VARIANCE_EPS = 1e-7;

// — constants computed once (float64, like numpy) ——————————————————————————————————————

/** numpy.linspace: y[i] = i * step + start, and the last value is exactly `stop`. */
function linspace(start, stop, num) {
  const y = new Float64Array(num);
  const step = (stop - start) / (num - 1);
  for (let i = 0; i < num; i++) y[i] = i * step + start;
  y[num - 1] = stop;
  return y;
}
function hertzToMelSlaney(freq) {
  const logstep = 27.0 / Math.log(6.4);
  return freq >= 1000.0 ? 15.0 + Math.log(freq / 1000.0) * logstep : 3.0 * freq / 200.0;
}
function melToHertzSlaney(mel) {
  const logstep = Math.log(6.4) / 27.0;
  return mel >= 15.0 ? 1000.0 * Math.exp(logstep * (mel - 15.0)) : 200.0 * mel / 3.0;
}

/**
 * The Slaney-normalised triangular mel filter bank, (201 bins × 80 mels) in the reference.
 * Stored sparsely: for each mel, its first bin and its non-zero weights.
 */
function buildMelFilters() {
  const melMin = hertzToMelSlaney(0);
  const melMax = hertzToMelSlaney(SAMPLE_RATE / 2);
  const melFreqs = linspace(melMin, melMax, N_MELS + 2);
  const filterFreqs = melFreqs.map(melToHertzSlaney);
  const fftFreqs = linspace(0, Math.floor(SAMPLE_RATE / 2), N_BINS);
  const filterDiff = new Float64Array(N_MELS + 1);
  for (let i = 0; i < N_MELS + 1; i++) filterDiff[i] = filterFreqs[i + 1] - filterFreqs[i];
  const filters = [];
  for (let m = 0; m < N_MELS; m++) {
    const enorm = 2.0 / (filterFreqs[m + 2] - filterFreqs[m]);
    let first = -1;
    const w = [];
    for (let k = 0; k < N_BINS; k++) {
      const down = -(filterFreqs[m] - fftFreqs[k]) / filterDiff[m];
      const up = (filterFreqs[m + 2] - fftFreqs[k]) / filterDiff[m + 1];
      const v = Math.max(0, Math.min(down, up)) * enorm;
      if (v > 0) { if (first < 0) first = k; w.push(v); } else if (first >= 0) break;
    }
    filters.push({ first: Math.max(0, first), weights: Float64Array.from(w) });
  }
  return filters;
}
const MEL_FILTERS = buildMelFilters();

/** Periodic Hann window of 400 points (numpy.hanning(401)[:-1], same as torch.hann_window). */
const HANN = (() => {
  const w = new Float64Array(N_FFT);
  for (let n = 0; n < N_FFT; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);
  return w;
})();

// — a mixed-radix FFT for n = 400 = 4 × 4 × 5 × 5 (Stockham, decimation in frequency) ——————————

function makeFft(n, radices) {
  const stages = [];
  let len = n; let stride = 1;
  for (const p of radices) {
    const m = len / p;
    // twiddles W_len^(q·r), q < m, r < p
    const twRe = new Float64Array(m * p); const twIm = new Float64Array(m * p);
    for (let q = 0; q < m; q++) {
      for (let r = 0; r < p; r++) {
        const a = (-2 * Math.PI * q * r) / len;
        twRe[q * p + r] = Math.cos(a); twIm[q * p + r] = Math.sin(a);
      }
    }
    // the small DFT matrix W_p^(j·r)
    const dRe = new Float64Array(p * p); const dIm = new Float64Array(p * p);
    for (let j = 0; j < p; j++) {
      for (let r = 0; r < p; r++) {
        const a = (-2 * Math.PI * ((j * r) % p)) / p;
        dRe[j * p + r] = Math.cos(a); dIm[j * p + r] = Math.sin(a);
      }
    }
    stages.push({ p, m, len, stride, twRe, twIm, dRe, dIm });
    len = m; stride *= p;
  }
  if (len !== 1) throw new Error('makeFft: the radices must multiply to n');
  const bufRe = new Float64Array(n); const bufIm = new Float64Array(n);
  const aRe = new Float64Array(8); const aIm = new Float64Array(8);
  /** In-place complex FFT of (re, im), natural order in and out. */
  return function fft(re, im) {
    let xRe = re; let xIm = im; let yRe = bufRe; let yIm = bufIm;
    for (const st of stages) {
      const { p, m, stride: s, twRe, twIm, dRe, dIm } = st;
      for (let q = 0; q < m; q++) {
        for (let k = 0; k < s; k++) {
          for (let j = 0; j < p; j++) { const i = k + s * (q + m * j); aRe[j] = xRe[i]; aIm[j] = xIm[i]; }
          for (let r = 0; r < p; r++) {
            let sr = 0; let si = 0;
            for (let j = 0; j < p; j++) {
              const wr = dRe[j * p + r]; const wi = dIm[j * p + r];
              sr += aRe[j] * wr - aIm[j] * wi;
              si += aRe[j] * wi + aIm[j] * wr;
            }
            const tr = twRe[q * p + r]; const ti = twIm[q * p + r];
            const o = k + s * (p * q + r);
            yRe[o] = sr * tr - si * ti;
            yIm[o] = sr * ti + si * tr;
          }
        }
      }
      const tRe = xRe; const tIm = xIm; xRe = yRe; xIm = yIm; yRe = tRe; yIm = tIm;
    }
    if (xRe !== re) { re.set(xRe); im.set(xIm); }
  };
}
const fft400 = makeFft(N_FFT, [4, 4, 5, 5]);

/**
 * numpy's float32 sum (np.add.reduce on a contiguous float32 array): pairwise summation with float32
 * accumulators, 8-way unrolled blocks of at most 128 values (numpy/_core/src/umath/loops_utils.h.src).
 * Reproduced operation by operation, so the mean and variance are bit-identical to the reference's.
 */
function pairwiseSum32(a, start, n) {
  const fr = Math.fround;
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res = fr(res + a[start + i]);
    return res;
  }
  if (n <= 128) {
    let r0 = a[start]; let r1 = a[start + 1]; let r2 = a[start + 2]; let r3 = a[start + 3];
    let r4 = a[start + 4]; let r5 = a[start + 5]; let r6 = a[start + 6]; let r7 = a[start + 7];
    let i = 8;
    for (const end = n - (n % 8); i < end; i += 8) {
      const o = start + i;
      r0 = fr(r0 + a[o]); r1 = fr(r1 + a[o + 1]); r2 = fr(r2 + a[o + 2]); r3 = fr(r3 + a[o + 3]);
      r4 = fr(r4 + a[o + 4]); r5 = fr(r5 + a[o + 5]); r6 = fr(r6 + a[o + 6]); r7 = fr(r7 + a[o + 7]);
    }
    let res = fr(fr(fr(r0 + r1) + fr(r2 + r3)) + fr(fr(r4 + r5) + fr(r6 + r7)));
    for (; i < n; i++) res = fr(res + a[start + i]);
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return fr(pairwiseSum32(a, start, n2) + pairwiseSum32(a, start + n2, n - n2));
}

// — the features ——————————————————————————————————————————————————————————————————————————

/** The model's input: the last 8 s of 16 kHz audio, zero-padded at the BEGINNING to exactly 8 s. */
export function smartTurnInput(audio) {
  const a = audio instanceof Float32Array ? audio : Float32Array.from(audio || []);
  if (a.length === N_SAMPLES) return a;
  if (a.length > N_SAMPLES) return a.slice(a.length - N_SAMPLES);
  const out = new Float32Array(N_SAMPLES);
  out.set(a, N_SAMPLES - a.length);
  return out;
}

/**
 * Whisper log-mel features of 16 kHz audio, like compute_whisper_log_mel_features(audio, do_normalize=True):
 * shorter input is zero-padded at the END, longer input keeps its first 8 s.
 * @param {Float32Array} audio
 * @returns {Float32Array} 80 × 800 values, row-major [mel][frame]
 */
export function whisperLogMel(audio) {
  // 1. exactly 8 s, in float32
  const x = new Float32Array(N_SAMPLES);
  x.set(audio.length > N_SAMPLES ? audio.subarray(0, N_SAMPLES) : audio);
  // 2. zero mean, unit variance, in float32 EXACTLY like numpy (x.mean(), x.var(): float32 pairwise sums).
  //    It matters: the lowest mel band of a frame is often a near-cancellation of its DC offset, and the
  //    int8 model is sensitive to it (an exact float64 mean shifted one test probability by 0.03).
  const fr = Math.fround;
  const mean = fr(pairwiseSum32(x, 0, N_SAMPLES) / N_SAMPLES);
  const sq = new Float32Array(N_SAMPLES);
  for (let i = 0; i < N_SAMPLES; i++) { const d = fr(x[i] - mean); sq[i] = fr(d * d); }
  const variance = fr(pairwiseSum32(sq, 0, N_SAMPLES) / N_SAMPLES);
  const std = fr(Math.sqrt(fr(variance + NORM_VARIANCE_EPS)));
  for (let i = 0; i < N_SAMPLES; i++) x[i] = fr(fr(x[i] - mean) / std);
  // 3. power spectrogram: reflect padding of 200 on each side, Hann window, real FFT, |·|²
  //    Two real frames per complex FFT (one in the real part, one in the imaginary part).
  const pad = N_FFT >> 1;
  const sample = (p) => {
    let i = p - pad;
    if (i < 0) i = -i; else if (i >= N_SAMPLES) i = 2 * (N_SAMPLES - 1) - i;
    return x[i];
  };
  const re = new Float64Array(N_FFT); const im = new Float64Array(N_FFT);
  const power = new Float64Array(N_BINS * N_FRAMES);         // [frame][bin]
  for (let t = 0; t < N_FRAMES; t += 2) {
    const s0 = t * HOP_LENGTH; const s1 = s0 + HOP_LENGTH;
    for (let j = 0; j < N_FFT; j++) { re[j] = sample(s0 + j) * HANN[j]; im[j] = sample(s1 + j) * HANN[j]; }
    fft400(re, im);
    const o0 = t * N_BINS; const o1 = o0 + N_BINS;
    for (let k = 0; k < N_BINS; k++) {
      const nk = (N_FFT - k) % N_FFT;
      const ar = re[k] + re[nk]; const ai = im[k] - im[nk];
      const br = im[k] + im[nk]; const bi = re[k] - re[nk];
      power[o0 + k] = (ar * ar + ai * ai) / 4;
      power[o1 + k] = (br * br + bi * bi) / 4;
    }
  }
  // 4. mel projection, floor, log10; the max is taken AFTER dropping the last frame (never computed here)
  const out = new Float32Array(N_MELS * N_FRAMES);
  const logs = new Float64Array(N_MELS * N_FRAMES);
  let max = -Infinity;
  for (let m = 0; m < N_MELS; m++) {
    const { first, weights } = MEL_FILTERS[m];
    const nw = weights.length;
    for (let t = 0; t < N_FRAMES; t++) {
      const base = t * N_BINS + first;
      let v = 0;
      for (let k = 0; k < nw; k++) v += weights[k] * power[base + k];
      const l = Math.log10(Math.max(MEL_FLOOR, v));
      logs[m * N_FRAMES + t] = l;
      if (l > max) max = l;
    }
  }
  // 5. dynamic range of 8 (log10 units), then scale to about [-1, 1]
  const floor = max - 8.0;
  for (let i = 0; i < logs.length; i++) out[i] = (Math.max(logs[i], floor) + 4.0) / 4.0;
  return out;
}

/** The Smart Turn pipeline: last 8 s (padded at the beginning), then the log-mel features. */
export function smartTurnFeatures(audio) {
  return whisperLogMel(smartTurnInput(audio));
}

// exposed for the tests
export const _ = { makeFft, MEL_FILTERS, HANN, linspace };
