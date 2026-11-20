// Starts a packaged VIK (simulated engine, its own settings folder) and checks that it really works before it is
// published: the server answers, the studio's page loads and runs (its agent list fills), then it quits.
//   node scripts/smoke-package.mjs              the packaged app under out/ (after npm run package / make)
//   node scripts/smoke-package.mjs <executable> one executable: …/VIK.exe, or …/VIK.app/Contents/MacOS/VIK
// Exits with 1 if anything fails. Uses Node's own WebSocket (Node 22+) to talk to the window (DevTools protocol).
import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function executable() {
  if (process.argv[2]) return process.argv[2];
  const out = join(APP, 'out');
  for (const d of existsSync(out) ? readdirSync(out) : []) {
    for (const c of [join(out, d, 'VIK.exe'), join(out, d, 'VIK.app', 'Contents', 'MacOS', 'VIK'), join(out, d, 'vik')]) if (existsSync(c)) return c;
  }
  return null;
}

const exe = executable();
if (!exe) { console.error('No packaged app found: run npm run package (or make) first, or give the executable.'); process.exit(1); }
const debugPort = 9300 + Math.floor(Math.random() * 500);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;       // set by VS Code: the app would run as plain Node
const app = spawn(exe, ['--mock', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vik-smoke-'))}`, `--remote-debugging-port=${debugPort}`],
  { env, stdio: 'ignore', detached: process.platform !== 'win32' });
let exited = null;
app.on('exit', (code) => { exited = code; });

const problems = [];
const ok = (m) => console.log(`✔ ${m}`);
async function until(what, fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (exited !== null) throw new Error(`the app quit (code ${exited}) before ${what}`);
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    await sleep(500);
  }
  throw new Error(`${what}: nothing after ${Math.round(ms / 1000)} s`);
}

/** Evaluates an expression in the studio's page (DevTools protocol). */
async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('DevTools connection failed')); });
  const answer = new Promise((resolve) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) resolve(m); }; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  const m = await Promise.race([answer, sleep(5000).then(() => ({}))]);
  ws.close();
  return m.result && m.result.result ? m.result.result.value : undefined;
}

try {
  const base = await until('the server answers', async () => {
    for (let p = 8790; p <= 8799; p++) {
      try { const h = await (await fetch(`http://127.0.0.1:${p}/health`)).json(); if (h && h.models === 'ready') return `http://127.0.0.1:${p}`; } catch { /* next */ }
    }
    return null;
  }, 120000);
  ok(`the server answers (${base}), the simulated engine is ready`);
  const page = await until('the studio window opens', async () => {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return list.find((t) => t.type === 'page' && String(t.url).startsWith(base));
  }, 60000);
  ok('the studio window shows the studio');
  const agents = await until('the studio runs (its agent list fills)', () => evaluate(page.webSocketDebuggerUrl,
    "document.querySelectorAll('#agentSelect option').length > 0 && typeof window.vikSave === 'function' && typeof window.vikUpdates === 'function' ? document.querySelectorAll('#agentSelect option').length : 0"), 60000);
  ok(`the studio runs: ${agents} agents in the list`);
} catch (e) {
  problems.push(e.message);
} finally {
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-app.pid, 'SIGKILL');
  } catch { /* gone */ }
}
if (problems.length) { console.error(`✖ ${exe}\n  - ${problems.join('\n  - ')}`); process.exit(1); }
console.log(`✔ ${exe} starts and works`);
process.exit(0);
