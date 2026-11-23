// Small helpers shared by the server.

/** An async queue: push() on one side, `for await` on the other. */
export class AsyncQueue {
  constructor() { this.items = []; this.waiters = []; this.ended = false; this.error = null; }
  push(item) {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w.resolve({ value: item, done: false }); else this.items.push(item);
  }
  end() {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w.resolve({ value: undefined, done: true });
  }
  fail(err) {
    this.error = err;
    this.ended = true;
    for (const w of this.waiters.splice(0)) w.reject(err);
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.error) return Promise.reject(this.error);
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
      return: () => { this.end(); return Promise.resolve({ value: undefined, done: true }); },
    };
  }
}

/** A wait that can be cancelled. */
export function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(false); return; }   // already cancelled: never "done"
    if (!ms || ms <= 0) { resolve(true); return; }
    const t = setTimeout(() => resolve(true), ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(false); }, { once: true });
  });
}

/** A lock: only one model preparation at a time. */
export function mutex() {
  let last = Promise.resolve();
  return (fn) => {
    const run = last.then(fn, fn);
    last = run.catch(() => {});
    return run;
  };
}

/** RMS level of a 16-bit PCM block. */
export function rmsS16(buf) {
  const n = buf.length >> 1;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = buf.readInt16LE(i * 2) / 32768; sum += v * v; }
  return Math.sqrt(sum / n);
}

/** The status line while a model loads: "Loading: language model 42 % (440/1057 MB) · waiting for data, 12 s". */
/**
 * The words of a model's progress. With a size, bytes arrive: "Downloading" (once, then the model stays on this
 * computer). Without, it is read from this computer into memory: "Loading" — never a download.
 */
export function progressText(p) {
  if (!p) return '';
  const pct = typeof p.progress === 'number' ? ` ${Math.round(p.progress)} %` : '';
  if (p.total) {
    const wait = p.waitS ? ` · ${p.progress >= 100 ? 'loading into memory' : 'waiting for data'}, ${p.waitS} s` : '';
    return `Downloading: ${p.stage}${pct} (${(p.downloaded / 1e6).toFixed(0)}/${(p.total / 1e6).toFixed(0)} MB)${wait}`;
  }
  const wait = p.waitS ? `, ${p.waitS} s` : '';
  return `Loading from this computer: ${p.stage}${p.local ? pct : ''}${wait}`;   // local: a progress of its own (Zonos)
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/**
 * Evens out the voice's loudness. Some voices come out much quieter or louder from one sentence to the next (Zonos
 * with a strong design above all: "almost not audible", then loud). One leveler per stream of the voice:
 * level(pcm, sampleRate, sentenceStart) → the same 16-bit samples, at a steadier level.
 *  - the level is measured on speech only: 20 ms blocks above -50 dBFS (a pause, a silence keep the gain as it is);
 *  - the gain moves toward the target (-20 dBFS of speech), down within about 0.2 s, up within about 0.8 s, and
 *    within 0.1 s for the first 0.3 s of each sentence (a sentence much quieter than the one before is not lost),
 *    between -6 and +14 dB;
 *  - a peak never goes past -1 dBFS: the gain is lowered for that frame.
 */
export function createLeveler({ target = -20, maxBoost = 14, maxCut = 6, upS = 0.8, downS = 0.2, quickS = 0.1, quickFor = 0.3 } = {}) {
  let gainDb = null;                                 // unknown until the first speech
  let quick = 0;                                     // seconds of quick adaptation left (a sentence starts)
  return (pcm, sampleRate = 24000, sentenceStart = false) => {
    if (sentenceStart) quick = quickFor;
    const n = pcm.length;
    if (!n) return pcm;
    const block = Math.max(1, Math.round(sampleRate * 0.02));
    let speech = 0; let speechN = 0; let peak = 0;
    for (let i = 0; i < n; i += block) {
      let e = 0; const end = Math.min(n, i + block);
      for (let j = i; j < end; j++) { const v = pcm[j] / 32768; e += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
      if (10 * Math.log10(e / (end - i) + 1e-12) > -50) { speech += e; speechN += end - i; }
    }
    if (speechN) {
      const want = clamp(target - 10 * Math.log10(speech / speechN + 1e-12), -maxCut, maxBoost);
      const seconds = n / sampleRate;
      const tau = gainDb == null ? 1e-9 : quick > 0 ? quickS : want < gainDb ? downS : upS;
      gainDb = gainDb == null ? want : gainDb + (want - gainDb) * (1 - Math.exp(-seconds / tau));
      quick = Math.max(0, quick - seconds);
    }
    let g = 10 ** ((gainDb == null ? 0 : gainDb) / 20);
    if (peak * g > 0.891) g = 0.891 / peak;          // -1 dBFS
    if (Math.abs(g - 1) < 0.01) return pcm;
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) { const v = Math.round(pcm[i] * g); out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; }
    return out;
  };
}
