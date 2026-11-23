// The agent's saved voices (Voice & timing): the voice being set (its engine, its voice, its speed, Zonos's voice
// and design) kept under a name. A saved voice can be given back to the agent as its
// own voice ("Use"), or used by a pattern ("Change voice", Interactions): the agent then answers in it from that
// reply on. They live with the agent (voices.json), and travel with it: duplicate, export, import.
// The voices saved in the other agents of this computer are listed too: using one copies it here.
// Listen: a sentence in a voice (the one being set, or a saved one), in French or English, without a conversation
// (POST /api/voice/test). Persona → Voice chooses among the saved voices.
import { api } from './api.js';
import { $, h, ask, toast } from './ui.js';
import { state, settings, set, onChange, saveVoices } from './state.js';

const KEYS = ['localVoiceEngine', 'localVoice', 'localSpeed', 'zonosVoice', 'voiceDesign'];
const ENGINE = { supertonic: 'Supertonic', chatterbox: 'Chatterbox', zonos: 'Zonos' };
let others = [];              // the voices of the other agents: [{agent, title, id, name, settings}]
let push = () => {};

/** A saved voice in a few words: "Zonos · Gaspard · age +1.5, deep 3". */
export function describeVoice(v) {
  const s = v.settings || {};
  const e = ENGINE[s.localVoiceEngine] ? s.localVoiceEngine : 'supertonic';   // Parler (removed): Supertonic
  const parts = [ENGINE[e] || e];
  if (e === 'supertonic') parts.push(s.localVoice || 'F1');
  if (e === 'zonos') { parts.push(s.zonosVoice || 'the first voice'); if (s.voiceDesign) parts.push(s.voiceDesign); }
  if ((e === 'supertonic' || e === 'chatterbox') && Number(s.localSpeed) && Number(s.localSpeed) !== 1) parts.push(`speed ${s.localSpeed}`);
  return parts.join(' · ');
}
const current = () => { const s = settings(); return Object.fromEntries(KEYS.map((k) => [k, s[k]])); };
const mine = () => (state.agent && state.agent.voices) || [];
/** The patterns that change to this voice. */
const usedBy = (id) => (state.agent ? state.agent.interactions.patterns.filter((p) => p.then.some((a) => a.do === 'voice' && a.voice === id)).map((p) => p.name) : []);

/** Is this saved voice the agent's voice now (the same engine, voice, speed, design)? */
function inUse(v) {
  const s = settings();
  const norm = (k, x) => (k === 'localSpeed' ? Number(x || 1) : k === 'localVoiceEngine' ? (x || 'supertonic') : String(x == null ? '' : x).trim());
  return KEYS.every((k) => norm(k, (v.settings || {})[k]) === norm(k, s[k]));
}

/** The saved voices, as a list (Voice & timing) and as the choice of the agent's voice (Persona). */
export function renderVoices() {
  const elsewhere = others.filter((o) => o.agent !== state.agentId);
  const row = (v, other) => h('li', { [other ? 'data-other' : 'data-saved']: other ? String(others.indexOf(v)) : v.id, class: inUse(v) ? 'current' : '' },
    h('div', { class: 'what' }, h('b', {}, other ? `${v.name} (${v.title})` : v.name), h('span', {}, describeVoice(v)), inUse(v) ? h('em', {}, 'in use') : ''),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn quiet', onclick: () => listen(v.settings) }, 'Listen'),
      h('button', { type: 'button', class: 'btn', disabled: inUse(v), title: 'Give the agent this voice', onclick: () => use(v) }, 'Use'),
      other ? '' : h('button', { type: 'button', class: 'btn quiet danger', onclick: () => remove(v).catch((e) => toast(e.message, 'err')) }, 'Delete')));
  $('#voiceRows').replaceChildren(
    ...mine().map((v) => row(v, false)),
    ...(elsewhere.length ? [h('li', { class: 'from' }, 'From other agents (Use copies the voice here)'), ...elsewhere.map((o) => row(o, true))] : []));
  $('#voiceAbout').textContent = mine().length ? '' : 'None saved yet. Set a voice above, listen to it, then save it under a name: it shows here, Persona offers it, and a pattern can change to it (Interactions, “Change voice”).';
  // Persona → Voice: the saved voices; none matching: the voice set in Voice & timing
  const pick = $('#personaVoice');
  const current = mine().find(inUse);
  pick.replaceChildren(
    ...(current ? [] : [h('option', { value: '' }, `As set in Voice & timing: ${describeVoice({ settings: settings() })}`)]),
    ...mine().map((v) => h('option', { value: v.id }, `${v.name}: ${describeVoice(v)}`)));
  pick.value = current ? current.id : '';
}

