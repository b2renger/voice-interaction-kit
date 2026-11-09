// The Guide: the studio's built-in documentation (app/public/guide/*.md, in the order of pages.json), and the
// door to the tutorial (tour.js). A page is read by markdown.js and built here from text nodes: links only open
// a page of the guide, one of its sections, a view of the studio, a tutorial, or a website (in the browser).
import { $, h } from './ui.js';
import { parseMarkdown } from './markdown.js';

const BASE = '/public/guide/';
let pages = null;                  // [{id, title, group}]
const cache = new Map();           // id → blocks
let current = '';
let deps = { show: () => {}, startTour: () => {}, tourCard: () => null };

async function index() {
  if (!pages) {
    const r = await fetch(`${BASE}pages.json`);
    if (!r.ok) throw new Error('The guide could not be read.');
    pages = await r.json();
  }
  return pages;
}
async function blocksOf(id) {
  if (!cache.has(id)) {
    const r = await fetch(`${BASE}${encodeURIComponent(id)}.md`);
    if (!r.ok) throw new Error(`The page "${id}" could not be read.`);
    cache.set(id, parseMarkdown(await r.text()));
  }
  return cache.get(id);
}

// ———————————————————————————— a page, from its blocks ————————————————————————————
function link(href, children) {
  let m;
  if (/^https:\/\//i.test(href)) return h('a', { href, target: '_blank', rel: 'noopener', class: 'ext' }, children);
  if ((m = /^view:([a-z]+)$/.exec(href))) {
    const view = m[1];
    return h('a', { href: `#${view}`, class: 'go', onclick: (e) => { e.preventDefault(); deps.show(view); } }, children);
  }
  if ((m = /^tour:([a-z0-9-]+)$/.exec(href))) {
    const tour = m[1];
    return h('button', { class: 'btn primary tour-go', type: 'button', onclick: () => deps.startTour(tour) }, children);
  }
  if ((m = /^([a-z0-9-]+)\.md(?:#([a-z0-9-]+))?$/.exec(href))) {
    const [, page, section] = m;
    return h('a', { href: `#guide/${page}`, onclick: (e) => { e.preventDefault(); openGuide(page, section); } }, children);
  }
  if ((m = /^#([a-z0-9-]+)$/.exec(href))) {
    const section = m[1];
    return h('a', { href, onclick: (e) => { e.preventDefault(); scrollToSection(section); } }, children);
  }
  return h('span', {}, children);          // any other target: the words only
}

function inline(nodes) {
  return nodes.map((n) => {
    if (n.t === 'text') return n.v;
    if (n.t === 'code') return h('code', {}, n.v);
    if (n.t === 'strong') return h('strong', {}, inline(n.c));
    if (n.t === 'em') return h('em', {}, inline(n.c));
    if (n.t === 'link') return link(n.href, inline(n.c));
    return '';
  });
}

function block(b) {
  switch (b.type) {
    case 'heading': return h(`h${b.level}`, { id: `g-${b.id}` }, inline(b.inline));
    case 'paragraph': {
      // a paragraph that is only a tutorial link: the button alone, not inside a paragraph of text
      const only = b.inline.length === 1 && b.inline[0].t === 'link' && b.inline[0].href.startsWith('tour:');
      return only ? h('p', { class: 'tour-line' }, inline(b.inline)) : h('p', {}, inline(b.inline));
    }
    case 'list': return h(b.ordered ? 'ol' : 'ul', b.ordered && b.start !== 1 ? { start: b.start } : {}, b.items.map((it) => h('li', {}, inline(it))));
    case 'code': return h('pre', {}, h('code', {}, b.text));
    case 'tip': return h('aside', { class: 'tip' }, b.blocks.map(block));
    case 'table': return h('div', { class: 'doc-table' }, h('table', {},
      h('thead', {}, h('tr', {}, b.head.map((c) => h('th', {}, inline(c))))),
      h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, inline(c))))))));
    case 'hr': return h('hr');
    case 'image': return /^[\w./-]+$/.test(b.src) && !b.src.includes('..') ? h('img', { src: `${BASE}${b.src}`, alt: b.alt, loading: 'lazy' }) : '';
    default: return '';
  }
}

