// The tutorial: a card that walks a person through the studio, one step at a time, and a ring around what to
// look at. A step says what to do; it is done when the studio shows it (the agent's files, the view, the
// conversation), checked a few times a second, so it never matters how the person did it. "Do it for me" does a
// step in their place with the views' own functions, so it is saved exactly as their own edits would be.
// The progress is kept in this window (localStorage): the tutorial can be left, and picked up again.
import { $, h, toast } from './ui.js';
import { api } from './api.js';
import { parseInline } from './markdown.js';
import { state, settings, saveTableSoon, saveInteractionsSoon, touched, openAgent } from './state.js';
import { renderKnowledge, newTable } from './knowledge.js';
import { renderInteractions, newPattern } from './interactions.js';

const STORE = 'vik.tour';          // {id, step, agent, before, open}: the tutorial under way
const DONE = 'vik.tour.done';      // a tutorial was finished once
const LATER = 'vik.tour.later';    // "Not now": the navigation stops offering it
const VIEW_NAMES = { talk: 'Talk', persona: 'Persona', knowledge: 'Knowledge', interactions: 'Interactions', voice: 'Voice & timing', settings: 'Settings', guide: 'Guide' };

// what "Do it for me" writes: a small café
const CAFE = {
  agent: 'Café',
  name: 'Lou',
  persona: 'You are Lou. You serve at a small café near the station.\nYou are warm and brief. You love the cakes, and you say so.\nWhen you don\'t know something, you say it simply and offer what you do know.',
  greeting: 'Hi! What can I get you?',
  table: 'Menu',
  rows: [
    ['Espresso', 'a short, strong coffee, two euros'],
    ['Cappuccino | cappu', 'espresso with milk foam and a little cocoa, three euros'],
    ['Lemon cake', 'our own, baked this morning, three fifty'],
  ],
  pattern: 'The menu',
  tryIt: 'what\'s in a cappuccino?',
  ask: 'Do you have cappuccino?',
};

let deps = { show: () => {}, agent: null, createAgent: async () => {}, openGuide: () => {}, changed: () => {} };
let tour = null;                   // the tutorial under way (as stored)
let decided = 0;                   // decisions seen since the step began (the "ask it" step)
let card = null;
let ring = null;
let timer = 0;
let advancing = 0;
let shown = '';                    // what the card shows now: redrawn only when it changes (the focus stays)

