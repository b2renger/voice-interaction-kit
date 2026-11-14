// Interactions: the agent's stages and its patterns, "When … → Then …" (docs/DESIGN.md 2.3), and a field to try a
// sentence on the decision model. Saved as you type.
import { $, h, debounce, toast, ask, slug, pct } from './ui.js';
import { api } from './api.js';
import { state, saveInteractionsSoon, touched, flush } from './state.js';

const WHEN = {
  says: 'the person says something like',
  mentions: 'the person mentions an entry of',
  start: 'the conversation starts',
  signal: 'a client sends the signal',
  otherwise: 'nothing else fits, in this stage',
};
const THEN = {
  say: ['Say', 'this line, as written'],
  answer: ['Answer', 'the language model writes it'],
  choices: ['Show choices', 'buttons to tap'],
  mood: ['Set the mood', 'for the interface'],
  voice: ['Change voice', 'from this reply on'],
  signal: ['Send a signal', 'to cables, p5.js, pages'],
  go: ['Go to', 'another stage'],
};
const MOODS = ['neutral', 'happy', 'curious', 'focused', 'sorry', 'surprised', 'excited'];
let selected = '';            // the pattern being edited
let filter = '*';             // the stage whose patterns are listed ('*': all)

const I = () => state.agent.interactions;
const changed = () => { saveInteractionsSoon(); touched('interactions'); };
const stageName = (id) => (id ? (I().stages.find((s) => s.id === id) || { name: id }).name : 'Every stage');
const tableName = (id) => (state.agent.tables.find((t) => t.id === id) || { name: id || '(no table)' }).name;
const optionsOf = (list, value) => list.map(([v, label]) => h('option', { value: v, selected: v === value }, label));

/** "says: when do you open (+3)" → one line under the pattern's name. */
function summary(p) {
  const w = p.when;
  if (w.kind === 'says') return w.examples.length ? `“${w.examples[0]}”${w.examples.length > 1 ? ` and ${w.examples.length - 1} more` : ''}` : 'no example yet';
  if (w.kind === 'mentions') return `mentions ${tableName(w.table)}`;
  if (w.kind === 'signal') return `signal ${w.name || '(no name)'}`;
  return WHEN[w.kind];
}

/** @param {boolean} [stages] false: leave the stage chips as they are (one is being renamed) */
export function renderInteractions(stages = true) {
  if (!state.agent) return;
  const it = I();
  if (filter !== '*' && filter !== '' && !it.stages.some((s) => s.id === filter)) filter = '*';
  if (!it.patterns.some((p) => p.id === selected)) selected = it.patterns[0] ? it.patterns[0].id : '';
  if (stages) renderStages();
  $('#confidence').value = it.confidence;
  $('#confOut').textContent = pct(it.confidence);
  $('#tryStage').replaceChildren(...it.stages.map((s) => h('option', { value: s.id }, `in ${s.name}`)));
  $('#stageFilter').replaceChildren(
    ...[['*', 'All'], ...it.stages.map((s) => [s.id, s.name]), ['', 'Every stage']].map(([id, name]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === id), onclick: () => { filter = id; renderInteractions(); } }, name)));
  renderList();
  renderEditor();
}

function renderStages() {
  const it = I();
  const chips = [];
  it.stages.forEach((s, i) => {
    chips.push(h('span', { class: `stage-chip${s.id === it.start ? ' start' : ''}` },
      h('input', { value: s.name, 'aria-label': `Stage ${i + 1} name`, oninput: (e) => { s.name = e.target.value; changed(); }, onchange: () => renderInteractions(false) }),
      s.id === it.start ? h('small', {}, 'starts here') : '',
      it.stages.length > 1 ? h('button', { type: 'button', title: `Delete the stage ${s.name}`, 'aria-label': `Delete the stage ${s.name}`, onclick: () => removeStage(s) }, '×') : ''));
  });
  chips.push(h('button', { class: 'btn quiet', type: 'button', onclick: addStage }, 'Add a stage'));
  $('#stages').replaceChildren(...chips);
  $('#startStage').replaceChildren(...it.stages.map((s) => h('option', { value: s.id, selected: s.id === it.start }, s.name)));
}

