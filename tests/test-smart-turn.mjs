// Tests the Smart Turn end-of-turn model pipeline (2_qvac_local/src/turn), Node only:
//   1. the JavaScript features match the Python reference (fixtures made by tests/tools/make_smart_turn_fixtures.py);
//   2. model parity: the REAL ONNX model, run from Python, gives the same probability on the JavaScript
//      features as on the reference features (only if python3 has numpy and onnxruntime; otherwise skipped);
//   3. createSmartTurn: the SMART_TURN_FAKE test hook, and a clean "unavailable" without a model or runtime;
//   4. the features of 8 s of audio take less than 200 ms.
//   node tests/test-smart-turn.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, check, skip, summary } from './helpers.mjs';
import { smartTurnFeatures, smartTurnInput, whisperLogMel, N_MELS, N_FRAMES } from '../2_qvac_local/src/turn/whisper-features.mjs';
import { createSmartTurn, SMART_TURN_UNAVAILABLE } from '../2_qvac_local/src/turn/smart-turn.mjs';

const SR = 16000;
const MODEL = join(ROOT, '2_qvac_local', 'models', 'smart-turn-v3.2-cpu.onnx');
const fixtures = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'smart-turn-features.json'), 'utf8'));

/** The test signals: SAME formulas and order of operations as tests/tools/make_smart_turn_fixtures.py. */
function smartTurnSignal(kind, seconds) {
  const n = seconds * SR;
  const out = new Float32Array(n);
  if (kind === 'tone') {
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1.0, t / 0.05, (seconds - t) / 0.05);
      out[i] = 0.4 * env * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
    }
  } else if (kind === 'noise') {
    let seed = 12345;
    for (let i = 0; i < n; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      out[i] = (seed / 4294967296 - 0.5) * 0.2;
    }
  } else if (kind === 'chirp') {
    const f0 = 100.0; const f1 = 3000.0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = 0.3 * Math.sin(2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * seconds)));
    }
  } else if (kind === 'vowels') {
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const syll = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
      const f0 = 140 + 30 * Math.sin(2 * Math.PI * 0.7 * t);
      out[i] = 0.3 * syll * (Math.sin(2 * Math.PI * f0 * t) + 0.6 * Math.sin(2 * Math.PI * 2 * f0 * t)
        + 0.3 * Math.sin(2 * Math.PI * 3 * f0 * t)) / 1.9;
    }
  }
  return out;
}

