// No Arduino at hand? This script plays the board of vik_osc_room.ino, on this computer.
// It sends the room's temperature to VIK twice a second: the room warms up by itself, and cools down while the
// fan is on. It switches its "fan" when VIK sends /arduino/fan, and tells VIK the fan's state.
//
//   node fake-arduino.mjs                     VIK on this computer, listening on port 9000; the "board" on 8000
//   node fake-arduino.mjs 127.0.0.1 9000 8000  the same, said explicitly: VIK's host, VIK's port, this board's port
//
// In VIK: Settings > OSC > Listen on port 9000, and Send to 127.0.0.1:8000.
import dgram from 'node:dgram';

const [VIK_HOST = '127.0.0.1', VIK_PORT = '9000', PORT = '8000'] = process.argv.slice(2);
const sock = dgram.createSocket('udp4');

// OSC 1.0, the little this board needs: an address and one number (float or int)
const pad = (s) => { const b = Buffer.from(`${s}\0`); return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]); };
function message(address, value, type) {
  const n = Buffer.alloc(4);
  if (type === 'i') n.writeInt32BE(value); else n.writeFloatBE(value);
  return Buffer.concat([pad(address), pad(`,${type}`), n]);
}
function read(b) {
  const str = (o) => { const end = b.indexOf(0, o); return [b.toString('utf8', o, end), (end + 4) & ~3]; };
  const [address, o] = str(0);
  const [tags, at] = str(o);
  const t = tags[1];
  const value = t === 'i' ? b.readInt32BE(at) : t === 'f' ? b.readFloatBE(at) : t === 'T' ? 1 : t === 'F' ? 0 : null;
  return { address, value };
}
const send = (address, value, type = 'f') => sock.send(message(address, value, type), Number(VIK_PORT), VIK_HOST);

let temp = 24;
let fan = 0;
sock.on('message', (b) => {
  let m;
  try { m = read(b); } catch { return; }
  if (m.address !== '/arduino/fan') return;
  fan = Number(m.value) > 0.5 ? 1 : 0;
  console.log(`VIK says: fan ${fan ? 'ON' : 'off'}`);
  send('/arduino/fan/state', fan, 'i');
});
sock.bind(Number(PORT), () => {
  console.log(`Fake Arduino: sends /arduino/temp to ${VIK_HOST}:${VIK_PORT}, listens for /arduino/fan on port ${PORT}. Ctrl+C to stop.`);
  setInterval(() => {
    temp += fan ? -0.4 : 0.15;                       // it warms up slowly, the fan cools it faster
    temp = Math.min(35, Math.max(20, temp));
    send('/arduino/temp', Math.round(temp * 10) / 10);
    process.stdout.write(`\rtemp ${temp.toFixed(1)} C, fan ${fan ? 'ON ' : 'off'}  `);
  }, 500);
});
