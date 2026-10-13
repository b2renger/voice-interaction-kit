// The Voice Lab app: the QVAC voice server runs INSIDE the app, and the window shows the lab window page.
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
function modelsDir() { return path.join(os.homedir(), '.qvac', 'models'); }

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
      detail: 'Allow Voice Lab in System Settings → Privacy & Security → Microphone, then restart the app.',
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
        { label: 'Copy address for cables.gl', click: () => { if (srv) clipboard.writeText(srv.wsUrl); } },
      ],
    },
    {
      label: 'Files',
      submenu: [
        { label: 'Open models folder', click: () => { fs.mkdirSync(modelsDir(), { recursive: true }); shell.openPath(modelsDir()); } },
        {
          label: 'Open settings folder (config.json, personas)',
          click: () => {
            fs.mkdirSync(path.join(userDir(), 'personas'), { recursive: true });
            if (!fs.existsSync(userConfigPath())) fs.copyFileSync(path.join(APP_DIR, 'config.json'), userConfigPath());
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

function showLog() {
  dialog.showMessageBox(win, { type: 'info', message: 'Server log', detail: logLines.slice(-40).join('\n') || '(empty)' });
}

async function start() {
  const config = await loadAppConfig();
  const { startServer } = await import(pathToFileURL(path.join(APP_DIR, 'src', 'app-server.mjs')).href);
  try {
    srv = await startServer({
      config,
      mock: MOCK,
      log,
      personaDirs: [path.join(userDir(), 'personas'), path.join(APP_DIR, 'personas')],
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
    title: `Voice Lab${MOCK ? ' — simulated engine' : ''}`,
    backgroundColor: '#151514',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.loadURL(srv.url);
  win.on('closed', () => { win = null; });
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
