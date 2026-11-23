// The VIK app: the voice server runs INSIDE the app, and the window shows the studio.
// While the app is open, the cables op ("Local" engine) can connect to it.
'use strict';

const { app, BrowserWindow, Menu, shell, dialog, session, systemPreferences, clipboard, autoUpdater } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { setupUpdates, updateMode } = require('./updates.cjs');
const folder = require('./folder.cjs');

const APP_DIR = path.join(__dirname, '..');
const MOCK = process.argv.includes('--mock') || process.env.VOICE_ENGINE === 'mock';

/**
 * Windows: the installer (Squirrel) launches the app with --squirrel-install, --squirrel-updated,
 * --squirrel-uninstall or --squirrel-obsolete. The app must then create or remove the shortcuts
 * (desktop, Start menu) and quit right away, with no server and no window.
 * Equivalent to the "electron-squirrel-startup" module, without the dependency.
 */
function handleSquirrelEvent({
  argv = process.argv,
  platform = process.platform,
  execPath = process.execPath,
  spawn = require('node:child_process').spawn,
  quit = () => app.quit(),
} = {}) {
  if (platform !== 'win32') return false;
  const cmd = argv.find((a) => typeof a === 'string' && a.startsWith('--squirrel-'));
  if (!cmd || cmd === '--squirrel-firstrun') return false;   // first launch: start normally
  const updateExe = path.win32.resolve(path.win32.dirname(execPath), '..', 'Update.exe');
  const exeName = path.win32.basename(execPath);
  const run = (args) => {
    try { spawn(updateExe, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch (_) { /* nothing */ }
  };
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') run([`--createShortcut=${exeName}`]);
  else if (cmd === '--squirrel-uninstall') run([`--removeShortcut=${exeName}`]);
  // --squirrel-obsolete (old version replaced) and any other event: quit as well.
  setTimeout(quit, cmd === '--squirrel-obsolete' ? 0 : 1000);
  return true;
}

const SQUIRREL = handleSquirrelEvent();

// Required by QVAC on Linux (no Linux build is published). The window only ever shows the studio (will-navigate below).
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

let win = null;
let srv = null;
let updates = null;      // new versions of VIK (electron/updates.cjs)
let quitting = false;
const logLines = [];

function log(m) {
  const line = `[${new Date().toLocaleTimeString('en-GB')}] ${m}`;
  logLines.push(line);
  if (logLines.length > 500) logLines.shift();
  console.log(line);
}

/** The settings: the app's own, completed by the user's (settings folder). */
function userDir() { return app.getPath('userData'); }
function userConfigPath() { return path.join(userDir(), 'config.json'); }
/**
 * The VIK folder (Settings → VIK folder, electron/folder.cjs): the agents, the people, the models. Read once per
 * launch; a chosen folder is also the home QVAC's worker keeps its models in (SNAP_USER_COMMON).
 */
let place = null;
function where() {
  if (!place) {
    const p = folder.readPointer(userDir());
    place = folder.layoutOf(p.dir, userDir());
    if (p.dir) process.env.SNAP_USER_COMMON = p.dir;
  }
  return place;
}
function agentsDir() { return where().agents; }
function modelsDir() { return where().models; }
function openModelsFolder() { fs.mkdirSync(modelsDir(), { recursive: true }); shell.openPath(modelsDir()); }
/** The settings folder of the app's earlier name ("Voice Lab"): its personas become agents, its config.json is kept. */
function oldUserDir() { return path.join(app.getPath('appData'), 'Voice Lab'); }

/** Once: the config.json of the earlier "Voice Lab" app, if this app has none. */
function adoptOldConfig() {
  const old = path.join(oldUserDir(), 'config.json');
  if (fs.existsSync(userConfigPath()) || !fs.existsSync(old)) return;
  try {
    fs.mkdirSync(userDir(), { recursive: true });
    fs.copyFileSync(old, userConfigPath());
    log(`▸ settings of the earlier "Voice Lab" app kept: ${userConfigPath()}`);
  } catch (e) { log(`(the earlier settings could not be copied: ${e.message})`); }
}

async function loadAppConfig() {
  const { loadConfig, mergeConfig } = await import(pathToFileURL(path.join(APP_DIR, 'src', 'config.mjs')).href);
  const base = loadConfig(path.join(APP_DIR, 'config.json'));
  const userFile = userConfigPath();
  if (!fs.existsSync(userFile)) return base;
  try {
    const user = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    return mergeConfig(base, user);       // each section merged (models, turn, defaults)
  } catch (e) {
    dialog.showErrorBox('Unreadable settings', `The file ${userFile} is not valid JSON: ${e.message}\nThe app is using the original settings.`);
    return base;
  }
}

/** The studio's own pages (http://127.0.0.1:<port>/…). */
let ours = () => false;
/** The microphone, and writing to the clipboard (Settings → Clients → Copy): only for the app's own page. */
const GRANTED = ['media', 'clipboard-sanitized-write'];
function setupPermissions(port) {
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  ours = (url) => typeof url === 'string' && origins.some((o) => url === o || url.startsWith(o + '/'));
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = GRANTED.includes(permission) && ours(details.requestingUrl || wc.getURL());
    callback(ok);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => GRANTED.includes(permission) && ours(requestingOrigin));
}

async function askMacMicrophone() {
  if (process.platform !== 'darwin') return;
  const st = systemPreferences.getMediaAccessStatus('microphone');
  if (st === 'granted') return;
  const ok = await systemPreferences.askForMediaAccess('microphone');
  if (!ok) {
    dialog.showMessageBox({
      type: 'warning',
      message: 'Microphone access is denied',
      detail: 'Allow VIK in System Settings → Privacy & Security → Microphone, then restart the app.',
    });
  }
}

function relaunch(withMock) {
  const args = process.argv.slice(1).filter((a) => a !== '--mock');
  if (withMock) args.push('--mock');
  app.relaunch({ args });
  app.exit(0);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about', label: 'About' }, { type: 'separator' }, { role: 'hide', label: 'Hide' }, { role: 'quit', label: 'Quit' }] }] : []),
    {
      label: 'Engine',
      submenu: [
        { label: 'QVAC (local models)', type: 'radio', checked: !MOCK, click: () => { if (MOCK) relaunch(false); } },
        { label: 'Simulated (no models, to design the interface)', type: 'radio', checked: MOCK, click: () => { if (!MOCK) relaunch(true); } },
        { type: 'separator' },
        { label: 'Copy address for clients (cables.gl, p5.js…)', click: () => { if (srv) clipboard.writeText(srv.wsUrl); } },
      ],
    },
    {
      label: 'Files',
      submenu: [
        // the agent's edits, on disk now (they are also saved a moment after you type): app/public/js/main.js
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => { if (win) win.webContents.executeJavaScript('window.vikSave && window.vikSave()').catch(() => {}); } },
        { type: 'separator' },
        ...(MOCK ? [] : [{ label: 'Download all models (once)…', click: () => offerInstall(true) }]),
        { label: 'Open agents folder', click: () => { fs.mkdirSync(agentsDir(), { recursive: true }); shell.openPath(agentsDir()); } },
        { label: 'Open models folder', click: openModelsFolder },
        {
          label: 'Open settings folder (config.json)',
          click: () => {
            fs.mkdirSync(userDir(), { recursive: true });
            // only what the user changes: a full copy would hide every setting a later version of the app changes
            if (!fs.existsSync(userConfigPath())) {
              fs.writeFileSync(userConfigPath(), `${JSON.stringify({
                _help: `Only the keys written here replace the app's settings. All the keys: ${path.join(APP_DIR, 'config.json')}`,
                defaults: {},
              }, null, 2)}\n`);
            }
            shell.openPath(userDir());
          },
        },
        { label: 'Server log', click: () => showLog() },
        { label: 'Check for updates…', click: () => showUpdates(true) },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Quit' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload page' },
        { role: 'toggleDevTools', label: 'Developer tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual size' },
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom out' },
        { role: 'togglefullscreen', label: 'Full screen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Downloads every model once, all the voices included: afterwards, neither relaunching nor changing the voice
 * downloads anything, and the app works offline. Offered when the app is ready, and from the Files menu.
 */
async function offerInstall(fromMenu) {
  const missing = srv.models().filter((m) => !m.file);
  if (!missing.length) {
    if (fromMenu) dialog.showMessageBox(win, { type: 'info', message: 'All the models are on this computer.', detail: 'VIK works without the internet.' });
    return;
  }
  const noPrompt = path.join(userDir(), 'no-download-prompt');
  if (!fromMenu && fs.existsSync(noPrompt)) return;
  const gb = missing.reduce((s, m) => s + m.size, 0) / 1e9;
  const p2p = missing.some((m) => m.p2pOnly);
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'question',
    message: `Download all the models now? (${gb.toFixed(1)} GB, once)`,
    detail: `Missing: ${missing.map((m) => m.stage).join(', ')}.\n\nAfterwards, nothing downloads again, not even when you change the voice, and VIK works without the internet.`
      + (p2p ? '\n\nThe voices come from QVAC\'s peer-to-peer network, which some networks (schools, companies) block.' : ''),
    buttons: ['Download everything', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    ...(fromMenu ? {} : { checkboxLabel: 'Don\'t ask again at launch (Files → Download all models)' }),
  });
  if (checkboxChecked) fs.writeFileSync(noPrompt, '');
  if (response !== 0) return;
  const failed = await srv.install();
  if (!failed.length) {
    dialog.showMessageBox(win, { type: 'info', message: 'All the models are on this computer.', detail: 'VIK works without the internet.' });
    return;
  }
  // the voices' mirror (config "modelMirror"): its page, to download them by hand
  const url = (failed.find((m) => m.mirror) || {}).mirror;
  const page = url ? url.slice(0, url.lastIndexOf('/')).replace('/releases/download/', '/releases/tag/') : '';
  const { response: chosen } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: `${failed.length} model${failed.length > 1 ? 's' : ''} could not be downloaded`,
    detail: `${failed.map((m) => m.stage).join(', ')}. The reason is in Files → Server log.\n\n`
      + (page
        ? `The voices can also be downloaded by hand from ${page}: put the files in the models folder (Files → Open models folder), then restart VIK. `
          + 'Or copy that folder from a computer that has the models.'
        : failed.some((m) => m.p2pOnly)
          ? 'If this network blocks QVAC\'s peer-to-peer network: connect once to another one (home Wi-Fi, a phone hotspot) and choose Files → Download all models again, '
            + 'or copy the models folder (Files → Open models folder) from a computer that has them.'
          : 'Check the internet connection and choose Files → Download all models again.'),
    buttons: page ? ['OK', 'Open the download page', 'Open models folder'] : ['OK'],
    defaultId: 0,
    cancelId: 0,
  });
  if (chosen === 1) shell.openExternal(page);
  if (chosen === 2) openModelsFolder();
}

/**
 * The studio's Updates window (app/public/js/updates.js): this version, and what the last check found. A page that
 * cannot open it yet (loading, reloading) opens it once loaded: a new version ready must not go unseen.
 */
let updatesPending = null;
function showUpdates(check) {
  const later = () => { updatesPending = { check: updatesPending ? updatesPending.check || check : check }; };
  if (!win || win.isDestroyed()) { later(); return; }
  win.webContents.executeJavaScript(`window.vikUpdates ? (window.vikUpdates(${check ? 'true' : 'false'}), true) : false`)
    .then((opened) => { if (!opened) later(); }, later);
}

function showLog() {
  dialog.showMessageBox(win, { type: 'info', message: 'Server log', detail: logLines.slice(-40).join('\n') || '(empty)' });
}

/**
 * Settings → VIK folder, for the studio (through the server: /api/folder). Moving copies the agents, the people
 * and the models to the folder chosen, then VIK restarts there; the next launch removes the old copies.
 */
let moving = null;            // {phase: 'copying'|'done'|'failed', copied, bytes, file, error}
const folderApi = {
  state() { const l = where(); return { movable: true, dir: l.dir, agents: l.agents, people: l.people, models: l.models, holds: folder.contentOf(l), moving }; },
  async choose() {
    const r = await dialog.showOpenDialog(win, { title: 'The VIK folder: agents, people, models', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { cancelled: true };
    const dir = r.filePaths[0];
    return { dir, holds: folder.contentOf(folder.layoutOf(dir, userDir())) };
  },
  /** dir '' = back to the usual places; asIs: a folder that already holds agents, used without copying anything. */
  move(dir, { asIs = false } = {}) {
    if (moving && moving.phase === 'copying') throw new Error('A move is already running.');
    const from = where();
    const to = folder.layoutOf(String(dir || ''), userDir());
    const restart = () => setTimeout(() => { app.relaunch(); app.quit(); }, 1200);
    if (asIs) {
      if (!to.dir) throw new Error('Choose a folder.');
      folder.writePointer(userDir(), { dir: to.dir });
      log(`▸ VIK folder: ${to.dir}, used as it is; VIK restarts there`);
      moving = { phase: 'done', copied: 0, bytes: 0, file: '' };
      restart();
      return moving;
    }
    const held = folder.contentOf(to);
    if (to.dir && (held.agents || held.people)) throw new Error('This folder already holds agents: use it as it is, or choose an empty folder.');
    const plan = folder.planMove(from, to);                  // refuses the same place, too little room, no writing
    moving = { phase: 'copying', copied: 0, bytes: plan.bytes, file: '' };
    log(`▸ VIK folder: moving to ${to.dir || 'the usual places'} (${(plan.bytes / 1e9).toFixed(1)} GB to copy)`);
    folder.copyAll(plan, (p) => { moving = { phase: 'copying', ...p }; })
      .then(() => {
        folder.writePointer(userDir(), { dir: to.dir, previous: from.dir });
        moving = { phase: 'done', copied: plan.bytes, bytes: plan.bytes, file: '' };
        log('▸ VIK folder: copied; VIK restarts there');
        restart();
      }, (e) => { moving = { phase: 'failed', error: e.message }; log(`✖ VIK folder: ${e.message} (nothing changed)`); });
    return moving;
  },
};

async function start() {
  adoptOldConfig();
  where();                      // the VIK folder first: QVAC's worker, started with the server, takes its models' home from it
  // a move finished last time: the old copies go, now that nothing uses them (only those found again here)
  const pointer = folder.readPointer(userDir());
  if (pointer.previous != null) {
    const r = folder.removeOld(folder.layoutOf(pointer.previous, userDir()), where());
    log(`▸ VIK folder: now ${where().dir || 'the usual places'}; ${r.removed} old files removed${r.kept ? `, ${r.kept} kept (not found here)` : ''}`);
    folder.writePointer(userDir(), { dir: pointer.dir });
  }
  const config = await loadAppConfig();
  const { startServer } = await import(pathToFileURL(path.join(APP_DIR, 'src', 'app-server.mjs')).href);
  try {
    srv = await startServer({
      config,
      mock: MOCK,
      log,
      agentsDir: agentsDir(),
      peopleFile: where().people,                          // before 3.8, the people of this computer: copied into each agent once
      folder: () => folderApi,                              // Settings → VIK folder
      updates: () => updates,                                 // new versions, for the studio's Updates window
      // the personas of earlier versions become agents (first launch only)
      legacyDirs: [path.join(oldUserDir(), 'personas'), path.join(userDir(), 'personas')],
      onStatus: ({ text, progress }) => {
        if (!win || win.isDestroyed()) return;
        win.setProgressBar(typeof progress === 'number' && progress < 100 ? progress / 100 : -1);
      },
    });
  } catch (e) {
    dialog.showErrorBox('The voice server won\'t start', e.message);
    app.exit(1);
    return;
  }
  setupPermissions(srv.port);
  // asked at once, without holding the window: unanswered (a Mac with nobody at it), the studio still opens
  askMacMicrophone().catch(() => {});
  buildMenu();

  win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 760,
    minHeight: 600,
    title: `VIK${MOCK ? ' — simulated engine' : ''}`,
    backgroundColor: '#151514',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.once('ready-to-show', () => win.show());
  // links open in the browser; only web addresses (never file: or other programs' protocols)
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => { if (updatesPending) { const p = updatesPending; updatesPending = null; showUpdates(p.check); } });
  // the window shows the studio and nothing else: a link or a file dropped on it opens in the browser, or not at all
  const stay = (e, url) => { if (ours(url)) return; e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.on('will-navigate', (e, url) => stay(e, e.url || url));
  win.webContents.on('will-frame-navigate', (e) => { if (!ours(e.url)) e.preventDefault(); });
  // closing: the edits typed a moment ago are saved first (they wait half a second otherwise), at most 4 s
  let saved = false;
  win.on('close', (e) => {
    if (saved || !win || win.isDestroyed()) return;
    e.preventDefault();
    saved = true;
    const save = win.webContents.executeJavaScript('window.vikSaveBeforeClose ? window.vikSaveBeforeClose() : ""');
    Promise.race([save, new Promise((r) => setTimeout(r, 4000))]).catch(() => {}).finally(() => { if (win && !win.isDestroyed()) win.close(); });
  });
  win.loadURL(srv.url);
  win.on('closed', () => { win = null; });
  srv.ready.then(() => offerInstall(false));
  updates = setupUpdates({
    app, autoUpdater, log,
    notify: (state, show) => { if (show) showUpdates(false); },   // a new version ready or available: the window opens
    mode: updateMode({ isPackaged: app.isPackaged, platform: process.platform, execPath: process.execPath, exists: fs.existsSync }),
    enabled: config.updates !== false,
    feed: process.env.VIK_UPDATE_FEED || '',   // the tests' own update server (.github/workflows/update-test.yml)
  });
}

if (SQUIRREL) {
  // Windows install, update or uninstall: nothing else to do.
} else if (!app.requestSingleInstanceLock()) {
  // One app at a time: the models and port 8790 cannot be shared.
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (e) => {
    if (quitting || !srv) return;
    e.preventDefault();
    quitting = true;
    Promise.race([srv.close(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
  });
}

module.exports = { handleSquirrelEvent };   // for the tests