const A = () => state.agent;
const I = () => state.agent.interactions;
const viewIs = (v) => document.body.dataset.view === v;
const filled = (r, c) => !!String(r[c] || '').trim();
const mentionsPattern = () => I().patterns.find((p) => p.when.kind === 'mentions' && A().tables.some((t) => t.id === p.when.table));
const lastPattern = () => I().patterns[I().patterns.length - 1];
/** Types into a field as a person would: the view's own listeners save it and pass it on. */
function typeInto(sel, value) {
  const el = $(sel);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export const TOURS = {
  'first-agent': {
    title: 'Build your first agent',
    about: 'A café that answers questions about its menu: a persona, a table, a pattern, then a conversation. About ten minutes.',
    steps: [
      { title: 'Build your first agent', next: 'Let\'s start',
        text: 'In about ten minutes, you\'ll build a small café agent that answers questions about its menu: who it is, what it knows, and how it decides. Then you\'ll talk to it.\n\nEverything saves as you type. You can leave the tutorial at any time, and pick it up again from the **Guide**.' },
      { target: '#agentMenuBtn', title: 'A new agent', auto: true,
        text: 'Click **Manage**, then **New agent…**, and call it **Café**.',
        // done when another agent than those of the start is open: it becomes the tutorial's agent
        done: () => { if (state.agentId && !tour.before.includes(state.agentId)) { tour.agent = state.agentId; return true; } return false; },
        doIt: () => deps.createAgent(CAFE.agent) },
      { view: 'persona', target: '[data-k="name"]', agent: true, title: 'Its name',
        text: '**Café** is its title in the list. Its **Name** is how it introduces itself: give it a person\'s name, like **Lou**.',
        done: () => { const s = A().settings; const n = String(s.name || '').trim(); return !!n && n !== String(s.title || '').trim(); },
        doIt: () => typeInto('[data-k="name"]', CAFE.name) },
      { view: 'persona', target: '#personaBody', agent: true, title: 'Who it is',
        text: 'The persona: the language model reads it before every reply. Write it like a character sheet, in the second person: *You are Lou. You serve at a small café…*',
        done: () => { const b = String(A().body || ''); return b.trim().length >= 20 && !/Describe here who the agent is/.test(b); },
        doIt: () => typeInto('#personaBody', CAFE.persona) },
      { view: 'persona', target: '[data-k="greeting"]', agent: true, title: 'What it says first',
        text: 'The **Greeting** is said when you click Start. Empty, the agent waits to be spoken to. Try: *Hi! What can I get you?*',
        done: () => !!String(A().settings.greeting || '').trim(),
        doIt: () => typeInto('[data-k="greeting"]', CAFE.greeting) },
      { view: 'persona', target: '#promptPreview', agent: true, title: 'What the model reads',
        text: 'Your persona, plus the rules VIK adds so that replies sound right when spoken. It follows what you type.' },
      { target: '.nav button[data-view="knowledge"]', title: 'What it knows', auto: true,
        text: 'Now the menu. Open **Knowledge**.',
        done: () => viewIs('knowledge') },
      { view: 'knowledge', target: '#tableArea .empty .btn.primary, #tableTabs .act-first', agent: true, title: 'A table', auto: true,
        text: 'A table holds one kind of thing: here, what the café serves. Click **New table** and call it **Menu**.',
        done: () => A().tables.length > 0,
        doIt: () => newTable(CAFE.table) },
      { view: 'knowledge', target: '.sheet-wrap', agent: true, title: 'The entries',
        text: 'Each row is an entry, and its first cell is how people name it. Fill two or three: a name and a description. **Add a row** adds one. Other names go after a |, as in *Cappuccino | cappu*.',
        done: () => A().tables.some((t) => t.rows.filter((r) => filled(r, 0) && filled(r, 1)).length >= 2),
        doIt: () => {
          const t = A().tables[0];
          if (!t) return;
          while (t.headers.length < 2) { t.headers.push(t.headers.length ? 'description' : 'name'); t.rows.forEach((r) => r.push('')); }
          t.rows = CAFE.rows.map((r) => t.headers.map((_, c) => r[c] || ''));
          saveTableSoon(t);
          touched('tables');
          renderKnowledge();
        } },
      { target: '.nav button[data-view="interactions"]', title: 'How it decides', auto: true,
        text: 'Open **Interactions**.',
        done: () => viewIs('interactions') },
      { view: 'interactions', target: '#patternEditor .empty .btn.primary, #newPattern', agent: true, title: 'A pattern', auto: true,
        text: 'A pattern says what the agent does when something happens. Click **New pattern** and call it **The menu**.',
        done: () => I().patterns.length > 0,
        doIt: () => newPattern(CAFE.pattern) },
      { view: 'interactions', target: '#patternEditor select[aria-label="When"]', agent: true, title: 'When', auto: true,
        text: 'Choose **the person mentions an entry of**, and the table **Menu**. Now any sentence that names something on the menu fires this pattern.',
        done: () => !!mentionsPattern(),
        doIt: () => {
          const p = lastPattern();
          const t = A().tables[0];
          if (!p || !t) { toast('Make the table and the pattern first.', 'err'); return; }
          p.when = { kind: 'mentions', table: t.id };
          saveInteractionsSoon();
          touched('interactions');
          renderInteractions();
        } },
      { view: 'interactions', target: '#patternEditor textarea[aria-label="The line"]', agent: true, title: 'Then',
        text: 'What it says, as written. Words in braces are filled from the entry found: `A {name}? That\'s {description}.`',
        done: () => { const p = mentionsPattern(); return !!(p && p.then.some((a) => a.do === 'say' && String(a.text || '').trim())); },
        doIt: () => {
          const p = mentionsPattern() || lastPattern();
          if (!p) return;
          const t = A().tables.find((x) => x.id === p.when.table) || A().tables[0];
          const [first = 'name', second = 'description'] = t ? t.headers : [];
          const line = `A {${first}}? That's {${second}}.`;
          const say = p.then.find((a) => a.do === 'say');
          if (say) say.text = line; else p.then.unshift({ do: 'say', text: line });
          saveInteractionsSoon();
          touched('interactions');
          renderInteractions();
        } },
      { view: 'interactions', target: '.trybox', agent: true, title: 'Try a sentence',
        text: 'Type what a customer would say: *what\'s in a cappuccino?* You see which pattern fires, how sure the agent is, and what came close.',
        done: () => { const t = $('#tryOut .took'); return !!(t && t.textContent.trim()); },
        doIt: () => typeInto('#tryText', CAFE.tryIt) },
      { target: '.nav button[data-view="talk"]', title: 'Talk to it', auto: true,
        text: 'Open **Talk**.',
        done: () => viewIs('talk') },
      { view: 'talk', target: '#start', agent: true, title: 'Start', auto: true,
        text: 'Click **Start**. The first time, the models take a moment to load: the banner shows the progress.',
        hint: () => (settings().engine === 'gemini' ? 'Gemini Live ignores the patterns: for this tutorial, choose VIK, on this computer, in Settings.' : ''),
        done: () => !!(deps.agent && deps.agent.active) },
      { view: 'talk', target: '#sayText', agent: true, title: 'Ask it', auto: true, wait: 1600,
        text: 'Speak, or type here: *Do you have cappuccino?* Your pattern answers, with your line.',
        enter: () => { decided = 0; },
        done: () => decided > 0,
        doIt: () => {
          if (!deps.agent || !deps.agent.active) { toast('Click Start first.'); return; }
          $('#sayText').value = CAFE.ask;
          $('#sayForm').requestSubmit();
        } },
      { view: 'talk', target: '.trace', title: 'Why it answered',
        text: 'Each turn: the pattern that fired, its score, the entry it found, and what came close. When the agent surprises you, look here first.' },
      { title: 'That\'s an agent', next: 'Finish', end: true,
        text: 'A persona, a table and a pattern: that\'s all an agent needs. Next, try **stages** for a conversation in steps, **signals** for cables and p5.js, or another voice. The **Guide** has a page for each.' },
    ],
  },
};

// ———————————————————————————— progress ————————————————————————————
function load() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } }
function save() { try { if (tour) localStorage.setItem(STORE, JSON.stringify(tour)); else localStorage.removeItem(STORE); } catch { /* no storage */ } }
const flag = (k) => { try { return !!localStorage.getItem(k); } catch { return false; } };
const setFlag = (k) => { try { localStorage.setItem(k, '1'); } catch { /* no storage */ } };
const stepsOf = (t) => (TOURS[t && t.id] || TOURS['first-agent']).steps;
const stepOf = () => stepsOf(tour)[tour.step];

