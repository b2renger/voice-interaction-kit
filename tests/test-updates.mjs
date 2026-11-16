// Tests the new-version checks (app/electron/updates.cjs) with a fake GitHub, a fake updater and fake dialogs.
//   node tests/test-updates.mjs
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { ROOT, check, summary, sleep } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { setupUpdates, updateMode, newer, REPO } = require(join(ROOT, 'app', 'electron', 'updates.cjs'));

// — versions —
check(newer('3.2.0', '3.1.0') && newer('v3.10.0', '3.9.9') && newer('4.0.0', '3.99.99') && !newer('3.1.0', '3.1.0') && !newer('3.0.9', '3.1.0') && !newer('', '3.1.0'),
  'newer: by numbers ("3.10.0" > "3.9.9"), a leading "v" ignored, equal is not newer');

// — how each copy updates —
const exe = 'C:\\Users\\e\\AppData\\Local\\vik\\app-3.1.0\\VIK.exe';
const updateExe = 'C:\\Users\\e\\AppData\\Local\\vik\\Update.exe';
check(updateMode({ isPackaged: true, platform: 'win32', execPath: exe, exists: (f) => f === updateExe }) === 'squirrel', 'Windows, installed by VIK-Setup (Update.exe next to app-x.y.z): the real updater');
check(updateMode({ isPackaged: true, platform: 'win32', execPath: 'D:\\VIK-win32-x64\\VIK.exe', exists: () => false }) === 'notice', 'Windows, the portable .zip: a notice');
check(updateMode({ isPackaged: true, platform: 'darwin', execPath: '/Applications/VIK.app/Contents/MacOS/VIK', exists: () => true }) === 'notice', 'Mac (not code-signed): a notice');
check(updateMode({ isPackaged: false, platform: 'win32', execPath: exe, exists: () => true }) === 'none', 'from the source code: nothing');

/** A fake app, dialogs and shell; answers: the button chosen in each dialog, in order. */
function world({ answers = [], version = '3.1.0' } = {}) {
  const w = { shown: [], opened: [], logs: [], answers: [...answers] };
  w.app = { getVersion: () => version };
  w.dialog = { showMessageBox: (win, o) => { w.shown.push(o); return Promise.resolve({ response: w.answers.length ? w.answers.shift() : 1 }); } };
  w.shell = { openExternal: (u) => { w.opened.push(u); return Promise.resolve(); } };
  w.log = (m) => w.logs.push(m);
  w.getWin = () => null;
  return w;
}
const github = (tag, calls = []) => async (url, o) => { calls.push({ url, o }); return { ok: true, json: async () => ({ tag_name: tag, html_url: `https://github.com/${REPO}/releases/tag/${tag}` }) }; };

// — the notice (Mac, the .zip) —
{
  const calls = [];
  const w = world({ answers: [0] });
  const u = setupUpdates({ ...w, mode: 'notice', fetchImpl: github('v3.2.0', calls), firstAfterMs: 10, everyMs: 40 });
  await sleep(120);
  check(calls.length >= 2 && calls[0].url === `https://api.github.com/repos/${REPO}/releases/latest` && calls[0].o.headers['User-Agent'] === 'VIK',
    'notice: asks GitHub for the latest release at launch, then again later (every hour)', calls.map((c) => c.url));
  check(w.shown.length === 1 && w.shown[0].message === 'VIK 3.2.0 is available' && /You have 3\.1\.0/.test(w.shown[0].detail),
    'notice: "VIK 3.2.0 is available", once only for that version', w.shown.map((s) => s.message));
  check(w.opened[0] === `https://github.com/${REPO}/releases/tag/v3.2.0`, '"Open the download page" opens that release', w.opened);
  await u.check(true);
  check(w.shown.length === 2 && w.shown[1].message === 'VIK 3.2.0 is available', 'Files → Check for updates: says it again when asked');
}
{
  const w = world();
  const u = setupUpdates({ ...w, mode: 'notice', fetchImpl: github('v3.1.0'), firstAfterMs: 10, everyMs: 1e9 });
  await sleep(60);
  check(w.shown.length === 0, 'notice: nothing newer → nothing shown at launch');
  await u.check(true);
  check(w.shown.length === 1 && w.shown[0].message === 'VIK is up to date' && /3\.1\.0/.test(w.shown[0].detail), 'Files → Check for updates: "VIK is up to date"', w.shown);
}
{
  const w = world({ answers: [1] });
  const down = async () => { throw new Error('fetch failed'); };
  const u = setupUpdates({ ...w, mode: 'notice', fetchImpl: down, firstAfterMs: 10, everyMs: 1e9 });
  await sleep(60);
  check(w.shown.length === 0 && w.logs.some((l) => /fetch failed/.test(l)), 'notice: offline at launch → only a line in the server log');
  await u.check(true);
  await sleep(10);
  check(w.shown.length === 1 && w.shown[0].message === 'Could not check for a new version' && w.opened[0] === `https://github.com/${REPO}/releases/latest`,
    'Files → Check for updates, offline: says so, with a button to the download page', [w.shown, w.opened]);
}
{
  const calls = [];
  const w = world();
  const u = setupUpdates({ ...w, mode: 'notice', enabled: false, fetchImpl: github('v9.0.0', calls), firstAfterMs: 10, everyMs: 20 });
  await sleep(80);
  check(calls.length === 0 && w.shown.length === 0, 'config "updates": false → never looks by itself');
  await u.check(true);
  check(calls.length === 1 && w.shown.length === 1, '… but Files → Check for updates still works');
}

