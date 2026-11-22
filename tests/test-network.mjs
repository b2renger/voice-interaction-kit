// Tests what another computer can do when VIK listens on the network ("host" in config.json), WITHOUT a model
// (Node 22+ only): it is a client (the conversation's events, the pages, /health) and nothing more. The agents,
// the people, the updates, the conversation itself and the Zonos bridge answer this computer only.
// "Another computer" is played by this one, reaching the server through its network address.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { ROOT, check, skip, summary, until } from './helpers.mjs';

const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
if (!lan) {
  skip('another computer on the network: a client, nothing more', 'this computer has no network address');
  process.exit(summary() ? 1 : 0);
}
const port = 20700 + Math.floor(Math.random() * 200);
const cwd = mkdtempSync(join(tmpdir(), 'vik-network-'));
writeFileSync(join(cwd, 'config.json'), JSON.stringify({ host: '0.0.0.0', modelMirror: '' }));
const proc = spawn(process.execPath, [join(ROOT, 'app', 'src', 'server.mjs'), '--mock', '--port', String(port), '--config', 'config.json'],
  { cwd, env: { ...process.env, VIK_AGENTS: mkdtempSync(join(tmpdir(), 'vik-agents-network-')) }, stdio: 'ignore' });
process.on('exit', () => { try { proc.kill(); } catch { /* gone */ } });
const HERE = `http://127.0.0.1:${port}`;
const THERE = `http://${lan.address}:${port}`;
check(await until(async () => { try { return (await (await fetch(`${HERE}/health`)).json()).models === 'ready'; } catch { return false; } }, 15000), 'the local server starts, listening on the network ("host": "0.0.0.0")');

const ask = async (base, method, path, body) => { const r = await fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
const socket = (base, path) => new Promise((res) => { const ws = new WebSocket(base.replace('http', 'ws') + path); ws.onopen = () => { ws.close(); res(true); }; ws.onerror = () => res(false); });

// this computer: everything, as before
const mine = await ask(HERE, 'GET', '/api/agents');
const agents = JSON.parse(mine.text);
check(mine.status === 200 && agents.length > 0, 'from this computer: the agents are listed');
check((await ask(HERE, 'POST', '/api/agents', { name: 'Mine' })).status === 200 && await socket(HERE, '/voice') && await socket(HERE, '/brain') && await socket(HERE, '/zonos') && await socket(HERE, '/events'), 'from this computer: an agent is created, a conversation, the hub and the Zonos bridge open');

// another computer: a client
const health = await ask(THERE, 'GET', '/health');
check(health.status === 200 && JSON.parse(health.text).models === 'ready' && !('agentsDir' in JSON.parse(health.text)), 'from the network: /health answers (without the agents folder\'s path)');
check((await ask(THERE, 'GET', '/')).status === 200 && (await ask(THERE, 'GET', '/voice-core.js')).status === 200 && (await ask(THERE, 'GET', '/public/vik.css')).status === 200, 'from the network: the pages are served');
check(await socket(THERE, '/events'), 'from the network: a client follows the conversation (/events)');
const refused = [];
for (const [m, p, b] of [['GET', '/api/agents'], ['GET', `/api/agents/${agents[0].id}`], ['POST', '/api/agents', { name: 'Planted' }], ['DELETE', `/api/agents/${agents[0].id}`], ['PUT', `/api/agents/${agents[0].id}/persona`, { settings: {}, body: 'x' }],
  ['GET', `/api/agents/${agents[0].id}/export`], ['GET', '/api/voices'], ['GET', '/api/people'], ['POST', '/api/decide', { agent: agents[0].id, text: 'hello' }], ['POST', '/api/llm/models', { url: 'http://127.0.0.1:1/v1' }],
  ['GET', '/api/updates'], ['POST', '/api/updates/install'], ['GET', '/api/voice/zonos'], ['GET', '/zonos/models/x.bin'], ['GET', '/zonos/engine/engine.js'], ['GET', '/farms'], ['GET', '/farms?add=10.0.0.1'], ['GET', '/models']]) {
  const r = await ask(THERE, m, p, b);
  if (r.status !== 403) refused.push(`${m} ${p} → ${r.status}`);
}
check(!refused.length, 'from the network: the agents, the people, the updates, the language-model probe, the farms, the models and the Zonos files are refused (403)', refused);
check(!(await socket(THERE, '/voice')) && !(await socket(THERE, '/brain')) && !(await socket(THERE, '/zonos')), 'from the network: no conversation of its own, no posing as the studio, no posing as the Zonos engine');
const after = JSON.parse((await ask(HERE, 'GET', '/api/agents')).text);
check(after.length === agents.length + 1 && after.some((a) => a.id === agents[0].id) && !after.some((a) => /planted/i.test(a.name || a.title || '')), 'nothing was created or deleted from the network', after.map((a) => a.id));

proc.kill();
process.exit(summary() ? 1 : 0);
