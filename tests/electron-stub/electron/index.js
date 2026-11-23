// A fake "electron" module to test electron/main.cjs under Node (tests/test-electron-main.mjs).
'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const state = globalThis.__electronStub = { windows: [], menu: null, permissionRequest: null, permissionCheck: null, relaunched: null, exited: null, errors: [], quitCalled: 0 };
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vik-userdata-'));
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'vik-appdata-'));   // where the earlier "Voice Lab" folder would be

class App extends EventEmitter {
  constructor() { super(); this.name = 'VIK'; this.isPackaged = false; this.commandLine = { appendSwitch() {} }; }
  getVersion() { return '3.1.0'; }
  whenReady() { return Promise.resolve(); }
  getPath(n) { return n === 'userData' ? userData : n === 'appData' ? appData : os.tmpdir(); }
  requestSingleInstanceLock() { return true; }
  relaunch(o) { state.relaunched = o || { args: [] }; }
  exit(c) { state.exited = c; }
  quit() {
    state.quitCalled++;
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.emit('before-quit', e);
    if (!e.defaultPrevented) state.quitDone = true;
  }
}
const app = new App();

class BrowserWindow extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts; this.url = null; this.progress = []; this.destroyed = false;
    this.scripts = [];
    this.wcEvents = {};
    this.webContents = {
      setWindowOpenHandler: (f) => { this.openHandler = f; }, getURL: () => this.url,
      executeJavaScript: (js) => { this.scripts.push(js); return Promise.resolve(); },
      on: (ev, fn) => { this.wcEvents[ev] = fn; },
    };
    state.windows.push(this);
    setTimeout(() => this.emit('ready-to-show'), 10);
  }
  loadURL(u) { this.url = u; return Promise.resolve(); }
  show() { this.shown = true; }
  setProgressBar(p) { this.progress.push(p); }
  isDestroyed() { return this.destroyed; }
  close() {
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.emit('close', e);
    if (!e.defaultPrevented) { this.destroyed = true; this.closedDone = true; this.emit('closed'); }
  }
  isMinimized() { return false; }
  restore() {}
  focus() {}
}

// Electron's updater (Squirrel on Windows): records what it is asked
class AutoUpdater extends EventEmitter {
  constructor() { super(); this.feed = null; this.checks = 0; this.installs = 0; }
  setFeedURL(o) { this.feed = o; }
  checkForUpdates() { this.checks++; }
  quitAndInstall() { this.installs++; }
}

module.exports = {
  app,
  autoUpdater: new AutoUpdater(),
  BrowserWindow,
  Menu: { buildFromTemplate: (t) => t, setApplicationMenu: (m) => { state.menu = m; } },
  shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
  dialog: { showErrorBox: (t, m) => state.errors.push(`${t}: ${m}`), showMessageBox: () => Promise.resolve({ response: 0 }) },
  session: { defaultSession: { setPermissionRequestHandler: (f) => { state.permissionRequest = f; }, setPermissionCheckHandler: (f) => { state.permissionCheck = f; } } },
  systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: () => Promise.resolve(true) },
  clipboard: { writeText: (t) => { state.clipboard = t; } },
};
