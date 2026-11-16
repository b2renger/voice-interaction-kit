#!/usr/bin/env node
// vik-to-artlux.mjs: the agent's signals change ArtLux's scene, over OSC.
//
//   node examples/artlux/vik-to-artlux.mjs                   ArtLux on this computer, port 10000
//   node examples/artlux/vik-to-artlux.mjs --host 192.168.0.10 --port 10000
//
// It follows the VIK studio as a client (ws://localhost:8790/events). When a pattern sends the signal
// "artlux-scene" with a scene's name as its value, it sends /artlux/scene/recall <name> to ArtLux
// (Preferences ▸ OSC / Tracking: OSC receive on). ArtLux finds the scene by its name or its id.
// Node 22 or later, no dependencies.
import dgram from 'node:dgram';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const VIK = arg('--vik', 'ws://localhost:8790/events');
const HOST = arg('--host', '127.0.0.1');
const PORT = Number(arg('--port', '10000'));
const SIGNAL = 'artlux-scene';
const ADDRESS = '/artlux/scene/recall';

// OSC 1.0: a string is UTF-8, ends with a zero, padded to 4 bytes
const pad = (s) => { const b = Buffer.from(`${s}\0`); return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]); };
const message = (address, text) => Buffer.concat([pad(address), pad(',s'), pad(text)]);

const udp = dgram.createSocket('udp4');
let waiting = false;

function connect() {
  const ws = new WebSocket(VIK);
  ws.onopen = () => { waiting = false; console.log(`Following VIK (${VIK}). Scenes go to ArtLux at ${HOST}:${PORT}.`); };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'hello' && !m.app) console.log('The VIK server runs, but the studio window is closed: open it.');
    if (m.type !== 'signal') return;
    if (m.name !== SIGNAL || !m.value) { console.log(`  (signal "${m.name}" is not for ArtLux)`); return; }
    udp.send(message(ADDRESS, m.value), PORT, HOST);
    console.log(`  ${ADDRESS} "${m.value}"`);
  };
  ws.onclose = () => {
    if (!waiting) console.log('VIK is not running (yet): trying again every 2 s…');
    waiting = true;
    setTimeout(connect, 2000);
  };
  ws.onerror = () => {};
}
connect();
