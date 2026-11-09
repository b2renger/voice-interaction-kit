// The VIK studio: boots the views, binds the settings fields, opens agents, and runs the conversation
// (the voice core, common/voice-core.js). docs/DESIGN.md, 5.
import { $, $$, h, toast, ask, menu, seconds } from './ui.js';
import { api } from './api.js';
import { state, settings, valueOf, set, onChange, openAgent, lastAgent, flush, reloadAgent } from './state.js';
import { initTalk, banner } from './talk.js';
import { initKnowledge, renderKnowledge } from './knowledge.js';
import { initInteractions, renderInteractions } from './interactions.js';
import { initSettings, loadModels, paintSettings, showHealth, modelsInUse } from './settings.js';
import { initGuide, renderGuide, openGuide, refreshGuideTour } from './guide.js';
import { initTour, startTour, tourCard } from './tour.js';

// ———————————————————————————— the conversation ————————————————————————————
$('#geminiVoices').replaceChildren(...VoiceCore.GEMINI_VOICES.map(([n, c]) => h('option', { value: n }, `${n}, ${c}`)));
$('#localVoices').replaceChildren(...VoiceCore.LOCAL_VOICES.map((v) => h('option', { value: v }, v)));
const agent = VoiceCore.createVoiceAgent({ settings: settings() });
window.agent = agent;                                     // for the console and the tests
const { hub } = initTalk(agent);
initKnowledge();
initInteractions();
initSettings();

/** The settings go to the conversation after a short pause (a slider, a word typed): some reload a model. */
let pushTimer = 0;
function pushSettings(delay = 0) {
  clearTimeout(pushTimer);
  const run = () => {
    pushTimer = 0;
    const r = agent.update(settings());
    if (r && r.needsRestart) banner('warn', 'This setting needs a new start: click Stop, then Start.');
  };
  if (delay) pushTimer = setTimeout(run, delay); else run();
}

$('#start').addEventListener('click', () => {
  clearTimeout(pushTimer);
  flush();                                                // the agent's last edits, on disk before it decides
  banner('', '');
  $('#choices').replaceChildren();
  agent.update(settings());
  agent.start();
});
$('#stop').addEventListener('click', () => agent.stop());
$('#interrupt').addEventListener('click', () => agent.interrupt());
$('#sayForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#sayText').value.trim();
  if (!t) return;
  if (!agent.active) { banner('warn', 'Click Start first.'); return; }
  agent.sendText(t);
  $('#sayText').value = '';
});
$('#signalBtn').addEventListener('click', () => {
  const names = state.agent ? state.agent.interactions.patterns.filter((p) => p.when.kind === 'signal').map((p) => p.when.name) : [];
  $('#signalNames').replaceChildren(...names.map((n) => h('option', { value: n })));
  if (names.length && !$('#signalName').value) $('#signalName').value = names[0];
  const dlg = $('#signalDlg');
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    if (!agent.active) { banner('warn', 'Click Start first: a signal goes to a running conversation.'); return; }
    agent.sendSignal($('#signalName').value.trim(), $('#signalValue').value);
  }, { once: true });
  dlg.returnValue = '';
  dlg.showModal();
});
let engineName = '';
agent.on('start', (ev) => {
  const what = ev.engine !== 'local' ? 'Started with Gemini Live.' : engineName === 'mock' ? 'Started with the simulated engine: no models, a little script.' : `Started with ${modelsInUse()}.`;
  $('#trace').prepend(h('li', { class: 'event' }, what));
});

// ———————————————————————————— the views ————————————————————————————
const VIEWS = ['talk', 'persona', 'knowledge', 'interactions', 'voice', 'settings', 'guide'];
function show(view) {
  if (!VIEWS.includes(view)) view = 'talk';
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  for (const b of $$('.nav button[data-view]')) b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false');
  if (view === 'knowledge') renderKnowledge();
  if (view === 'interactions') renderInteractions();
  if (view === 'settings') paintSettings();
  if (view === 'guide') renderGuide();
  document.body.dataset.view = view;
  try { localStorage.setItem('vik.view', view); } catch { /* no storage */ }
}
for (const b of $$('.nav button[data-view]')) b.addEventListener('click', () => show(b.dataset.view));

