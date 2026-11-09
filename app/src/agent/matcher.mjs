// The matcher: how close a sentence is to an example or to an entry, as the cosine of their embeddings
// (docs/DESIGN.md, 3). Two kinds:
//   words   no model: the words of a text (common English and French words left out) and their letter trigrams,
//           hashed into a vector. The same result every time; it only matches close wordings.
//   model   an embedding model (EmbeddingGemma 300M through QVAC), with the prompts it was trained with.
// A matcher maps its raw cosine to a 0–1 score, so that one "confidence" setting means the same thing with both:
// for a model, (cosine − floor) / (ceil − floor), the floor being the cosine of two unrelated texts and the ceiling
// that of two that say the same thing. A model has one range for comparing two sentences ("similar") and one for
// searching the knowledge (a sentence against an entry's row: "search").
import { normalize } from './knowledge.mjs';

const DIM = 2048;
// Words that carry no meaning of their own here. The question words (when, where, how…) stay: they do.
const STOP = new Set(('a an the is are am was were be been being do does did you your yours i me my mine we us our it its '
  + 'to of in on at for and or but so can could would should will shall may might must please just some any this that '
  + 'these those there here with about have has had very really also too then than tell let lets ok '
  + 'le la les un une des du de d l est sont suis es etes je j tu il elle nous vous ils elles on me m te t se s mon ma mes ton '
  + 'ta tes son sa ses notre nos votre vos leur leurs et mais au aux en dans sur pour par avec ce c cet cette ces y ne n pas '
  + 'plait svp moi toi lui eux').split(' '));

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function unit(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** A plural, English or French, as its singular: "tickets" → "ticket" ("bus", "glass" stay). */
const singular = (w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);

/** The words vector of a text: its words (weight 1) and their letter trigrams (weight 0.35), unit length. */
export function wordVector(text) {
  const all = normalize(text).split(' ').filter(Boolean);
  const words = all.filter((w) => !STOP.has(w));
  const v = new Float32Array(DIM);
  for (const w of (words.length ? words : all).map(singular)) {   // "yes", "next": a text of common words keeps them
    v[hash(`w:${w}`) % DIM] += 1;
    const p = `<${w}>`;
    for (let i = 0; i + 3 <= p.length; i++) v[hash(`t:${p.slice(i, i + 3)}`) % DIM] += 0.35;
  }
  return unit(v);
}

export function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** The words matcher: no model, always there. */
export function wordsMatcher() {
  return {
    id: 'words',
    name: 'Words',
    async vectors(texts) { return texts.map(wordVector); },
    score(a, b) { return Math.max(0, Math.min(1, cosine(a, b))); },
  };
}

/**
 * EmbeddingGemma 300M's ranges, measured with QVAC 0.21 (Q8_0): two sentences that say the same thing score
 * 0.79–0.97, two unrelated ones 0.43–0.65; a sentence against the row of the entry it means 0.53–0.66, against
 * other rows 0.24–0.43.
 */
export const GEMMA_CALIBRATION = { similar: [0.55, 0.95], search: [0.35, 0.7] };

/** The prompts EmbeddingGemma was trained with (its model card): a symmetric comparison, a search, a document. */
const GEMMA_PROMPTS = {
  similar: (t) => `task: sentence similarity | query: ${t}`,
  query: (t) => `task: search result | query: ${t}`,
  document: (t, title) => `title: ${title || 'none'} | text: ${t}`,
};

/**
 * A matcher on an embedding model.
 * @param {{id: string, name: string, embed: (texts: string[]) => Promise<number[][]>,
 *   calibration?: {similar: [number, number], search: [number, number]}, prompts?: typeof GEMMA_PROMPTS, batch?: number}} o
 *   calibration: per kind of comparison, [floor, ceiling] of the raw cosine (see GEMMA_CALIBRATION)
 */
export function modelMatcher({ id, name, embed, calibration = GEMMA_CALIBRATION, prompts = GEMMA_PROMPTS, batch = 32 }) {
  const cache = new Map();             // prompted text → unit vector
  const MAX = 50000;
  // QVAC's embedding model takes one job at a time ("Cannot set new job: a job is already set"): one after the other
  let chain = Promise.resolve();
  const oneAtATime = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  const range = (kind) => {
    const r = calibration[kind] || calibration.similar || [0, 1];
    return [Number(r[0]) || 0, Number(r[1]) > Number(r[0]) ? Number(r[1]) : 1];
  };
  return {
    id,
    name,
    calibration,
    /**
     * @param {string[]} texts @param {'similar'|'query'|'document'} kind @param {string[]} [titles] (documents)
     * @returns {Promise<Float32Array[]>}
     */
    async vectors(texts, kind = 'similar', titles = []) {
      const prompted = texts.map((t, i) => (prompts[kind] || prompts.similar)(String(t), titles[i]));
      const todo = [...new Set(prompted.filter((p) => !cache.has(p)))];
      for (let i = 0; i < todo.length; i += batch) {
        const part = todo.slice(i, i + batch);
        const out = await oneAtATime(() => embed(part));
        part.forEach((p, k) => cache.set(p, unit(Float32Array.from(out[k] || []))));
      }
      while (cache.size > MAX) cache.delete(cache.keys().next().value);
      return prompted.map((p) => cache.get(p));
    },
    /** @param {'similar'|'search'} [kind] two sentences, or a sentence against an entry's row */
    score(a, b, kind = 'similar') {
      const [lo, hi] = range(kind);
      return Math.max(0, Math.min(1, (cosine(a, b) - lo) / (hi - lo)));
    },
  };
}
