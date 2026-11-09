// persona.md: who an agent is, in markdown, with its settings in a block at the top (the "front matter").
//
//   ---
//   name: Ada
//   language: en
//   endSilenceMs: 900
//   ---
//
//   You are Ada, a curious, warm guide at the great gallery…
//
// The front matter: one "key: value" per line. A value is text, a number or true/false; text that would read
// as something else ("42", "true", " spaced ") is written in double quotes. Lines starting with # are comments.
// The body is the persona: what the language model reads before every reply. PURE module (docs/DESIGN.md, 2.1).

const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
/** The keys written first, in this order; the others follow in the order they were given. */
const FIRST = ['name', 'title', 'language', 'greeting'];

/** @returns {{settings: Record<string, string|number|boolean>, body: string}} */
export function parsePersona(text) {
  const t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(t);
  if (!m) return { settings: {}, body: t.trim() };
  const settings = {};
  for (const line of String(m[1] || '').split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const colon = l.indexOf(':');
    if (colon <= 0) continue;
    const key = l.slice(0, colon).trim();
    if (KEY.test(key)) settings[key] = readValue(l.slice(colon + 1));
  }
  return { settings, body: t.slice(m[0].length).trim() };
}

/** The text of persona.md. Values that are null or undefined are left out. */
export function writePersona({ settings = {}, body = '' } = {}) {
  const keys = Object.keys(settings).filter((k) => KEY.test(k) && settings[k] !== undefined && settings[k] !== null);
  keys.sort((a, b) => rank(a) - rank(b));
  const head = keys.map((k) => `${k}: ${writeValue(settings[k])}`).join('\n');
  const text = String(body || '').replace(/\r\n?/g, '\n').trim();
  return `---\n${head ? `${head}\n` : ''}---\n\n${text}${text ? '\n' : ''}`;
}

const rank = (k) => { const i = FIRST.indexOf(k); return i < 0 ? FIRST.length : i; };

function readValue(raw) {
  const v = raw.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function writeValue(v) {
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  const s = (typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/\s*\n\s*/g, ' ');
  // quoted when it would read back as something else
  if (s === '' || s !== s.trim() || /^(?:true|false|-?\d+(?:\.\d+)?)$/.test(s) || s.startsWith('"') || s.startsWith('#')) return JSON.stringify(s);
  return s;
}