function scrollToSection(section) {
  const el = document.getElementById(`g-${section}`);
  if (el) el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ———————————————————————————— the view ————————————————————————————
/** The list of pages, by group; the open page shows its sections under it. */
function renderSide(list, blocks) {
  const groups = [];
  for (const p of list) {
    let g = groups.find((x) => x.name === p.group);
    if (!g) { g = { name: p.group, pages: [] }; groups.push(g); }
    g.pages.push(p);
  }
  const sections = (blocks || []).filter((b) => b.type === 'heading' && b.level === 2);
  $('#guidePages').replaceChildren(...groups.map((g) => h('li', { class: 'guide-group' },
    h('span', { class: 'group-name' }, g.name),
    h('ol', {}, g.pages.map((p) => h('li', {},
      h('a', { href: `#guide/${p.id}`, 'aria-current': p.id === current ? 'page' : null, onclick: (e) => { e.preventDefault(); openGuide(p.id); } }, p.title),
      p.id === current && sections.length ? h('ol', { class: 'sections' }, sections.map((s) => h('li', {},
        h('a', { href: `#g-${s.id}`, onclick: (e) => { e.preventDefault(); scrollToSection(s.id); } }, inline(s.inline))))) : ''))))));
  const card = deps.tourCard();
  if (card) $('#guideTour').replaceChildren(card); else $('#guideTour').replaceChildren();
}

let drawing = null;
/** Draws the open page (or the last one read, or the first). Calls made while it draws share its promise. */
export function renderGuide() {
  if (!drawing) {
    drawing = (async () => {
      try {
        let list;
        try { list = await index(); } catch (e) { $('#guideArticle').replaceChildren(h('p', { class: 'hint' }, e.message)); return; }
        if (!list.some((p) => p.id === current)) {
          let last = '';
          try { last = localStorage.getItem('vik.guide') || ''; } catch { /* no storage */ }
          current = list.some((p) => p.id === last) ? last : list[0].id;
        }
        let drawn;
        do { drawn = current; await drawPage(list, drawn); } while (drawn !== current);   // another page was asked for meanwhile
      } finally { drawing = null; }
    })();
  }
  return drawing;
}

async function drawPage(list, id) {
  let blocks;
  try { blocks = await blocksOf(id); } catch (e) { $('#guideArticle').replaceChildren(h('p', { class: 'hint' }, e.message)); return; }
  if (id !== current) return;
  const at = list.findIndex((p) => p.id === id);
  const next = list[at + 1];
  const prev = list[at - 1];
  $('#guideArticle').replaceChildren(
    ...blocks.map(block),
    h('nav', { class: 'doc-next', 'aria-label': 'Other pages' },
      prev ? h('a', { href: `#guide/${prev.id}`, class: 'prev', onclick: (e) => { e.preventDefault(); openGuide(prev.id); } }, h('small', {}, 'Previous'), prev.title) : h('span'),
      next ? h('a', { href: `#guide/${next.id}`, class: 'next', onclick: (e) => { e.preventDefault(); openGuide(next.id); } }, h('small', {}, 'Next'), next.title) : h('span')));
  renderSide(list, blocks);
}

/** Opens the guide on a page (and a section of it). */
export async function openGuide(page, section) {
  if (page) {
    current = page;
    try { localStorage.setItem('vik.guide', page); } catch { /* no storage */ }
  }
  deps.show('guide');                            // show() draws the page (renderGuide)
  await renderGuide();
  if (section) scrollToSection(section);
  else $('#view-guide').closest('main').scrollTop = 0;
}

/** Redraws the tutorial's card in the guide (it has started, moved on, finished). */
export function refreshGuideTour() {
  if ($('#view-guide').hidden) return;
  const card = deps.tourCard();
  $('#guideTour').replaceChildren(...(card ? [card] : []));
}

/**
 * @param {{show: (view: string) => void, startTour: (id: string) => void, tourCard: () => Node|null}} d
 */
export function initGuide(d) {
  deps = { ...deps, ...d };
  // "How it works" links in the views: data-guide="page" or "page#section"
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-guide]');
    if (!a) return;
    e.preventDefault();
    const [page, section] = a.dataset.guide.split('#');
    openGuide(page, section);
  });
}
