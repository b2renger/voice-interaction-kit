// Recognizing people by their voice (app/src/speakers/):
//   1. the filter banks match Kaldi's (fixtures made by tests/tools/make_speaker_fixtures.py with kaldi-native-fbank);
//   2. the voice without its silences;
//   3. the people of this computer (people.json): add, the same name again, delete, read back, another model;
//   4. who it is: the closest voiceprint, above a line that is lower for a short voice;
//   5. the real model on real voices (LibriSpeech clips), when onnxruntime-node is installed (optional dependency).
// Node only: node tests/test-speakers.mjs
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, check, skip, summary } from './helpers.mjs';

const src = (p) => pathToFileURL(join(ROOT, 'app', 'src', p)).href;
const { fbank, N_MELS } = await import(src('speakers/fbank.mjs'));
const { voiced, createPeople, createSpeakerModel, thresholdFor, MIN_SECONDS, MODEL_NAME } = await import(src('speakers/speakers.mjs'));

// — 1. the filter banks ——————————————————————————————————————————————————————————————————
/** The test signals: SAME formulas as tests/tools/make_speaker_fixtures.py (signal). */
function signal(kind, seconds) {
  const n = Math.floor(16000 * seconds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / 16000;
    if (kind === 'tones') x[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 1730 * t) + 0.05 * Math.sin(2 * Math.PI * 5100 * t + 0.3);
    else {
      const env = 0.2 + 0.8 * Math.sin((Math.PI * i) / n);
      x[i] = env * (0.25 * Math.sin(2 * Math.PI * 140 * t) + 0.12 * Math.sin(2 * Math.PI * 700 * t) * Math.sin(2 * Math.PI * 140 * t)
        + 0.08 * Math.sin(2 * Math.PI * 1200 * t + 1.0));
    }
  }
  return x;
}
const fixtures = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'speaker-fbank.json'), 'utf8'));
for (const fx of fixtures.signals) {
  const { data, frames } = fbank(signal(fx.kind, fx.seconds));
  let max = 0;
  fx.indices.forEach((idx, j) => { max = Math.max(max, Math.abs(data[idx] - fx.values[j])); });
  check(frames === fx.frames && data.length === frames * N_MELS, `fbank ${fx.kind} ${fx.seconds} s: ${frames} frames of ${N_MELS} bins, as Kaldi`, { frames, expected: fx.frames });
  check(max < 2e-3, `fbank ${fx.kind}: the values match kaldi-native-fbank (largest difference ${max.toExponential(1)})`, max);
}
check(fbank(new Float32Array(399)).frames === 0 && fbank(new Float32Array(400)).frames === 1, 'fbank: one frame needs 25 ms (400 samples)');

// — 2. the voice without its silences ———————————————————————————————————————————————————
{
  const a = new Float32Array(16000 * 3);
  for (let i = 16000; i < 16000 * 2; i++) a[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / 16000);   // 1 s of "voice" between two silences
  for (let i = 0; i < a.length; i++) if (i < 16000 || i >= 32000) a[i] = 0.0005 * Math.sin(i);        // a quiet room
  const v = voiced(a);
  check(Math.abs(v.seconds - 1) < 0.03, `voiced: 1 s of voice in 3 s of sound (${v.seconds.toFixed(2)} s)`, v.seconds);
  check(voiced(new Float32Array(16000)).seconds === 0, 'voiced: silence is no voice');
}

// — 3. the people of this computer ———————————————————————————————————————————————————————
const vec = (k, n = 32) => { const v = new Float32Array(n); v[k] = 1; return v; };
{
  const file = join(mkdtempSync(join(tmpdir(), 'vik-people-test-')), 'sub', 'people.json');
  const logs = [];
  const people = createPeople({ file, log: (m) => logs.push(m) });
  check(people.size === 0 && people.list().length === 0 && !existsSync(file), 'people: nobody at first, no file');
  const papa = people.add('  Papa ', vec(2), 10.94);
  people.add('Léo', vec(5), 12);
  check(papa.name === 'Papa' && papa.seconds === 10.9 && /^[0-9a-f]{8}$/.test(papa.id) && existsSync(file), 'people: added, the name trimmed, saved (its folder made)', papa);
  const again = people.add('papa', vec(3), 9);
  check(people.size === 2 && again.id === papa.id && people.identify(vec(3)).name === 'papa', 'people: the same name again (any case) replaces their voice', people.list());
  check(people.add('[Zoé]\n', vec(7), 9).name === 'Zoé', 'people: brackets and line breaks are removed from a name (they would break "[Zoé] …" for the model)');
  let err = null;
  try { people.add('   ', vec(1), 9); } catch (e) { err = e.message; }
  check(err === 'A name is needed.', 'people: a name is needed', err);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  check(saved.model === MODEL_NAME && saved.people.length === 3 && saved.people[0].voiceprint.length === 32 && !('audio' in saved.people[0]),
    'people.json: the model\'s name and the voiceprints, no recording', Object.keys(saved.people[0]));
  const back = createPeople({ file, log: (m) => logs.push(m) });
  check(back.size === 3 && back.names().join(',') === 'papa,Léo,Zoé' && back.identify(vec(5)).name === 'Léo', 'people: read back from the file', back.names());
  check(back.remove(again.id) && !back.remove('00000000') && createPeople({ file }).names().join(',') === 'Léo,Zoé', 'people: delete, saved');
  writeFileSync(file, JSON.stringify({ version: 1, model: 'another-model', people: saved.people }));
  const other = createPeople({ file, log: (m) => logs.push(m) });
  check(other.size === 0 && logs.some((m) => /another speaker model/.test(m)), 'people: voiceprints of another model are not used (record again)', logs);
}