/** Starts a tutorial, or picks up the one under way. */
export async function startTour(id = 'first-agent', { over = false } = {}) {
  if (!TOURS[id]) return;
  const saved = load();
  if (saved && saved.id === id && !over && saved.step < TOURS[id].steps.length) tour = { ...saved, open: true };
  else {
    // the agents there before: the tutorial's agent is the one made after it starts (never an example, never yours)
    let before;
    try { before = (await api.agents()).map((a) => a.id); } catch (e) { toast(`The tutorial could not start: ${e.message}`, 'err'); return; }
    tour = { id, step: 0, agent: '', before: [...new Set([...before, state.agentId].filter(Boolean))], open: true };
  }
  save();
  enter();
  deps.changed();
}

function leave() {
  if (!tour) return;
  tour.open = false;
  save();
  hide();
  deps.changed();
}

function finish(thenGuide) {
  tour = null;
  save();
  setFlag(DONE);
  hide();
  deps.changed();
  if (thenGuide) deps.openGuide('start');
}

function go(delta) {
  clearTimeout(advancing);
  advancing = 0;
  const at = tour.step + delta;
  if (at >= stepsOf(tour).length) { finish(false); return; }
  tour.step = Math.max(0, at);
  save();
  enter();
  deps.changed();
}

/** A step begins: its own start, the target brought into view, the card drawn. */
function enter() {
  const step = stepOf();
  if (step.enter) step.enter();
  shown = '';
  build();
  tick();
  // the target in view, with room around it for the card (a field at the bottom of the window comes up)
  const el = targetOf(step);
  if (el) { const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > window.innerHeight - 160) el.scrollIntoView({ block: 'center' }); }
  if (!step.target) card.querySelector('.coach-actions .btn.primary')?.focus();
}

// ———————————————————————————— the card and the ring ————————————————————————————
const visible = (el) => !!(el && el.getClientRects().length && !el.closest('[hidden]'));
function targetOf(step) {
  if (!step.target) return null;
  for (const sel of step.target.split(/,\s*/)) { const el = $(sel); if (visible(el)) return el; }
  return null;
}

