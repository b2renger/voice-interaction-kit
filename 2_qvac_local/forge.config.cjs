// Packages the Voice Lab app with Electron Forge and QVAC's official plugin,
// which bundles the QVAC "worker" and keeps only the native libraries of the target platform.
//
//   npm run make      → out/make/…: VoiceLab-Setup.exe (Windows) or Voice Lab.dmg (Mac), plus a .zip
//
// Each platform is built ON that platform: the .exe on a Windows PC, the .dmg on an Apple Silicon Mac
// (npm installs QVAC's native libraries for the machine that builds).
// The GitHub workflow (../.github/workflows/release.yml) builds both without a Mac.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const QvacForgePlugin = require('@qvac/sdk/electron-forge');

// Mach-O magic numbers (32/64-bit, both byte orders). 0xcafebabe (universal binary) is also the
// magic of Java class files: a universal binary has a small architecture count right after it.
const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]);

function isMachO(file) {
  const head = Buffer.alloc(8);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    if (fs.readSync(fd, head, 0, 8, 0) < 8) return false;
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const magic = head.readUInt32BE(0);
  return MACHO_MAGICS.has(magic) || (magic === 0xcafebabe && head.readUInt32BE(4) < 32);
}

/** Every Mach-O file under dir (symlinks skipped: they point at files found anyway). */
function machOFiles(dir, found = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) machOFiles(p, found);
    else if (e.isFile() && isMachO(p)) found.push(p);
  }
  return found;
}

/**
 * macOS, unsigned build. Packaging edits Electron's app (name, Info.plist, our files), which breaks the
 * signature Electron ships with. Downloaded from GitHub, a broken signature makes macOS say the app
 * "is damaged", and only Terminal can open it. Re-signing "ad hoc" (no certificate) makes the signature
 * valid again: macOS then shows its usual "Open Anyway" in Privacy & Security.
 * The native libraries in node_modules (QVAC, onnxruntime) are signed one by one first, because
 * codesign refuses to seal an app that contains unsigned code.
 */
function adHocSign(appPath) {
  const codesign = (...args) => execFileSync('codesign', args, { stdio: 'pipe' });
  execFileSync('xattr', ['-cr', appPath]);   // Finder info / resource forks make codesign fail
  const libs = machOFiles(path.join(appPath, 'Contents', 'Resources'));
  for (const lib of libs) {
    try { codesign('--force', '--sign', '-', lib); }
    catch (err) { console.warn(`[ad-hoc sign] could not sign ${lib}: ${String(err.stderr || err.message).trim()}`); }
  }
  codesign('--force', '--deep', '--sign', '-', appPath);
  codesign('--verify', '--deep', '--strict', '--verbose=2', appPath);   // throws, so a bad build fails here
  console.log(`[ad-hoc sign] ${path.basename(appPath)}: ${libs.length} native libraries + the app, signature verified`);
}

module.exports = {
  packagerConfig: {
    name: 'Voice Lab',
    executableName: 'VoiceLab',
    appBundleId: 'edu.voicelab.app',
    appCategoryType: 'public.app-category.education',
    // The QVAC worker cannot load its libraries from an asar archive (the plugin enforces this too).
    // No asar also lets onnxruntime-node (Smart Turn, optional) load its native library.
    asar: false,
    // macOS: the sentence shown when the app asks for the microphone.
    extendInfo: {
      NSMicrophoneUsageDescription: 'Voice Lab listens to your voice so you can talk with the agent. The sound stays on this computer.',
    },
    // models/ (the Smart Turn model) must stay in the package: never add it here.
    ignore: [
      /^\/out\//,
      /^\/selftest-[^/]*\.wav$/,
      /^\/\.qvac-worker-backup\//,
    ],
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: 'voice_lab', setupExe: 'VoiceLab-Setup.exe' } },
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'], config: { name: 'Voice Lab' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'win32', 'linux'] },
  ],
  plugins: [
    new QvacForgePlugin({
      projectDir: __dirname,
      configPath: path.join(__dirname, 'qvac.config.json'),
      logLevel: 'info',
    }),
  ],
  hooks: {
    // Runs after the QVAC plugin has finished editing the app, and before the .dmg and .zip are made.
    postPackage: async (forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin' || process.platform !== 'darwin') return;
      if (forgeConfig.packagerConfig.osxSign) return;   // a real certificate is set up: Packager signed already
      for (const dir of outputPaths) {
        for (const name of fs.readdirSync(dir)) {
          if (name.endsWith('.app')) adHocSign(path.join(dir, name));
        }
      }
    },
  },
};