// — 1. features parity with the Python reference ——————————————————————————————————————————
console.log('— 1. features: JavaScript vs the Python reference (Pipecat) —');
const computed = new Map();
{
  const TOL = 1e-4;
  let worst = 0;
  for (const fx of fixtures.signals) {
    const sig = smartTurnSignal(fx.kind, fx.seconds);
    let sum = 0; let sumsq = 0;
    for (let i = 0; i < sig.length; i++) { sum += sig[i]; sumsq += sig[i] * sig[i]; }
    const sameInput = sig.length === fx.input.n && Math.abs(sum - fx.input.sum) < 1e-6 * Math.max(1, Math.abs(fx.input.sum)) + 1e-6
      && Math.abs(sumsq - fx.input.sumsq) < 1e-6 * Math.max(1, fx.input.sumsq);
    const f = smartTurnFeatures(sig);
    computed.set(fx.name, { sig, f });
    let maxDiff = 0;
    fixtures.indices.forEach((idx, j) => { maxDiff = Math.max(maxDiff, Math.abs(f[idx] - fx.values[j])); });
    let s = 0; let mn = Infinity; let mx = -Infinity;
    for (let i = 0; i < f.length; i++) { s += f[i]; if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
    const mean = s / f.length;
    let v = 0;
    for (let i = 0; i < f.length; i++) v += (f[i] - mean) * (f[i] - mean);
    const std = Math.sqrt(v / f.length);
    const statsDiff = Math.max(Math.abs(mean - fx.mean), Math.abs(std - fx.std), Math.abs(mn - fx.min), Math.abs(mx - fx.max));
    worst = Math.max(worst, maxDiff, statsDiff);
    check(sameInput && f.length === N_MELS * N_FRAMES && fx.shape[0] === N_MELS && fx.shape[1] === N_FRAMES && maxDiff < TOL && statsDiff < TOL,
      `features ${fx.name}: same as the reference (max diff ${maxDiff.toExponential(1)}, stats ${statsDiff.toExponential(1)})`,
      { sameInput, length: f.length, maxDiff, statsDiff });
  }
  console.log(`     worst difference over all signals: ${worst.toExponential(2)} (tolerance 1e-4)`);
  // the input preparation of local_smart_turn_v3.py: last 8 s, zero padding at the BEGINNING
  const short = smartTurnInput(Float32Array.from([1, 2, 3]));
  const long = smartTurnInput(Float32Array.from({ length: 9 * SR }, (_, i) => i));
  check(short.length === 8 * SR && short[8 * SR - 1] === 3 && short[0] === 0 && long.length === 8 * SR && long[0] === SR,
    'input: keeps the last 8 s, pads at the beginning');
  check(whisperLogMel(new Float32Array(SR)).every((x) => x === -1.5), 'features: silence gives the floor value everywhere (-1.5)');
}

// — 2. model parity (the real ONNX model, from Python) ——————————————————————————————————————
console.log('\n— 2. model parity: the real ONNX model on the JavaScript features vs the reference features —');
const python = process.env.PYTHON || 'python3';
let parityRan = false;
const pythonProbability = new Map();          // signal name → probability from Python's onnxruntime (reference features)
const probe = spawnSync(python, ['-c', 'import numpy, onnxruntime'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  skip('model parity (python3 with numpy and onnxruntime)', 'not available on this machine');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'smart-turn-parity-'));
  try {
    const manifest = [];
    for (const [name, { sig, f }] of computed) {
      writeFileSync(join(dir, `${name}.sig.f32`), Buffer.from(sig.buffer, sig.byteOffset, sig.byteLength));
      writeFileSync(join(dir, `${name}.feat.f32`), Buffer.from(f.buffer, f.byteOffset, f.byteLength));
      manifest.push({ name, signal: `${name}.sig.f32`, features: `${name}.feat.f32` });
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const run = spawnSync(python, ['-B', join(ROOT, 'tests', 'tools', 'smart_turn_parity.py'), MODEL, dir], { encoding: 'utf8', timeout: 120000 });
    let out = null;
    try { out = JSON.parse(String(run.stdout).trim().split('\n').pop()); } catch { out = null; }
    check(run.status === 0 && out && out.results.length === manifest.length, 'model parity: the Python runner works (onnxruntime ' + (out && out.onnxruntime) + ')', String(run.stderr).slice(-600));
    if (out) {
      parityRan = true;
      let maxDiff = 0;
      for (const r of out.results) {
        pythonProbability.set(r.name, r.ref);
        const d = Math.abs(r.js - r.ref);
        maxDiff = Math.max(maxDiff, d);
        check(d < 1e-3 && r.js >= 0 && r.js <= 1, `model parity ${r.name}: p(js) ${r.js.toFixed(4)} vs p(ref) ${r.ref.toFixed(4)}`, r);
      }
      const featureDiff = Math.max(...out.results.map((r) => r.featureDiff));
      console.log(`     max probability difference: ${maxDiff.toExponential(2)} (tolerance 1e-3); max feature difference over all 64000 values: ${featureDiff.toExponential(2)}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// — 3. createSmartTurn ——————————————————————————————————————————————————————————————————————
console.log('\n— 3. createSmartTurn —');
{
  const audio = computed.get('vowels-3s').sig;
  const withFake = async (value) => {
    process.env.SMART_TURN_FAKE = value;
    try {
      const st = createSmartTurn({ modelPath: '/nowhere/model.onnx', threshold: 0.5 });
      return { ready: await st.ready(), r: await st.predict(audio).catch((e) => e), name: st.name };
    } finally { delete process.env.SMART_TURN_FAKE; }
  };
  const c = await withFake('complete');
  check(c.ready === true && c.r.probability === 0.95 && c.r.complete === true && c.r.ms >= 1 && c.r.ms < 50, 'SMART_TURN_FAKE=complete → 0.95, complete', c);
  const inc = await withFake('incomplete');
  check(inc.ready === true && inc.r.probability === 0.05 && inc.r.complete === false, 'SMART_TURN_FAKE=incomplete → 0.05, not complete', inc);
  const num = await withFake('0.7');
  check(num.ready === true && num.r.probability === 0.7 && num.r.complete === true, 'SMART_TURN_FAKE=0.7 → 0.7, complete (threshold 0.5)', num);
  const low = await withFake('0.3');
  check(low.r.probability === 0.3 && low.r.complete === false, 'SMART_TURN_FAKE=0.3 → not complete');

  const logs = [];
  const missing = createSmartTurn({ modelPath: '/nowhere/smart-turn.onnx', log: (m) => logs.push(m) });
  let threw = false; let ready;
  try { ready = await missing.ready(); await missing.ready(); } catch { threw = true; }
  const err = await missing.predict(audio).then(() => null, (e) => e);
  check(ready === false && !threw, 'missing model, no fake: ready() is false, no exception');
  check(logs.length === 1 && /model not found/.test(logs[0]), 'the reason is logged once', logs);
  check(err && err.message === SMART_TURN_UNAVAILABLE, 'predict() refuses cleanly when unavailable', err && err.message);

  // the real model through onnxruntime-node, when the runtime is installed (optional dependency)
  const real = createSmartTurn({ modelPath: MODEL, log: (m) => logs.push(m) });
  if (await real.ready()) {
    const r = await real.predict(audio);
    check(r.probability >= 0 && r.probability <= 1 && typeof r.complete === 'boolean', `onnxruntime-node: real prediction p=${r.probability.toFixed(4)} in ${r.ms} ms`, r);
    const ref = pythonProbability.get('vowels-3s');
    if (ref != null) check(Math.abs(r.probability - ref) < 1e-3, `onnxruntime-node: same probability as Python's onnxruntime (${r.probability.toFixed(4)} vs ${ref.toFixed(4)})`, { node: r.probability, python: ref });
    await real.close();
  } else {
    skip('real prediction through onnxruntime-node', String(logs[logs.length - 1] || '').replace(/^Smart Turn unavailable \(|\): using silence only\.$/g, ''));
  }
}

// — 4. speed ————————————————————————————————————————————————————————————————————————————————
console.log('\n— 4. speed —');
{
  const eight = smartTurnSignal('vowels', 8);
  const t0 = performance.now();
  smartTurnFeatures(eight);
  const cold = performance.now() - t0;
  const times = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); smartTurnFeatures(eight); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  const median = times[2];
  console.log(`     feature extraction of 8 s: ${median.toFixed(1)} ms (median of 5), first run ${cold.toFixed(1)} ms`);
  check(median < 200, `features of 8 s in less than 200 ms (${median.toFixed(1)} ms)`, times);
}

if (!parityRan) console.log('\n(model parity skipped: install numpy and onnxruntime for python3 to run it)');
process.exit(summary() ? 1 : 0);
