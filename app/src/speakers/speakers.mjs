// Who is speaking. A speaker model turns a voice into 512 numbers (a voiceprint); the people recorded on this
// computer (people.json) each have one, and the voice of a turn goes to the closest, if it is close enough.
//
//   createSpeakerModel({modelPath, threads, log}) →
//     {name, ready(): Promise<boolean>, embed(float32At16k): Promise<Float32Array>, close()}
//   createPeople({file, log}) → {size, names(), list(), add(name, voiceprint, seconds), remove(id), identify(voiceprint, seconds)}
//   voiced(float32At16k) → the audio without its silences (what the model listens to), and how long it is
//
// The model: CAM++ by WeSpeaker, trained on VoxCeleb 2 (Apache-2.0, see ../../models/SPEAKER_MODEL_LICENSE.txt),
// run by onnxruntime-node, the OPTIONAL dependency Smart Turn uses too: without it, nobody is recognized.
// Test hook: VIK_SPEAKERS_FAKE=1 → a fake model whose "voice" is the pitch of a tone (no onnxruntime).
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fbank, N_MELS } from './fbank.mjs';

export const MODEL_NAME = 'campplus-voxceleb';
export const MIN_SECONDS = 0.3;       // less voice than this: too short to tell who it is
/**
 * How close a voice must be to someone's voiceprint to be theirs. The shorter the voice, the lower it scores, so the
 * lower its line. Measured on LibriSpeech test-clean (40 speakers, 15 s recorded each), a family of 4 recorded:
 *   0.5 s, 0.30: the right person 90 %, a wrong one 0.2 %, a stranger stays unknown 94 %;
 *   1 s, 0.40: the right person 96 %, a wrong one 0.1 %, a stranger stays unknown 98 %;
 *   whole sentences (3 to 30 s), 0.45: the right person 99 %, a wrong one 0 %, a stranger stays unknown 97.5 %.
 * Below the line: "someone not recognized" (never the last person recognized: a child's "yes" is not a parent's).
 */
export const thresholdFor = (seconds) => (seconds < 1 ? 0.3 : seconds < 3 ? 0.4 : 0.45);
export const ENROL_SECONDS = 8;       // a recording needs at least this much voice
const PEOPLE_MAX = 50;

/** The audio without its silences: 20 ms blocks at most 35 dB under the loudest one, and above -55 dBFS. */
export function voiced(audio) {
  const B = 320;
  const n = Math.floor(audio.length / B);
  const rms = new Float64Array(n);
  let peak = 0;
  for (let b = 0; b < n; b++) {
    let e = 0;
    for (let i = b * B; i < (b + 1) * B; i++) e += audio[i] * audio[i];
    rms[b] = Math.sqrt(e / B);
    if (rms[b] > peak) peak = rms[b];
  }
  const floor = Math.max(peak * 10 ** (-35 / 20), 10 ** (-55 / 20));
  const keep = [];
  for (let b = 0; b < n; b++) if (rms[b] >= floor) keep.push(b);
  const out = new Float32Array(keep.length * B);
  keep.forEach((b, k) => out.set(audio.subarray(b * B, (b + 1) * B), k * B));
  return { audio: out, seconds: out.length / 16000 };
}

const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };
const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** @param {{modelPath?: string, threads?: number, log?: (m: string) => void}} [o] */
export function createSpeakerModel({ modelPath, threads = 1, log = () => {} } = {}) {
  if (process.env.VIK_SPEAKERS_FAKE) return fakeModel();
  let session = null;
  let ort = null;
  const loading = (async () => {
    try {
      if (!modelPath || !existsSync(modelPath)) throw new Error(`model not found: ${modelPath}`);
      let mod;
      try { mod = await import('onnxruntime-node'); } catch (e) {
        throw new Error(`the onnxruntime-node runtime is not installed (${String(e && e.message).split('\n')[0]})`);
      }
      ort = mod.default && mod.default.InferenceSession ? mod.default : mod;
      session = await ort.InferenceSession.create(modelPath, {
        executionMode: 'sequential', interOpNumThreads: 1, graphOptimizationLevel: 'all',
        intraOpNumThreads: Math.max(1, Math.round(Number(threads) || 1)),
      });
      log(`▸ speaker model ready (${modelPath.split(/[\\/]/).pop()})`);
      return true;
    } catch (e) {
      log(`Recognizing people is unavailable (${e && e.message ? e.message : e}).`);
      return false;
    }
  })();
  return {
    name: MODEL_NAME,
    ready: () => loading,
    async embed(audio) {
      if (!(await loading) || !session) throw new Error('the speaker model is unavailable');
      const { data, frames } = fbank(audio);
      if (frames < 10) throw new Error('too short');
      const out = await session.run({ feats: new ort.Tensor('float32', data, [1, frames, N_MELS]) });
      return unit((out.embs || out[Object.keys(out)[0]]).data);
    },
    async close() {
      try { if (session && session.release) await session.release(); } catch { /* released */ }
      session = null;
    },
  };
}

