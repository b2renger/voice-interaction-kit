// The agents on disk: one folder per agent (docs/DESIGN.md, 2).
//
//   <dir>/<id>/persona.md            who it is (markdown + settings)
//   <dir>/<id>/knowledge/<table>.csv what it knows
//   <dir>/<id>/interactions.json     how it decides
//
// The studio edits them through the server's API (app-server.mjs); they can also be edited by hand while the app
// runs: compiled() notices a file that changed. Writes go through a temporary file, so a crash never leaves half
// a file. Deleted agents go to <dir>/.trash, not to oblivion.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, cpSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { parsePersona, writePersona } from './persona.mjs';
import { parseCsv, writeCsv } from './csv.mjs';
import { normalizeInteractions, slug } from './interactions.mjs';

export const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MARKER = '.vik';
const MAX_ROWS = 5000;
const MAX_COLUMNS = 50;

/** "opening-hours" → "Opening hours" */
export function tableName(id) { const s = String(id).replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * @param {{dir: string, examples?: string, legacy?: string[], log?: (m: string) => void}} o
 *   dir: where the agents live; examples: the example agents, copied on first launch;
 *   legacy: folders of persona JSON files from earlier versions, imported once.
 */
export function createAgentStore({ dir, examples, legacy = [], log = () => {} }) {
  mkdirSync(dir, { recursive: true });
  const cache = new Map();       // id → {sig, agent}
  const listeners = new Set();

  const folder = (id) => {
    if (!ID.test(String(id || ''))) throw httpError(400, `"${id}" is not an agent name.`);
    return join(dir, id);
  };
  const must = (id) => {
    const f = folder(id);
    if (!existsSync(join(f, 'persona.md'))) throw httpError(404, `There is no agent "${id}".`);
    return f;
  };
  const changed = (id) => { cache.delete(id); for (const fn of listeners) { try { fn(id); } catch { /* a listener's problem */ } } };

  function ids() {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && ID.test(e.name) && existsSync(join(dir, e.name, 'persona.md')))
      .map((e) => e.name).sort();
  }

  /** A signature of the agent's files (names, sizes, dates): it changes when a file does. */
  function signature(f) {
    const parts = [];
    const add = (p) => { try { const s = statSync(p); parts.push(`${p}:${s.size}:${s.mtimeMs}`); } catch { parts.push(`${p}:-`); } };
    add(join(f, 'persona.md'));
    add(join(f, 'interactions.json'));
    const k = join(f, 'knowledge');
    if (existsSync(k)) for (const n of readdirSync(k).sort()) if (n.endsWith('.csv')) add(join(k, n));
    return parts.join('|');
  }

  /** Everything about an agent, parsed: {id, settings, body, tables, interactions}. Cached until a file changes. */
  function compiled(id) {
    const f = must(id);
    const sig = signature(f);
    const hit = cache.get(id);
    if (hit && hit.sig === sig) return hit.agent;
    const { settings, body } = parsePersona(readText(join(f, 'persona.md')));
    const tables = [];
    const k = join(f, 'knowledge');
    if (existsSync(k)) {
      for (const n of readdirSync(k).sort()) {
        const tid = basename(n, extname(n));
        if (extname(n).toLowerCase() !== '.csv' || !ID.test(tid)) continue;
        const t = parseCsv(readText(join(k, n)));
        tables.push({ id: tid, name: tableName(tid), headers: t.headers, rows: t.rows.slice(0, MAX_ROWS) });
      }
    }
    let raw = {};
    try { raw = JSON.parse(readText(join(f, 'interactions.json')) || '{}'); } catch (e) { log(`✖ agent ${id}: interactions.json is not valid JSON (${e.message})`); }
    const agent = { id, settings, body, tables, interactions: normalizeInteractions(raw) };
    cache.set(id, { sig, agent });
    return agent;
  }

  function summary(id) {
    const a = compiled(id);
    return {
      id, name: String(a.settings.name || ''), title: String(a.settings.title || a.settings.name || id),
      language: String(a.settings.language || 'en'), tables: a.tables.length, patterns: a.interactions.patterns.length,
    };
  }

  function newId(wanted) {
    const base = slug(wanted, 'agent');
    let id = base;
    for (let n = 2; existsSync(join(dir, id)) || existsSync(join(dir, '.trash', id)); n++) id = `${base}-${n}`;
    return id;
  }

  /** Writes a whole agent (a new one, an import). */
  function writeAgent(id, { persona, tables = [], interactions = {} }) {
    const f = folder(id);
    mkdirSync(join(f, 'knowledge'), { recursive: true });
    atomicWrite(join(f, 'persona.md'), typeof persona === 'string' ? persona : writePersona(persona));
    for (const t of tables) atomicWrite(join(f, 'knowledge', `${tableId(t.id)}.csv`), typeof t.csv === 'string' ? t.csv : writeCsv(cleanTable(t)));
    atomicWrite(join(f, 'interactions.json'), `${JSON.stringify(normalizeInteractions(interactions), null, 2)}\n`);
    changed(id);
    return id;
  }

  const store = {
    dir,
    list: () => ids().map(summary),
    get: (id) => compiled(id),
    compiled,
    /** Calls fn(id) after any change made through the store. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    savePersona(id, { settings = {}, body = '' }) {
      atomicWrite(join(must(id), 'persona.md'), writePersona({ settings: plainSettings(settings), body }));
      changed(id);
      return summary(id);
    },
    saveTable(id, table, data) {
      const f = must(id);
      mkdirSync(join(f, 'knowledge'), { recursive: true });
      atomicWrite(join(f, 'knowledge', `${tableId(table)}.csv`), writeCsv(cleanTable(data)));
      changed(id);
      return compiled(id).tables.find((t) => t.id === tableId(table));
    },
    deleteTable(id, table) {
      const p = join(must(id), 'knowledge', `${tableId(table)}.csv`);
      if (existsSync(p)) rmSync(p);
      changed(id);
    },
    renameTable(id, table, to) {
      const k = join(must(id), 'knowledge');
      const from = join(k, `${tableId(table)}.csv`);
      const next = tableId(slug(to, ''));
      if (!existsSync(from)) throw httpError(404, `There is no table "${table}".`);
      if (existsSync(join(k, `${next}.csv`))) throw httpError(409, `A table "${tableName(next)}" already exists.`);
      renameSync(from, join(k, `${next}.csv`));
      changed(id);
      return next;
    },
    saveInteractions(id, data) {
      const clean = normalizeInteractions(data);
      atomicWrite(join(must(id), 'interactions.json'), `${JSON.stringify(clean, null, 2)}\n`);
      changed(id);
      return clean;
    },

    /** A new agent: empty, a copy of another (from), or an import (bundle). Returns its summary. */
    create({ name = '', from = '', bundle = null } = {}) {
      if (bundle) return summary(importBundle(bundle));
      if (from) {
        const src = must(from);
        const a = compiled(from);
        const title = name || `${a.settings.title || a.settings.name || from} (copy)`;
        const id = newId(title);
        cpSync(src, join(dir, id), { recursive: true, filter: (p) => !p.includes(`${join(src, '.cache')}`) });
        const p = parsePersona(readText(join(dir, id, 'persona.md')));
        atomicWrite(join(dir, id, 'persona.md'), writePersona({ settings: { ...p.settings, title }, body: p.body }));
        changed(id);
        return summary(id);
      }
      const title = String(name || 'New agent').trim().slice(0, 80);
      const id = writeAgent(newId(title), {
        persona: { settings: { name: title, title, language: 'en' }, body: `You are ${title}. Describe here who the agent is, what it knows and how it speaks.` },
        interactions: { stages: [{ id: 'main', name: 'Main' }], patterns: [] },
      });
      return summary(id);
    },
    /** Moves the agent to <dir>/.trash (recoverable by hand). */
    remove(id) {
      const f = must(id);
      mkdirSync(join(dir, '.trash'), { recursive: true });
      renameSync(f, join(dir, '.trash', `${id}-${Date.now()}`));
      changed(id);
    },
    /** One file holding the whole agent (.vik.json). */
    exportBundle(id) {
      const f = must(id);
      const a = compiled(id);
      return {
        vik: 'agent', version: 1, id,
        persona: readText(join(f, 'persona.md')),
        knowledge: Object.fromEntries(a.tables.map((t) => [t.id, writeCsv(t)])),
        interactions: a.interactions,
      };
    },
    importBundle,
    /** Copies the example agents that are not here yet. Returns the ids copied. */
    addExamples() {
      if (!examples || !existsSync(examples)) return [];
      const done = [];
      for (const e of readdirSync(examples, { withFileTypes: true })) {
        if (!e.isDirectory() || !ID.test(e.name) || existsSync(join(dir, e.name))) continue;
        cpSync(join(examples, e.name), join(dir, e.name), { recursive: true });
        done.push(e.name);
      }
      if (done.length) log(`▸ example agents added: ${done.join(', ')}`);
      return done;
    },
  };

  /** An agent from a .vik.json bundle, or from a persona JSON of an earlier version. Returns its id. */
  function importBundle(b) {
    if (!b || typeof b !== 'object') throw httpError(400, 'This file is not an agent.');
    if (b.vik === 'agent') {
      const p = parsePersona(String(b.persona || ''));
      const title = String(p.settings.title || p.settings.name || b.id || 'Imported agent');
      const tables = Object.entries(b.knowledge && typeof b.knowledge === 'object' ? b.knowledge : {})
        .filter(([t]) => ID.test(slug(t, ''))).map(([t, csv]) => ({ id: slug(t, ''), ...parseCsv(String(csv)) }));
      return writeAgent(newId(b.id || title), { persona: { settings: p.settings, body: p.body }, tables, interactions: b.interactions || {} });
    }
    if (typeof b.persona === 'string' || typeof b.name === 'string') return writeAgent(newId(b.title || b.name || 'Imported agent'), fromLegacy(b, ''));
    throw httpError(400, 'This file is not an agent (no persona).');
  }

  // — first launch: the examples, and the personas of earlier versions —
  if (!existsSync(join(dir, MARKER))) {
    store.addExamples();
    for (const d of legacy) {
      if (!d || !existsSync(d)) continue;
      for (const n of readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
        try {
          const old = JSON.parse(readText(join(d, n)));
          const knowledge = old.knowledge ? readIfThere(join(d, basename(String(old.knowledge)))) : '';
          const id = newId(old.title || old.name || basename(n, '.json'));
          writeAgent(id, fromLegacy(old, knowledge));
          log(`▸ persona ${n} (earlier version) → agent "${id}"`);
        } catch (e) { log(`✖ persona ${n} not imported: ${e.message}`); }
      }
    }
    atomicWrite(join(dir, MARKER), `${JSON.stringify({ created: new Date().toISOString() })}\n`);
  }
  return store;
}