/** "**Click** Manage" → nodes (bold, italic, code), paragraphs on blank lines. */
function text(s) {
  const nodes = (list) => list.map((n) => (n.t === 'text' ? n.v : n.t === 'code' ? h('code', {}, n.v) : h(n.t === 'strong' ? 'strong' : 'em', {}, nodes(n.c || []))));
  return String(s).split(/\n\n+/).map((p) => h('p', {}, nodes(parseInline(p))));
}

function done(step) {
  if (!step.done) return true;
  if (step.agent && tour.agent && state.agentId !== tour.agent) return false;
  try { return !!(state.agent && step.done()); } catch { return false; }
}

/** What is in the way of this step: another agent open, another view shown. */
function obstacle(step) {
  if (step.agent && tour.agent && state.agentId !== tour.agent) return { kind: 'agent' };
  if (step.view && !viewIs(step.view)) return { kind: 'view', view: step.view };
  return null;
}

function build() {
  if (!card) {
    card = h('div', { class: 'coach', role: 'dialog', 'aria-label': 'Tutorial' });
    ring = h('div', { class: 'coach-ring', 'aria-hidden': 'true', hidden: true });
    document.body.append(ring, card);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
  }
  card.hidden = false;
  clearInterval(timer);
  timer = setInterval(tick, 250);
}

function hide() {
  clearInterval(timer);
  clearTimeout(advancing);
  advancing = 0;
  if (card) card.hidden = true;
  if (ring) ring.hidden = true;
}

function draw(step, isDone, block) {
  const steps = stepsOf(tour);
  const n = tour.step;
  const agentTitle = () => { const o = $(`#agentSelect option[value="${CSS.escape(tour.agent)}"]`); return o ? o.textContent : tour.agent; };
  let hint = '';
  let fix = null;
  if (block && block.kind === 'agent') { hint = `This step is about ${agentTitle()}.`; fix = h('button', { class: 'btn', type: 'button', onclick: () => openAgent(tour.agent).catch((e) => toast(e.message, 'err')) }, `Open ${agentTitle()}`); }
  else if (block && block.kind === 'view') { hint = `It's in ${VIEW_NAMES[block.view]}.`; fix = h('button', { class: 'btn', type: 'button', onclick: () => deps.show(block.view) }, `Open ${VIEW_NAMES[block.view]}`); }
  else if (step.done && isDone && !step.auto) hint = 'Done.';
  const extra = step.hint ? step.hint() : '';
  const actions = [];
  if (fix) actions.push(fix);
  else if (step.doIt && !isDone) actions.push(h('button', { class: 'btn', type: 'button', onclick: async () => { try { await step.doIt(); } catch (e) { toast(e.message, 'err'); } } }, 'Do it for me'));
  if (step.done && !isDone && !step.end) actions.push(h('button', { class: 'btn quiet', type: 'button', onclick: () => go(1) }, 'Skip'));
  actions.push(h('span', { class: 'spacer' }));
  if (step.end) actions.push(h('button', { class: 'btn', type: 'button', onclick: () => finish(true) }, 'Open the Guide'));
  if (!step.auto || !step.done) actions.push(h('button', { class: 'btn primary', type: 'button', disabled: !isDone, onclick: () => (step.end ? finish(false) : go(1)) }, step.next || 'Next'));
  card.replaceChildren(
    h('header', {},
      h('span', { class: 'coach-count' }, `Step ${n + 1} of ${steps.length}`),
      h('button', { class: 'coach-x', type: 'button', title: 'Leave the tutorial (pick it up again from the Guide)', 'aria-label': 'Leave the tutorial', onclick: leave }, '×')),
    h('h2', {}, step.title),
    h('div', { class: 'coach-text', 'aria-live': 'polite' }, text(step.text)),
    extra ? h('p', { class: 'coach-hint warn' }, extra) : '',
    hint ? h('p', { class: `coach-hint${hint === 'Done.' ? ' ok' : ''}` }, hint) : '',
    h('div', { class: 'coach-actions' }, actions));
}

function tick() {
  if (!tour || !tour.open || !card) return;
  const step = stepOf();
  const isDone = done(step);
  const block = obstacle(step);
  const key = `${tour.step}|${isDone}|${block ? `${block.kind}:${block.view || ''}` : ''}|${step.hint ? step.hint() : ''}`;
  if (key !== shown) { shown = key; draw(step, isDone, block); }
  if (isDone && step.auto && !advancing) advancing = setTimeout(() => { advancing = 0; if (tour && done(stepOf()) && stepOf() === step) go(1); }, step.wait || 450);
  place();
}