async function addStage() {
  const name = await ask('A new stage', 'Its name (welcome, tour, quiz, goodbye…)', '', 'Add');
  if (!name) return;
  const it = I();
  it.stages.push({ id: slug(name, new Set(it.stages.map((s) => s.id)), 'stage'), name });
  if (!it.start) it.start = it.stages[0].id;
  changed();
  renderInteractions();
}

function removeStage(s) {
  const it = I();
  const used = it.patterns.filter((p) => p.stage === s.id);
  if (!confirm(`Delete the stage "${s.name}"?${used.length ? ` Its ${used.length} pattern(s) will apply in every stage.` : ''}`)) return;
  it.stages = it.stages.filter((x) => x !== s);
  for (const p of used) p.stage = '';
  for (const p of it.patterns) for (const a of p.then) if (a.do === 'go' && a.stage === s.id) a.stage = it.stages[0].id;
  if (it.start === s.id) it.start = it.stages[0].id;
  changed();
  renderInteractions();
}

function renderList() {
  const shown = I().patterns.filter((p) => filter === '*' || p.stage === filter);
  $('#patternList').replaceChildren(
    ...shown.map((p) => h('button', { class: `p${p.on ? '' : ' off'}`, type: 'button', 'aria-current': String(p.id === selected), onclick: () => { selected = p.id; renderList(); renderEditor(); } },
      h('b', {}, p.name), h('span', {}, `${summary(p)}${filter === '*' && p.stage ? `, in ${stageName(p.stage)}` : ''}`))),
    shown.length ? '' : h('p', { class: 'hint' }, filter === '*' ? 'No pattern yet: without one, the language model answers everything.' : 'No pattern in this stage.'),
  );
}

