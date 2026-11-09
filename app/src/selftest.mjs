// npm run selftest — checks that QVAC works on THIS machine, without a browser or a microphone:
//   1. loads the three models (the first launch downloads them, ~1.5 GB);
//   2. has the local voice say a sentence (→ selftest-voice.wav);
//   3. has speech recognition listen back to it;
//   4. asks Smart Turn (the end-of-turn model) whether that sentence is finished;
//   5. asks the language model for a reply;
//   6. has the voice say the reply (→ selftest-reply.wav);
// and prints the time taken by each step.
import { writeFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createQvacEngine } from './engines/qvac.mjs';
import { systemPrompt } from './text.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig(join(APP, 'config.json'));
const settings = {
  ...config.defaults,
  name: 'Ada',
  persona: 'You are a warm museum guide.',
  shortAnswers: true,
  uiTools: false,
};
// The test sentence follows the language set in config.json (a French one when it is "fr").
const PHRASE = settings.language === 'fr' ? 'Bonjour, à quelle heure ferme le musée aujourd\'hui ?' : 'Hello, what time does the museum close today?';
const results = [];
// ok: true (✔), false (✖, the self-test fails) or 'warn' (⚠, an optional part is missing: the self-test still passes)
const step = (name, ms, ok, detail = '') => { results.push({ name, ms, ok, detail }); console.log(`${ok === 'warn' ? '⚠' : ok ? '✔' : '✖'} ${name}${ms != null ? ` — ${(ms / 1000).toFixed(2)} s` : ''}${detail ? `\n    ${detail}` : ''}`); };

function wav(file, pcm, rate) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}
function resample(pcm, from, to) {
  const ratio = from / to;
  const out = new Int16Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio; const k = Math.floor(x); const f = x - k;
    out[i] = Math.round((pcm[k] || 0) * (1 - f) + (pcm[k + 1] || 0) * f);
  }
  return out;
}
async function say(engine, text) {
  const t0 = Date.now();
  const tts = engine.speak({ voice: settings.localVoice, speed: settings.localSpeed, language: settings.language });
  tts.write(text);
  tts.end();
  const parts = []; let rate = 44100; let first = null;
  for await (const f of tts.frames) { if (first === null) first = Date.now() - t0; parts.push(f.pcm); rate = f.sampleRate; }
  const n = parts.reduce((a, p) => a + p.length, 0);
  const pcm = new Int16Array(n); let o = 0;
  for (const p of parts) { pcm.set(p, o); o += p.length; }
  return { pcm, rate, first, total: Date.now() - t0 };
}

console.log(`QVAC self-test — ${process.platform} ${process.arch}, Node ${process.versions.node}\n`);
let engine;
try {
  engine = await createQvacEngine(config, (m) => console.log('  ' + m));
} catch (e) { step('QVAC SDK', null, false, e.message); process.exit(1); }

try {
  const t0 = Date.now();
  let last = '';
  await engine.prepare(settings, (p) => {
    const line = `  loading: ${p.stage} ${typeof p.progress === 'number' ? Math.round(p.progress) + ' %' : ''}`;
    if (line !== last) { last = line; if (process.stdout.isTTY) process.stdout.write(`\r${line}        `); }
  });
  if (process.stdout.isTTY) process.stdout.write('\n');
  step('loading the three models', Date.now() - t0, true, `${config.models.asr.src} · ${config.models.llm.src} · ${config.models.tts.src}`);
} catch (e) { step('loading the models', null, false, e.message + '\n    (see the README: P2P network blocked? Vulkan up to date on Windows?)'); process.exit(1); }

// 2. the voice
let voice;
try {
  voice = await say(engine, PHRASE);
  wav(join(APP, 'selftest-voice.wav'), voice.pcm, voice.rate);
  step('voice: say a sentence', voice.total, voice.pcm.length > voice.rate * 0.5, `first frame after ${(voice.first / 1000).toFixed(2)} s, ${(voice.pcm.length / voice.rate).toFixed(1)} s of audio at ${voice.rate} Hz → selftest-voice.wav`);
} catch (e) { step('voice', null, false, e.message); }

