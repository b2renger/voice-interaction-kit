// Builds Zonos's in-browser engine (the voice engine "Zonos", app/src/engines/zonos.mjs) into app/zonos-engine/:
// engine.js, worker.js and codec-worker.js, which the studio's window loads from /zonos/engine/.
//
//   npm run zonos:engine                 (in the app folder; needs git, and Node 22 for corepack/pnpm)
//   node scripts/build-zonos-engine.mjs --ref <commit>     another version of Zonos than the one pinned below
//   node scripts/build-zonos-engine.mjs --from <folder>    an existing checkout of github.com/Zyphra/ZONOS3-Mini
//
// It is Zyphra's own build, unchanged: their sources at a pinned commit, their lockfile, their "build" script
// (servers/web: pnpm build = type check + vite build). The engine is MIT (Zyphra, Inc.); its licence and notices
// are copied next to it. The folder is not committed: the installers carry it (release.yml runs this script),
// and from a checkout you run it once. The model is not part of it: the app downloads it on first use.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/Zyphra/ZONOS3-Mini';
const REF = 'b171b19149d29b8bcc31e0342d5e3b0063dc479b';     // 13 November 2026: the version the Zonos voice was written against
const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(APP, 'zonos-engine');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const ref = arg('--ref') || REF;
const from = arg('--from');

function run(cmd, args, cwd) {
  console.log(`▸ ${cmd} ${args.join(' ')}`);
  // shell: on Windows, corepack and npx are .cmd files
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed (exit code ${r.status})`);
}
/** pnpm, the version Zonos pins ("packageManager"): through corepack (ships with Node 22), else npx. */
function pnpm(args, cwd) {
  try { run('corepack', ['pnpm', ...args], cwd); } catch (e) {
    console.log(`(corepack: ${e.message}; trying npx)`);
    run('npx', ['--yes', 'pnpm@10', ...args], cwd);
  }
}

let src = from ? resolve(from) : '';
let temp = '';
try {
  if (!src) {
    temp = mkdtempSync(join(tmpdir(), 'zonos-engine-'));
    src = temp;
    run('git', ['init', '--quiet'], src);
    run('git', ['remote', 'add', 'origin', REPO], src);
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', ref], src);
    run('git', ['checkout', '--quiet', 'FETCH_HEAD'], src);
  }
  if (!existsSync(join(src, 'servers', 'web', 'package.json'))) throw new Error(`${src} is not a checkout of ${REPO}`);
  pnpm(['install', '--frozen-lockfile', '--filter', 'zonos3-web...'], src);
  pnpm(['--dir', 'servers/web', 'build'], src);
  const dist = join(src, 'servers', 'web', 'dist');
  for (const f of ['engine.js', 'worker.js', 'codec-worker.js']) if (!existsSync(join(dist, f))) throw new Error(`the build did not produce ${f}`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  cpSync(dist, OUT, { recursive: true });
  for (const f of ['LICENSE', 'NOTICE']) if (existsSync(join(src, f))) cpSync(join(src, f), join(OUT, `ZONOS_${f}.txt`));
  if (existsSync(join(src, 'third_party', 'licenses'))) cpSync(join(src, 'third_party', 'licenses'), join(OUT, 'third_party_licenses'), { recursive: true });
  writeFileSync(join(OUT, 'VERSION.json'), `${JSON.stringify({ source: REPO, ref: from ? `local checkout (${from})` : ref, built: new Date().toISOString() }, null, 2)}\n`);
  console.log(`\n▸ the Zonos engine is in ${OUT}: ${readdirSync(OUT).join(', ')}`);
} catch (e) {
  console.error(`\n✖ The Zonos engine was not built: ${e.message}`);
  console.error('  VIK works without it: the voice engine "Zonos" then says "not installed", and the default voice speaks.');
  process.exitCode = 1;
} finally {
  if (temp) rmSync(temp, { recursive: true, force: true });
}
