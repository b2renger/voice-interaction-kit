// The Updates window: this version of VIK, and the new ones (Files → Check for updates…, Settings → Version).
// The state comes from app/electron/updates.cjs, through the server (GET /api/updates); while the window is open it
// is read again every second, so "checking", "downloading" and "ready" show as they happen.
import { $ } from './ui.js';
import { api } from './api.js';

let st = null;
let poll = null;

const MODE = {
  squirrel: 'VIK updates itself: it looks for a new version when it starts, then every hour.',
  notice: 'VIK says when a new version is out: download it and open it to install it.',
  none: 'This VIK runs from the source code: git pull updates it. The installers are on the Releases page.',
};
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** What the window says for a state: [status, how, link label or '' (no link)]. */
export function describe(s) {
  const v = s.latest ? `VIK ${s.latest}` : 'A new version';
  switch (s.status) {
    case 'checking': return ['Looking for a new version…', MODE[s.mode] || '', ''];
    case 'latest': return [`This is the latest version.${s.checkedAt ? ` Checked at ${time(s.checkedAt)}.` : ''}`, MODE[s.mode] || '', 'What\'s new'];
    case 'downloading': return [`${v} is downloading.`, 'It installs itself in the background, then VIK offers to restart.', ''];
    case 'ready': return [`${v} is ready.`, 'Restart now to use it, or later: it starts the next time you open VIK. Your agents and settings are kept.', 'What\'s new'];
    case 'available': return [`${v} is available.`, 'Download the new installer and open it: your agents and settings are kept.', 'Open the download page'];
    case 'failed': return [`Could not check for a new version: ${s.error}`, 'The network may block GitHub. The new versions are on the Releases page.', 'Open the download page'];
    case 'source': return ['', MODE.none, ''];
    default: return ['Not checked yet.', MODE[s.mode] || '', ''];
  }
}

function paint() {
  if (!st) return;
  const [status, how, link] = describe(st);
  $('#updTitle').textContent = st.version ? `VIK ${st.version}` : 'VIK';
  $('#updStatus').textContent = status;
  $('#updStatus').hidden = !status;
  $('#updHow').textContent = how;
  const page = $('#updPage');
  page.hidden = !link || !st.page;
  page.textContent = link;
  if (st.page) page.href = st.page;
  page.classList.toggle('quiet', link === 'What\'s new');
  $('#updCheck').hidden = st.status === 'source';
  $('#updCheck').disabled = ['checking', 'downloading', 'ready'].includes(st.status);
  $('#updInstall').hidden = st.status !== 'ready';
  const news = ['ready', 'available'].includes(st.status) && st.latest ? `, VIK ${st.latest} is ${st.status === 'ready' ? 'ready' : 'available'}` : '';
  $('#appVersion').textContent = `${st.version ? `VIK ${st.version}` : 'VIK'}${news}`;
}

async function refresh() {
  try { st = await api.updates(); paint(); } catch { /* the server is restarting */ }
}

/** Opens the window; check: look for a new version at once (Files → Check for updates…). */
async function open(check = false) {
  const dlg = $('#updatesDlg');
  if (!dlg.open) dlg.showModal();
  if (check) { try { st = await api.checkUpdates(); } catch { /* shown by the next read */ } }
  await refresh();
  clearInterval(poll);
  poll = setInterval(refresh, 1000);
}

export function initUpdates() {
  $('#updatesDlg').addEventListener('close', () => { clearInterval(poll); poll = null; });
  $('#checkUpdates').addEventListener('click', () => open(true));
  $('#updCheck').addEventListener('click', async () => { try { st = await api.checkUpdates(); paint(); } catch { /* next read */ } });
  $('#updInstall').addEventListener('click', () => api.installUpdate().catch(() => {}));
  // the app's menu (Files → Check for updates…), and a new version ready or available (app/electron/main.cjs)
  window.vikUpdates = (check) => open(!!check);
  refresh();
}
