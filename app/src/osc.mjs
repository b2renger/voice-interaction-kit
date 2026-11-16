// OSC out: a pattern's action "Send OSC" (docs/DESIGN.md, 2.3), to ArtLux, an Arduino, a show controller.
// The address and the value belong to the agent. Where the messages go (the setting oscTo, "host:port, host:port")
// belongs to this computer: an agent shared by someone else can never send what is said to another address.
import dgram from 'node:dgram';

/** The value, typed by how it looks: '' = no argument, 12 = an integer, 0.5 = a float, anything else = a string. */
export function oscArgs(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return [];
  if (/^-?\d{1,9}$/.test(v)) return [{ type: 'i', value: Number(v) }];
  if (/^-?\d*\.\d+$/.test(v)) return [{ type: 'f', value: Number(v) }];
  return [{ type: 's', value: v }];
}

/** "127.0.0.1:10000, 192.168.0.20:8000" → [{host, port}]. What is not host:port is left out. */
export function oscTargets(s) {
  return String(s || '').split(/[\s,;]+/)
    .map((t) => /^([\w.-]+):(\d{1,5})$/.exec(t))
    .filter((m) => m && Number(m[2]) > 0 && Number(m[2]) < 65536)
    .map((m) => ({ host: m[1], port: Number(m[2]) }));
}

// OSC 1.0: strings are UTF-8, end with a zero, padded to 4 bytes; numbers are 32-bit big-endian
const str = (s) => { const b = Buffer.from(`${s}\0`, 'utf8'); return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]); };
export function encodeOsc(address, args = []) {
  const data = args.map((a) => {
    if (a.type === 's') return str(a.value);
    const b = Buffer.alloc(4);
    if (a.type === 'i') b.writeInt32BE(a.value); else b.writeFloatBE(a.value);
    return b;
  });
  return Buffer.concat([str(address), str(`,${args.map((a) => a.type).join('')}`), ...data]);
}

let sock = null;
/** Sends one message to every target (a x.x.x.255 address is a broadcast). */
export function sendOsc(targets, address, args, log = () => {}) {
  if (!sock) {
    sock = dgram.createSocket('udp4');
    sock.on('error', (e) => log(`✖ OSC: ${e.message}`));
    sock.bind(0, () => sock.setBroadcast(true));
    sock.unref();
  }
  const msg = encodeOsc(address, args);
  for (const t of targets) sock.send(msg, t.port, t.host, (e) => { if (e) log(`✖ OSC to ${t.host}:${t.port}: ${e.message}`); });
}
