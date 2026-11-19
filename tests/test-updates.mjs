// Tests the new-version checks (app/electron/updates.cjs) with a fake GitHub and a fake updater: the state the
// studio's Updates window shows, and when it opens by itself.
//   node tests/test-updates.mjs
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { ROOT, check, summary, sleep } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { setupUpdates, updateMode, newer, REPO, PAGE } = require(join(ROOT, 'app', 'electron', 'updates.cjs'));

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

/** A fake app; every state the window would get, and whether it opened by itself. */
function world({ version = '3.1.0' } = {}) {
  const w = { states: [], shows: [], logs: [] };
  w.app = { getVersion: () => version };
  w.notify = (state, show) => { w.states.push(state); if (show) w.shows.push(state); };
  w.log = (m) => w.logs.push(m);
  w.last = () => w.states[w.states.length - 1];
  return w;
}
const github = (tag, calls = []) => async (url, o) => { calls.push({ url, o }); return { ok: true, json: async () => ({ tag_name: tag, html_url: `https://github.com/${REPO}/releases/tag/${tag}` }) }; };
const tagPage = (v) => `https://github.com/${REPO}/releases/tag/v${v}`;

// — run from the source code —
{
  const w = world();
  const u = setupUpdates({ ...w, mode: 'none', fetchImpl: github('v9.0.0'), firstAfterMs: 10 });
  await u.check();
  await sleep(30);
  check(u.state().status === 'source' && u.state().version === '3.1.0' && w.states.length === 0, 'source code: the window shows the version, nothing is checked', u.state());
}

// — the notice (Mac, the .zip) —
{
  const calls = [];
  const w = world();
  const u = setupUpdates({ ...w, mode: 'notice', fetchImpl: github('v3.2.0', calls), firstAfterMs: 10, everyMs: 40 });
  check(u.state().status === 'idle' && u.state().version === '3.1.0', 'notice: before the first check, the window shows the version, "not checked yet"');
  await sleep(120);
  check(calls.length >= 2 && calls[0].url === `https://api.github.com/repos/${REPO}/releases/latest` && calls[0].o.headers['User-Agent'] === 'VIK',
    'notice: asks GitHub for the latest release at launch, then again later (every hour)', calls.map((c) => c.url));
  check(w.last().status === 'available' && w.last().latest === '3.2.0' && w.last().page === tagPage('3.2.0'),
    'notice: "VIK 3.2.0 is available", with its page', w.last());
  check(w.shows.length === 1 && w.shows[0].status === 'available', 'notice: the window opens by itself once only for that version', w.shows.length);
  check(w.states.some((s) => s.status === 'checking'), 'notice: "checking" while GitHub answers');
  await u.check();
  check(u.state().status === 'available' && w.shows.length === 1, 'Check again: still available, the window does not open again by itself');
}
{
  const w = world();
  const u = setupUpdates({ ...w, mode: 'notice', fetchImpl: github('v3.1.0'), firstAfterMs: 10, everyMs: 1e9 });
  await sleep(60);
  check(u.state().status === 'latest' && u.state().latest === '3.1.0' && u.state().checkedAt > 0 && u.state().page === tagPage('3.1.0') && w.shows.length === 0,
    'notice: nothing newer → "the latest version", when it was checked, this version\'s page; nothing opens', u.state());
}
{
  const w = world();
  const down = async () => { throw new Error('fetch failed'); };
  const u = setupUpdates({ ...w, mode: 'notice', fetchImpl: down, firstAfterMs: 10, everyMs: 1e9 });
  await sleep(60);
  check(u.state().status === 'failed' && u.state().error === 'fetch failed' && u.state().page === PAGE && w.shows.length === 0 && w.logs.some((l) => /fetch failed/.test(l)),
    'notice: offline → "could not check" and why, the download page, a line in the server log; nothing opens by itself', u.state());
}
{
  const calls = [];
  const w = world();
  const u = setupUpdates({ ...w, mode: 'notice', enabled: false, fetchImpl: github('v9.0.0', calls), firstAfterMs: 10, everyMs: 20 });
  await sleep(80);
  check(calls.length === 0 && w.states.length === 0, 'config "updates": false → never looks by itself');
  await u.check();
  check(calls.length === 1 && u.state().status === 'available', '… but Check for updates still works');
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
  const w = world();
  const calls = [];
  const u = setupUpdates({ ...w, autoUpdater: au, mode: 'squirrel', platform: 'win32', arch: 'x64', fetchImpl: github('v9.0.0', calls), firstAfterMs: 10, everyMs: 30 });
  check(au.feed && au.feed.url === `https://update.electronjs.org/${REPO}/win32-x64/3.1.0`, 'Windows: the updater asks update.electronjs.org for this repository, platform and version', au.feed);
  await sleep(100);
  check(au.checks >= 2 && calls.length === 0 && u.state().status === 'checking', 'Windows: it checks at launch and again later, through the updater', au.checks);
  au.emit('update-available');
  await sleep(10);
  check(u.state().status === 'downloading' && w.shows.length === 0, 'Windows: a download that starts shows "downloading", and opens nothing');
  check(u.state().latest === '9.0.0' && calls.length === 1, 'Windows: the window says which version downloads (asked of GitHub: the updater does not say)', u.state().latest);
  const n = au.checks;
  await sleep(80);
  check(au.checks === n, 'Windows: no check while it downloads', [n, au.checks]);
  u.install();
  check(au.installs === 0, 'Restart now does nothing before the new version is ready');
  au.emit('update-downloaded', {}, '', 'v3.2.0');
  check(u.state().status === 'ready' && u.state().latest === '3.2.0' && u.state().page === tagPage('3.2.0') && w.shows.length === 1 && w.shows[0].status === 'ready',
    'Windows: once installed, "VIK 3.2.0 is ready", and the window opens by itself', u.state());
  u.install();
  check(au.installs === 1, 'Restart now: restarts into the new version (quitAndInstall)');
  await sleep(80);
  await u.check();
  check(au.checks === n && u.state().status === 'ready', 'Windows: no more checks once the new version is there (it would download it again)', [n, au.checks]);
}
{
  const au = new FakeUpdater();
  const w = world();
  const u = setupUpdates({ ...w, autoUpdater: au, mode: 'squirrel', platform: 'win32', arch: 'x64', firstAfterMs: 1e9, feed: 'http://127.0.0.1:9/feed' });
  check(au.feed.url === 'http://127.0.0.1:9/feed', 'Windows: the tests can give their own update server');
  await u.check();
  check(au.checks === 1 && u.state().status === 'checking', 'Windows, Check for updates: "checking"');
  au.emit('update-not-available');
  check(u.state().status === 'latest' && u.state().latest === '3.1.0', 'Windows: nothing new → "the latest version"', u.state());
  await u.check();
  au.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED'));
  check(u.state().status === 'failed' && u.state().error === 'net::ERR_NAME_NOT_RESOLVED' && w.shows.length === 0, 'Windows, offline: "could not check" and why', u.state());
  au.emit('update-downloaded', {}, '', '');
  check(u.state().status === 'ready' && u.state().latest === '' && au.installs === 0, 'Windows: ready without a name: "a new version is ready"; nothing restarts until asked', u.state());
  au.emit('error', new Error('late'));
  check(u.state().status === 'ready', 'Windows: an error after the new version is ready does not hide it');
}

process.exit(summary() ? 1 : 0);