/** The ring around the target (or the way to it), and the card next to it, inside the window. */
function place() {
  if (!tour || !tour.open || !card || card.hidden) return;
  const step = stepOf();
  const block = obstacle(step);
  let el = targetOf(step);
  if (block && block.kind === 'view') el = $(`.nav button[data-view="${block.view}"]`);
  if (block && block.kind === 'agent') el = $('#agentSelect');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const gap = 14;
  const m = 12;
  let left;
  let top;
  if (el && visible(el)) {
    const r = el.getBoundingClientRect();
    const pad = 5;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    ring.hidden = false;
    const clampX = (x) => Math.min(Math.max(x, m), vw - cw - m);
    const clampY = (y) => Math.min(Math.max(y, m), vh - ch - m);
    // under or over a wide target, the card keeps to its right: its buttons are usually on the left
    const alignX = () => clampX(r.width > cw ? r.right - cw : r.left);
    if (vw < 760) { left = m; top = r.bottom + gap + ch < vh - m ? r.bottom + gap : clampY(r.top - gap - ch); }
    else if (r.right + pad + gap + cw <= vw - m) { left = r.right + pad + gap; top = clampY(r.top - 8); }
    else if (r.bottom + pad + gap + ch <= vh - m) { left = alignX(); top = r.bottom + pad + gap; }
    else if (r.top - pad - gap - ch >= m) { left = alignX(); top = r.top - pad - gap - ch; }
    else if (r.left - pad - gap - cw >= m) { left = r.left - pad - gap - cw; top = clampY(r.top); }
    else { left = vw - cw - m * 2; top = vh - ch - m * 2; }
  } else {
    // nothing to point at: high in the middle of the view, over the presence rather than the words
    ring.hidden = true;
    const main = $('main').getBoundingClientRect();
    left = Math.max(m, main.left + (main.width - cw) / 2);
    top = Math.max(m, main.top + 24);
  }
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

// ———————————————————————————— offering it ————————————————————————————
/** The tutorial's card in the Guide: start it, pick it up, or start it again. */
export function tourCard() {
  const def = TOURS['first-agent'];
  const saved = load();
  const going = saved && saved.id === 'first-agent' && saved.step < def.steps.length;
  return h('div', { class: 'tour-card' },
    h('b', {}, def.title),
    h('p', {}, going ? `Under way: step ${saved.step + 1} of ${def.steps.length}, ${def.steps[saved.step].title.toLowerCase()}.` : flag(DONE) ? 'Done once. Build another agent the same way, step by step.' : def.about),
    h('div', { class: 'row' },
      going
        ? [h('button', { class: 'btn primary', type: 'button', onclick: () => startTour('first-agent') }, 'Pick it up'), h('button', { class: 'btn quiet', type: 'button', onclick: () => startTour('first-agent', { over: true }) }, 'Start over')]
        : h('button', { class: 'btn primary', type: 'button', onclick: () => startTour('first-agent', { over: true }) }, flag(DONE) ? 'Start again' : 'Start the tutorial')));
}

/** The navigation's offer: until the tutorial is done, or "Not now". */
function paintNav() {
  const box = $('#navTour');
  if (!box) return;
  const saved = load();
  const going = saved && saved.step < stepsOf(saved).length;
  box.hidden = !!(tour && tour.open) || flag(DONE) || flag(LATER);
  if (box.hidden) return;
  box.replaceChildren(
    h('b', {}, going ? 'Your tutorial' : 'New to VIK?'),
    h('span', {}, going ? `Step ${saved.step + 1} of ${stepsOf(saved).length}: pick it up where you left it.` : 'Build your first agent, step by step, in about ten minutes.'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => startTour('first-agent') }, going ? 'Pick it up' : 'Start the tutorial'),
    h('button', { class: 'btn quiet', type: 'button', onclick: () => { setFlag(LATER); paintNav(); } }, 'Not now'));
}

/**
 * @param {{show: (view: string) => void, agent: any, createAgent: (name: string) => Promise<void>,
 *   openGuide: (page?: string) => void, changed?: () => void}} d
 */
export function initTour(d) {
  const changed = d.changed || (() => {});
  deps = { ...deps, ...d, changed: () => { paintNav(); changed(); } };
  if (deps.agent) deps.agent.on('decision', () => { decided++; });
  const saved = load();
  if (saved && saved.open && TOURS[saved.id] && saved.step < TOURS[saved.id].steps.length) { tour = saved; enter(); }
  paintNav();
}
