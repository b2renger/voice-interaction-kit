// Settings: this computer's engine, models and language model (docs/DESIGN.md, 4), and what the server says
// about itself (the decision model, the clients' address, the agents' folder).
import { $, $$, h, toast } from './ui.js';
import { api } from './api.js';
import { state, settings, setMachine, onChange } from './state.js';

/** Ready-made addresses (the same list as app/src/llm.mjs): [name, url, needs a key]. */
const SERVICES = [
  ['Ollama, on this computer', 'http://localhost:11434/v1', false],
  ['LM Studio, on this computer', 'http://localhost:1234/v1', false],
  ['OpenAI', 'https://api.openai.com/v1', true],
  ['Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', true],
  ['Mistral', 'https://api.mistral.ai/v1', true],
  ['OpenRouter', 'https://openrouter.ai/api/v1', true],
];
let farms = [];
let farmPolling = 0;

const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
/** "Qwen3 1.7B — balanced (default), downloaded" */
function modelOption(c) {
  const where = c.here ? ', downloaded' : c.here === false ? `, ${size(c.size)} to download${c.p2pOnly ? ' (peer to peer)' : ''}` : '';
  const o = h('option', { value: c.default ? '' : c.src }, `${c.label}${c.default ? ' (default)' : ''}${where}`);
  o.dataset.short = c.label.split(' — ')[0];
  return o;
}

export async function loadModels() {
  try {
    const c = await api.models();
    $('#asrModels').replaceChildren(...c.asr.map(modelOption));
    $('#llmLocal').replaceChildren(...c.llm.map(modelOption));
    paintSettings();
  } catch { /* no models: the simulated engine, or the engine failed (its error shows in the banner) */ }
}

/** What runs, in a few words: "Whisper small, Qwen3 1.7B, Supertonic". */
export function modelsInUse() {
  const s = settings();
  const short = (sel) => { const o = $(sel).selectedOptions[0]; return o && o.dataset.short; };
  let brain = short('#llmLocal') || 'the local model';
  if (s.llm === 'farm') { const f = farms.find((x) => x.url === s.llmUrl); brain = `LLM farm ${f ? f.name : s.llmUrl} (${s.llmModel})`; }
  if (s.llm === 'service') { let host = s.llmUrl; try { host = new URL(s.llmUrl).host; } catch { /* as typed */ } brain = `${s.llmModel} at ${host}`; }
  const voice = { supertonic: 'Supertonic', parler: 'Parler', chatterbox: 'Chatterbox', zonos: 'Zonos' }[s.localVoiceEngine] || 'Supertonic';
  return [short('#asrModels'), brain, voice].filter(Boolean).join(', ');
}

/** The parts of the view that depend on the choices: which language model, the service preset, the farm list. */
export function paintSettings() {
  const s = settings();
  const llm = s.llm || 'local';
  for (const el of $$('[data-llm]')) el.hidden = !el.dataset.llm.split(' ').includes(llm);
  for (const sel of ['#asrModels', '#llmLocal']) { const el = $(sel); if (el.options.length && el.selectedIndex < 0) el.value = ''; }
  const preset = SERVICES.findIndex(([, url]) => url === s.llmUrl);
  $('#servicePreset').value = preset >= 0 ? String(preset) : 'other';
  $('#keyLabel').textContent = llm === 'farm' ? 'Farm password, if it has one' : (preset >= 0 && !SERVICES[preset][2] ? 'Key (none needed)' : 'Key');
  if (llm === 'farm') startFarms(); else stopFarms();
  renderFarms();
}

// — LLM farms on the network (LlmOnLan) —
function startFarms() { if (!farmPolling) { pollFarms(); farmPolling = setInterval(() => pollFarms(), 3000); } }
function stopFarms() { clearInterval(farmPolling); farmPolling = 0; }
async function pollFarms(add) {
  try {
    const r = await api.farms(add);
    const before = JSON.stringify(farms);
    farms = r.farms || [];
    if (r.error) toast(r.error, 'err');
    if (r.added) {
      const f = farms.find((x) => x.id === r.added);
      const m = f && (f.models.find((x) => x.default) || f.models[0]);
      if (m) { setMachine({ llm: 'farm', llmUrl: f.url, llmModel: m.id }); toast(`Using ${f.name}.`); }
    }
    if (JSON.stringify(farms) !== before || r.added) renderFarms();
  } catch { /* the server is restarting */ }
}
function renderFarms() {
  const s = settings();
  const items = [];
  for (const f of farms) {
    for (const m of f.models) {
      const on = s.llm === 'farm' && f.url === s.llmUrl && m.id === s.llmModel;
      items.push(h('label', {},
        h('input', { type: 'radio', name: 'farm', checked: on, onchange: () => setMachine({ llm: 'farm', llmUrl: f.url, llmModel: m.id }) }),
        h('span', {}, h('b', {}, f.name), ` ${m.underlying || m.id}`,
          h('span', { class: 'sub' }, `${f.slots ? `, ${f.clients || 0} of ${f.slots} places taken` : ''}${f.requiresKey ? ', needs a password' : ''}${f.healthy ? '' : ', not answering'}`))));
    }
  }
  $('#farmList').replaceChildren(...items);
  const chosen = farms.some((f) => f.url === s.llmUrl);
  $('#farmStatus').textContent = farms.length
    ? (s.llm === 'farm' && s.llmUrl && !chosen ? `The farm at ${s.llmUrl} is not heard right now: replies will fail if it is off.` : 'Farms heard on this network:')
    : 'Listening for LLM farms on this network. A farm shares its model once its Settings → Share compute is on. On another network or subnet, add it by its address.';
}

