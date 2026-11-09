// interactions.json: an agent's stages and patterns ("When … → Then …"), the rules its decision model follows.
// normalizeInteractions() turns any JSON (hand-written, old, broken) into a valid structure, so the rest of the
// code never has to check. PURE module (docs/DESIGN.md, 2.3).

/** What can start a pattern. */
export const WHEN = {
  says: 'the person says something close to one of the examples',
  mentions: 'the person mentions an entry of a table',
  start: 'the conversation starts',
  signal: 'a client sends this signal',
  otherwise: 'nothing else fired, in this stage',
};
/** What a pattern can do, in order. */
export const THEN = {
  say: 'say this line',
  answer: 'the language model answers',
  choices: 'show choice buttons',
  mood: 'set the mood',
  signal: 'send a signal to the clients',
  go: 'go to another stage',
};
export const MOODS = ['neutral', 'happy', 'curious', 'focused', 'sorry', 'surprised', 'excited'];
export const DEFAULT_CONFIDENCE = 0.5;   // the score (0–1) a pattern needs to fire
const MAX_TEXT = 4000;

/** An id made from a name: lower case, no accents, dashes ("Opening hours" → "opening-hours"). */
export function slug(s, fallback = 'item') {
  const v = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return v || fallback;
}

const text = (v, max = MAX_TEXT) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/\n|\|/)).map((x) => text(x, 300)).filter(Boolean).slice(0, 200);

/** A unique id among `taken`, from `wanted` or the name. */
function uniqueId(wanted, name, taken, fallback) {
  const base = slug(wanted || name, fallback);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** @returns {{version: 1, start: string, stages: {id: string, name: string}[], confidence: number, patterns: object[]}} */
export function normalizeInteractions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const stageIds = new Set();
  const stages = (Array.isArray(o.stages) ? o.stages : []).filter((s) => s && (s.id || s.name)).slice(0, 50)
    .map((s) => { const name = text(s.name || s.id, 80); return { id: uniqueId(s.id, name, stageIds, 'stage'), name }; });
  const start = stageIds.has(o.start) ? o.start : (stages[0] ? stages[0].id : '');
  const conf = Number(o.confidence);
  const patternIds = new Set();
  const patterns = (Array.isArray(o.patterns) ? o.patterns : []).filter((p) => p && typeof p === 'object').slice(0, 500).map((p) => {
    const name = text(p.name, 80) || 'Pattern';
    const w = p.when && typeof p.when === 'object' ? p.when : {};
    const kind = w.kind in WHEN ? w.kind : 'says';
    const when = { kind };
    if (kind === 'says') when.examples = list(w.examples);
    if (kind === 'mentions') when.table = slug(w.table, '');
    if (kind === 'signal') when.name = text(w.name, 80);
    return {
      id: uniqueId(p.id, name, patternIds, 'pattern'),
      name,
      stage: stageIds.has(p.stage) ? p.stage : '',
      on: p.on !== false,
      when,
      then: (Array.isArray(p.then) ? p.then : []).filter((a) => a && a.do in THEN).slice(0, 20).map(action),
    };
  });
  return { version: 1, start, stages, confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : DEFAULT_CONFIDENCE, patterns };
}

function action(a) {
  switch (a.do) {
    case 'say': return { do: 'say', text: String(a.text == null ? '' : a.text).trim().slice(0, MAX_TEXT) };
    case 'answer': return { do: 'answer', instruction: text(a.instruction) };
    case 'choices': return { do: 'choices', question: text(a.question, 200), options: list(a.options).slice(0, 6) };
    case 'mood': return { do: 'mood', mood: MOODS.includes(a.mood) ? a.mood : 'neutral' };
    case 'signal': return { do: 'signal', name: text(a.name, 80), value: text(a.value, 500) };
    case 'go': return { do: 'go', stage: slug(a.stage, '') };
    default: return null;
  }
}