/** For the tests: the "voice" is its pitch (the median of 50 ms blocks, by autocorrelation): close pitches, close voices. */
function fakeModel() {
  const pitch = (a) => {
    const F = 800; const found = [];
    for (let o = 0; o + F <= a.length; o += F) {
      let e = 0;
      for (let i = o; i < o + F; i++) e += a[i] * a[i];
      if (e / F < 1e-5) continue;
      let best = 0; let lag = 0;
      for (let L = 16; L <= 266; L++) {                      // 1000 Hz down to 60 Hz
        let s = 0;
        for (let i = o; i < o + F - L; i++) s += a[i] * a[i + L];
        if (s > best) { best = s; lag = L; }
      }
      if (lag) found.push(16000 / lag);
    }
    found.sort((x, y) => x - y);
    return found.length ? found[found.length >> 1] : 0;
  };
  return {
    name: `${MODEL_NAME} (fake)`,
    ready: async () => true,
    async embed(audio) {
      const at = pitch(audio) / 100;                         // in 100 Hz steps
      return unit(Float32Array.from({ length: 32 }, (_, k) => Math.exp(-((k - at) ** 2) / 0.5)));
    },
    async close() {},
  };
}

/** The people recorded on this computer, and their voiceprints. Never in an agent: a voice is personal data. */
export function createPeople({ file, log = () => {} }) {
  let people = [];
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j && j.model === MODEL_NAME && Array.isArray(j.people)) {
      people = j.people.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.voiceprint))
        .map((p) => ({ id: String(p.id), name: p.name, seconds: Number(p.seconds) || 0, added: String(p.added || ''), voiceprint: unit(p.voiceprint) }));
    } else if (j && j.model) log(`(people.json was made with another speaker model: record the people again)`);
  } catch (e) {
    if (e.code !== 'ENOENT') log(`(people.json could not be read: ${e.message})`);
  }
  function save() {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const out = people.map((p) => ({ id: p.id, name: p.name, seconds: p.seconds, added: p.added, voiceprint: Array.from(p.voiceprint, (x) => Math.round(x * 1e5) / 1e5) }));
    writeFileSync(tmp, JSON.stringify({ version: 1, model: MODEL_NAME, people: out }));
    renameSync(tmp, file);
  }
  const same = (a, b) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
  return {
    get size() { return people.length; },
    names: () => people.map((p) => p.name),
    list: () => people.map(({ id, name, seconds, added }) => ({ id, name, seconds, added })),
    /** Records someone (the same name again: their new voice replaces the old one). */
    add(name, voiceprint, seconds) {
      const n = String(name || '').replace(/[\u0000-\u001f[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!n) throw new Error('A name is needed.');
      const old = people.find((p) => same(p.name, n));
      if (!old && people.length >= PEOPLE_MAX) throw new Error(`At most ${PEOPLE_MAX} people.`);
      const p = { id: old ? old.id : randomBytes(4).toString('hex'), name: n, seconds: Math.round(seconds * 10) / 10, added: new Date().toISOString(), voiceprint: unit(voiceprint) };
      people = old ? people.map((x) => (x === old ? p : x)) : [...people, p];
      save();
      return { id: p.id, name: p.name, seconds: p.seconds, added: p.added };
    },
    remove(id) {
      const before = people.length;
      people = people.filter((p) => p.id !== id);
      if (people.length !== before) save();
      return people.length !== before;
    },
    /** The closest person: {name ('' if nobody is close enough), closest (their name anyway), score}. */
    identify(voiceprint, seconds = 1) {
      let best = null; let score = -1;
      for (const p of people) { const s = cosine(voiceprint, p.voiceprint); if (s > score) { score = s; best = p; } }
      return { name: best && score >= thresholdFor(seconds) ? best.name : '', closest: best ? best.name : '', score: Math.round(score * 100) / 100 };
    },
  };
}
