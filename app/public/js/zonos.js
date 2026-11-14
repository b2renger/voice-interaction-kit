// The Zonos voice in the studio (Voice & timing): its voices, and the design sliders it offers (age, gender, pitch,
// texture, mood…). The design is kept as one line of text, "age +1.5, deep 3" (the setting voiceDesign, in
// persona.md): the sliders write it, and typing it moves the sliders.
// By default Zonos runs in this very window, on the graphics card (zonos-host.js); the first time, its model is
// downloaded (about 1 GB). With "mode": "server" in config.json it is a Zonos server on the computer instead.
import { api } from './api.js';
import { host, onHost, startZonosHost } from './zonos-host.js';
import { $, $$, h } from './ui.js';
import { state, settings, set, onChange } from './state.js';

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

const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
/** The few words next to "Voice", and the sentence under the fields. */
function words(info) {
  const designing = sliders.length ? 'Move a slider, then talk: the design goes with each sentence. Stay near the middle; far ends can break the voice.' : 'This Zonos offers no design sliders (its steering file is missing).';
  if (info.mode !== 'web') {
    return info.available ? ['server found', designing] : ['no server', `No Zonos server answers at ${info.url}: the default voice speaks instead. Start one, then check again.`];
  }
  if (info.engineFiles === false) return ['not installed', 'This copy of VIK does not carry the Zonos engine yet (see docs/ZONOS.md: "npm run zonos:engine" in the app folder). The default voice speaks instead.'];
  if (host.state === 'failed') return ['cannot run here', `Zonos cannot run on this computer: ${host.error}. The default voice speaks instead.`];
  if (host.state === 'ready' && info.available) return ['ready', designing];
  const pct = host.total ? ` ${Math.floor((100 * host.loaded) / host.total)} %` : '';
  return [`loading${pct}`, `Loading the Zonos voice${host.total ? ` (${mb(host.loaded)} of ${mb(host.total)})` : ''}… The first time, its model is downloaded: about 1 GB. Until it is ready, the default voice speaks.`];
}

let last = { mode: 'web', available: false, url: '', voices: [], sliders: [] };
function build(info) {
  last = info;
  sliders = info.sliders || [];
  [$('#zonosState').textContent, $('#zonosHelp').textContent] = words(info);
  $('#zonosVoices').replaceChildren(h('option', { value: '' }, 'The first voice'), ...(info.voices || []).map((v) => h('option', { value: v.label }, v.label)));
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
        // (a label that already names its two ends, "Read ↔ chatty", is not given them again)
        h('span', {}, sl.poles && !sl.label.includes('↔') ? `${sl.label}: ${sl.poles[0]} ↔ ${sl.poles[1]}` : sl.label, h('output', { 'data-for': sl.id }, '—')),
        input);
    })))));
  paint();
}

/** fresh: ask the server to look again. retry: also load the engine again if it failed ("Check again"). */
export async function loadZonos(fresh = false, retry = false, again = 0) {
  let info;
  try { info = await api.zonos(fresh); } catch { info = { mode: 'server', available: false, url: 'its address', voices: [], sliders: [] }; }
  build(info);
  // Zonos in this window: load it now (when the app carries its engine); its voices and sliders come once it is ready
  if (info.mode === 'web' && info.engineFiles !== false && (host.state === 'off' || (retry && host.state === 'failed'))) startZonosHost();
  // the engine is ready here but the server has not heard it yet (its "ready" travels on another connection): ask again
  if (info.mode === 'web' && host.state === 'ready' && !info.available && again < 10) setTimeout(() => loadZonos(true, false, again + 1), 300);
}

/** pushSettings(delayMs): sends the settings to the conversation (main.js). */
export function initZonos(pushSettings) {
  push = pushSettings;
  $('#zonosCheck').addEventListener('click', () => loadZonos(true, true));
  // the engine in this window: its loading shows as it goes; once ready (or failed), ask the server again
  let hostWas = host.state;
  onHost(() => {
    if (host.state !== hostWas) { hostWas = host.state; if (host.state === 'ready' || host.state === 'failed') { loadZonos(true); return; } }
    [$('#zonosState').textContent, $('#zonosHelp').textContent] = words(last);
  });
  $('#zonosReset').addEventListener('click', () => { set('voiceDesign', ''); push(0); });
  let shown = false;
  const refresh = () => {
    const s = settings();
    const on = s.engine === 'local' && s.localVoiceEngine === 'zonos';
    if (on && !shown) loadZonos(true);                 // asked each time the engine is chosen: the server may have started since
    shown = on;
    if (on) paint();
    // a saved voice of the agent is a Zonos one (a pattern may change to it): have the engine ready too
    if (!on && s.engine === 'local' && state.agent && (state.agent.voices || []).some((v) => v.settings.localVoiceEngine === 'zonos') && host.state === 'off') loadZonos(true);
  };
  onChange(refresh);
  refresh();
}