/** An agent from a persona JSON of an earlier version ({title, name, persona, …settings}, a knowledge text). */
function fromLegacy(old, knowledge) {
  const settings = {};
  for (const [k, v] of Object.entries(old)) {
    if (['persona', 'knowledge', 'id', 'apiKey', 'tokenUrl', 'geminiEndpoint', 'serverUrl', 'engine'].includes(k)) continue;
    if (['string', 'number', 'boolean'].includes(typeof v)) settings[k] = v;
  }
  const body = [String(old.persona || '').trim(), knowledge ? `## What you know\n\n${knowledge.trim()}` : ''].filter(Boolean).join('\n\n');
  return { persona: { settings, body }, tables: [], interactions: { stages: [{ id: 'main', name: 'Main' }], patterns: [] } };
}

/** Only plain values go in the front matter (no objects from a buggy page). */
function plainSettings(s) {
  const out = {};
  for (const [k, v] of Object.entries(s || {})) if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0, 20000) : v;
  return out;
}

function tableId(t) {
  const id = slug(t, '');
  if (!ID.test(id)) throw httpError(400, `"${t}" is not a table name.`);
  return id;
}

/** A table from the studio: text cells, at most MAX_COLUMNS columns and MAX_ROWS rows, no empty rows. */
function cleanTable(t) {
  const headers = (Array.isArray(t && t.headers) ? t.headers : []).slice(0, MAX_COLUMNS).map((h, i) => String(h == null ? '' : h).trim() || `column ${i + 1}`);
  const rows = (Array.isArray(t && t.rows) ? t.rows : []).slice(0, MAX_ROWS)
    .map((r) => headers.map((_, i) => String((Array.isArray(r) ? r[i] : '') ?? '').trim()))
    .filter((r) => r.some((x) => x !== ''));
  return { headers, rows };
}

function readText(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
function readIfThere(p) { return existsSync(p) ? readText(p) : ''; }
function atomicWrite(p, text) {
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}
export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
