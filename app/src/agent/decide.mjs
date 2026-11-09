// The decision model: what the agent does with a sentence, before any language model runs (docs/DESIGN.md, 3).
//
//   1. score the patterns of the current stage: "says" → the closest example; "mentions" → the best entry of its
//      table (the sentence against the entry's name and against its whole row; a name said word for word ≥ 0.95);
//   2. the best score at or above the agent's confidence wins; otherwise the stage's "otherwise" pattern, if any;
//   3. otherwise a free answer.
// Whatever happens, the knowledge for the model: the entry found, the entry in focus, and the closest entries.
import { entriesOf, describe, withLinks, entryNamedIn, normalize, findEntry } from './knowledge.mjs';

const RETRIEVE = 3;          // the closest entries given to the model for a free answer
const RETRIEVE_MIN = 0.35;   // … if they score at least this
const CANDIDATES = 5;        // the runners-up shown in the explanation
const AMBIGUITY = 0.15;      // a mention whose entry leads the next one by less than this (no name said) is doubtful

/**
 * @param {{store: {compiled: (id: string) => any}, matcher: () => any, log?: (m: string) => void}} o
 *   matcher(): the matcher to use now (the model's when it is loaded, the words one otherwise)
 */
export function createDecider({ store, matcher, log = () => {} }) {
  const indexes = new Map();     // agent id → {agent, m, promise}

  /** The agent's embeddings, computed once per version of its files and per matcher. */
  function indexOf(id) {
    const agent = store.compiled(id);
    const m = matcher();
    const hit = indexes.get(id);
    if (hit && hit.agent === agent && hit.m === m) return hit.promise;
    const t0 = Date.now();
    const promise = (async () => {
      const entries = entriesOf(agent);
      const patterns = agent.interactions.patterns.filter((p) => p.on);
      const examples = patterns.flatMap((p) => (p.when.kind === 'says' ? p.when.examples : []));
      const names = entries.flatMap((e) => e.names);
      const [ex, nameVecs, rows] = await Promise.all([
        m.vectors(examples, 'similar'),
        m.vectors(names, 'similar'),
        m.vectors(entries.map(describe), 'document', entries.map((e) => e.key)),
      ]);
      // each entry's names (its first cell can give several): their vectors
      let n0 = 0;
      const keys = entries.map((e) => { const v = nameVecs.slice(n0, n0 + e.names.length); n0 += e.names.length; return v; });
      let k = 0;
      const pats = patterns.map((p) => {
        const n = p.when.kind === 'says' ? p.when.examples.length : 0;
        const vecs = ex.slice(k, k + n);
        k += n;
        return { p, vecs };
      });
      if (examples.length + entries.length > 50) log(`▸ decision model: agent "${id}" indexed with ${m.name} (${examples.length} examples, ${entries.length} entries, ${Date.now() - t0} ms)`);
      return { agent, m, entries, pats, keys, rows };
    })();
    indexes.set(id, { agent, m, promise });
    promise.catch(() => { if (indexes.get(id) && indexes.get(id).promise === promise) indexes.delete(id); });
    return promise;
  }

  const stageOf = (agent, stage) => (agent.interactions.stages.some((s) => s.id === stage) ? stage : agent.interactions.start);
  const applies = (p, stage) => p.on && (!p.stage || p.stage === stage);
  const round = (x) => (x == null ? null : Math.round(x * 100) / 100);
  const ref = (e) => (e ? { table: e.table, key: e.key } : null);

  /**
   * What the agent would do with this sentence.
   * @param {string} id the agent @param {string} text what was said
   * @param {{stage?: string, focus?: {table: string, key: string}|null}} [state]
   */
  async function decide(id, text, state = {}) {
    const t0 = Date.now();
    const ix = await indexOf(id);
    const { agent, m, entries } = ix;
    const stage = stageOf(agent, state.stage);
    const [uSim] = await m.vectors([text], 'similar');
    const [uQuery] = await m.vectors([text], 'query');
    const said = normalize(text);

    // how close the sentence is to each entry: one of its names, or its whole row; a name said word for word ≥ 0.95
    const entryScore = entries.map((e, i) => {
      const s = Math.max(...ix.keys[i].map((v) => m.score(uSim, v, 'similar')), m.score(uQuery, ix.rows[i], 'search'));
      return entryNamedIn(text, e) ? Math.max(s, 0.95) : s;
    });

    const cands = [];
    for (const { p, vecs } of ix.pats) {
      if (!applies(p, stage)) continue;
      if (p.when.kind === 'says') {
        let best = 0;
        let example = '';
        p.when.examples.forEach((x, i) => {
          const s = normalize(x) === said ? 1 : m.score(uSim, vecs[i]);
          if (s > best) { best = s; example = x; }
        });
        cands.push({ p, score: best, example, entry: null });
      } else if (p.when.kind === 'mentions') {
        let best = -1;
        let second = 0;
        let entry = null;
        entries.forEach((e, i) => {
          if (e.table !== p.when.table) return;
          if (entryScore[i] > best) { second = Math.max(second, best); best = entryScore[i]; entry = e; } else second = Math.max(second, entryScore[i]);
        });
        // no name said, and the best entry hardly beats the next one ("who painted it?" fits every painting):
        // not a mention of this entry. Its score shrinks with its lead: no lead, no score.
        const named = entry && entryNamedIn(text, entry);
        const lead = best - second;
        const score = named || lead >= AMBIGUITY ? best : best * (lead / AMBIGUITY);
        if (entry) cands.push({ p, score: Math.max(0, score), example: '', entry });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const confidence = agent.interactions.confidence;
    let chosen = cands[0] && cands[0].score >= confidence ? cands[0] : null;
    let kind = chosen ? 'pattern' : 'free';
    if (!chosen) {
      const other = ix.pats.map((x) => x.p).filter((p) => p.when.kind === 'otherwise' && applies(p, stage))
        .sort((a, b) => Number(!!b.stage) - Number(!!a.stage))[0];          // the stage's own first
      if (other) { chosen = { p: other, score: null, example: '', entry: null }; kind = 'otherwise'; }
    }

    // the knowledge for the model: the entry found, the entry in focus, then the closest entries
    const focus = findEntry(entries, state.focus);
    const closest = entries.map((e, i) => ({ e, s: entryScore[i] })).filter((x) => x.s >= RETRIEVE_MIN)
      .sort((a, b) => b.s - a.s).slice(0, RETRIEVE).map((x) => x.e);
    const entry = chosen && chosen.entry;
    const knowledge = withLinks(entries, [entry, focus, ...closest].filter(Boolean));

    return {
      text: String(text),
      stage,
      matcher: m.name,
      kind,
      pattern: chosen ? { id: chosen.p.id, name: chosen.p.name, kind: chosen.p.when.kind } : null,
      score: chosen ? round(chosen.score) : null,
      example: chosen ? chosen.example : '',
      entry: ref(entry),
      candidates: cands.slice(0, CANDIDATES).map((c) => ({ id: c.p.id, name: c.p.name, score: round(c.score), example: c.example, entry: ref(c.entry) })),
      ms: Date.now() - t0,
      // for the conversation (not sent as is): what to do, the entry's cells, the knowledge
      then: chosen ? chosen.p.then : [],
      entryCells: entry ? entry : (focus || null),
      knowledge,
    };
  }

  /** The pattern that fires on a moment ("start", or a client's signal), or null. */
  async function onMoment(id, kind, state = {}, name = '') {
    const agent = store.compiled(id);
    const stage = stageOf(agent, state.stage);
    const p = agent.interactions.patterns.filter((x) => x.when.kind === kind && applies(x, stage)
      && (kind !== 'signal' || normalize(x.when.name) === normalize(name)))
      .sort((a, b) => Number(!!b.stage) - Number(!!a.stage))[0];
    if (!p) return null;
    const entries = entriesOf(agent);
    const focus = findEntry(entries, state.focus);
    return {
      text: '', stage, matcher: '', kind: 'pattern', pattern: { id: p.id, name: p.name, kind }, score: null, example: '', entry: null,
      candidates: [], ms: 0, then: p.then, entryCells: focus, knowledge: withLinks(entries, focus ? [focus] : []),
    };
  }

  return {
    decide,
    onMoment,
    /** The first stage of an agent. */
    startStage: (id) => store.compiled(id).interactions.start,
    hasStage: (id, stage) => store.compiled(id).interactions.stages.some((s) => s.id === stage),
    /** Computes an agent's embeddings ahead of its first sentence. */
    warm: (id) => indexOf(id).then(() => true, (e) => { log(`(decision model: ${e.message})`); return false; }),
  };
}

/** The knowledge given to the model, as text for its prompt. */
export function knowledgePrompt(entries) {
  if (!entries || !entries.length) return '';
  return `What you know that may help (use it in your own words, never read it out as a list):\n${entries.map((e) => `- ${describe(e)}`).join('\n')}`;
}
