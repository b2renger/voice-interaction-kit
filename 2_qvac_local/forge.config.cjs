// Packages the Voice Lab app with Electron Forge and QVAC's official plugin,
// which bundles the QVAC "worker" and keeps only the native libraries of the target platform.
//
//   npm run make      → out/make/…: VoiceLab-Setup.exe (Windows) or Voice Lab.dmg (Mac), plus a .zip
//
// Each platform is built ON that platform: the .exe on a Windows PC, the .dmg on an Apple Silicon Mac
// (npm installs QVAC's native libraries for the machine that builds).
// The GitHub workflow (../ci/voice-lab.yml, to copy into .github/workflows/) builds both without a Mac.
'use strict';

const path = require('node:path');
const QvacForgePlugin = require('@qvac/sdk/electron-forge');

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
};
