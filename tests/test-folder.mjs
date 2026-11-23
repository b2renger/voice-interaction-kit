// Tests the VIK folder (app/electron/folder.cjs): where the agents, the people and the models live, the choice kept
// in folder.json, a move (what it copies, what it refuses), and the old copies removed at the next launch.
// Temporary folders only: never the user's.
//   node tests/test-folder.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, check, summary } from './helpers.mjs';

const require = createRequire(import.meta.url);
const folder = require(join(ROOT, 'app', 'electron', 'folder.cjs'));
const tmp = (p) => mkdtempSync(join(tmpdir(), `vik-folder-${p}-`));
const put = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };

const userData = tmp('userdata');
const home = tmp('home');
const usual = folder.layoutOf('', userData, home);
check(usual.agents === join(userData, 'agents') && usual.people === join(userData, 'people.json') && usual.models === join(home, '.qvac', 'models') && usual.dir === '',
  'the usual places: agents and people in the app\'s settings folder, models in <home>/.qvac/models', usual);
const D = tmp('chosen');
const chosen = folder.layoutOf(D, userData, home);
check(chosen.agents === join(D, 'agents') && chosen.people === join(D, 'people.json') && chosen.models === join(D, '.qvac', 'models') && chosen.home === D,
  'a chosen folder holds them all: D/agents, D/people.json, D/.qvac/models (D is QVAC\'s home)', chosen);

// the choice, kept in folder.json
check(folder.readPointer(userData).dir === '' && folder.readPointer(userData).previous === null, 'no folder.json: the usual places');
folder.writePointer(userData, { dir: D, previous: '' });
check(JSON.stringify(folder.readPointer(userData)) === JSON.stringify({ dir: D, previous: '' }), 'folder.json keeps the folder chosen, and the one left by a move');

// what a move copies
put(join(usual.agents, 'cafe', 'persona.md'), 'You are Lou.');
put(join(usual.agents, 'cafe', 'knowledge', 'menu.csv'), 'name,price\nTea,2\n');
put(usual.people, '{"people":[]}');
put(join(usual.models, 'whisper.bin'), 'x'.repeat(5000));
put(join(usual.models, 'zonos3-web', 'backbone', 'w.bin'), 'y'.repeat(3000));
const plan = folder.planMove(usual, chosen);
check(plan.todo.length === 5 && plan.bytes === 5000 + 3000 + 'You are Lou.'.length + 'name,price\nTea,2\n'.length + '{"people":[]}'.length,
  'a move copies the agents, the people and the models (the Zonos voice too)', { n: plan.todo.length, bytes: plan.bytes });
let error = '';
try { folder.planMove(usual, usual); } catch (e) { error = e.message; }
check(/already/.test(error), 'refused: the folder VIK uses already', error);
error = '';
try { folder.planMove(usual, folder.layoutOf(join(usual.agents, 'inside'), userData, home)); } catch (e) { error = e.message; }
check(/outside/.test(error), 'refused: a folder inside the current one', error);

const seen = [];
await folder.copyAll(plan, (p) => seen.push(p.copied));
check(readFileSync(join(chosen.agents, 'cafe', 'knowledge', 'menu.csv'), 'utf8') === 'name,price\nTea,2\n' && existsSync(join(chosen.models, 'zonos3-web', 'backbone', 'w.bin')) && existsSync(chosen.people),
  'copied: the same files at the new place', readdirSync(D));
check(seen[seen.length - 1] === plan.bytes && seen.every((v, i) => !i || v >= seen[i - 1]), 'the copy says how far it is, up to the whole', seen);
check(!readdirSync(join(chosen.models)).some((f) => f.endsWith('.vik-part')), 'no half-copied file is left');
const again = folder.planMove(usual, chosen);
check(again.todo.length === 0 && again.bytes === 0, 'moving again: what is there already, with the same size, is not copied again');

// the next launch: the old copies go, only those found again at the new place
put(join(usual.agents, 'new-one', 'persona.md'), 'Made after the copy.');
const r = folder.removeOld(usual, chosen);
check(r.removed === 5 && r.kept === 1 && !existsSync(join(usual.models, 'whisper.bin')) && !existsSync(usual.people) && existsSync(join(usual.agents, 'new-one', 'persona.md'))
  && !existsSync(join(usual.agents, 'cafe')) && !existsSync(join(usual.models, 'zonos3-web')),
  'next launch: the old copies are removed (and their empty folders); a file not found at the new place stays', r);
check(JSON.stringify(folder.contentOf(chosen)) === JSON.stringify({ agents: 1, people: true, models: 8000 }), 'what a place holds: its agents, whether people are recorded, the models\' size', folder.contentOf(chosen));

process.exitCode = summary() ? 1 : 0;
