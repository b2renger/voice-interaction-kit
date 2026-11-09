// Knowledge: the agent's tables, edited as a spreadsheet (one CSV file each, docs/DESIGN.md 2.2). Saved as you type.
import { $, h, debounce, toast, ask, slug } from './ui.js';
import { api } from './api.js';
import { state, saveTableSoon, touched, flush } from './state.js';

const SHOWN = 500;            // rows shown at once (a bigger table is edited in a spreadsheet)
let current = '';             // the table shown

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const names = (cell) => String(cell || '').split('|').map((x) => x.trim()).filter(Boolean);

/** Every entry name of the agent → its table: to show which cells link to another table. */
function nameIndex() {
  const m = new Map();
  for (const t of state.agent.tables) for (const r of t.rows) for (const n of names(r[0])) m.set(norm(n), t);
  return m;
}

export function renderKnowledge() {
  const a = state.agent;
  if (!a) return;
  if (!a.tables.some((t) => t.id === current)) current = a.tables[0] ? a.tables[0].id : '';
  $('#tableTabs').replaceChildren(
    ...a.tables.map((t) => h('button', { role: 'tab', 'aria-selected': String(t.id === current), onclick: () => { current = t.id; renderKnowledge(); } },
      t.name, h('span', { class: 'count' }, t.rows.length))),
    h('button', { class: 'act act-first', onclick: newTable }, 'New table'),
    h('button', { class: 'act', onclick: () => $('#csvFile').click() }, 'Import a CSV'),
  );
  const t = a.tables.find((x) => x.id === current);
  if (!t) {
    $('#tableArea').replaceChildren(h('div', { class: 'empty' },
      h('p', {}, 'No table yet. A table holds one kind of thing: artworks, dishes, departures, plants. Each row is an entry, and its first cell is how people name it.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: newTable }, 'New table'), h('button', { class: 'btn', onclick: () => $('#csvFile').click() }, 'Import a CSV'))));
    return;
  }
  const changed = () => { saveTableSoon(t); touched('tables'); };
  const head = h('tr', {},
    t.headers.map((col, c) => h('th', {}, h('div', { class: 'th' },
      h('input', { value: col, 'aria-label': `Column ${c + 1} name`, oninput: (e) => { t.headers[c] = e.target.value; changed(); } }),
      c > 0 ? h('button', { title: `Delete the column "${col}"`, 'aria-label': `Delete the column ${col}`, onclick: () => removeColumn(t, c) }, '×') : ''))),
    h('th', { class: 'rowtools' }, h('button', { title: 'Add a column', 'aria-label': 'Add a column', onclick: () => { t.headers.push(`column ${t.headers.length + 1}`); t.rows.forEach((r) => r.push('')); changed(); renderKnowledge(); } }, '+')));
  const body = t.rows.slice(0, SHOWN).map((r, i) => h('tr', {},
    t.headers.map((_, c) => h('td', { 'data-c': c },
      h('input', { value: r[c] || '', 'aria-label': `${t.headers[c]}, row ${i + 1}`, oninput: (e) => { r[c] = e.target.value; changed(); }, onchange: refreshLinks }))),
    h('td', { class: 'rowtools' }, h('button', { title: 'Delete this row', 'aria-label': `Delete row ${i + 1}`, onclick: () => { t.rows.splice(i, 1); changed(); renderKnowledge(); } }, '×'))));
  $('#tableArea').replaceChildren(
    h('div', { class: 'sheet-tools' },
      h('button', { class: 'btn quiet', onclick: () => renameTable(t) }, 'Rename'),
      h('button', { class: 'btn quiet', onclick: () => downloadCsv(t) }, 'Export as CSV'),
      h('button', { class: 'btn quiet danger', onclick: () => removeTable(t) }, 'Delete the table')),
    h('div', { class: 'sheet-wrap' }, h('table', { class: 'sheet' }, h('thead', {}, head), h('tbody', {}, body))),
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn', onclick: () => { t.rows.push(t.headers.map(() => '')); changed(); renderKnowledge(); const inputs = document.querySelectorAll('.sheet tbody tr:last-child input'); if (inputs[0]) inputs[0].focus(); } }, 'Add a row'),
      t.rows.length > SHOWN ? h('span', { class: 'hint' }, `The first ${SHOWN} of ${t.rows.length} rows: edit the others in a spreadsheet (Export, then Import).`) : ''));
  refreshLinks();
}

/** Marks the cells that name an entry of another table (a link), without redrawing the sheet (the focus stays). */
function refreshLinks() {
  const t = state.agent && state.agent.tables.find((x) => x.id === current);
  if (!t) return;
  const index = nameIndex();
  document.querySelectorAll('.sheet tbody tr').forEach((tr, i) => {
    tr.querySelectorAll('td[data-c]').forEach((td) => {
      const c = Number(td.dataset.c);
      let other = null;
      if (c > 0) for (const n of names((t.rows[i] || [])[c])) { const o = index.get(norm(n)); if (o && o.id !== t.id) { other = o; break; } }
      td.classList.toggle('linked', !!other);
      if (other) td.title = `Links to an entry of ${other.name}`; else td.removeAttribute('title');
    });
  });
}

/** A new table: its name is asked (or given: the tutorial's "Do it for me"). */
export async function newTable(given) {
  const name = typeof given === 'string' ? given : await ask('A new table', 'What it holds, in a word or two (artworks, dishes, departures)', '', 'Create');
  if (!name) return;
  const id = slug(name, new Set(state.agent.tables.map((t) => t.id)), 'table');
  try {
    const t = await api.saveTable(state.agentId, id, { headers: ['name', 'description'], rows: [['', '']] });
    state.agent.tables.push({ ...t, rows: t.rows.length ? t.rows : [['', '']] });
    current = t.id;
    touched('tables');
    renderKnowledge();
  } catch (e) { toast(e.message, 'err'); }
}

async function renameTable(t) {
  const to = await ask('Rename the table', 'Its new name', t.name, 'Rename');
  if (!to || to === t.name) return;
  flush();
  try {
    const r = await api.renameTable(state.agentId, t.id, to);
    const fresh = await api.agent(state.agentId);
    state.agent.tables = fresh.tables;
    current = r.id;
    // the patterns that mention this table follow it
    for (const p of state.agent.interactions.patterns) if (p.when.kind === 'mentions' && p.when.table === t.id) p.when.table = r.id;
    await api.saveInteractions(state.agentId, state.agent.interactions);
    touched('tables');
    renderKnowledge();
  } catch (e) { toast(e.message, 'err'); }
}

function removeColumn(t, c) {
  const filled = t.rows.filter((r) => String(r[c] || '').trim()).length;
  if (filled && !confirm(`Delete the column "${t.headers[c]}" and its ${filled} filled cells?`)) return;
  t.headers.splice(c, 1);
  t.rows.forEach((r) => r.splice(c, 1));
  saveTableSoon(t);
  touched('tables');
  renderKnowledge();
}

async function removeTable(t) {
  const used = state.agent.interactions.patterns.filter((p) => p.when.kind === 'mentions' && p.when.table === t.id).map((p) => p.name);
  if (!confirm(`Delete the table "${t.name}" and its ${t.rows.length} rows?${used.length ? `\n\nThese patterns use it: ${used.join(', ')}.` : ''}`)) return;
  flush();
  try {
    await api.deleteTable(state.agentId, t.id);
    state.agent.tables = state.agent.tables.filter((x) => x !== t);
    touched('tables');
    renderKnowledge();
  } catch (e) { toast(e.message, 'err'); }
}

/** A CSV from a spreadsheet: a new table named after the file (the server reads it: separators, quotes, accents). */
async function importCsv(file) {
  const text = await file.text();
  const base = file.name.replace(/\.[^.]+$/, '');
  const id = slug(base, new Set(state.agent.tables.map((t) => t.id)), 'table');
  try {
    const t = await api.saveTable(state.agentId, id, { csv: text });
    state.agent.tables.push(t);
    current = t.id;
    touched('tables');
    renderKnowledge();
    toast(`Imported ${t.rows.length} rows into "${t.name}".`);
  } catch (e) { toast(e.message, 'err'); }
}

function downloadCsv(t) {
  const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = `﻿${[t.headers, ...t.rows].map((r) => t.headers.map((_, i) => cell(r[i])).join(',')).join('\n')}\n`;
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: `${t.id}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** "What it would look up": the entries the agent would give the language model for this sentence. */
const lookup = debounce(async () => {
  const text = $('#lookupText').value.trim();
  const out = $('#lookupOut');
  if (!text || !state.agentId) { out.replaceChildren(); return; }
  flush();
  try {
    const d = await api.decide({ agent: state.agentId, text });
    const tableName = (id) => (state.agent.tables.find((t) => t.id === id) || { name: id }).name;
    out.replaceChildren(
      d.knowledge.length
        ? h('ol', {}, d.knowledge.map((e) => h('li', {}, h('b', {}, e.key), ` in ${tableName(e.table)}`)))
        : h('p', { class: 'hint' }, `Nothing close enough: the agent would answer from its persona alone.${d.matcher === 'Words' ? ' (The words matcher finds close wordings only; EmbeddingGemma also finds meanings.)' : ''}`),
      d.entry ? h('p', { class: 'hint' }, `It names "${d.entry.key}": the pattern "${d.pattern.name}" would fire.`) : '');
  } catch (e) { out.replaceChildren(h('p', { class: 'hint' }, e.message)); }
}, 350);

export function initKnowledge() {
  $('#csvFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(f); });
  $('#lookupText').addEventListener('input', lookup);
}
