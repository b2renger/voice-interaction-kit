// A small markdown reader for the studio's guide (app/public/guide/*.md). It turns text into a tree of blocks and
// inline pieces, never into HTML: the guide view builds the page from the tree with text nodes, so a page cannot
// run anything. It reads what the guide uses, and nothing more:
//   # ## ### headings, paragraphs, - and 1. lists (one level), > tips, ``` code, | tables |, ---, ![images](…);
//   inline **bold**, *italic* or _italic_, `code`, [links](…), and \ to escape a character (\| in a table).
// No DOM here: tests/test-guide.mjs runs it in Node.

/** "Writing good patterns" → "writing-good-patterns" (the id of a heading, for links to a section). */
export function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const FENCE = /^```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const RULE = /^(-{3,}|\*{3,})\s*$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const QUOTE = /^>\s?/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBER = /^(\d+)[.)]\s+(.*)$/;
const TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const isTable = (lines, i) => /^\|/.test(lines[i]) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]);
/** Does a new block start on this line (so the paragraph above ends)? */
function startsBlock(lines, i) {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || RULE.test(l) || IMAGE.test(l) || QUOTE.test(l) || BULLET.test(l) || NUMBER.test(l) || isTable(lines, i);
}

/** The cells of a table row: split on | (not inside `code`, not \|). */
function cells(line) {
  const s = line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1');
  const out = [];
  let cur = '';
  let code = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '\\|'; k++; continue; }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The text of inline markdown, without its marks (for a heading's id). */
function plain(text) {
  return String(text).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_\\]/g, '');
}

/**
 * The blocks of a page:
 *   {type:'heading', level, id, inline} · {type:'paragraph', inline} · {type:'list', ordered, start, items: inline[]}
 *   {type:'code', lang, text} · {type:'tip', blocks} · {type:'table', head: inline[], rows: inline[][]}
 *   {type:'hr'} · {type:'image', alt, src}
 * @param {string} text
 * @param {Set<string>} [ids] the heading ids already taken (a tip shares its page's)
 */
export function parseMarkdown(text, ids = new Set()) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const uniqueId = (s) => {
    const base = slugify(s) || 'section';
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = FENCE.exec(line))) {
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang: m[1], text: body.join('\n') });
    } else if ((m = HEADING.exec(line))) {
      blocks.push({ type: 'heading', level: m[1].length, id: uniqueId(plain(m[2])), inline: parseInline(m[2]) });
      i++;
    } else if (RULE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
    } else if ((m = IMAGE.exec(line))) {
      blocks.push({ type: 'image', alt: m[1], src: m[2] });
      i++;
    } else if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
      blocks.push({ type: 'tip', blocks: parseMarkdown(body.join('\n'), ids) });
    } else if (isTable(lines, i)) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', head: head.map((c) => parseInline(c)), rows: rows.map((r) => head.map((_, c) => parseInline(r[c] || ''))) });
    } else if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = !BULLET.test(line);
      const re = ordered ? NUMBER : BULLET;
      const items = [];
      const start = ordered ? Number(NUMBER.exec(line)[1]) : 1;
      while (i < lines.length) {
        const im = re.exec(lines[i]);
        if (im) { items.push([ordered ? im[2] : im[1]]); i++; continue; }
        // an item that goes on, on the next line, indented
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1].push(lines[i].trim()); i++; continue; }
        break;
      }
      blocks.push({ type: 'list', ordered, start, items: items.map((parts) => parseInline(parts.join(' '))) });
    } else {
      const body = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) body.push(lines[i++].trim());
      blocks.push({ type: 'paragraph', inline: parseInline(body.join(' ')) });
    }
  }
  return blocks;
}

// `code` · **bold** · [text](href) · *italic* · _italic_ · \x (an escaped character). An italic opens after a
// space, the start, a bracket or a quote (not in knowledge/*.csv or snake_case), and closes before a non-letter.
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![^\s(["'])\*(?![\s*])(.+?)(?<![\s\\])\*(?![\w*])|(?<![^\s(["'])_(?![\s_])(.+?)(?<!\s)_(?!\w)|\\([\\`*_[\]|{}#>!-])/g;

/**
 * The inline pieces of a line: {t:'text', v} · {t:'code', v} · {t:'strong', c} · {t:'em', c} · {t:'link', href, c}
 * (c: the pieces inside).
 */
export function parseInline(text) {
  const s = String(text || '');
  const out = [];
  const re = new RegExp(INLINE.source, 'g');
  let last = 0;
  let m;
  const push = (n) => {
    const prev = out[out.length - 1];
    if (n.t === 'text' && prev && prev.t === 'text') prev.v += n.v; else out.push(n);
  };
  while ((m = re.exec(s))) {
    if (m.index > last) push({ t: 'text', v: s.slice(last, m.index) });
    if (m[1] != null) push({ t: 'code', v: m[1].replace(/\\\|/g, '|') });
    else if (m[2] != null) push({ t: 'strong', c: parseInline(m[2]) });
    else if (m[3] != null) push({ t: 'link', href: m[4], c: parseInline(m[3]) });
    else if (m[5] != null) push({ t: 'em', c: parseInline(m[5]) });
    else if (m[6] != null) push({ t: 'em', c: parseInline(m[6]) });
    else push({ t: 'text', v: m[7] });
    last = re.lastIndex;
  }
  if (last < s.length) push({ t: 'text', v: s.slice(last) });
  return out;
}

/** Every link of a page's blocks: [{href, text}] (for the tests: none may lead nowhere). */
export function linksOf(blocks) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.t === 'link') out.push({ href: n.href, text: textOf(n.c) });
      if (n.c) walk(n.c);
    }
  };
  for (const b of blocks) {
    if (b.inline) walk(b.inline);
    if (b.items) b.items.forEach(walk);
    if (b.head) { b.head.forEach(walk); b.rows.forEach((r) => r.forEach(walk)); }
    if (b.blocks) out.push(...linksOf(b.blocks));
  }
  return out;
}

/** The plain text of inline pieces. */
export function textOf(nodes) {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : textOf(n.c || []))).join('');
}
