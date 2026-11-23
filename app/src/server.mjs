// The voice server from the command line, without a window (the Electron app also uses it, as a module).
//   npm run server            QVAC engine
//   npm run server:mock       simulated engine, no models
//   node src/server.mjs --port 8790 --host 127.0.0.1 --config config.json --agents <folder>
// The agents: --agents, or the VIK_AGENTS environment variable, or the app's own folder (the same as the window's).
// The people recognized by their voice: --people, or VIK_PEOPLE, or the app's own people.json; with another agents
// folder (the tests), a temporary one: never the user's.
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { loadConfig } from './config.mjs';
import { startServer, APP_DIR } from './app-server.mjs';

const args = parseArgs(process.argv.slice(2));
const configFile = args.config ? resolve(process.cwd(), String(args.config)) : join(APP_DIR, 'config.json');
if (args.config && !existsSync(configFile)) console.error(`✖ --config: ${configFile} does not exist: the default settings are used`);
const config = loadConfig(configFile);

/** Where the Electron app keeps its settings (its "userData" folder), so both use the same agents. */
function appDataDir() {
  const home = homedir();
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'VIK');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'VIK');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'VIK');
}

// the app's VIK folder (Settings → VIK folder, app/electron/folder.cjs), unless --agents / VIK_AGENTS says otherwise;
// a chosen folder also holds the models (QVAC's worker takes their home from SNAP_USER_COMMON)
const overridden = !!(args.agents || process.env.VIK_AGENTS);
const { readPointer, layoutOf } = createRequire(import.meta.url)('../electron/folder.cjs');
const place = layoutOf(overridden ? '' : readPointer(appDataDir()).dir, appDataDir());
if (place.dir) process.env.SNAP_USER_COMMON = place.dir;

let srv;
try {
  srv = await startServer({
    config,
    agentsDir: resolve(String(args.agents || process.env.VIK_AGENTS || place.agents)),
    peopleFile: args.people || process.env.VIK_PEOPLE ? resolve(String(args.people || process.env.VIK_PEOPLE))
      : overridden ? undefined : place.people,
    mock: !!args.mock || process.env.VOICE_ENGINE === 'mock',
    port: Number(args.port || process.env.PORT || config.port || 8790),
    host: String(args.host || process.env.HOST || config.host || '127.0.0.1'),
    onStatus: ({ text }) => { if (process.stdout.isTTY && text) process.stdout.write(`\r${text}          `); },
  });
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(1);
}

let quitting = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  try { await srv.close(); } catch { /* closed */ }
  process.exit(0);
}
process.on('SIGINT', quit);
process.on('SIGTERM', quit);

function parseArgs(list) {
  const o = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) continue;
    o[a.slice(2)] = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : true;
  }
  return o;
}
