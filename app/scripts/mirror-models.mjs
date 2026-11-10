// Copies the models VIK can only get from QVAC's peer-to-peer registry (the voices) into a folder, checked
// against QVAC's catalogue (size and SHA-256), for the "models" release that VIK downloads them from over
// HTTPS (config.json "modelMirror"). Many school and company networks block the peer-to-peer network.
//   node scripts/mirror-models.mjs <folder>    (the Models mirror workflow runs it; or on any open network)
// The models: every catalogue name config.json uses (src, choices, Parler, Chatterbox and its S3Gen part)
// with no Hugging Face source. Writes <folder>/<file name> for each, and SHA256SUMS.txt.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] && resolve(process.argv[2]);
if (!out) { console.error('Usage: node scripts/mirror-models.mjs <folder>'); process.exit(1); }

const require = createRequire(join(APP, 'package.json'));
const sdkEntry = require.resolve('@qvac/sdk');
const sdk = await import(pathToFileURL(sdkEntry).href);
const { QVACRegistryClient } = require('@qvac/registry-client');
// The registry the SDK reads (its client's own default is another one): @qvac/inference's DEFAULT_REGISTRY_CORE_KEY,
// from the copy the SDK uses (inside it, or next to it).
async function registryKey() {
  const sdkDir = sdkEntry.slice(0, sdkEntry.lastIndexOf(join('node_modules', '@qvac', 'sdk')) + join('node_modules', '@qvac', 'sdk').length);
  for (const dir of [join(sdkDir, 'node_modules', '@qvac', 'inference'), join(APP, 'node_modules', '@qvac', 'inference')]) {
    const f = join(dir, 'dist', 'constants', 'registry.js');
    if (existsSync(f)) return (await import(pathToFileURL(f).href)).DEFAULT_REGISTRY_CORE_KEY;
  }
  throw new Error('@qvac/inference (its registry key) cannot be found');
}

/** The catalogue names config.json uses. */
function namesInConfig() {
  const names = new Set();
  const add = (n) => { if (typeof n === 'string' && n) names.add(n); };
  for (const m of Object.values(JSON.parse(readFileSync(join(APP, 'config.json'), 'utf8')).models)) {
    add(m.src); add(m.vad);
    for (const c of m.choices || []) add(c && c.src);
    for (const k of ['parler', 'chatterbox']) if (m[k]) { add(m[k].src); add(m[k].s3gen); }
  }
  return [...names];
}
const sha256 = (file) => new Promise((ok, fail) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (d) => h.update(d)).on('error', fail).on('end', () => ok(h.digest('hex')));
});
const fileOf = (c) => c.registryPath.split('/').pop();

const models = namesInConfig().map((n) => sdk[n]).filter((c) => c && c.registryPath && c.registrySource !== 'hf');
if (!models.length) { console.error('No peer-to-peer-only model in config.json.'); process.exit(1); }
mkdirSync(out, { recursive: true });
const client = new QVACRegistryClient({ registryCoreKey: await registryKey(), storage: mkdtempSync(join(tmpdir(), 'vik-registry-')) });
await client.ready();
let failed = 0;
const sums = [];
for (const c of models) {
  const file = join(out, fileOf(c));
  try {
    if (!(existsSync(file) && statSync(file).size === c.expectedSize && (await sha256(file)) === c.sha256Checksum)) {
      rmSync(file, { force: true });
      const t0 = Date.now();
      console.log(`↓ ${c.name} (${(c.expectedSize / 1e6).toFixed(0)} MB) from ${c.registrySource}/${c.registryPath}`);
      // as the SDK does: straight from the blob the catalogue points to; timeout = nothing received for that long
      const blob = { coreKey: c.blobCoreKey, blockOffset: c.blobBlockOffset, blockLength: c.blobBlockLength, byteOffset: c.blobByteOffset, byteLength: c.expectedSize, sha256: c.sha256Checksum };
      if (c.blobCoreKey) await client.downloadBlob(blob, { outputFile: file, timeout: 120000 });
      else await client.downloadModel(c.registryPath, c.registrySource, { outputFile: file, timeout: 120000 });
      console.log(`  in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    const size = statSync(file).size;
    const sum = await sha256(file);
    if (size !== c.expectedSize || sum !== c.sha256Checksum) throw new Error(`${size} bytes, SHA-256 ${sum}: the catalogue says ${c.expectedSize} bytes, ${c.sha256Checksum}`);
    sums.push(`${sum}  ${fileOf(c)}`);
    console.log(`✔ ${fileOf(c)}`);
  } catch (e) {
    failed++;
    rmSync(file, { force: true });
    console.error(`✖ ${c.name}: ${e.message}`);
  }
}
try { await client.close(); } catch { /* closing */ }
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
process.exit(failed ? 1 : 0);
