// Checks a packaged VIK before it is published: what the app needs at run time must be inside it.
//   node scripts/check-package.mjs              every packaged app under out/ (after npm run package / make)
//   node scripts/check-package.mjs <app dir>    one packaged app: …/resources/app, or …/VIK.app/Contents/Resources/app
//
// 1. QVAC's native addons (qvac/addons.manifest.json) can be found from @qvac/inference and @qvac/sdk, the way
//    Node resolves them. Electron Packager drops what is only a peer dependency: with @qvac/inference 0.21.1 and
//    @qvac/sdk 0.21.0, llama.cpp ended up nested under the SDK, out of @qvac/inference's reach, and the QVAC
//    worker could not start ("models do not download"). package.json pins @qvac/inference for that reason.
// 2. The Guide's pages (public/guide/pages.json and each page) are there.
// 3. Zonos's in-browser engine (zonos-engine/, built by scripts/build-zonos-engine.mjs) is there.
// Exits with 1 if anything is missing.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The packaged apps under out/ (Windows and Linux: resources/app; Mac: VIK.app/Contents/Resources/app). */
function packagedApps() {
  const out = join(APP, 'out');
  if (!existsSync(out)) return [];
  const found = [];
  for (const d of readdirSync(out, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === 'make') continue;
    const base = join(out, d.name);
    for (const c of [join(base, 'resources', 'app'), join(base, 'VIK.app', 'Contents', 'Resources', 'app')]) if (existsSync(join(c, 'package.json'))) found.push(c);
  }
  return found;
}

/** Where Node would find package `name` when required from inside `fromDir` (a package's folder), or null. */
function resolveFrom(fromDir, name, root) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (resolve(dir) === resolve(root)) return null;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function check(appDir) {
  const problems = [];
  const manifestFile = join(appDir, 'qvac', 'addons.manifest.json');
  let addons = [];
  if (!existsSync(manifestFile)) problems.push('qvac/addons.manifest.json is missing (the QVAC Forge plugin did not run?)');
  else {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const list = Array.isArray(manifest) ? manifest : manifest.addons || [];
    addons = list.map((a) => (typeof a === 'string' ? a : a.name)).filter((n) => typeof n === 'string' && n.startsWith('@qvac/'));
    if (!addons.length) problems.push('qvac/addons.manifest.json lists no @qvac addon');
  }
  // the SDK at the top, @qvac/inference wherever npm put it (the top, or inside the SDK)
  const sdk = resolveFrom(appDir, '@qvac/sdk', appDir);
  const inference = sdk && resolveFrom(sdk, '@qvac/inference', appDir);
  if (!sdk) problems.push('@qvac/sdk is missing');
  else if (!inference) problems.push('@qvac/inference cannot be found from @qvac/sdk');
  for (const [from, dir] of [['@qvac/inference', inference], ['@qvac/sdk', sdk]]) {
    if (!dir) continue;
    for (const addon of addons) if (!resolveFrom(dir, addon, appDir)) problems.push(`${addon} cannot be found from ${from}`);
  }
  for (const f of ['engine.js', 'worker.js', 'codec-worker.js']) if (!existsSync(join(appDir, 'zonos-engine', f))) problems.push(`zonos-engine/${f} is missing (the voice engine "Zonos": npm run zonos:engine before packaging)`);
  const pagesFile = join(appDir, 'public', 'guide', 'pages.json');
  if (!existsSync(pagesFile)) problems.push('public/guide/pages.json is missing');
  else for (const p of JSON.parse(readFileSync(pagesFile, 'utf8'))) if (!existsSync(join(appDir, 'public', 'guide', `${p.id}.md`))) problems.push(`the Guide's page ${p.id}.md is missing`);
  return { addons, problems };
}

const dirs = process.argv[2] ? [resolve(process.argv[2])] : packagedApps();
if (!dirs.length) { console.error('No packaged app found: run npm run package (or make) first, or give the app folder.'); process.exit(1); }
let failed = false;
for (const d of dirs) {
  const { addons, problems } = check(d);
  if (problems.length) {
    failed = true;
    console.error(`✖ ${d}\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  } else console.log(`✔ ${d}: ${addons.length} QVAC addons found from @qvac/inference and @qvac/sdk; the Guide is complete`);
}
process.exit(failed ? 1 : 0);