// — 4. who it is ———————————————————————————————————————————————————————————————————————————
{
  const people = createPeople({ file: join(mkdtempSync(join(tmpdir(), 'vik-people-test-')), 'people.json') });
  const mix = (a, b, w) => { const v = new Float32Array(32); v[a] = w; v[b] = Math.sqrt(1 - w * w); return v; };
  people.add('Papa', vec(2), 10); people.add('Léo', vec(5), 10);
  check(people.identify(mix(5, 9, 0.9)).name === 'Léo', 'identify: the closest voiceprint (0.9)');
  const r = people.identify(mix(5, 9, 0.35), 2);
  check(r.name === '' && r.closest === 'Léo' && r.score === 0.35, 'identify: below the line (0.35 for a sentence), someone not recognized, the closest given', r);
  check(people.identify(mix(5, 9, 0.35), 0.6).name === 'Léo', 'identify: a short voice scores lower, its line is lower (0.35 is enough for 0.6 s)');
  check(thresholdFor(0.5) < thresholdFor(1) && thresholdFor(1) < thresholdFor(3) && thresholdFor(3) === thresholdFor(30) && MIN_SECONDS > 0, 'identify: the line goes up with the length, then stays');
  check(createPeople({ file: join(tmpdir(), 'vik-none', 'people.json') }).identify(vec(1)).name === '', 'identify: nobody recorded, nobody recognized');
}

// — 5. the real model on real voices ————————————————————————————————————————————————————————
{
  const logs = [];
  const model = createSpeakerModel({ modelPath: join(ROOT, 'app', 'models', 'campplus-voxceleb.onnx'), log: (m) => logs.push(m) });
  const missing = createSpeakerModel({ modelPath: join(tmpdir(), 'no-model.onnx'), log: (m) => logs.push(m) });
  check((await missing.ready()) === false && logs.some((m) => /model not found/.test(m)), 'missing model: ready() is false, the reason logged');
  if (await model.ready()) {
    const clip = (n) => { const b = readFileSync(join(ROOT, 'tests', 'fixtures', 'voices', `${n}.pcm`)); const a = new Float32Array(b.length >> 1); for (let i = 0; i < a.length; i++) a[i] = b.readInt16LE(i * 2) / 32768; return a; };
    const t0 = performance.now();
    const [a1, a2, b1] = [await model.embed(voiced(clip('a1')).audio), await model.embed(voiced(clip('a2')).audio), await model.embed(voiced(clip('b1')).audio)];
    const ms = Math.round((performance.now() - t0) / 3);
    const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
    const norm = Math.sqrt(a1.reduce((s, v) => s + v * v, 0));
    check(a1.length === 512 && Math.abs(norm - 1) < 1e-4, `real model: 512 numbers per voice, of length 1 (${ms} ms for 2 s)`, a1.length);
    check(cos(a1, a2) >= thresholdFor(2) && cos(a1, b1) < thresholdFor(2) && cos(a1, a2) - cos(a1, b1) > 0.3,
      `real model: two sentences of one person are close (${cos(a1, a2).toFixed(2)}), two people are not (${cos(a1, b1).toFixed(2)})`, { same: cos(a1, a2), other: cos(a1, b1) });
    const people = createPeople({ file: join(mkdtempSync(join(tmpdir(), 'vik-people-test-')), 'people.json') });
    people.add('A', a1, 2); people.add('B', b1, 2);
    check(people.identify(a2, 2).name === 'A', 'real model: A\'s other sentence is A', people.identify(a2, 2));
    let err = null;
    try { await model.embed(new Float32Array(1000)); } catch (e) { err = e.message; }
    check(err === 'too short', 'real model: less than 10 frames is refused', err);
    await model.close();
  } else skip('the real model on real voices', String(logs[logs.length - 1] || ''));
}

process.exit(summary() ? 1 : 0);
