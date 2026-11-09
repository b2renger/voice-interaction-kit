// The studio's built-in guide: its markdown reader (app/public/js/markdown.js), and its pages
// (app/public/guide/*.md, listed in pages.json): each one is listed, has its title, and no link leads nowhere.
// The tutorial's steps point at things that exist in the studio.
//   node tests/test-guide.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary } from './helpers.mjs';

const PUB = join(ROOT, 'app', 'public');
const { parseMarkdown, parseInline, linksOf, textOf, slugify } = await import(pathToFileURL(join(PUB, 'js', 'markdown.js')).href);
const json = (x) => JSON.stringify(x);

// ———————————————————————————— the reader ————————————————————————————
{
  check(slugify('Writing good patterns') === 'writing-good-patterns' && slugify('Où, quand ?') === 'ou-quand', 'reader: heading ids are plain (accents and punctuation dropped)');
  const b = parseMarkdown('# Title *here*\n\nOne **bold `code`** line\nand its second line.\n\n## Again\n## Again\n');
  check(b.length === 4 && b[0].type === 'heading' && b[0].level === 1 && b[0].id === 'title-here', 'reader: a heading, with an id from its text', b[0]);
  check(b[1].type === 'paragraph' && textOf(b[1].inline) === 'One bold code line and its second line.', 'reader: lines that follow each other make one paragraph', b[1]);
  check(json(b[1].inline[1]) === json({ t: 'strong', c: [{ t: 'text', v: 'bold ' }, { t: 'code', v: 'code' }] }), 'reader: code inside bold', b[1].inline);
  check(b[2].id === 'again' && b[3].id === 'again-2', 'reader: two headings with the same text get different ids');

  const lists = parseMarkdown('- one\n- two\n  goes on\n\n3. third\n4. fourth\n');
  check(lists[0].type === 'list' && !lists[0].ordered && lists[0].items.length === 2 && textOf(lists[0].items[1]) === 'two goes on', 'reader: a list, an item that goes on on the next line', lists[0]);
  check(lists[1].ordered && lists[1].start === 3 && lists[1].items.length === 2, 'reader: a numbered list keeps its first number', lists[1]);
  check(parseMarkdown('Text\n- item').length === 2, 'reader: a list right under a paragraph starts a new block');

  const t = parseMarkdown('| name | note |\n|---|:--:|\n| `Water Lilies | Nymphéas` | a \\| b |\n| short |\n');
  check(t[0].type === 'table' && t[0].head.length === 2 && t[0].rows.length === 2, 'reader: a table, its header and rows', t[0]);
  check(json(t[0].rows[0][0]) === json([{ t: 'code', v: 'Water Lilies | Nymphéas' }]) && textOf(t[0].rows[0][1]) === 'a | b', 'reader: a | inside `code` or written \\| stays in its cell', t[0].rows[0]);
  check(t[0].rows[1].length === 2 && textOf(t[0].rows[1][1]) === '', 'reader: a short row gets empty cells');
  check(parseMarkdown('| not a table\nnext line')[0].type === 'paragraph', 'reader: a line starting with | but no separator is text');

  const tip = parseMarkdown('> **Tip:** do it.\n> Then this.\n\n```js\nconst a = 1;\n  b();\n```\n---\n![The studio](images/studio.png)\n');
  check(tip[0].type === 'tip' && tip[0].blocks.length === 1 && textOf(tip[0].blocks[0].inline) === 'Tip: do it. Then this.', 'reader: > lines make a tip', tip[0]);
  check(tip[1].type === 'code' && tip[1].lang === 'js' && tip[1].text === 'const a = 1;\n  b();', 'reader: a code block keeps its text and spaces', tip[1]);
  check(tip[2].type === 'hr' && tip[3].type === 'image' && tip[3].src === 'images/studio.png' && tip[3].alt === 'The studio', 'reader: a rule, an image');
  check(parseMarkdown('```\n# not a heading\n- not a list\n```')[0].text === '# not a heading\n- not a list', 'reader: nothing is read inside a code block');

  const i1 = parseInline('snake_case_word, knowledge/*.csv, 2 * 3 * 4, *em* and _em_ and [a link](persona.md#x).');
  check(i1.filter((n) => n.t === 'em').length === 2 && i1.some((n) => n.t === 'text' && n.v.includes('snake_case_word')) && i1.some((n) => n.t === 'text' && n.v.includes('2 * 3 * 4')),
    'reader: italics, but not the _ of snake_case or a lone * (2 * 3)', i1);
  check(json(linksOf([{ type: 'paragraph', inline: i1 }])) === json([{ href: 'persona.md#x', text: 'a link' }]), 'reader: a link, its target and its text');
  const i2 = parseInline('\\*not italic\\*, `{name}` and <b>not html</b>');
  check(textOf(i2) === '*not italic*, {name} and <b>not html</b>' && !i2.some((n) => n.t === 'em'), 'reader: \\* escapes; HTML stays text (the page is built from text nodes)', i2);
}