// 3. speech recognition listens back to the sentence
let heard = '';
if (voice) {
  try {
    const pcm16k = resample(voice.pcm, voice.rate, 16000);
    const t0 = Date.now();
    let endAt = null; let errorMsg = '';
    const asr = engine.openAsr({ endSilenceMs: 700, startSensitivity: 'high', endSensitivity: 'high' }, {
      onVad: () => {}, onText: (t) => { heard += t; }, onEndOfTurn: () => { endAt = Date.now(); }, onError: (e) => { errorMsg = e.message; },
    });
    const chunk = 1600;
    const silence = new Int16Array(16000 * 2);
    const all = new Int16Array(pcm16k.length + silence.length);
    all.set(pcm16k); all.set(silence, pcm16k.length);
    for (let i = 0; i < all.length; i += chunk) {
      const c = all.subarray(i, i + chunk);
      asr.write(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
      await new Promise((r) => setTimeout(r, 25));
    }
    const until = Date.now() + 20000;
    while ((!endAt || !heard.trim()) && !errorMsg && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    asr.close();
    const words = PHRASE.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']{4,}/g) || [];
    const found = words.filter((w) => heard.toLowerCase().includes(w)).length;
    step('recognition: listen back to the sentence', Date.now() - t0, !!heard.trim() && found >= Math.ceil(words.length / 2), `heard: "${heard.trim() || '(nothing)'}"${endAt ? '' : ' — no end of turn detected'}${errorMsg ? ' — ' + errorMsg : ''}`);
  } catch (e) { step('speech recognition', null, false, e.message); }
}

// 4. end of turn: Smart Turn says whether the sentence (+ 300 ms of silence) is finished
if (voice) {
  const name = 'end of turn: Smart Turn';
  try {
    const c = (config.turn && config.turn.smartTurn) || {};
    const model = String(c.model || 'models/smart-turn-v3.2-cpu.onnx');
    const { createSmartTurn } = await import('./turn/smart-turn.mjs');
    let why = '';
    const t0 = Date.now();
    const st = createSmartTurn({
      modelPath: isAbsolute(model) ? model : join(APP, model),
      threads: Number(c.threads) || 1,
      threshold: c.threshold == null ? 0.5 : Number(c.threshold),
      log: (m) => { why = m; },
    });
    if (!(await st.ready())) {
      step(name, null, 'warn', `${why || 'Smart Turn is unavailable here.'}\n    (optional: without it, turns end on silence only — npm install adds onnxruntime-node)`);
    } else {
      const loadMs = Date.now() - t0;
      const pcm16k = resample(voice.pcm, voice.rate, 16000);
      const audio = new Float32Array(pcm16k.length + 16000 * 0.3);          // + 300 ms of silence
      for (let i = 0; i < pcm16k.length; i++) audio[i] = pcm16k[i] / 32768;
      const r = await st.predict(audio);
      const ok = Number.isFinite(r.probability) && r.probability >= 0 && r.probability <= 1;
      step(name, r.ms, ok, `probability that the sentence is finished: ${r.probability.toFixed(3)} (${r.complete ? 'complete' : 'not finished'}), inference ${r.ms} ms, model loaded in ${(loadMs / 1000).toFixed(2)} s`);
      await st.close();
    }
  } catch (e) { step(name, null, false, e.message); }
}

// 5. the language model
let reply = '';
try {
  const t0 = Date.now();
  const g = engine.generate({ system: systemPrompt(settings, 'local'), history: [{ role: 'user', content: heard.trim() || PHRASE }], temperature: 0.7, onDelta: (d) => { reply += d; } });
  const r = await g.done;
  const clean = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  step('model: reply', Date.now() - t0, clean.length > 0, `first word after ${((r.firstTokenMs || 0) / 1000).toFixed(2)} s — "${clean.slice(0, 200)}"`);
  reply = clean;
} catch (e) { step('language model', null, false, e.message); }

// 6. say the reply
if (reply) {
  try {
    const v = await say(engine, reply.replace(/\[\[[^\]]*\]\]/g, ''));
    wav(join(APP, 'selftest-reply.wav'), v.pcm, v.rate);
    step('voice: say the reply', v.total, v.pcm.length > 0, '→ selftest-reply.wav');
  } catch (e) { step('voice (reply)', null, false, e.message); }
}

const ok = results.every((r) => r.ok);                     // 'warn' counts as a pass
const warned = results.some((r) => r.ok === 'warn');
console.log(`\n${ok ? '✔ QVAC works on this machine.' + (warned ? ' (⚠ an optional part is missing, see above)' : '') : '✖ At least one step failed (see above and the README).'}`);
try { await engine.close(); } catch { /* closed */ }
process.exit(ok ? 0 : 1);
