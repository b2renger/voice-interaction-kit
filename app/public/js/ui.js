// Small DOM helpers for the studio. Text always goes in as text, never as HTML.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

/**
 * An element: h('button', {class: 'btn', onclick}, 'Save'). Attributes starting with "on" are listeners;
 * `null`/`false` attributes are left out; children are nodes or text.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function debounce(fn, ms) {
  let t = 0;
  const run = (...a) => { clearTimeout(t); t = setTimeout(() => { t = 0; fn(...a); }, ms); };
  run.flush = (...a) => { if (t) { clearTimeout(t); t = 0; fn(...a); } };
  return run;
}

let toastTimer = 0;
/** A short message at the bottom of the window. */
export function toast(text, kind = '') {
  let el = $('.toast');
  if (!el) { el = h('div', { class: 'toast', role: 'status' }); document.body.append(el); }
  el.className = `toast${kind ? ` ${kind}` : ''}`;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 6000 : 2600);
}

/** Asks for a name (Electron has no window.prompt). Resolves with the text, or null if cancelled. */
export function ask(title, label, value = '', ok = 'OK') {
  const dlg = $('#ask');
  $('#askTitle').textContent = title;
  $('#askLabel').textContent = label;
  $('#askOk').textContent = ok;
  const input = $('#askValue');
  input.value = value;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? input.value.trim() || null : null), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    input.select();
  });
}

/** A small menu under a button: items [{label, run}] or 'sep'. */
export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'menu', role: 'menu', style: `left:${r.left}px; top:${r.bottom + 4}px` },
    items.map((it) => (it === 'sep' ? h('hr') : h('button', { role: 'menuitem', onclick: () => { m.remove(); it.run(); } }, it.label))));
  document.body.append(m);
  const close = (e) => { if (!m.contains(e.target) && e.target !== anchor) { m.remove(); document.removeEventListener('pointerdown', close); } };
  setTimeout(() => document.addEventListener('pointerdown', close), 0);
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { m.remove(); anchor.focus(); } });
  m.querySelector('button').focus();
}

/** A unique id from a name, among `taken`: "Opening hours" → "opening-hours", "opening-hours-2"… */
export function slug(s, taken = new Set(), fallback = 'item') {
  const base = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** "1.3 s", "800 ms" */
export const seconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
export const pct = (x) => (x == null ? '' : `${Math.round(x * 100)} %`);
