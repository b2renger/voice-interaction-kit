// The voice server from the command line, without a window (the Electron app also uses it, as a module).
//   npm run server            QVAC engine
//   npm run server:mock       simulated engine, no models
//   node src/server.mjs --port 8790 --host 127.0.0.1 --config config.json --agents <folder>
// The agents: --agents, or the VIK_AGENTS environment variable, or the app's own folder (the same as the window's).
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from './config.mjs';
import { startServer, APP_DIR } from './app-server.mjs';

const args = parseArgs(process.argv.slice(2));
const config = loadConfig(args.config ? join(process.cwd(), args.config) : join(APP_DIR, 'config.json'));

/** Where the Electron app keeps its settings (its "userData" folder), so both use the same agents. */
function appDataDir() {
  const home = homedir();
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'VIK');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'VIK');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'VIK');
}

let srv;
try {
  srv = await startServer({
    config,
    agentsDir: resolve(String(args.agents || process.env.VIK_AGENTS || join(appDataDir(), 'agents'))),
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
