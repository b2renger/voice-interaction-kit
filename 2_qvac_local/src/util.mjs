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
export function progressText(p) {
  if (!p) return '';
  const pct = typeof p.progress === 'number' ? ` ${Math.round(p.progress)} %` : '';
  const mb = p.total ? ` (${(p.downloaded / 1e6).toFixed(0)}/${(p.total / 1e6).toFixed(0)} MB)` : '';
  const wait = p.waitS ? ` · ${p.progress >= 100 ? 'loading into memory' : 'waiting for data'}, ${p.waitS} s` : '';
  return `Loading: ${p.stage}${pct}${mb}${wait}`;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
