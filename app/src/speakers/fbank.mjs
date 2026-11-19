// Kaldi filter-bank features, as WeSpeaker computes them for its speaker models:
//   torchaudio.compliance.kaldi.fbank(wave × 32768, num_mel_bins=80, frame_length=25, frame_shift=10,
//   dither=0, window_type='hamming', use_energy=False), then the mean of each bin over time removed.
// The other options are Kaldi's defaults: DC offset removed per frame, pre-emphasis 0.97, a frame padded
// to 512 samples, the power spectrum, mel bins from 20 Hz to 8 kHz (mel = 1127 ln(1 + f / 700)), log.
//
// PURE module (no dependency, no I/O).
//   fbank(audio16k) → { data: Float32Array(frames × 80), frames }, row-major [frame][bin]

export const SAMPLE_RATE = 16000;
export const N_MELS = 80;
const FRAME = 400;                 // 25 ms
const SHIFT = 160;                 // 10 ms
const N_FFT = 512;                 // the frame padded to a power of two
const PREEMPH = 0.97;
const LOG_FLOOR = 1.1920928955078125e-7;   // float32 epsilon, like torch

const WINDOW = Float64Array.from({ length: FRAME }, (_, n) => 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (FRAME - 1)));

// the mel triangles over the FFT bins 0..255 (the Nyquist bin weighs nothing)
const mel = (f) => 1127 * Math.log(1 + f / 700);
const BANKS = (() => {
  const lo = mel(20), hi = mel(SAMPLE_RATE / 2), delta = (hi - lo) / (N_MELS + 1);
  const width = SAMPLE_RATE / N_FFT;
  const banks = [];
  for (let b = 0; b < N_MELS; b++) {
    const left = lo + b * delta, center = left + delta, right = center + delta;
    const weights = [];
    for (let k = 0; k < N_FFT / 2; k++) {
      const m = mel(width * k);
      const w = Math.max(0, Math.min((m - left) / (center - left), (right - m) / (right - center)));
      if (w > 0) weights.push([k, w]);
    }
    banks.push(weights);
  }
  return banks;
})();

// radix-2 FFT, in place
const BITS = Math.log2(N_FFT);
const REV = Uint16Array.from({ length: N_FFT }, (_, i) => {
  let r = 0;
  for (let b = 0; b < BITS; b++) r |= ((i >> b) & 1) << (BITS - 1 - b);
  return r;
});
const COS = Float64Array.from({ length: N_FFT / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / N_FFT));
const SIN = Float64Array.from({ length: N_FFT / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / N_FFT));
function fft(re, im) {
  for (let i = 0; i < N_FFT; i++) {
    const j = REV[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1, step = N_FFT / size;
    for (let start = 0; start < N_FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step], s = SIN[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** @param {Float32Array} audio  16 kHz mono, -1..1 */
export function fbank(audio) {
  const frames = audio.length < FRAME ? 0 : 1 + Math.floor((audio.length - FRAME) / SHIFT);
  const data = new Float32Array(frames * N_MELS);
  const frame = new Float64Array(FRAME);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  const power = new Float64Array(N_FFT / 2);
  for (let f = 0; f < frames; f++) {
    const o = f * SHIFT;
    let mean = 0;
    for (let i = 0; i < FRAME; i++) { frame[i] = audio[o + i] * 32768; mean += frame[i]; }
    mean /= FRAME;
    for (let i = 0; i < FRAME; i++) frame[i] -= mean;
    re.fill(0); im.fill(0);
    for (let i = FRAME - 1; i >= 0; i--) re[i] = (frame[i] - PREEMPH * frame[i > 0 ? i - 1 : 0]) * WINDOW[i];
    fft(re, im);
    for (let k = 0; k < N_FFT / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < N_MELS; b++) {
      let e = 0;
      for (const [k, w] of BANKS[b]) e += power[k] * w;
      data[f * N_MELS + b] = Math.log(Math.max(e, LOG_FLOOR));
    }
  }
  for (let b = 0; b < N_MELS; b++) {           // each bin's mean over time removed
    let m = 0;
    for (let f = 0; f < frames; f++) m += data[f * N_MELS + b];
    m /= frames || 1;
    for (let f = 0; f < frames; f++) data[f * N_MELS + b] -= m;
  }
  return { data, frames };
}