function renderEditor() {
  const it = I();
  const p = it.patterns.find((x) => x.id === selected);
  const box = $('#patternEditor');
  if (!p) { box.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'A pattern says what the agent does when something happens: "When the visitor asks when we open, say our opening hours."'), h('button', { class: 'btn primary', onclick: newPattern }, 'New pattern'))); return; }
  const edit = (fn) => (e) => { fn(e); changed(); renderList(); };
  const redraw = (fn) => (e) => { fn(e); changed(); renderList(); renderEditor(); };
  const headers = p.when.kind === 'mentions' ? ((state.agent.tables.find((t) => t.id === p.when.table) || {}).headers || []) : [];

  // — When —
  const w = p.when;
  let whenBody;
  if (w.kind === 'says') {
    const addInput = h('input', { class: 'add', type: 'text', placeholder: 'Add an example, then Enter', 'aria-label': 'Add an example',
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = e.target.value.trim();
        if (!v) return;
        w.examples.push(v); changed(); renderList(); renderEditor();
        const again = $('#patternEditor input.add'); if (again) again.focus();
      } });
    whenBody = h('div', { class: 'stack' },
      h('div', { class: 'examples' }, w.examples.map((x, i) => h('span', { class: 'chip' }, x,
        h('button', { class: 'x', type: 'button', 'aria-label': `Remove the example ${x}`, onclick: redraw(() => w.examples.splice(i, 1)) }, '×'))), addInput),
      h('p', { class: 'hint' }, 'Write whole sentences, as people say them: a single word matches too many things. Other languages work too with EmbeddingGemma.'));
  } else if (w.kind === 'mentions') {
    whenBody = state.agent.tables.length
      ? h('select', { style: 'max-width:280px', onchange: redraw((e) => { w.table = e.target.value; }) }, ...optionsOf(state.agent.tables.map((t) => [t.id, t.name]), w.table), w.table && !state.agent.tables.some((t) => t.id === w.table) ? h('option', { value: w.table, selected: true }, `${w.table} (missing)`) : '')
      : h('p', { class: 'hint' }, 'This agent has no table yet: add one in Knowledge.');
  } else if (w.kind === 'signal') {
    whenBody = h('input', { type: 'text', value: w.name || '', placeholder: 'visitor-near', style: 'max-width:280px', 'aria-label': 'Signal name', oninput: edit((e) => { w.name = e.target.value; }) });
  } else whenBody = h('p', { class: 'hint' }, w.kind === 'start' ? 'Replaces the greeting.' : 'When no other pattern of this stage is close enough. Without one, the language model answers freely.');

  // — Then —
  const move = (i, d) => redraw(() => { const a = p.then.splice(i, 1)[0]; p.then.splice(i + d, 0, a); });
  const actionRow = (a, i) => {
    let body;
    if (a.do === 'say') {
      // the placeholders no column fills, pointed out as you type (the line is not redrawn: the cursor stays)
      const warn = h('p', { class: 'warn-line', 'aria-live': 'polite' });
      const check = () => { const u = unknownPlaceholders(a.text, headers); warn.textContent = u.length ? `No column fills ${u.map((x) => `{${x}}`).join(', ')}.` : ''; warn.hidden = !u.length; };
      body = [h('textarea', { rows: 2, value: a.text, 'aria-label': 'The line', oninput: edit((e) => { a.text = e.target.value; check(); }) }),
        h('p', { class: 'hint' }, headers.length ? `Fill it from the entry: ${headers.map((x) => `{${x}}`).join(' ')}. Several lines separated by | : one at random.` : 'Several lines separated by | : one is picked at random. {said} is what the person said.'),
        warn];
      check();
    } else if (a.do === 'answer') {
      body = [h('input', { type: 'text', value: a.instruction, placeholder: 'How to answer, for example: in two sentences, then ask a question', 'aria-label': 'Instruction', oninput: edit((e) => { a.instruction = e.target.value; }) }),
        h('p', { class: 'hint' }, 'The language model gets the persona, the entry found and its links, and this instruction.')];
    } else if (a.do === 'choices') {
      body = [h('input', { type: 'text', value: a.question, placeholder: 'The question, optional', 'aria-label': 'Question', oninput: edit((e) => { a.question = e.target.value; }) }),
        h('input', { type: 'text', value: a.options.join(' | '), placeholder: 'Option A | Option B', 'aria-label': 'Options', oninput: edit((e) => { a.options = e.target.value.split('|').map((x) => x.trim()).filter(Boolean).slice(0, 6); }) })];
    } else if (a.do === 'mood') {
      body = [h('select', { 'aria-label': 'Mood', onchange: edit((e) => { a.mood = e.target.value; }) }, ...optionsOf(MOODS.map((m) => [m, m]), a.mood))];
    } else if (a.do === 'voice') {
      const voices = state.agent.voices || [];
      const gone = a.voice && !voices.some((v) => v.id === a.voice);
      body = [h('select', { 'aria-label': 'Voice', onchange: edit((e) => { a.voice = e.target.value; }) },
        ...optionsOf([['', 'The agent’s own voice'], ...voices.map((v) => [v.id, v.name]), ...(gone ? [[a.voice, `${a.voice} (deleted)`]] : [])], a.voice)),
        h('p', { class: 'hint' }, voices.length ? 'The agent answers in this voice from this reply on, until another pattern changes it. Voices are saved in Voice & timing.'
          : 'No saved voice yet: set a voice in Voice & timing and save it under a name. It will appear here.')];
    } else if (a.do === 'signal') {
      body = [h('div', { class: 'row', style: 'flex-wrap:nowrap' },
        h('input', { type: 'text', value: a.name, placeholder: 'name, like show-artwork', 'aria-label': 'Signal name', oninput: edit((e) => { a.name = e.target.value; }) }),
        h('input', { type: 'text', value: a.value, placeholder: 'value, like {name}', 'aria-label': 'Signal value', oninput: edit((e) => { a.value = e.target.value; }) }))];
    } else if (a.do === 'go') {
      body = [h('select', { 'aria-label': 'Stage', onchange: edit((e) => { a.stage = e.target.value; }) }, ...optionsOf(it.stages.map((s) => [s.id, s.name]), a.stage))];
    }
    return h('div', { class: 'action' },
      h('div', { class: 'what' }, THEN[a.do][0], h('small', {}, THEN[a.do][1])),
      h('div', { class: 'body' }, body),
      h('div', { class: 'ctl' },
        i > 0 ? h('button', { type: 'button', title: 'Move up', 'aria-label': 'Move up', onclick: move(i, -1) }, '↑') : '',
        i < p.then.length - 1 ? h('button', { type: 'button', title: 'Move down', 'aria-label': 'Move down', onclick: move(i, 1) }, '↓') : '',
        h('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove this action', onclick: redraw(() => p.then.splice(i, 1)) }, '×')));
  };
  const blank = { say: { text: '' }, answer: { instruction: '' }, choices: { question: '', options: [] }, mood: { mood: 'happy' }, voice: { voice: '' }, signal: { name: '', value: '' }, go: { stage: (it.stages[0] || {}).id || '' } };

  box.replaceChildren(h('div', { class: 'peditor' },
    h('div', { class: 'head' },
      h('input', { class: 'name', type: 'text', value: p.name, 'aria-label': 'Pattern name', oninput: edit((e) => { p.name = e.target.value; }) }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.on, onchange: edit((e) => { p.on = e.target.checked; }) }), 'On')),
    h('div', { class: 'row' },
      h('label', { class: 'field', style: 'min-width:200px' }, h('span', {}, 'Applies'),
        h('select', { onchange: redraw((e) => { p.stage = e.target.value; }) }, ...optionsOf([['', 'In every stage'], ...it.stages.map((s) => [s.id, `In ${s.name}`])], p.stage))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => duplicate(p) }, 'Duplicate'),
      h('button', { class: 'btn quiet danger', type: 'button', onclick: () => remove(p) }, 'Delete')),
    h('div', { class: 'clause' }, h('span', { class: 'kw' }, 'When'),
      h('div', { class: 'stack' },
        h('div', { class: 'row', style: 'flex-wrap:nowrap' },
          h('select', { style: 'max-width:320px', 'aria-label': 'When', onchange: redraw((e) => { p.when = { kind: e.target.value, examples: [], table: (state.agent.tables[0] || {}).id || '', name: '' }; }) },
            ...optionsOf(Object.entries(WHEN), w.kind)),
          w.kind === 'mentions' || w.kind === 'signal' ? whenBody : ''),
        w.kind === 'mentions' || w.kind === 'signal' ? '' : whenBody)),
    h('div', { class: 'clause' }, h('span', { class: 'kw' }, 'Then'),
      h('div', { class: 'actions' },
        p.then.map(actionRow),
        p.then.length ? '' : h('p', { class: 'hint' }, 'Nothing yet: add what the agent does.'),
        h('div', { class: 'add-actions' }, h('span', { class: 'hint', style: 'align-self:center;margin-right:4px' }, 'Add'), Object.entries(THEN).map(([k, [label]]) =>
          h('button', { class: 'btn', type: 'button', onclick: redraw(() => p.then.push({ do: k, ...blank[k] })) }, label)))))));
}