// — the real updater (Windows, installed) —
class FakeUpdater extends EventEmitter {
  constructor() { super(); this.feed = null; this.checks = 0; this.installs = 0; }
  setFeedURL(o) { this.feed = o; }
  checkForUpdates() { this.checks++; }
  quitAndInstall() { this.installs++; }
}
{
  const au = new FakeUpdater();
  const w = world({ answers: [0] });
  const calls = [];
  setupUpdates({ ...w, autoUpdater: au, mode: 'squirrel', platform: 'win32', arch: 'x64', fetchImpl: github('v9.0.0', calls), firstAfterMs: 10, everyMs: 30 });
  check(au.feed && au.feed.url === `https://update.electronjs.org/${REPO}/win32-x64/3.1.0`, 'Windows: the updater asks update.electronjs.org for this repository, platform and version', au.feed);
  await sleep(100);
  check(au.checks >= 2 && calls.length === 0, 'Windows: it checks at launch and again later (never through the notice)', au.checks);
  au.emit('update-available');
  check(w.shown.length === 0, 'Windows: a download that starts is silent');
  au.emit('update-downloaded', {}, '', 'v3.2.0');
  await sleep(10);
  check(w.shown.length === 1 && w.shown[0].message === 'A new version of VIK is ready (v3.2.0)' && w.shown[0].buttons[0] === 'Restart now',
    'Windows: once installed, "A new version of VIK is ready", Restart now / Later', w.shown);
  check(au.installs === 1, '"Restart now" restarts into the new version (quitAndInstall)');
  const n = au.checks;
  await sleep(100);
  check(au.checks === n, 'Windows: no more checks once the new version is there (it would download it again)', [n, au.checks]);
}
{
  const au = new FakeUpdater();
  const w = world({ answers: [1] });
  const u = setupUpdates({ ...w, autoUpdater: au, mode: 'squirrel', platform: 'win32', arch: 'x64', firstAfterMs: 1e9, feed: 'http://127.0.0.1:9/feed' });
  check(au.feed.url === 'http://127.0.0.1:9/feed', 'Windows: the tests can give their own update server');
  await u.check(true);
  au.emit('update-not-available');
  await sleep(10);
  check(au.checks === 1 && w.shown.length === 1 && w.shown[0].message === 'VIK is up to date', 'Windows, Files → Check for updates: "VIK is up to date"');
  await u.check(true);
  au.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED'));
  await sleep(10);
  check(w.shown.length === 2 && w.shown[1].message === 'Could not check for a new version', 'Windows, Files → Check for updates, offline: says so');
  au.emit('error', new Error('again'));
  await sleep(10);
  check(w.shown.length === 2 && w.logs.some((l) => /again/.test(l)), 'Windows: an error on a check of its own → the server log only');
  au.emit('update-downloaded', {}, '', '');
  await sleep(10);
  check(w.shown[2] && w.shown[2].message === 'A new version of VIK is ready' && au.installs === 0, '"Later": nothing restarts (the new version starts next time)');
}

process.exit(summary() ? 1 : 0);
