// New versions of VIK. At launch, then every hour, VIK looks for a newer release of this repository on GitHub
// (config.json "updates": false turns that off; Files → Check for updates still works).
//   Windows, installed with VIK-Setup: a real update. Electron's updater (Squirrel) asks update.electronjs.org,
//     which reads this repository's releases (the RELEASES and .nupkg files that .github/workflows/release.yml
//     publishes), downloads the new version in the background and installs it next to this one. VIK then offers to
//     restart; "Later": the new version starts next time.
//   Mac (updating requires a code-signed app, and VIK is not signed) and the portable .zip: a notice, with a button
//     to the download page.
//   Run from the source code (npm start): nothing (git pull updates it).
'use strict';
const path = require('node:path');

const REPO = 'b2renger/voice-interaction-kit';
const PAGE = `https://github.com/${REPO}/releases/latest`;

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
 * Starts looking for updates. Returns {check(manual)}: Files → Check for updates calls check(true), which says
 * so when there is nothing new or when it fails. `feed` replaces update.electronjs.org (the tests' own server).
 */
function setupUpdates({
  app, autoUpdater, dialog, shell, getWin, log, mode, enabled = true,
  fetchImpl = globalThis.fetch, firstAfterMs = 15000, everyMs = 3600000,
  platform = process.platform, arch = process.arch, feed = '',
}) {
  const version = app.getVersion();
  const win = () => { const w = getWin(); return w && !w.isDestroyed() ? w : undefined; };
  const box = (o) => dialog.showMessageBox(win(), o);
  let timer = null;
  let manual = false;      // the menu asked: say what happens, even "nothing new"
  let downloaded = false;  // Squirrel has installed the new version: no more checks (it would download it again)
  const told = new Set();  // the versions already announced (a notice once per version and launch)

  const failed = (e) => {
    log(`(updates: ${e.message})`);
    if (!manual) return;
    manual = false;
    box({ type: 'warning', message: 'Could not check for a new version', detail: `${e.message}\n\nThe new versions are on ${PAGE}`, buttons: ['OK', 'Open the download page'], defaultId: 0, cancelId: 0 })
      .then(({ response }) => { if (response === 1) shell.openExternal(PAGE); });
  };
  const upToDate = () => {
    if (!manual) return;
    manual = false;
    box({ type: 'info', message: 'VIK is up to date', detail: `You have the latest version, ${version}.`, buttons: ['OK'] });
  };

  if (mode === 'squirrel') {
    autoUpdater.setFeedURL({ url: feed || `https://update.electronjs.org/${REPO}/${platform}-${arch}/${version}` });
    autoUpdater.on('error', failed);
    autoUpdater.on('update-available', () => {
      log('▸ updates: a new version of VIK is downloading');
      if (manual) { manual = false; box({ type: 'info', message: 'A new version of VIK is downloading', detail: 'VIK will offer to restart once it is ready.', buttons: ['OK'] }); }
    });
    autoUpdater.on('update-not-available', upToDate);
    autoUpdater.on('update-downloaded', async (event, notes, name) => {
      downloaded = true;
      clearInterval(timer);
      log(`▸ updates: ${name || 'a new version'} is installed, it starts with the next launch`);
      const { response } = await box({
        type: 'info',
        message: `A new version of VIK is ready${name ? ` (${name})` : ''}`,
        detail: 'Restart now to use it, or later: it starts the next time you open VIK. Your agents and settings are kept.',
        buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      });
      if (response === 0) autoUpdater.quitAndInstall();
    });
  }

  async function check(fromMenu = false) {
    manual = manual || fromMenu;
    if (mode === 'none') {
      manual = false;
      if (fromMenu) box({ type: 'info', message: 'This VIK runs from the source code', detail: 'Update it with git pull. The installers are on ' + PAGE, buttons: ['OK'] });
      return;
    }
    if (mode === 'squirrel') {
      if (downloaded) { manual = false; if (fromMenu) box({ type: 'info', message: 'A new version of VIK is ready', detail: 'It starts the next time you open VIK.', buttons: ['OK'] }); return; }
      try { autoUpdater.checkForUpdates(); } catch (e) { failed(e); }
      return;
    }
    let latest;
    try { latest = await latestRelease(fetchImpl); } catch (e) { failed(e); return; }
    if (!newer(latest.version, version)) { upToDate(); return; }
    if (told.has(latest.version) && !manual) return;
    manual = false;
    told.add(latest.version);
    log(`▸ updates: VIK ${latest.version} is available (this is ${version})`);
    const { response } = await box({
      type: 'info',
      message: `VIK ${latest.version} is available`,
      detail: `You have ${version}. Download the new installer and open it: your agents and settings are kept.`,
      buttons: ['Open the download page', 'Later'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) shell.openExternal(latest.page);
  }

  if (enabled && mode !== 'none') {
    setTimeout(() => {
      check(false);
      timer = setInterval(() => { if (!downloaded) check(false); }, everyMs);
      if (timer.unref) timer.unref();
    }, firstAfterMs).unref?.();
  }
  return { check, mode };
}

module.exports = { setupUpdates, updateMode, newer, latestRelease, REPO };