// ———————————————————————————— the settings fields ————————————————————————————
const FMT = {
  creativity: (v) => Number(v).toFixed(1), localSpeed: (v) => `${Number(v).toFixed(2)}×`, volume: (v) => `${Math.round(v * 100)} %`,
  endSilenceMs: (v) => `${v} ms`, replyDelayMs: (v) => `${v} ms`,
  interruptAfterMs: (v) => (Number(v) === 0 ? 'at once' : `${v} ms`),
  fillerAfterMs: (v) => (Number(v) === 0 ? 'never' : `${v} ms`),
  awayAfterMs: (v) => (Number(v) === 0 ? 'never' : seconds(Number(v))),
};
function paintFields() {
  const s = settings();
  for (const el of $$('[data-k]')) {
    const v = valueOf(el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = String(v) === el.value;
    else if (document.activeElement !== el) el.value = v == null ? '' : v;   // never under the cursor
  }
  for (const out of $$('[data-out]')) { const k = out.dataset.out; out.textContent = FMT[k] ? FMT[k](s[k]) : s[k]; }
  for (const el of $$('[data-show]')) el.hidden = el.dataset.show !== s.engine;
  for (const el of $$('[data-voice]')) if (s.engine === 'local') el.hidden = !el.dataset.voice.split(' ').includes(s.localVoiceEngine || 'supertonic');
  $('#botName').textContent = s.name || 'Agent';
  $('#promptPreview').textContent = s.engine === 'gemini'
    ? VoiceCore.systemPrompt(s, 'gemini')
    : `${VoiceCore.systemPrompt(s, 'local')}\n\nAnd for each reply: the entries of the knowledge it found, and the instruction of the pattern that fired.`;
  if (!$('#view-settings').hidden) paintSettings();
}
for (const el of $$('[data-k]')) {
  const typing = el.tagName === 'TEXTAREA' || ['text', 'password', 'url', 'search'].includes(el.type);
  const live = el.type === 'range' || typing;
  el.addEventListener(live ? 'input' : 'change', () => {
    if (el.type === 'radio' && !el.checked) return;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
    set(el.dataset.k, v);
    pushSettings(typing ? 400 : el.type === 'range' ? 150 : 0);
  });
  if (live) el.addEventListener('change', () => { if (pushTimer) pushSettings(0); });   // released: right away
}

onChange((what, detail) => {
  if (what === 'agent') {
    paintFields();
    renderKnowledge();
    renderInteractions();
    pushSettings(0);
    hub.info();
    $('#agentSelect').value = state.agentId;
  } else if (what === 'setting') {
    paintFields();
    if (detail === 'name') hub.info();
    if (detail === 'name' || detail === 'title') refreshAgentTitle();
    if (['tables', 'interactions'].includes(detail) && settings().engine === 'gemini') pushSettings(600);
    if (['engine', 'llm', 'llmUrl', 'llmModel', 'localLlm', 'localAsr'].includes(detail)) { hub.info(); if (detail === 'llm' || detail === 'llmUrl') pushSettings(0); }
  } else if (what === 'saved') {
    const el = $('#saved');
    el.className = `saved${detail.status === 'error' ? ' err' : ''}`;
    el.textContent = detail.status === 'saving' ? 'Saving…' : detail.status === 'saved' ? 'Saved' : `Not saved: ${detail.error}`;
  }
});

// ———————————————————————————— the agents ————————————————————————————
async function loadAgents(select) {
  const list = await api.agents();
  $('#agentSelect').replaceChildren(...list.map((a) => h('option', { value: a.id }, a.title || a.name || a.id)));
  const id = list.some((a) => a.id === select) ? select : (list[0] && list[0].id);
  if (id) await openAgent(id);
  return list;
}
/** A new agent, opened on its persona (Manage → New agent…, and the tutorial's "Do it for me"). */
async function createAgent(name) {
  try { const a = await api.create({ name }); await loadAgents(a.id); show('persona'); } catch (err) { toast(err.message, 'err'); }
}
function refreshAgentTitle() {
  const o = $(`#agentSelect option[value="${CSS.escape(state.agentId)}"]`);
  if (o && state.agent) o.textContent = state.agent.settings.title || state.agent.settings.name || state.agentId;
}
$('#agentSelect').addEventListener('change', (e) => openAgent(e.target.value).catch((err) => toast(err.message, 'err')));
$('#agentMenuBtn').addEventListener('click', (e) => menu(e.currentTarget, [
  { label: 'New agent…', run: async () => {
    const name = await ask('A new agent', 'Its name, as people will call it', '', 'Create');
    if (name) await createAgent(name);
  } },
  { label: 'Duplicate', run: async () => {
    flush();
    try { const a = await api.create({ from: state.agentId }); await loadAgents(a.id); toast(`"${a.title}" is a copy you can change freely.`); } catch (err) { toast(err.message, 'err'); }
  } },
  'sep',
  { label: 'Export to a file', run: async () => {
    flush();
    try {
      const b = await api.exportBundle(state.agentId);
      const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })), download: `${state.agentId}.vik.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Exported: persona, knowledge and interactions, without this computer\'s settings or keys.');
    } catch (err) { toast(err.message, 'err'); }
  } },
  { label: 'Import a file…', run: () => $('#importFile').click() },
  { label: 'Add the example agents', run: async () => {
    try { const r = await api.create({ examples: true }); await loadAgents(state.agentId); toast(r.added.length ? `Added: ${r.added.join(', ')}.` : 'The examples are all here.'); } catch (err) { toast(err.message, 'err'); }
  } },
  'sep',
  { label: 'Delete this agent…', run: async () => {
    if (!confirm(`Delete "${state.agent.settings.title || state.agentId}"? Its folder goes to the agents' trash folder.`)) return;
    try { await api.remove(state.agentId); await loadAgents(''); } catch (err) { toast(err.message, 'err'); }
  } },
]));
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const bundle = JSON.parse(await f.text());
    const a = await api.create({ bundle });
    await loadAgents(a.id);
    toast(`Imported "${a.title}".`);
  } catch (err) { toast(err instanceof SyntaxError ? 'This file is not an agent (not JSON).' : err.message, 'err'); }
});

