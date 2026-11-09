// Makes the app's icons from public/logo.svg: build/icon.ico (Windows) and build/icon.icns (Mac).
//   node scripts/make-icons.mjs        (needs Playwright: `npm install` at the root of the kit)
// The SVG is drawn by Chromium at each size; the files hold PNG images (both formats accept them).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(APP, '..', 'package.json'));
const { chromium } = require('playwright');
const svg = readFileSync(join(APP, 'public', 'logo.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
const png = {};
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  png[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();

// ICO: a directory of PNG images, 16 to 256 px
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const head = Buffer.alloc(6 + 16 * icoSizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(icoSizes.length, 4);
let offset = head.length;
icoSizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s === 256 ? 0 : s, e); head.writeUInt8(s === 256 ? 0 : s, e + 1);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png[s].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += png[s].length;
});
writeFileSync(join(APP, 'build', 'icon.ico'), Buffer.concat([head, ...icoSizes.map((s) => png[s])]));

// ICNS: typed PNG chunks (16/32/64 for the 1× and 2× small sizes, then 128 to 1024)
const chunks = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]
  .map(([type, s]) => { const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(8 + png[s].length, 4); return Buffer.concat([h, png[s]]); });
const body = Buffer.concat(chunks);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii'); icnsHead.writeUInt32BE(8 + body.length, 4);
writeFileSync(join(APP, 'build', 'icon.icns'), Buffer.concat([icnsHead, body]));
console.log('▸ build/icon.ico and build/icon.icns made from public/logo.svg');
