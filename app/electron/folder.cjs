// The VIK folder: where VIK keeps the agents, the people recognized by their voice, and the downloaded models.
//   usual place (no folder chosen): <userData>/agents, <userData>/people.json, <home>/.qvac/models
//   a folder D chosen in Settings:   D/agents, D/people.json, D/.qvac/models
// QVAC's worker keeps its models in <home>/.qvac/models, and takes that home from SNAP_USER_COMMON when it is set:
// VIK sets it to D. The choice is written in <userData>/folder.json ({dir, previous}), read at each launch.
// Moving copies everything to the new place (a file there with the same size is skipped), switches, restarts; the next
// launch removes the old copies (the models are no longer in use then), only those found again at the new place.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** Where each thing lives: a chosen folder, or the usual places (dir ''). */
function layoutOf(dir, userData, home = os.homedir()) {
  if (dir) return { dir, agents: path.join(dir, 'agents'), people: path.join(dir, 'people.json'), models: path.join(dir, '.qvac', 'models'), home: dir };
  return { dir: '', agents: path.join(userData, 'agents'), people: path.join(userData, 'people.json'), models: path.join(home, '.qvac', 'models'), home };
}

const pointerFile = (userData) => path.join(userData, 'folder.json');
/** {dir, previous}: the folder chosen ('' = the usual places), and the one left by a move (its copies to remove). */
function readPointer(userData) {
  try {
    const j = JSON.parse(fs.readFileSync(pointerFile(userData), 'utf8'));
    return { dir: typeof j.dir === 'string' ? j.dir : '', previous: typeof j.previous === 'string' ? j.previous : null };
  } catch { return { dir: '', previous: null }; }
}
function writePointer(userData, o) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(pointerFile(userData), `${JSON.stringify({ dir: o.dir || '', ...(o.previous != null ? { previous: o.previous } : {}) }, null, 2)}\n`);
}

/** Every file under `dir` (relative paths), with its size. */
function filesOf(dir) {
  const out = [];
  const walk = (d, rel) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n.name);
      const r = rel ? path.join(rel, n.name) : n.name;
      if (n.isDirectory()) walk(p, r);
      else if (n.isFile()) { try { out.push({ rel: r, size: fs.statSync(p).size }); } catch { /* gone */ } }
    }
  };
  walk(dir, '');
  return out;
}

/** What a place holds: the agents (folders), whether people are recorded, the models' size in bytes. */
function contentOf(layout) {
  let agents = 0;
  try { agents = fs.readdirSync(layout.agents, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).length; } catch { /* none */ }
  return { agents, people: fs.existsSync(layout.people), models: filesOf(layout.models).reduce((n, f) => n + f.size, 0) };
}

const inside = (a, b) => { const r = path.relative(b, a); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/**
 * What a move from `from` to `to` copies: [{src, dst, size}] and their total. A file already at the new place with
 * the same size is not copied again. Refused (an Error with the reason): the same place, one inside the other,
 * a folder that cannot be written, not enough room.
 */
function planMove(from, to) {
  if (path.resolve(from.home) === path.resolve(to.home) && path.resolve(from.agents) === path.resolve(to.agents)) throw new Error('It is the folder VIK uses already.');
  if (to.dir && (inside(to.dir, from.agents) || inside(to.dir, from.models) || (from.dir && inside(from.dir, to.dir)))) throw new Error('Choose a folder outside the current one.');
  const copies = [];
  const add = (srcDir, dstDir) => { for (const f of filesOf(srcDir)) copies.push({ src: path.join(srcDir, f.rel), dst: path.join(dstDir, f.rel), size: f.size }); };
  add(from.agents, to.agents);
  if (fs.existsSync(from.people)) copies.push({ src: from.people, dst: to.people, size: fs.statSync(from.people).size });
  add(from.models, to.models);
  const todo = copies.filter((c) => { try { return fs.statSync(c.dst).size !== c.size; } catch { return true; } });
  const bytes = todo.reduce((n, c) => n + c.size, 0);
  // can we write there, and is there room?
  const probe = to.dir || to.home;
  fs.mkdirSync(probe, { recursive: true });
  const test = path.join(probe, `.vik-write-test-${process.pid}`);
  try { fs.writeFileSync(test, 'ok'); fs.rmSync(test); } catch (e) { throw new Error(`VIK cannot write in ${probe} (${e.code || e.message}).`); }
  if (fs.statfsSync) {
    const st = fs.statfsSync(probe);
    const free = Number(st.bavail) * Number(st.bsize);
    if (free < bytes + 200e6) throw new Error(`Not enough room there: ${(bytes / 1e9).toFixed(1)} GB to copy, ${(free / 1e9).toFixed(1)} GB free.`);
  }
  return { copies, todo, bytes };
}

/** Copies the plan's files (each one whole, or not at all); onProgress({copied, bytes, file}). */
async function copyAll(plan, onProgress = () => {}) {
  let copied = 0;
  for (const c of plan.todo) {
    onProgress({ copied, bytes: plan.bytes, file: path.basename(c.src) });
    fs.mkdirSync(path.dirname(c.dst), { recursive: true });
    const part = `${c.dst}.vik-part`;
    await fs.promises.copyFile(c.src, part);
    if (fs.statSync(part).size !== c.size) { fs.rmSync(part, { force: true }); throw new Error(`${path.basename(c.src)} was not copied whole.`); }
    fs.renameSync(part, c.dst);
    copied += c.size;
  }
  onProgress({ copied, bytes: plan.bytes, file: '' });
}

/**
 * After a move, at the next launch: removes from the old place each file found again at the new one with the
 * same size (anything else stays), then the folders left empty. Returns how many files were removed and kept.
 */
function removeOld(from, to) {
  let removed = 0; let kept = 0;
  const pairs = [[from.agents, to.agents], [from.models, to.models]];
  for (const [a, b] of pairs) {
    for (const f of filesOf(a)) {
      let same = false;
      try { same = fs.statSync(path.join(b, f.rel)).size === f.size; } catch { /* not there */ }
      if (same) { try { fs.rmSync(path.join(a, f.rel)); removed++; } catch { kept++; } } else kept++;
    }
    pruneEmpty(a);
  }
  if (fs.existsSync(from.people)) {
    let same = false;
    try { same = fs.statSync(to.people).size === fs.statSync(from.people).size; } catch { /* not there */ }
    if (same) { try { fs.rmSync(from.people); removed++; } catch { kept++; } } else kept++;
  }
  return { removed, kept };
}
function pruneEmpty(dir) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const n of names) if (n.isDirectory()) pruneEmpty(path.join(dir, n.name));
  try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* not empty, or gone */ }
}

module.exports = { layoutOf, readPointer, writePointer, contentOf, planMove, copyAll, removeOld, filesOf };
