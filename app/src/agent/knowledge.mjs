// What an agent knows: the rows of its tables as "entries", linked to each other by their names, and how an
// entry fills a line ("{artist}") or a prompt. PURE module (docs/DESIGN.md, 2.2 and 3).

/** Lower case, no accents, no punctuation, single spaces: "L'Été, à Paris!" → "l ete a paris". */
export function normalize(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`´]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * The entries of an agent: one per row, its name being the first cell. The first cell can give other names,
 * separated by | ("Water Lilies | Nymphéas"): the entry is found by any of them, and shown by the first.
 * @param {{tables: {id: string, name: string, headers: string[], rows: string[][]}[]}} agent
 * @returns {{table: string, tableName: string, key: string, names: string[], cells: Record<string, string>,
 *   links: {table: string, key: string}[]}[]}
 */
export function entriesOf(agent) {
  const out = [];
  for (const t of agent.tables || []) {
    for (const r of t.rows || []) {
      const names = String(r[0] || '').split('|').map((x) => x.trim()).filter(Boolean);
      if (!names.length) continue;
      const cells = {};
      t.headers.forEach((h, i) => { cells[h] = i === 0 ? names[0] : String(r[i] || ''); });
      out.push({ table: t.id, tableName: t.name, key: names[0], names, cells, links: [] });
    }
  }
  // links: a cell (other than the name) holding a name of an entry of another table
  const byName = new Map();
  for (const e of out) {
    for (const name of e.names) {
      const n = normalize(name);
      if (!byName.has(n)) byName.set(n, []);
      if (!byName.get(n).includes(e)) byName.get(n).push(e);
    }
  }
  for (const e of out) {
    const seen = new Set();
    Object.entries(e.cells).forEach(([h, v], i) => {
      if (i === 0) return;
      for (const target of byName.get(normalize(v)) || []) {
        const id = `${target.table}\u0000${target.key}`;
        if (target.table === e.table || seen.has(id)) continue;
        seen.add(id);
        e.links.push({ table: target.table, key: target.key });
      }
    });
  }
  return out;
}

/** The entry with this table and name, or null. */
export function findEntry(entries, ref) {
  if (!ref) return null;
  return entries.find((e) => e.table === ref.table && e.key === ref.key) || null;
}

/** An entry as one line of text (for the matcher, and for the model): "Water Lilies (artworks) — artist: Claude Monet; year: 1916". */
export function describe(e) {
  const rest = Object.entries(e.cells).slice(1).filter(([, v]) => v).map(([h, v]) => `${h}: ${v}`).join('; ');
  const also = (e.names || []).slice(1);
  return `${e.key}${also.length ? ` (also: ${also.join(', ')})` : ''} (${e.tableName.toLowerCase()})${rest ? ` — ${rest}` : ''}`;
}

/** Is any name of this entry said in the sentence? */
export function entryNamedIn(sentence, e) { return (e.names || [e.key]).some((n) => namedIn(sentence, n)); }

/** The entries to give the model: these, then their links (one step), without repeats, at most `max`. */
export function withLinks(entries, chosen, max = 6) {
  const out = [];
  const add = (e) => { if (e && !out.includes(e) && out.length < max) out.push(e); };
  for (const e of chosen) add(e);
  for (const e of chosen) for (const l of (e && e.links) || []) add(findEntry(entries, l));
  return out;
}

/**
 * Is this entry's name said in the sentence, as whole words? ("where are the toilets" says "toilets";
 * "the 10:42 to Lyon" says "Lyon"). A leading article does not have to be said ("tell me about du Penseur" says
 * "Le Penseur"). Names shorter than 3 letters never count: "3" or "a" would be said everywhere.
 */
export function namedIn(sentence, key) {
  const s = ` ${normalize(sentence)} `;
  const k = normalize(key);
  const bare = k.replace(/^(?:the|a|an|le|la|les|l|un|une|des|du|de)\s+/, '');
  return [k, bare].some((x) => x.replace(/\s/g, '').length >= 3 && s.includes(` ${x} `));
}

/**
 * A line with placeholders: {column} → the entry's cell (column names in any case), {said} → what was said.
 * A placeholder with nothing to fill it becomes empty.
 */
export function fill(template, entry, extra = {}) {
  const cells = {};
  if (entry) for (const [h, v] of Object.entries(entry.cells)) cells[normalize(h)] = v;
  for (const [k, v] of Object.entries(extra)) cells[normalize(k)] = String(v == null ? '' : v);
  return String(template || '').replace(/\{([^{}]{1,60})\}/g, (_, name) => cells[normalize(name)] ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}

/** The placeholders of a line that no column of `headers` fills (to warn in the studio). */
export function unknownPlaceholders(template, headers = []) {
  const known = new Set(['said', ...headers.map(normalize)]);
  return [...String(template || '').matchAll(/\{([^{}]{1,60})\}/g)].map((m) => m[1]).filter((n) => !known.has(normalize(n)));
}