async function loadOthers() {
  try { others = await api.voices(); } catch { others = []; }
  renderVoices();
}

/** A sample sentence in this voice (French or English), without a conversation. */
let listening = false;
async function listen(voiceSettings, language = $('#voiceLang').value, text = $('#voiceText').value.trim()) {
  const note = (t) => { $('#voiceStatus').textContent = t; };
  if (window.agent && (window.agent.active || window.agent.state === 'connecting')) { note('Stop the conversation to listen to a voice: the conversation uses it.'); return; }
  if (listening) return;
  listening = true;
  note('Preparing the voice… (a voice used for the first time loads first)');
  try {
    const blob = await api.testVoice({ ...current(), ...voiceSettings }, language, text);
    const audio = new Audio(URL.createObjectURL(blob));
    audio.volume = Math.max(0, Math.min(1, Number(settings().volume) || 1));
    note(`Listening (${language === 'fr' ? 'French' : 'English'}).`);
    audio.addEventListener('ended', () => { note(''); URL.revokeObjectURL(audio.src); });
    await audio.play();
  } catch (e) { note(`Could not listen to it: ${e.message}`); } finally { listening = false; }
}

async function save() {
  const was = mine().find(inUse);
  const name = await ask('Save this voice', 'A name for the voice as it is set now (the old sailor, the guide, calm)', was ? was.name : '', 'Save');
  if (!name) return;
  const list = mine().slice();
  const same = list.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
  if (same >= 0 && !confirm(`Replace the saved voice "${list[same].name}" with the voice as it is set now?`)) return;
  if (same >= 0) list[same] = { ...list[same], settings: current() };     // the name stays as it was first written
  else list.push({ name, settings: current() });
  if (!(await saveVoices(list))) return;
  renderVoices();
  toast(`Voice saved: ${name}.`);
}

function use(voice) {
  if (!voice) return;
  for (const k of KEYS) if (voice.settings[k] !== undefined) set(k, voice.settings[k]);
  push(0);
  renderVoices();
  toast(`${state.agent.settings.name || 'The agent'} now speaks with “${voice.name}”.`);
}

async function remove(voice) {
  const used = usedBy(voice.id);
  if (!confirm(`Delete the saved voice "${voice.name}"?${used.length ? `\n\nThese patterns change to it: ${used.join(', ')}. They will leave the voice as it is.` : ''}`)) return;
  if (await saveVoices(mine().filter((v) => v.id !== voice.id))) renderVoices();
}

/** pushSettings(delayMs): sends the settings to the conversation (main.js). */
export function initVoices(pushSettings) {
  push = pushSettings;
  $('#voiceSave').addEventListener('click', () => save().catch((e) => toast(e.message, 'err')));
  $('#voiceListen').addEventListener('click', () => listen({}));
  $('#voiceText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); listen({}); } });
  $('#personaVoice').addEventListener('change', (e) => use(mine().find((v) => v.id === e.target.value)));
  // Persona → Listen: the agent's voice, in its language when it is French or English
  $('#personaListen').addEventListener('click', () => listen({}, settings().language === 'fr' ? 'fr' : 'en', ''));
  onChange((what, detail) => {
    if (what === 'agent') { $('#voiceLang').value = settings().language === 'fr' ? 'fr' : 'en'; loadOthers(); }
    else if (what === 'setting' && (KEYS.includes(detail) || detail === 'voices')) renderVoices();
  });
  if (state.agent) loadOthers();
}