// ———————————————————————————— the pages ————————————————————————————
const pages = JSON.parse(readFileSync(join(PUB, 'guide', 'pages.json'), 'utf8'));
const files = readdirSync(join(PUB, 'guide')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
check(Array.isArray(pages) && pages.length >= 8 && pages.every((p) => p.id && p.title && p.group), 'pages: pages.json lists the pages, each with an id, a title and a group', pages.length);
check(json([...files].sort()) === json(pages.map((p) => p.id).sort()), 'pages: every page in pages.json has its .md file, and every .md file is listed', { files, listed: pages.map((p) => p.id) });

const parsed = new Map(pages.filter((p) => files.includes(p.id)).map((p) => [p.id, parseMarkdown(readFileSync(join(PUB, 'guide', `${p.id}.md`), 'utf8'))]));
const idsOf = (blocks) => { const s = new Set(); const walk = (bs) => { for (const b of bs) { if (b.type === 'heading') s.add(b.id); if (b.blocks) walk(b.blocks); } }; walk(blocks); return s; };
const html = readFileSync(join(PUB, 'index.html'), 'utf8');
const views = new Set([...html.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]));
const tourJs = readFileSync(join(PUB, 'js', 'tour.js'), 'utf8');
const tours = new Set([...tourJs.matchAll(/^\s*'([a-z0-9-]+)': \{\s*title:/gm)].map((m) => m[1]));
check(tours.has('first-agent'), 'tutorial: "first-agent" is defined', [...tours]);

const bad = [];
for (const [id, blocks] of parsed) {
  const page = pages.find((p) => p.id === id);
  const h1 = blocks.filter((b) => b.type === 'heading' && b.level === 1);
  if (h1.length !== 1 || blocks[0] !== h1[0] || textOf(h1[0].inline) !== page.title) bad.push(`${id}: its first line must be "# ${page.title}", and the only # heading`);
  for (const { href } of linksOf(blocks)) {
    let m;
    if (/^https:\/\/[^\s]+$/.test(href)) continue;
    if ((m = /^view:([a-z]+)$/.exec(href))) { if (!views.has(m[1])) bad.push(`${id}: ${href}: no such view`); continue; }
    if ((m = /^tour:([a-z0-9-]+)$/.exec(href))) { if (!tours.has(m[1])) bad.push(`${id}: ${href}: no such tutorial`); continue; }
    if ((m = /^([a-z0-9-]+)\.md(?:#([a-z0-9-]+))?$/.exec(href))) {
      if (!parsed.has(m[1])) bad.push(`${id}: ${href}: no such page`);
      else if (m[2] && !idsOf(parsed.get(m[1])).has(m[2])) bad.push(`${id}: ${href}: no such section`);
      continue;
    }
    if ((m = /^#([a-z0-9-]+)$/.exec(href))) { if (!idsOf(blocks).has(m[1])) bad.push(`${id}: ${href}: no such section`); continue; }
    bad.push(`${id}: ${href}: not a link the guide opens (https, page.md, page.md#section, #section, view:…, tour:…)`);
  }
  for (const b of blocks) if (b.type === 'image' && !existsSync(join(PUB, 'guide', b.src))) bad.push(`${id}: image ${b.src} is missing`);
}
check(bad.length === 0, 'pages: one title each, matching pages.json; every link opens a page, a section, a view, a tutorial or a website', bad);

// the studio's help links ("data-guide") open pages and sections that exist
const helps = [...html.matchAll(/data-guide="([a-z0-9-]+)(?:#([a-z0-9-]+))?"/g)];
const badHelp = helps.filter((m) => !parsed.has(m[1]) || (m[2] && !idsOf(parsed.get(m[1])).has(m[2]))).map((m) => m[0]);
check(helps.length >= 5 && badHelp.length === 0, 'pages: the help links of the studio\'s views open pages that exist', { count: helps.length, badHelp });

// the words students read: no leftover of the earlier name, no placeholder
const allText = [...parsed.keys()].map((id) => readFileSync(join(PUB, 'guide', `${id}.md`), 'utf8')).join('\n');
check(!/Voice Lab|TODO|lorem/i.test(allText), 'pages: no "Voice Lab", TODO or lorem ipsum');

// ———————————————————————————— the tutorial's targets exist in the studio ————————————————————————————
{
  const ids = new Set([...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  const keys = new Set([...html.matchAll(/data-k="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  const targets = [...tourJs.matchAll(/target: '([^']+)'/g)].map((m) => m[1]);
  const missing = [];
  for (const sel of targets) {
    for (const m of sel.matchAll(/#([A-Za-z][\w-]*)/g)) if (!ids.has(m[1])) missing.push(`${sel}: #${m[1]}`);
    for (const m of sel.matchAll(/data-k="([\w-]+)"/g)) if (!keys.has(m[1])) missing.push(`${sel}: data-k=${m[1]}`);
    for (const m of sel.matchAll(/data-view="([\w-]+)"/g)) if (!views.has(m[1])) missing.push(`${sel}: view ${m[1]}`);
  }
  check(targets.length >= 10 && missing.length === 0, 'tutorial: every step points at an element of the studio', { count: targets.length, missing });
}

process.exitCode = summary() ? 1 : 0;
