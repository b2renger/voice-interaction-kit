// Builds VoiceAgent.op.js = common/voice-core.js + op-glue.js: a single block to paste into cables.gl.
//   node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = readFileSync(join(here, '..', 'common', 'voice-core.js'), 'utf8');
const glue = readFileSync(join(here, 'op-glue.js'), 'utf8');
const version = (/version: '([^']+)'/.exec(core) || [])[1] || '?';

const header = `// VoiceAgent ${version} — cables.gl op for voice interaction (Gemini Live or the local QVAC backend).
// GENERATED FILE (build.mjs): do not edit by hand, edit common/voice-core.js or op-glue.js instead.
// How to use: 1_cables_gemini_live/README.md. Paste ALL of this file into the op's code editor.
`;

const out = `${header}\n${core.trim()}\n\n${glue.trim()}\n`;
writeFileSync(join(here, 'VoiceAgent.op.js'), out);
console.log(`VoiceAgent.op.js written (${(out.length / 1024).toFixed(1)} KB, voice-core ${version}).`);
