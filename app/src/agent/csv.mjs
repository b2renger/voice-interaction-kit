// CSV, as spreadsheets write it: comma, semicolon or tab separated (guessed from the first line), fields in
// double quotes when they hold a separator, a quote ("") or a line break. Written back with commas and a UTF-8
// mark at the start, so that Excel shows accents properly. PURE module (docs/DESIGN.md, 2.2).

/** @returns {{headers: string[], rows: string[][]}} rows all have as many cells as there are headers */
export function parseCsv(text) {
  const t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sep = guessSeparator(t);
  const lines = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false;                 // something on this line (an empty field still counts)
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      continue;
    }
    if (c === '"' && field.trim() === '') { quoted = true; field = ''; started = true; continue; }
    if (c === sep) { row.push(field); field = ''; started = true; continue; }
    if (c === '\n') { row.push(field); lines.push(row); row = []; field = ''; started = false; continue; }
    field += c;
    started = true;
  }
  if (started || field) { row.push(field); lines.push(row); }
  const kept = lines.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
  const head = kept.shift() || [];
  const width = Math.max(head.length, ...kept.map((r) => r.length), 0);
  const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => head[i] || ''));
  const rows = kept.map((r) => Array.from({ length: width }, (_, i) => r[i] || ''));
  return { headers, rows };
}

/** The CSV text of a table. */
export function writeCsv({ headers = [], rows = [] } = {}) {
  const width = headers.length;
  const cell = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows.map((r) => Array.from({ length: width }, (_, i) => (r || [])[i]))];
  return `﻿${lines.map((r) => r.map(cell).join(',')).join('\n')}\n`;
}

/** The separator used by the first line: the most frequent of , ; and tab, outside quotes. */
function guessSeparator(t) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const c of t) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '\n') break;
    else if (!quoted && c in counts) counts[c]++;
  }
  return Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), ',');
}

/** Empty headers get a name ("column 3"), repeated ones a number ("year 2"). */
function uniqueHeaders(list) {
  const seen = new Map();
  return list.map((h, i) => {
    const base = h || `column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) || 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} ${n}`;
  });
}