// ———————————————————————————— the server: models loading, engine, decision model ————————————————————————————
let wasLoading = false;
async function pollHealth() {
  let hl;
  try { hl = await api.health(); } catch { $('#engineLine').textContent = 'No local server: Gemini still works.'; return; }
  showHealth(hl);
  engineName = hl.engine || '';
  if (hl.error) banner('err', hl.error);
  if (hl.models !== 'ready') {
    wasLoading = true;
    if (!agent.active) banner('', (hl.status && hl.status.text) || 'Loading the models…', hl.status && hl.status.progress);
    setTimeout(pollHealth, 1000);
    return;
  }
  if (wasLoading && !agent.active && !hl.error) { banner('', 'The models are ready: click Start.'); wasLoading = false; loadModels(); }
  setTimeout(pollHealth, 15000);
}

// a table edited in a spreadsheet, a persona in a text editor: seen when the studio comes back to the front
window.addEventListener('focus', () => { reloadAgent().catch(() => {}); });

// ———————————————————————————— the guide and the tutorial ————————————————————————————
initGuide({ show, startTour, tourCard });
initTour({ show, agent, createAgent, openGuide, changed: refreshGuideTour });

// ———————————————————————————— boot ————————————————————————————
(async () => {
  let view = 'talk';
  try { view = localStorage.getItem('vik.view') || 'talk'; } catch { /* no storage */ }
  show(view);
  paintFields();
  try { await loadAgents(lastAgent()); } catch (e) { toast(`The agents could not be read: ${e.message}`, 'err'); }
  loadModels();
  pollHealth();
})();
