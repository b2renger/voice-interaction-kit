// Settings → VIK folder: where the agents, the people recorded and the models are, and moving them (the app copies
// everything to the folder chosen, then restarts there: app/electron/folder.cjs, through the server /api/folder).
import { $, h } from './ui.js';
import { api } from './api.js';

const gb = (b) => `${(b / 1e9).toFixed(1)} GB`;
let poll = null;

function paint(st) {
  const where = $('#folderWhere');
  const line = (dt, path, more) => [h('dt', {}, dt), h('dd', {}, h('code', {}, path || '—'), more ? ` ${more}` : '')];
  const holds = st.holds || {};
  where.replaceChildren(
    ...line('Agents', st.agents, st.holds ? `(${holds.agents} agent${holds.agents === 1 ? '' : 's'})` : ''),
    ...line('People', st.people, st.holds ? (holds.people ? '(recorded)' : '(nobody yet)') : ''),
    ...(st.models ? line('Models', st.models, st.holds ? `(${gb(holds.models)})` : '') : []));
  $('#folderMove').hidden = !st.movable;
  $('#folderBack').hidden = !st.movable || !st.dir;
  const m = st.moving;
  const busy = !!(m && (m.phase === 'copying' || m.phase === 'done'));
  $('#folderMove').disabled = busy; $('#folderBack').disabled = busy;
  $('#folderStatus').textContent = !st.movable ? 'Run by itself (npm run server), VIK uses the folders given to it (--agents, VIK_AGENTS); the app moves its folder here.'
    : m && m.phase === 'copying' ? `Copying… ${gb(m.copied)} of ${gb(m.bytes)}${m.file ? ` (${m.file})` : ''}. VIK restarts in the new folder when it is done.`
      : m && m.phase === 'done' ? 'Done: VIK restarts in its new folder… The old copies are removed at the next start.'
        : m && m.phase === 'failed' ? `Not moved: ${m.error}. Nothing changed.`
          : st.dir ? `VIK uses the folder ${st.dir}.` : 'VIK uses its usual places (the agents and people in the app\'s settings folder, the models in your user folder).';
  if (busy && !poll) poll = setInterval(refresh, 1000);
  if (!busy && poll) { clearInterval(poll); poll = null; }
}

async function refresh() { try { paint(await api.folder()); } catch { /* the app is restarting */ } }

async function move(dir, asIs) {
  try { await api.moveFolder(dir, asIs); } catch (e) { $('#folderStatus').textContent = `Not moved: ${e.message}`; return; }
  refresh();
}

async function choose() {
  if (window.agent && (window.agent.active || window.agent.state === 'connecting')) { $('#folderStatus').textContent = 'Stop the conversation first: VIK restarts in its new folder.'; return; }
  let r;
  try { r = await api.chooseFolder(); } catch (e) { $('#folderStatus').textContent = e.message; return; }
  if (!r || r.cancelled) return;
  const st = await api.folder();
  if (r.holds && (r.holds.agents || r.holds.people)) {
    // a VIK folder already (a shared folder, another computer's): used as it is, nothing copied
    if (confirm(`${r.dir} already holds ${r.holds.agents} agent${r.holds.agents === 1 ? '' : 's'}${r.holds.people ? ' and people recorded' : ''}.\n\nUse it as VIK's folder, as it is? VIK restarts there. Your current agents stay where they are; models it lacks are downloaded there when needed.`)) move(r.dir, true);
    return;
  }
  const size = st.holds ? ` (${st.holds.agents} agents, ${gb(st.holds.models)} of models)` : '';
  if (confirm(`Move VIK's folder to ${r.dir}?\n\nVIK copies the agents, the people and the models there${size}, then restarts in it. The old copies are removed at the next start.\n\nThe models folder (.qvac\\models) moves too: another program using QVAC's models would download its own again.`)) move(r.dir, false);
}

export function initFolder() {
  $('#folderMove').addEventListener('click', () => choose());
  $('#folderBack').addEventListener('click', () => {
    if (confirm('Move the agents, the people and the models back to VIK\'s usual places? VIK restarts there.')) move('', false);
  });
  refresh();
}
