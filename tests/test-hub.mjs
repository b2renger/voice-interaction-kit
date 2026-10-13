// Tests the hub through the real server (simulated engine), Node 22+ only, no browser:
// a fake lab window (the brain, /brain) publishes, two clients (/events) follow it and send commands.
//   node tests/test-hub.mjs
import { request } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary, until } from './helpers.mjs';

const src = (f) => pathToFileURL(join(ROOT, '2_qvac_local', 'src', f)).href;
const { startServer } = await import(src('app-server.mjs'));
const { loadConfig } = await import(src('config.mjs'));
const srv = await startServer({ config: loadConfig(join(ROOT, '2_qvac_local', 'config.json')), mock: true, port: 19900 + Math.floor(Math.random() * 90), log: () => {} });

function open(path) {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}${path}`);
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  const ready = new Promise((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error(`cannot open ${path}`)); });
  return { ws, msgs, ready, send: (m) => ws.send(JSON.stringify(m)), last: (type) => msgs.filter((m) => m.type === type).at(-1), count: (type) => msgs.filter((m) => m.type === type).length };
}
/** The HTTP status of a WebSocket upgrade from a given page (101 = accepted). */
function upgrade(path, origin) {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: origin } });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

const a = open('/events');
await a.ready;
await until(() => a.last('hello'), 2000);
check(a.last('hello') && a.last('hello').app === false && a.last('hello').state === 'idle', 'a client gets a snapshot at once ("hello"), with no lab window open', a.last('hello'));
a.send({ type: 'context', text: 'room 2' });
await until(() => a.last('error'), 2000);
check(a.last('error') && a.last('error').code === 'no-app', 'a command with no lab window open: error "no-app"', a.last('error'));

const brain = open('/brain');
await brain.ready;
await until(() => a.count('hello') >= 2, 2000);
check(a.last('hello').app === true, 'the lab window connects: the clients get a new hello (app: true)', a.last('hello'));
brain.send({ type: 'info', name: 'Ada', engine: 'gemini' });
brain.send({ type: 'event', event: { type: 'state', state: 'listening', prev: 'connecting', t: 5 } });
brain.send({ type: 'event', event: { type: 'ui.choices', state: 'listening', t: 6, question: 'Which room?', options: ['Room 1', 'Room 2'] } });
brain.send({ type: 'levels', user: 0.4, bot: 0 });
await until(() => a.last('levels'), 2000);
check(a.last('state') && a.last('state').state === 'listening' && a.last('state').prev === 'connecting', 'events reach the clients as they are (state)', a.last('state'));
check(a.last('ui.choices') && a.last('ui.choices').options.length === 2, '... choices too', a.last('ui.choices'));
check(a.last('levels') && a.last('levels').user === 0.4, 'the levels reach the clients', a.last('levels'));

const b = open('/events');
await b.ready;
await until(() => b.last('hello'), 2000);
const h = b.last('hello') || {};
check(h.app && h.name === 'Ada' && h.engine === 'gemini' && h.state === 'listening' && h.choices.join() === 'Room 1,Room 2' && h.question === 'Which room?' && h.levels.user === 0.4,
  'a client that arrives late gets the conversation as it is (name, engine, state, choices, levels)', h);

b.send({ type: 'context', text: 'the visitor is in room 2' });
b.send({ type: 'choose', option: 'Room 2' });
await until(() => brain.count('command') >= 2, 2000);
const cmds = brain.msgs.filter((m) => m.type === 'command').map((m) => m.command);
check(cmds[0] && cmds[0].type === 'context' && cmds[0].text === 'the visitor is in room 2' && cmds[1] && cmds[1].type === 'choose' && cmds[1].option === 'Room 2',
  'the clients\' commands reach the lab window', cmds);

b.send({ type: 'shutdown' });
b.send({ type: 'text', text: 42 });
await until(() => b.count('error') >= 2, 2000);
check(b.msgs.filter((m) => m.code === 'bad-command').length === 2 && brain.count('command') === 2, 'unknown or malformed commands are refused and never forwarded', b.msgs.filter((m) => m.type === 'error'));

const brain2 = open('/brain');
await brain2.ready;
await until(() => brain.ws.readyState === WebSocket.CLOSED, 2000);
check(brain.ws.readyState === WebSocket.CLOSED, 'a second lab window replaces the first');
brain2.ws.close();
await until(() => a.last('hello').app === false, 2000);
check(a.last('hello').app === false && a.last('hello').state === 'idle', 'the lab window closes: the clients get a hello (app: false, idle)', a.last('hello'));

// who may connect
check(await upgrade('/events', 'https://editor.p5js.org') === 101, 'the p5.js web editor may connect to /events');
check(await upgrade('/events', 'https://preview.p5js.org') === 101, '... and its preview frame, where sketches run');
check(await upgrade('/events', 'https://cables.gl') === 101, '... and cables.gl');
check(await upgrade('/events', 'https://evil.example') === 403, 'an unknown website may not');
check(await upgrade('/brain', 'https://cables.gl') === 403, 'only the lab window page may be the brain, not another page');
check(await upgrade('/brain', `http://127.0.0.1:${srv.port}`) === 101, 'the lab window page may');
check(await upgrade('/voice', 'https://cables.gl') === 101, '/voice (the lab window\'s audio) still answers');

for (const c of [a, b]) c.ws.close();
await srv.close();
process.exit(summary() ? 1 : 0);
