// The Zonos voice in the studio (Voice & timing): its server's voices, and the design sliders the server offers
// (age, gender, pitch, texture, mood…). The design is kept as one line of text, "age +1.5, deep 3" (the setting
// voiceDesign, in persona.md): the sliders write it, and typing it moves the sliders.
import { api } from './api.js';
import { $, $$, h } from './ui.js';
import { settings, set, onChange } from './state.js';

/** "age +1.5, deep 3" → {age: 1.5, deep: 3} (the same reading as the server's, engines/zonos.mjs). */
export function parseDesign(text) {
  const out = {};
  for (const part of String(text || '').split(/[,;\n]+/)) {
    const m = /^\s*([a-z_][\w.-]*?)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)\s*$/i.exec(part);
    if (m && Number(m[2]) !== 0) out[m[1].toLowerCase()] = Number(m[2]);
  }
  return out;
}
const signed = (v, bipolar) => (bipolar && v > 0 ? `+${v}` : String(v));
export function formatDesign(design, sliders = []) {
  const bipolar = (id) => { const s = sliders.find((x) => x.id === id); return !s || s.min < 0; };
  return Object.entries(design).filter(([, v]) => v).map(([k, v]) => `${k} ${signed(v, bipolar(k))}`).join(', ');
}

let sliders = [];
let push = () => {};

function paint() {
  const s = settings();
  const design = parseDesign(s.voiceDesign);
  for (const el of $$('#zonosDesign input[type=range]')) {
    const v = design[el.dataset.slider] || 0;
    if (document.activeElement !== el) el.value = String(v);
    const sl = sliders.find((x) => x.id === el.dataset.slider);
    $(`#zonosDesign output[data-for="${el.dataset.slider}"]`).textContent = v ? signed(v, sl && sl.min < 0) : '—';
  }
  // a voice kept in the agent that this server does not list still shows, as written
  const sel = $('#zonosVoices');
  if (s.zonosVoice && !Array.from(sel.options).some((o) => o.value === s.zonosVoice)) sel.append(h('option', { value: s.zonosVoice }, `${s.zonosVoice} (not on this server)`));
  if (document.activeElement !== sel) sel.value = s.zonosVoice || '';
}

function build(info) {
  sliders = info.sliders || [];
  $('#zonosState').textContent = info.available ? 'server found' : 'no server';
  $('#zonosHelp').textContent = info.available
    ? (sliders.length ? 'Move a slider, then talk: the design goes with each sentence. Stay near the middle; far ends can break the voice.' : 'This Zonos server offers no design sliders (it was started without its steering file).')
    : `No Zonos server answers at ${info.url}: the default voice speaks instead. Start one, then check again.`;
  $('#zonosVoices').replaceChildren(h('option', { value: '' }, 'The server’s first voice'), ...(info.voices || []).map((v) => h('option', { value: v.label }, v.label)));
  const groups = [];
  for (const sl of sliders) { let g = groups.find((x) => x.name === sl.group); if (!g) groups.push(g = { name: sl.group, items: [] }); g.items.push(sl); }
  $('#zonosDesign').replaceChildren(...groups.map((g) => h('div', { class: 'design-group' },
    h('h3', {}, g.name || 'Design'),
    h('div', { class: 'grid2' }, ...g.items.map((sl) => {
      const input = h('input', { type: 'range', min: String(sl.min), max: String(sl.max), step: '0.25', 'data-slider': sl.id, title: sl.effect || '' });
      input.addEventListener('input', () => {
        const design = parseDesign(settings().voiceDesign);
        const v = Number(input.value);
        if (v) design[sl.id] = v; else delete design[sl.id];
        set('voiceDesign', formatDesign(design, sliders));
        push(150);
      });
      input.addEventListener('change', () => push(0));
      return h('label', { class: 'field' },
        h('span', {}, sl.poles ? `${sl.label}: ${sl.poles[0]} ↔ ${sl.poles[1]}` : sl.label, h('output', { 'data-for': sl.id }, '—')),
        input);
    })))));
  paint();
}

export async function loadZonos(fresh = false) {
  try { build(await api.zonos(fresh)); } catch { build({ available: false, url: 'its address', voices: [], sliders: [] }); }
}

/** pushSettings(delayMs): sends the settings to the conversation (main.js). */
export function initZonos(pushSettings) {
  push = pushSettings;
  $('#zonosCheck').addEventListener('click', () => loadZonos(true));
  $('#zonosReset').addEventListener('click', () => { set('voiceDesign', ''); push(0); });
  let shown = false;
  const refresh = () => {
    const s = settings();
    const on = s.engine === 'local' && s.localVoiceEngine === 'zonos';
    if (on && !shown) loadZonos(true);                 // asked each time the engine is chosen: the server may have started since
    shown = on;
    if (on) paint();
  };
  onChange(refresh);
  refresh();
}
