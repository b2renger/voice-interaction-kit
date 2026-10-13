// Copies the shared core (../common/voice-core.js) into public/, so it travels with the app.
// Run automatically by npm start / npm run package / npm run make.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(app, '..', 'common', 'voice-core.js');
const to = join(app, 'public', 'voice-core.js');
if (!existsSync(from)) {
  if (!existsSync(to)) { console.error('✖ common/voice-core.js not found.'); process.exit(1); }
  process.exit(0);                                    // already copied (app folder on its own)
}
if (!existsSync(to) || readFileSync(from, 'utf8') !== readFileSync(to, 'utf8')) {
  copyFileSync(from, to);
  console.log('▸ public/voice-core.js updated from common/.');
}
