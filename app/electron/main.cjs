// The VIK app: the QVAC voice server runs INSIDE the app, and the window shows the lab window page.
// While the app is open, the cables op ("Local" engine) can connect to it.
'use strict';

const { app, BrowserWindow, Menu, shell, dialog, session, systemPreferences, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

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

if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');   // required by QVAC on Linux

let win = null;
let srv = null;
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
function agentsDir() { return path.join(userDir(), 'agents'); }
function modelsDir() { return path.join(os.homedir(), '.qvac', 'models'); }
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

/** The microphone: the app only grants it to its own page. */
function setupPermissions(port) {
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const ours = (url) => typeof url === 'string' && origins.some((o) => url === o || url.startsWith(o + '/'));
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = permission === 'media' && ours(details.requestingUrl || wc.getURL());
    callback(ok);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => permission === 'media' && ours(requestingOrigin));
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
        ...(MOCK ? [] : [{ label: 'Download all models (once)…', click: () => offerInstall(true) }]),
        { label: 'Open agents folder', click: () => { fs.mkdirSync(agentsDir(), { recursive: true }); shell.openPath(agentsDir()); } },
        { label: 'Open models folder', click: () => { fs.mkdirSync(modelsDir(), { recursive: true }); shell.openPath(modelsDir()); } },
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
  dialog.showMessageBox(win, {
    type: 'warning',
    message: `${failed.length} model${failed.length > 1 ? 's' : ''} could not be downloaded`,
    detail: `${failed.map((m) => m.stage).join(', ')}. The reason is in Files → Server log.\n\n`
      + (failed.some((m) => m.p2pOnly)
        ? 'If this network blocks QVAC\'s peer-to-peer network: connect once to another one (home Wi-Fi, a phone hotspot) and choose Files → Download all models again, '
          + 'or copy the models folder (Files → Open models folder) from a computer that has them.'
        : 'Check the internet connection and choose Files → Download all models again.'),
  });
}

function showLog() {
  dialog.showMessageBox(win, { type: 'info', message: 'Server log', detail: logLines.slice(-40).join('\n') || '(empty)' });
}

async function start() {
  adoptOldConfig();
  const config = await loadAppConfig();
  const { startServer } = await import(pathToFileURL(path.join(APP_DIR, 'src', 'app-server.mjs')).href);
  try {
    srv = await startServer({
      config,
      mock: MOCK,
      log,
      agentsDir: agentsDir(),
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
  await askMacMicrophone();
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
  win.loadURL(srv.url);
  win.on('closed', () => { win = null; });
  srv.ready.then(() => offerInstall(false));
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
