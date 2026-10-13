// A fake "electron" module to test electron/main.cjs under Node (tests/test-electron-main.mjs).
'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const state = globalThis.__electronStub = { windows: [], menu: null, permissionRequest: null, permissionCheck: null, relaunched: null, exited: null, errors: [], quitCalled: 0 };
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-lab-userdata-'));

class App extends EventEmitter {
  constructor() { super(); this.name = 'Voice Lab'; this.commandLine = { appendSwitch() {} }; }
  whenReady() { return Promise.resolve(); }
  getPath(n) { return n === 'userData' ? userData : os.tmpdir(); }
  requestSingleInstanceLock() { return true; }
  relaunch(o) { state.relaunched = o; }
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
    this.webContents = { setWindowOpenHandler: (f) => { this.openHandler = f; }, getURL: () => this.url };
    state.windows.push(this);
    setTimeout(() => this.emit('ready-to-show'), 10);
  }
  loadURL(u) { this.url = u; return Promise.resolve(); }
  show() { this.shown = true; }
  setProgressBar(p) { this.progress.push(p); }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return false; }
  restore() {}
  focus() {}
}

module.exports = {
  app,
  BrowserWindow,
  Menu: { buildFromTemplate: (t) => t, setApplicationMenu: (m) => { state.menu = m; } },
  shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
  dialog: { showErrorBox: (t, m) => state.errors.push(`${t}: ${m}`), showMessageBox: () => Promise.resolve({ response: 0 }) },
  session: { defaultSession: { setPermissionRequestHandler: (f) => { state.permissionRequest = f; }, setPermissionCheckHandler: (f) => { state.permissionCheck = f; } } },
  systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: () => Promise.resolve(true) },
  clipboard: { writeText: (t) => { state.clipboard = t; } },
};
