// The studio's state (docs/DESIGN.md, 5):
//   - the agent being edited: its files, read and saved through the API as you type (persona.md, the tables,
//     interactions.json);
//   - this computer's settings (engine, models, keys, speakers): kept in this window, never in an agent.
// settings() merges both into what the voice core runs with.
import { api } from './api.js';
import { debounce } from './ui.js';

const D = VoiceCore.DEFAULTS;
/** This computer's settings: they never travel with an agent (an export, a persona file shared by a student). */
export const MACHINE = ['engine', 'apiKey', 'tokenUrl', 'geminiEndpoint', 'geminiModel', 'serverUrl', 'localAsr', 'localLlm',
  'llm', 'llmUrl', 'llmModel', 'llmKey', 'volume', 'playVoice', 'listenWhileSpeaking', 'micMuted'];
/** Written in persona.md even when they have their default value. */
const ALWAYS = ['name', 'title', 'language', 'greeting'];
const MACHINE_STORE = 'vik.machine';
const AGENT_STORE = 'vik.agent';

export const state = { agentId: '', agent: null, machine: loadMachine() };
const listeners = new Set();
/** fn(what, detail): 'agent' (another agent is open), 'setting' (a key changed), 'saved' ({status, error}). */
export function onChange(fn) { listeners.add(fn); }
function emit(what, detail) { for (const fn of listeners) { try { fn(what, detail); } catch (e) { console.error(e); } } }

function loadMachine() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(MACHINE_STORE) || '{}'); } catch { /* no storage */ }
  const out = {};
  for (const k of MACHINE) if (m[k] !== undefined) out[k] = m[k];
  if (!out.engine) out.engine = 'local';
  // the voice server is the one that served this page (its port can change from one launch to the next)
  out.serverUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/voice`;
  return out;
}
function saveMachine() {
  try {
    const copy = { ...state.machine };
    delete copy.serverUrl;
    localStorage.setItem(MACHINE_STORE, JSON.stringify(copy));
  } catch { /* no storage */ }
}

/** What the voice core runs with: the defaults, the agent's settings, this computer's, the persona, the agent. */
export function settings() {
  const a = state.agent;
  // an agent never sets this computer's settings (where the conversation goes, the keys): an agent can come from anyone
  const own = a ? Object.fromEntries(Object.entries(a.settings).filter(([k]) => !MACHINE.includes(k))) : {};
  const s = { ...D, ...own, ...state.machine };
  s.persona = a ? a.body : '';
  // Gemini decides by itself: it gets the knowledge in its prompt (the local engine looks it up per sentence)
  if (s.engine === 'gemini' && a) s.persona = withKnowledge(a.body, a.tables);
  s.agent = state.agentId;
  return s;
}

/** The value a field shows. */
export function valueOf(k) {
  if (k === 'persona') return state.agent ? state.agent.body : '';
  if (k === 'title') return state.agent ? (state.agent.settings.title ?? '') : '';
  return settings()[k];
}

/** A field changed. */
export function set(k, v) {
  if (MACHINE.includes(k)) { state.machine[k] = v; saveMachine(); } else if (state.agent) {
    if (k === 'persona') state.agent.body = String(v);
    else state.agent.settings[k] = v;
    savePersonaSoon();
  }
  emit('setting', k);
}

/** Several of this computer's settings at once (choosing a farm: the address and the model). */
export function setMachine(o) {
  Object.assign(state.machine, o);
  saveMachine();
  for (const k of Object.keys(o)) emit('setting', k);
}

// — saving, as you type —
let saving = 0;
function status(s, error) { emit('saved', { status: s, error }); }
async function guard(fn) {
  saving++;
  status('saving');
  try { await fn(); saving--; if (!saving) status('saved'); } catch (e) { saving--; status('error', e.message); }
}

/** persona.md: the settings that differ from the defaults (and name, title, language, greeting), and the text. */
function personaFile() {
  const out = {};
  for (const [k, v] of Object.entries(state.agent.settings)) {
    if (MACHINE.includes(k) || k === 'persona' || k === 'agent' || v === undefined || v === null) continue;
    if (!ALWAYS.includes(k) && Object.prototype.hasOwnProperty.call(D, k) && D[k] === v) continue;
    if (ALWAYS.includes(k) && v === '' && k !== 'name') continue;
    out[k] = v;
  }
  return { settings: out, body: state.agent.body };
}
const savePersonaNow = () => { const id = state.agentId; const data = personaFile(); return guard(() => api.savePersona(id, data)); };
export const savePersonaSoon = debounce(savePersonaNow, 500);

const tableSavers = new Map();
/** A table changed: saved a moment later. */
export function saveTableSoon(t) {
  const key = `${state.agentId}/${t.id}`;
  if (!tableSavers.has(key)) {
    const id = state.agentId;
    tableSavers.set(key, debounce((table) => guard(() => api.saveTable(id, table.id, { headers: table.headers, rows: table.rows })), 600));
  }
  tableSavers.get(key)(t);
}
const saveInteractionsNow = () => { const id = state.agentId; const data = state.agent.interactions; return guard(() => api.saveInteractions(id, data)); };
export const saveInteractionsSoon = debounce(saveInteractionsNow, 500);

/** Edits not yet on disk (waiting, or being sent). */
export function busy() {
  return saving > 0 || savePersonaSoon.pending() || saveInteractionsSoon.pending() || [...tableSavers.values()].some((s) => s.pending());
}

/**
 * The agent's files again, from disk: they may have been edited by hand (a table in a spreadsheet) while the
 * studio was in the background. Never over edits of the studio not yet saved. Tells the views if anything changed.
 */
export async function reloadAgent() {
  if (!state.agentId || busy()) return false;
  const a = await api.agent(state.agentId);
  if (busy() || a.id !== state.agentId || JSON.stringify(a) === JSON.stringify(state.agent)) return false;
  state.agent = a;
  emit('agent', a);
  return true;
}

/** Everything still waiting to be saved, now (before opening another agent). */
export function flush() {
  savePersonaSoon.flush();
  saveInteractionsSoon.flush();
  for (const s of tableSavers.values()) s.flush();
}

/** Opens an agent: its files from the server. */
export async function openAgent(id) {
  flush();
  const a = await api.agent(id);
  state.agentId = id;
  state.agent = a;
  tableSavers.clear();
  try { localStorage.setItem(AGENT_STORE, id); } catch { /* no storage */ }
  emit('agent', a);
  return a;
}
export function lastAgent() { try { return localStorage.getItem(AGENT_STORE) || ''; } catch { return ''; } }

/** Something changed outside the fields (a table, a pattern): tell the views. */
export function touched(what) { emit('setting', what); }

/** The tables as text for a prompt (Gemini): "Artworks — name: Water Lilies; artist: Claude Monet…", at most `max` characters. */
export function withKnowledge(body, tables = [], max = 12000) {
  const lines = [];
  for (const t of tables) {
    if (!t.rows.length) continue;
    lines.push(`${t.name}:`);
    for (const r of t.rows) lines.push(`- ${t.headers.map((h, i) => (r[i] ? `${h}: ${r[i]}` : '')).filter(Boolean).join('; ')}`);
  }
  if (!lines.length) return body;
  let text = lines.join('\n');
  if (text.length > max) text = `${text.slice(0, max)}\n(…)`;
  return `${body}\n\nWhat you know:\n${text}`;
}
