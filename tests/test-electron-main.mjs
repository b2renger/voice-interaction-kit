// Tests electron/main.cjs under Node, with a fake "electron" module (Electron is not needed):
// the server starts INSIDE the app, the window opens the lab window page, the mic is granted only to it,
// the menus exist, and quitting closes the server.
//   node tests/test-electron-main.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT, check, summary, until, sleep } from './helpers.mjs';

// require('electron') always gets the stub, even when 2_qvac_local/node_modules has the real package
// (which, outside Electron, only exports the path to the Electron binary).
const require = createRequire(import.meta.url);
const { Module } = require('node:module');
const ELECTRON_STUB = join(ROOT, 'tests', 'electron-stub', 'electron', 'index.js');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request === 'electron' ? ELECTRON_STUB : request, ...rest);
};
process.argv.push('--mock');
const { handleSquirrelEvent } = require(join(ROOT, '2_qvac_local', 'electron', 'main.cjs'));
const st = globalThis.__electronStub;

// the Windows installer (Squirrel): shortcuts then immediate exit, with no server and no window
{
  const calls = [];
  let quits = 0;
  const fakeSpawn = (exe, args) => { calls.push({ exe, args }); return { on() { return this; }, unref() {} }; };
  const sq = (argv, platform = 'win32') => handleSquirrelEvent({
    argv: ['VoiceLab.exe', ...argv], platform, execPath: 'C:\\Users\\e\\AppData\\Local\\voice_lab\\app-1.0.0\\VoiceLab.exe',
    spawn: fakeSpawn, quit: () => { quits++; },
  });
  check(sq(['--squirrel-install', '1.0.0']) === true && calls[0] && /voice_lab\\Update\.exe$/.test(calls[0].exe) && calls[0].args[0] === '--createShortcut=VoiceLab.exe',
    'Squirrel: on install, creates the shortcuts through Update.exe and quits', calls[0]);
  check(sq(['--squirrel-updated', '1.0.1']) === true && calls[1].args[0] === '--createShortcut=VoiceLab.exe', 'Squirrel: on update, same');
  check(sq(['--squirrel-uninstall', '1.0.0']) === true && calls[2].args[0] === '--removeShortcut=VoiceLab.exe', 'Squirrel: on uninstall, removes the shortcuts');
  check(sq(['--squirrel-obsolete']) === true && calls.length === 3, 'Squirrel: an obsolete version quits without launching anything');
  check(sq(['--squirrel-firstrun']) === false && sq([]) === false && sq(['--squirrel-install'], 'darwin') === false,
    'Squirrel: first run, normal launch and Mac start the app');
  await sleep(1100);
  check(quits === 4, 'Squirrel: quits after each install event', quits);
}

const win = await until(() => st.windows[0] && st.windows[0].url && st.windows[0], 10000);
check(!!win, 'a window opens', st.errors);
check(win && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(win.url), 'it shows the lab window page served by the app', win && win.url);
check(win && win.opts.webPreferences.contextIsolation === true && win.opts.webPreferences.nodeIntegration === false, 'the page has no access to Node (isolation)');
check(win && /simulated engine/.test(win.opts.title), 'the title says "simulated engine" with --mock', win && win.opts.title);
const base = win.url.replace(/\/$/, '');
const health = await until(async () => { try { const h = await (await fetch(base + '/health')).json(); return h.models === 'ready' && h; } catch { return false; } }, 8000);
check(health && health.engine === 'mock' && /^ws:\/\/localhost:\d+\/voice$/.test(health.wsUrl), 'the voice server runs inside the app (address for cables)', health);
const core = await (await fetch(base + '/voice-core.js')).text();
check(/const VoiceCore/.test(core), 'the shared core is served');

// the microphone
const ask = (url, perm = 'media') => new Promise((r) => st.permissionRequest({ getURL: () => url }, perm, r, { requestingUrl: url }));
check(await ask(base + '/'), 'mic granted to the lab window page');
check(await ask(base.replace('127.0.0.1', 'localhost') + '/'), 'mic also granted through localhost');
check(!(await ask('https://example.com/')), 'mic refused to any other page');
check(!(await ask(base + '/', 'geolocation')), 'other permissions refused');
check(st.permissionCheck(null, 'media', base) === true && st.permissionCheck(null, 'media', 'https://example.com') === false, 'consistent permission check');

// the menus
const labels = JSON.stringify(st.menu || []);
check(/Engine/.test(labels) && /Simulated/.test(labels) && /models folder/.test(labels) && /Copy address for cables/.test(labels), 'menus: engine, folders, cables address');
const engineMenu = st.menu.find((m) => m.label === 'Engine');
engineMenu.submenu.find((i) => /cables/.test(i.label || '')).click();
check(st.clipboard === health.wsUrl, '"Copy address for cables.gl" copies the WebSocket address', st.clipboard);
engineMenu.submenu.find((i) => /QVAC/.test(i.label || '')).click();
check(st.relaunched && !st.relaunched.args.includes('--mock') && st.exited === 0, 'switching to the QVAC engine relaunches the app without --mock', st.relaunched);

// external links open in the browser
check(win.openHandler({ url: 'https://cables.gl' }).action === 'deny', 'external links do not open inside the app');

// quitting closes the server
const { app } = (await import('node:module')).createRequire(import.meta.url)('electron');
app.quit();
await sleep(600);
let closed = false;
try { await fetch(base + '/health'); } catch { closed = true; }
check(closed, 'quitting stops the server');
check(st.errors.length === 0, 'no error box', st.errors);
process.exit(summary() ? 1 : 0);
