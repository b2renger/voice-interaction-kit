// Settings → People: the people the agent recognizes by their voice. Each one types their name and reads a text
// once, with this microphone; the server keeps their voiceprint (512 numbers), never the recording.
// The patterns can then be kept for some of them (Interactions → "Who"), and the language model knows who speaks.
import { $, h, toast } from './ui.js';
import { api } from './api.js';
import { settings } from './state.js';

/** Texts to read: a little over 15 s each, with many different sounds. */
const TEXTS = {
  fr: 'Le vent du nord soufflait sur la petite ville. Les enfants jouaient près de la fontaine, pendant que le boulanger sortait du four des baguettes dorées. Au loin, un train traversait la vallée, et chacun s’arrêtait un instant pour l’écouter passer. Ce soir, nous irons voir la mer, puis nous rentrerons tranquillement à la maison.',
  en: 'The north wind was blowing over the little town. Children were playing by the fountain, while the baker took golden loaves out of the oven. Far away, a train crossed the valley, and everyone stopped for a moment to listen to it. Tonight we will go and see the sea, then we will quietly come back home.',
};
const MAX_S = 45;          // a recording stops by itself after this
const TEST_S = 4;          // "Who is speaking?" listens this long

export const people = { list: [] };
const listeners = new Set();
/** Called with the list of people each time it changes (the pattern editor's "Who"). */
export function onPeople(fn) { listeners.add(fn); }
async function refresh(list) {
  people.list = list || (await api.people().catch(() => ({ people: [] }))).people;
  for (const fn of listeners) fn(people.list);
  render();
}

/** The microphone at 16 kHz, as the conversation hears it; stop() → Int16Array. */
async function record(onTick) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: settings().micAutoGain !== false, channelCount: 1 } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const sink = ctx.createGain(); sink.gain.value = 0;
  const down = VoiceCore._.makeDownsampler(ctx.sampleRate, 16000);
  const parts = []; let n = 0;
  proc.onaudioprocess = (e) => { const b = down(e.inputBuffer.getChannelData(0)); parts.push(Float32Array.from(b)); n += b.length; onTick(n / 16000); };
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  return {
    async stop() {
      proc.onaudioprocess = null;
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
      const all = new Float32Array(n); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      return VoiceCore._.floatToInt16(all);
    },
  };
}

let rec = null;            // the recording in progress: {kind: 'add'|'test', stop}
let agentRef = null;
const live = () => agentRef && agentRef.active;

function render() {
  const busy = !!rec;
  $('#peopleList').replaceChildren(...people.list.map((p) => h('li', {},
    h('b', {}, p.name), h('span', { class: 'hint' }, `${p.seconds} s of voice`),
    h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => removePerson(p) }, 'Delete'))));
  $('#peopleEmpty').hidden = people.list.length > 0;
  const name = $('#personName').value.trim();
  $('#recordPerson').textContent = rec && rec.kind === 'add' ? 'Stop' : 'Record';
  $('#recordPerson').disabled = (!name && !rec) || live() || (busy && rec.kind !== 'add');
  $('#testPerson').disabled = !people.list.length || live() || busy;
  $('#readText').textContent = TEXTS[$('#personText').value] || TEXTS.en;
  if (live() && !busy) status('Stop the conversation to record someone: the agent would hear the text read.');
}
const status = (t) => { $('#recordStatus').textContent = t; };

let opening = false;   // the microphone is being opened: a second click must not open another one

async function toggleRecord() {
  if (rec) { finish(); return; }
  const name = $('#personName').value.trim();
  if (!name || opening) return;
  opening = true;
  try {
    const r = await record((sec) => { status(`Recording ${name}… read the text aloud. ${Math.floor(sec)} s`); if (sec >= MAX_S) finish(); });
    rec = { kind: 'add', name, stop: r.stop };
  } catch (e) { status(`No microphone: ${e.message}`); } finally { opening = false; }
  render();
}

async function finish() {
  const r = rec; if (!r) return;
  rec = null;
  const pcm = await r.stop();
  render();
  if (r.kind === 'add') {
    status(`Saving ${r.name}…`);
    try {
      const j = await api.addPerson(r.name, pcm);
      status(`${j.person.name} is recorded (${j.person.seconds} s of voice). Try "Who is speaking?".`);
      $('#personName').value = '';
      await refresh(j.people);
    } catch (e) { status(e.message); }
  } else {
    try {
      const w = await api.identify(pcm);
      status(w.name ? `${w.name} is speaking (${Math.round(w.score * 100)} %).` : `Someone not recognized${w.closest ? ` (the closest: ${w.closest}, ${Math.round(w.score * 100)} %)` : ''}.`);
    } catch (e) { status(e.message); }
  }
}

async function test() {
  if (rec || opening) return;
  opening = true;
  try {
    const r = await record((sec) => { status(`Listening… say a sentence. ${Math.max(0, Math.ceil(TEST_S - sec))} s`); if (sec >= TEST_S) finish(); });
    rec = { kind: 'test', stop: r.stop };
  } catch (e) { status(`No microphone: ${e.message}`); } finally { opening = false; }
  render();
}

async function removePerson(p) {
  if (!confirm(`Delete ${p.name}'s voice? The agent will no longer recognize them.`)) return;
  try { await refresh((await api.removePerson(p.id)).people); toast(`${p.name} deleted.`); } catch (e) { toast(e.message); }
}

export function initPeople(agent) {
  agentRef = agent;
  $('#personName').addEventListener('input', render);
  $('#personText').addEventListener('change', render);
  $('#recordPerson').addEventListener('click', toggleRecord);
  $('#testPerson').addEventListener('click', test);
  agent.on('state', () => { if (!live() && $('#recordStatus').textContent.startsWith('Stop the conversation')) status(''); render(); });
  refresh();
}
