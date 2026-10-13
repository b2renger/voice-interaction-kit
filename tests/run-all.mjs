// Runs every test suite, one after the other (each in its own Node process), then prints a summary table.
// Exits with 1 if a suite fails. For CI.
//   node tests/run-all.mjs                 all the suites
//   node tests/run-all.mjs protocol local  only the suites whose name contains one of these words
//   node tests/run-all.mjs --strict        a suite that cannot run here (no Playwright) counts as a failure
//
// A browser suite (Chromium through Playwright) that finds no Playwright is reported as "skipped", not failed,
// unless --strict. Inside a suite, a check that needs a missing tool (python3 + onnxruntime) is counted as skipped.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const SUITES = [
  { name: 'test-text', args: ['tests/test-text.mjs'] },
  { name: 'test-protocol', args: ['tests/test-protocol.mjs'] },
  { name: 'test-protocol fake-qvac', args: ['tests/test-protocol.mjs', 'fake-qvac'] },
  { name: 'test-electron-main', args: ['tests/test-electron-main.mjs'] },
  { name: 'test-smart-turn', args: ['tests/test-smart-turn.mjs'] },
  { name: 'test-gemini', args: ['tests/test-gemini.mjs'], browser: true },
  { name: 'test-hub', args: ['tests/test-hub.mjs'] },
  { name: 'test-local', args: ['tests/test-local.mjs'], browser: true },
];
const TIMEOUT_MS = 10 * 60 * 1000;

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const filters = argv.filter((a) => !a.startsWith('--'));
const chosen = filters.length ? SUITES.filter((s) => filters.some((f) => s.name.includes(f))) : SUITES;
if (!chosen.length) { console.error(`No suite matches: ${filters.join(', ')}`); process.exit(2); }

function run(suite) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const proc = spawn(process.execPath, suite.args.map((a, i) => (i === 0 ? join(ROOT, a) : a)), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (stream, sink) => stream.on('data', (d) => { out += String(d); sink.write(d); });
    take(proc.stdout, process.stdout);
    take(proc.stderr, process.stderr);
    const timer = setTimeout(() => { out += '\n(run-all: timed out)\n'; proc.kill('SIGKILL'); }, TIMEOUT_MS);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const all = [...out.matchAll(/(\d+) passed, (\d+) failed(?:, (\d+) skipped)?/g)];
      const last = all[all.length - 1];
      const r = { suite, code, seconds: (Date.now() - t0) / 1000, passed: null, failed: null, skipped: 0, note: '' };
      if (last) { r.passed = Number(last[1]); r.failed = Number(last[2]); r.skipped = Number(last[3] || 0); }
      if (suite.browser && /Playwright not found/.test(out)) { r.status = 'skipped'; r.note = 'Playwright not installed'; }
      else if (code === 0 && last && r.failed === 0) r.status = 'ok';
      else { r.status = 'FAIL'; if (!last) r.note = `exit code ${code}, no summary`; else if (code !== 0 && r.failed === 0) r.note = `exit code ${code}`; }
      resolve(r);
    });
  });
}

const results = [];
for (const suite of chosen) {
  console.log(`\n=============== ${suite.name} ===============`);
  results.push(await run(suite));
}

const rows = results.map((r) => [r.suite.name, r.passed ?? '—', r.failed ?? '—', r.skipped || 0, `${r.seconds.toFixed(0)} s`, r.status + (r.note ? ` (${r.note})` : '')]);
const head = ['suite', 'passed', 'failed', 'skipped', 'time', 'result'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
const line = (cells) => cells.map((c, i) => (i === 0 || i === cells.length - 1 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
console.log('\n' + line(head));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const row of rows) console.log(line(row));
const total = (k) => results.reduce((a, r) => a + (Number(r[k]) || 0), 0);
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
console.log(line(['total', total('passed'), total('failed'), total('skipped'), `${results.reduce((a, r) => a + r.seconds, 0).toFixed(0)} s`, '']));

const failed = results.filter((r) => r.status === 'FAIL' || (strict && r.status === 'skipped'));
console.log(failed.length ? `\n✖ ${failed.length} suite(s) failed: ${failed.map((r) => r.suite.name).join(', ')}` : '\n✔ all suites passed');
process.exit(failed.length ? 1 : 0);
