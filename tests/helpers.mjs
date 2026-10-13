// Shared test helpers: a static file server, a fake microphone recording, Playwright.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wav': 'audio/wav', '.css': 'text/css' };

export async function startStatic(root = ROOT) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/**
 * A fake microphone: 1 s of background noise, 1.5 s of "speech" (synthetic vowels), then silence.
 * Chrome plays it in a loop. 48 kHz mono 16-bit.
 */
export function makeFakeMicWav(file, { lead = 1.0, speech = 1.5, tail = 6.0 } = {}) {
  const rate = 48000;
  const total = lead + speech + tail;
  const n = Math.round(total * rate);
  const data = Buffer.alloc(n * 2);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = rnd() * 0.004;                                        // room noise
    if (t >= lead && t < lead + speech) {
      const local = t - lead;
      const syll = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * local);  // 4 syllables per second
      const f0 = 140 + 30 * Math.sin(2 * Math.PI * 0.7 * local);
      v += 0.3 * syll * (Math.sin(2 * Math.PI * f0 * t) + 0.6 * Math.sin(2 * Math.PI * 2 * f0 * t) + 0.3 * Math.sin(2 * Math.PI * 3 * f0 * t)) / 1.9;
    }
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
  return file;
}

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ['playwright', '/opt/npm-tools/node_modules/playwright', '@playwright/test'];
  for (const t of tries) { try { return require(t); } catch { /* next */ } }
  throw new Error('Playwright not found (npm i -D playwright).');
}

export async function launch(micWav) {
  const { chromium } = loadPlaywright();
  return chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${micWav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

let failures = 0;
let passes = 0;
let skips = 0;
export function check(cond, what, extra) {
  if (cond) { passes++; console.log(`ok   ${what}`); }
  else { failures++; console.log(`FAIL ${what}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}
/** A check that cannot run on this machine (a missing tool): reported, not a failure. */
export function skip(what, why) { skips++; console.log(`skip ${what} — skipped${why ? ': ' + why : ''}`); }
export function summary() { console.log(`\n${passes} passed, ${failures} failed${skips ? `, ${skips} skipped` : ''}`); return failures; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 8000, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}
