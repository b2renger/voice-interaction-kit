// The agent's saved voices (Voice & timing): the voice being set (its engine, its voice, its speed, Parler's
// description, Zonos's voice and design) kept under a name. A saved voice can be given back to the agent as its
// own voice ("Use"), or used by a pattern ("Change voice", Interactions): the agent then answers in it from that
// reply on. They live with the agent (voices.json), and travel with it: duplicate, export, import.
// The voices saved in the other agents of this computer are listed too: using one copies it here.
import { api } from './api.js';
import { $, h, ask, toast } from './ui.js';
import { state, settings, set, onChange, saveVoices } from './state.js';

const KEYS = ['localVoiceEngine', 'localVoice', 'localSpeed', 'voiceDescription', 'zonosVoice', 'voiceDesign'];
const ENGINE = { supertonic: 'Supertonic', parler: 'Parler', chatterbox: 'Chatterbox', zonos: 'Zonos' };
let others = [];              // the voices of the other agents: [{agent, title, id, name, settings}]
let push = () => {};

/** A saved voice in a few words: "Zonos · Gaspard · age +1.5, deep 3". */
export function describeVoice(v) {
  const s = v.settings || {};
  const e = s.localVoiceEngine || 'supertonic';
  const parts = [ENGINE[e] || e];
  if (e === 'supertonic') parts.push(s.localVoice || 'F1');
  if (e === 'parler') parts.push(s.voiceDescription ? `“${s.voiceDescription}”` : 'its template voice');
  if (e === 'zonos') { parts.push(s.zonosVoice || 'the first voice'); if (s.voiceDesign) parts.push(s.voiceDesign); }
  if ((e === 'supertonic' || e === 'chatterbox') && Number(s.localSpeed) && Number(s.localSpeed) !== 1) parts.push(`speed ${s.localSpeed}`);
  return parts.join(' · ');
}
const current = () => { const s = settings(); return Object.fromEntries(KEYS.map((k) => [k, s[k]])); };
const mine = () => (state.agent && state.agent.voices) || [];
const picked = () => {
  const v = $('#voiceList').value;
  if (v.startsWith('other:')) return { other: true, voice: others[Number(v.slice(6))] };
  return { other: false, voice: mine().find((x) => x.id === v) };
};
/** The patterns that change to this voice. */
const usedBy = (id) => (state.agent ? state.agent.interactions.patterns.filter((p) => p.then.some((a) => a.do === 'voice' && a.voice === id)).map((p) => p.name) : []);

export function renderVoices() {
  const sel = $('#voiceList');
  const keep = sel.value;
  const elsewhere = others.filter((o) => o.agent !== state.agentId);
  sel.replaceChildren(
    ...(mine().length ? [] : [h('option', { value: '' }, 'None saved yet')]),
    ...mine().map((v) => h('option', { value: v.id }, v.name)),
    ...(elsewhere.length ? [h('optgroup', { label: 'From other agents' }, ...elsewhere.map((o) => h('option', { value: `other:${others.indexOf(o)}` }, `${o.name} (${o.title})`)))] : []));
  if (Array.from(sel.options).some((o) => o.value === keep)) sel.value = keep;
  paint();
}
function paint() {
  const { other, voice } = picked();
  $('#voiceAbout').textContent = voice ? describeVoice(voice) : 'Set a voice above, then save it under a name: a pattern can then change to it (Interactions, “Change voice”).';
  $('#voiceUse').disabled = !voice;
  $('#voiceDelete').disabled = !voice || other;
}

async function loadOthers() {
  try { others = await api.voices(); } catch { others = []; }
  renderVoices();
}

async function save() {
  const { other, voice } = picked();
  const name = await ask('Save this voice', 'A name for the voice as it is set now (the old sailor, the guide, calm)', voice && !other ? voice.name : '', 'Save');
  if (!name) return;
  const list = mine().slice();
  const same = list.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
  if (same >= 0 && !confirm(`Replace the saved voice "${list[same].name}" with the voice as it is set now?`)) return;
  if (same >= 0) list[same] = { ...list[same], settings: current() };     // the name stays as it was first written
  else list.push({ name, settings: current() });
  const saved = await saveVoices(list);
  if (!saved) return;
  const made = saved.find((v) => v.name.toLowerCase() === name.toLowerCase());
  renderVoices();
  if (made) { $('#voiceList').value = made.id; paint(); }
  toast(`Voice saved: ${name}.`);
}

function use() {
  const { voice } = picked();
  if (!voice) return;
  for (const k of KEYS) if (voice.settings[k] !== undefined) set(k, voice.settings[k]);
  push(0);
  toast(`${state.agent.settings.name || 'The agent'} now speaks with “${voice.name}”.`);
}

async function remove() {
  const { other, voice } = picked();
  if (!voice || other) return;
  const used = usedBy(voice.id);
  if (!confirm(`Delete the saved voice "${voice.name}"?${used.length ? `\n\nThese patterns change to it: ${used.join(', ')}. They will leave the voice as it is.` : ''}`)) return;
  if (await saveVoices(mine().filter((v) => v.id !== voice.id))) renderVoices();
}

/** pushSettings(delayMs): sends the settings to the conversation (main.js). */
export function initVoices(pushSettings) {
  push = pushSettings;
  $('#voiceList').addEventListener('change', paint);
  $('#voiceSave').addEventListener('click', () => save().catch((e) => toast(e.message, 'err')));
  $('#voiceUse').addEventListener('click', use);
  $('#voiceDelete').addEventListener('click', () => remove().catch((e) => toast(e.message, 'err')));
  onChange((what) => { if (what === 'agent') loadOthers(); });
  if (state.agent) loadOthers();
}
