// New versions of VIK. At launch, then every hour, VIK looks for a newer release of this repository on GitHub
// (config.json "updates": false turns that off; Files → Check for updates still works).
//   Windows, installed with VIK-Setup: a real update. Electron's updater (Squirrel) asks update.electronjs.org,
//     which reads this repository's releases (the RELEASES and .nupkg files that .github/workflows/release.yml
//     publishes), downloads the new version in the background and installs it next to this one. VIK then offers to
//     restart; "Later": the new version starts next time.
//   Mac (updating requires a code-signed app, and VIK is not signed) and the portable .zip: a notice, with a link
//     to the download page.
//   Run from the source code (npm start): nothing (git pull updates it).
// What happens is a state ({version, mode, status, latest, page, error, checkedAt}) that the studio shows in its
// Updates window (Files → Check for updates…, Settings → Version), through the server (GET /api/updates).
'use strict';
const path = require('node:path');

const REPO = 'b2renger/voice-interaction-kit';
const PAGE = `https://github.com/${REPO}/releases/latest`;
const pageOf = (version) => `https://github.com/${REPO}/releases/tag/v${String(version).replace(/^v/, '')}`;

/** Is version a newer than version b? "3.10.0" > "3.9.2"; a leading "v" is ignored. */
function newer(a, b) {
  const parts = (v) => String(v || '').replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const x = parts(a); const y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** How this copy of VIK updates: 'squirrel' (Windows, installed by VIK-Setup), 'notice' (any other app), 'none' (source). */
function updateMode({ isPackaged, platform, execPath, exists }) {
  if (!isPackaged) return 'none';
  // Squirrel installs VIK in …\vik\app-3.2.0\VIK.exe, next to its …\vik\Update.exe
  if (platform === 'win32' && exists(path.win32.resolve(path.win32.dirname(execPath), '..', 'Update.exe'))) return 'squirrel';
  return 'notice';
}

/** The latest release on GitHub: {version, page}. */
async function latestRelease(fetchImpl) {
  const r = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VIK' } });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const j = await r.json();
  return { version: String(j.tag_name || '').replace(/^v/, ''), page: String(j.html_url || PAGE) };
}

/**
 * Starts looking for updates. Returns {check(), state(), install()}.
 * status: 'source' (run from the source code), 'idle' (not checked yet), 'checking', 'latest' (up to date),
 *   'downloading' (Windows: the new version is on its way), 'ready' (Windows: installed, starts with the next launch;
 *   install() restarts into it), 'available' (Mac, .zip: a newer installer is on `page`), 'failed' (`error`).
 * notify(state, show): every change; show: open the Updates window by itself (a new version ready or available).
 * `feed` replaces update.electronjs.org (the tests' own server).
 */
function setupUpdates({
  app, autoUpdater, log, mode, enabled = true, notify = () => {},
  fetchImpl = globalThis.fetch, firstAfterMs = 15000, everyMs = 3600000,
  platform = process.platform, arch = process.arch, feed = '', now = Date.now,
}) {
  const version = app.getVersion();
  const st = { version, mode, status: mode === 'none' ? 'source' : 'idle', latest: '', page: pageOf(version), error: '', checkedAt: 0 };
  const set = (o, show = false) => { Object.assign(st, o); notify({ ...st }, show); };
  let timer = null;
  const told = new Set();  // the versions already shown by themselves (once per version and launch)

  const failed = (e) => {
    log(`(updates: ${e.message})`);
    if (st.status !== 'ready') set({ status: 'failed', error: e.message, page: PAGE, checkedAt: now() });
  };

  if (mode === 'squirrel') {
    autoUpdater.setFeedURL({ url: feed || `https://update.electronjs.org/${REPO}/${platform}-${arch}/${version}` });
    autoUpdater.on('error', failed);
    autoUpdater.on('update-available', () => {
      log('▸ updates: a new version of VIK is downloading');
      set({ status: 'downloading', error: '', page: PAGE, checkedAt: now() });
      // the updater does not say which version: GitHub does, for the window (nothing if it can't)
      latestRelease(fetchImpl).then((l) => { if (st.status === 'downloading' && newer(l.version, version)) set({ latest: l.version, page: l.page }); }, () => {});
    });
    autoUpdater.on('update-not-available', () => set({ status: 'latest', latest: version, error: '', page: pageOf(version), checkedAt: now() }));
    autoUpdater.on('update-downloaded', (event, notes, name) => {
      clearInterval(timer);          // no more checks: it would download it again
      const latest = String(name || '').replace(/^v/, '') || (newer(st.latest, version) ? st.latest : '');
      log(`▸ updates: ${latest ? `VIK ${latest}` : 'a new version'} is installed, it starts with the next launch`);
      set({ status: 'ready', latest, error: '', page: latest ? pageOf(latest) : PAGE }, true);
    });
  }

  async function check() {
    // nothing to do from the source code, nor while the new version downloads (it ends 'ready' or 'failed')
    if (mode === 'none' || st.status === 'ready' || st.status === 'downloading') return;
    set({ status: 'checking', error: '' });
    if (mode === 'squirrel') {
      try { autoUpdater.checkForUpdates(); } catch (e) { failed(e); }
      return;
    }
    let latest;
    try { latest = await latestRelease(fetchImpl); } catch (e) { failed(e); return; }
    if (!newer(latest.version, version)) { set({ status: 'latest', latest: version, page: pageOf(version), checkedAt: now() }); return; }
    const show = !told.has(latest.version);
    told.add(latest.version);
    if (show) log(`▸ updates: VIK ${latest.version} is available (this is ${version})`);
    set({ status: 'available', latest: latest.version, page: latest.page, checkedAt: now() }, show);
  }

  if (enabled && mode !== 'none') {
    setTimeout(() => {
      check();
      timer = setInterval(() => { if (st.status !== 'ready') check(); }, everyMs);
      if (timer.unref) timer.unref();
    }, firstAfterMs).unref?.();
  }
  return {
    check,
    mode,
    state: () => ({ ...st }),
    /** Restarts into the new version (Windows, once it is ready). */
    install() { if (mode === 'squirrel' && st.status === 'ready') autoUpdater.quitAndInstall(); },
  };
}

module.exports = { setupUpdates, updateMode, newer, latestRelease, REPO, PAGE };