/** The placeholders of a line that no column fills. */
function unknownPlaceholders(text, headers) {
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const known = new Set(['said', ...headers.map(norm)]);
  return [...String(text || '').matchAll(/\{([^{}]{1,60})\}/g)].map((m) => m[1]).filter((n) => !known.has(norm(n)));
}

/** A new pattern: its name is asked (or given: the tutorial's "Do it for me"). */
export async function newPattern(given) {
  const name = typeof given === 'string' ? given : await ask('A new pattern', 'What it is about, in a few words (opening hours, an artwork, goodbye)', '', 'Create');
  if (!name) return;
  const it = I();
  const p = { id: slug(name, new Set(it.patterns.map((x) => x.id)), 'pattern'), name, stage: filter !== '*' ? filter : '', on: true, when: { kind: 'says', examples: [] }, then: [{ do: 'say', text: '' }] };
  it.patterns.push(p);
  selected = p.id;
  changed();
  renderInteractions();
  const input = $('#patternEditor input.add');
  if (input) input.focus();
}

function duplicate(p) {
  const it = I();
  const copy = JSON.parse(JSON.stringify(p));
  copy.name = `${p.name} (copy)`;
  copy.id = slug(copy.name, new Set(it.patterns.map((x) => x.id)), 'pattern');
  it.patterns.splice(it.patterns.indexOf(p) + 1, 0, copy);
  selected = copy.id;
  changed();
  renderInteractions();
}