export function initSettings() {
  $('#servicePreset').replaceChildren(...SERVICES.map(([name], i) => h('option', { value: String(i) }, name)), h('option', { value: 'other' }, 'Another address'));
  $('#servicePreset').addEventListener('change', (e) => {
    const p = SERVICES[Number(e.target.value)];
    if (p) setMachine({ llmUrl: p[1] });
    paintSettings();
  });
  $('#farmAdd').addEventListener('click', () => { const a = $('#farmAddress').value.trim(); if (a) { toast(`Asking ${a}…`); pollFarms(a); } });
  $('#farmAddress').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#farmAdd').click(); } });
  $('#listModels').addEventListener('click', async () => {
    const s = settings();
    $('#listModelsOut').textContent = 'Asking…';
    try {
      const r = await api.llmModels(s.llmUrl, s.llmKey);
      if (r.error) throw new Error(r.error);
      $('#llmModelList').replaceChildren(...r.models.map((m) => h('option', { value: m })));
      $('#listModelsOut').textContent = r.models.length ? `${r.models.length} models: pick one in the Model field.` : 'It serves no model.';
    } catch (e) { $('#listModelsOut').textContent = e.message; }
  });
  $('#copyAddr').addEventListener('click', () => { navigator.clipboard.writeText($('#clientsAddr').textContent).then(() => toast('Copied.'), () => toast('Copy it by hand.', 'err')); });
}

/**
 * The mic meter (Settings, Microphone): the level after the gain, the gate's threshold as a line, the bar coloured
 * while the gate is open. Drawn only while Settings is shown.
 */
export function initMicMeter(agent) {
  const meter = $('#micMeter'); const lvl = meter.querySelector('.lvl'); const thr = meter.querySelector('.thr'); const text = $('#micMeterText');
  const pos = (db) => `${Math.max(0, Math.min(100, ((db + 80) / 70) * 100))}%`;   // the Gate slider's scale, -80 to -10 dB
  let shown = -120;
  const frame = () => {
    requestAnimationFrame(frame);
    if ($('#view-settings').hidden) return;
    const m = agent.mic(); const s = settings();
    shown = m.db > shown ? m.db : shown - 1.2;                 // fast up, slow down: readable
    const off = Number(s.micGate) <= -80;
    lvl.style.width = pos(shown);
    thr.style.left = pos(Number(s.micGate)); thr.hidden = off;
    meter.classList.toggle('open', m.open);
    text.textContent = m.db <= -120 && !['listening', 'hearing', 'thinking', 'speaking'].includes(agent.state) ? 'Click Start to see the microphone.'
      : `${Math.round(Math.max(shown, -120))} dB${off ? '' : m.open ? ': the gate is open, the agent hears' : ': the gate is closed, the agent hears silence'}`;
  };
  requestAnimationFrame(frame);
}

/** Settings → OSC: what arrives on the port oscIn, during a conversation (the events "osc.in"). */
export function initOscIn(agent) {
  const list = $('#oscInList'); const text = $('#oscInText');
  const seen = new Map();          // address → its latest value, in the order they first came
  let failed = '';
  const render = () => {
    const port = String(settings().oscIn || '').trim();
    text.textContent = !port ? 'Empty: VIK does not listen. Sensors and buttons send to this computer\'s address, on this port.'
      : failed || (!agent.active ? `VIK listens on port ${port} during a conversation: click Start.`
        : seen.size ? `Listening on port ${port}. The agent knows these values:` : `Listening on port ${port}. Nothing has arrived yet.`);
    list.replaceChildren(...[...seen].map(([address, value]) => h('li', {}, h('code', {}, address), h('span', {}, value || '(no value)'))));
  };
  agent.on('osc.in', (ev) => { if (seen.size < 30 || seen.has(ev.address)) seen.set(ev.address, ev.args.map(String).join(' ')); render(); });
  agent.on('error', (ev) => { if (ev.code === 'osc') { failed = ev.message; render(); } });
  agent.on('state', (ev) => { if (ev.state === 'connecting') { seen.clear(); failed = ''; } render(); });
  onChange(() => { failed = ''; render(); });
  render();
}

/** What the server says about itself (polled while models load). */
export function showHealth(hl) {
  $('#clientsAddr').textContent = hl.wsUrl || `ws://${location.host}/events`;
  $('#agentsDir').textContent = hl.agentsDir ? `The agents are files in ${hl.agentsDir} (menu Files → Open agents folder).` : '';
  $('#matcherLine').textContent = hl.matcherModel
    ? `${hl.matcher}: understands paraphrases and other languages.`
    : hl.engine === 'mock' ? 'Words: the simulated engine compares the words only.' : 'Words, for now: EmbeddingGemma is not loaded (Files → Download all models). Close wordings only.';
  $('#matcherDot').classList.toggle('on', !!hl.matcherModel);
  const engine = hl.engine === 'mock' ? 'Simulated engine' : hl.engine === 'qvac' ? 'QVAC engine' : 'No local engine';
  $('#engineLine').replaceChildren(h('b', {}, engine), h('br'), state.agent ? `Decides with ${hl.matcher || 'Words'}` : '');
}