function remove(p) {
  if (!confirm(`Delete the pattern "${p.name}"?`)) return;
  const it = I();
  it.patterns = it.patterns.filter((x) => x !== p);
  selected = '';
  changed();
  renderInteractions();
}

/** The test field: what the agent would decide for this sentence, in this stage, and why. */
const tryIt = debounce(async () => {
  const text = $('#tryText').value.trim();
  const out = $('#tryOut');
  if (!text || !state.agentId) { out.replaceChildren(); return; }
  flush();
  try {
    const d = await api.decide({ agent: state.agentId, text, stage: $('#tryStage').value });
    const then = (d.then || []).map((a) => (a.do === 'say' ? `say “${a.text}”` : a.do === 'answer' ? `answer${a.instruction ? ` (${a.instruction})` : ''}` : a.do === 'go' ? `go to ${stageName(a.stage)}` : a.do === 'signal' ? `signal ${a.name}` : a.do === 'choices' ? `choices ${a.options.join(' | ')}` : a.do === 'voice' ? `voice ${a.voice ? ((state.agent.voices || []).find((v) => v.id === a.voice) || { name: a.voice }).name : 'its own'}` : `mood ${a.mood}`));
    out.replaceChildren(
      h('p', { class: 'took' }, d.pattern ? `${d.kind === 'otherwise' ? 'Otherwise: ' : ''}${d.pattern.name}${d.entry ? `, ${d.entry.key}` : ''}${d.score != null ? `  ${pct(d.score)}` : ''}` : 'A free answer'),
      h('p', { class: 'hint' }, d.pattern ? (then.length ? `Then: ${then.join(', then ')}.` : 'This pattern does nothing yet.') : `No pattern reaches the confidence (${pct(I().confidence)}): the language model answers, with what it knows.`),
      d.candidates.length ? h('ol', {}, d.candidates.map((c) => h('li', {}, `${c.name}${c.entry ? ` (${c.entry.key})` : ''}: `, h('span', { class: 'meter' + (c.score < I().confidence ? ' low' : '') }, h('i', { style: `width:${Math.round(c.score * 100)}%` })), ` ${pct(c.score)}${c.example ? `, closest to “${c.example}”` : ''}`))) : '',
      h('p', { class: 'hint' }, `Decided by ${d.matcher} in ${d.ms} ms.`));
    if (d.pattern && I().patterns.some((p) => p.id === d.pattern.id)) { selected = d.pattern.id; renderList(); renderEditor(); }
  } catch (e) { out.replaceChildren(h('p', { class: 'hint' }, e.message)); }
}, 300);

export function initInteractions() {
  $('#startStage').addEventListener('change', (e) => { I().start = e.target.value; changed(); renderInteractions(); });
  $('#newPattern').addEventListener('click', newPattern);
  $('#confidence').addEventListener('input', (e) => { I().confidence = Number(e.target.value); $('#confOut').textContent = pct(I().confidence); changed(); });
  $('#tryText').addEventListener('input', tryIt);
  $('#tryStage').addEventListener('change', tryIt);
}
