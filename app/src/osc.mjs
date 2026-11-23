// OSC out: a pattern's action "Send OSC" (docs/DESIGN.md, 2.3), to ArtLux, an Arduino, a show controller.
// The address and the value belong to the agent, and so does where the messages go (the setting oscTo, "host:port,
// host:port"; since 3.8: importing an agent that sends OSC to another computer, the studio asks first).
// OSC in: sensors and buttons (an Arduino) send to the port oscIn (the agent's too): their latest values go
// into what the language model reads, and patterns "when an OSC message arrives" fire on them.
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

/**
 * The messages of a packet: [{address, args}] (a bundle gives each of its messages). Arguments: i f d h (numbers),
 * s S (text), T F (true, false), N (null); a blob or an unknown type ends the message's arguments. Malformed: [].
 */
export function decodeOsc(buf) {
  const out = [];
  const readStr = (b, o) => { const end = b.indexOf(0, o); if (end < 0) throw new Error('no end'); return [b.toString('utf8', o, end), (end + 4) & ~3]; };
  const walk = (b, depth) => {
    if (b.length >= 16 && b.toString('latin1', 0, 8) === '#bundle\0') {
      for (let o = 16; o + 4 <= b.length && depth < 4;) {
        const size = b.readInt32BE(o);
        if (size <= 0 || o + 4 + size > b.length) break;
        walk(b.subarray(o + 4, o + 4 + size), depth + 1);
        o += 4 + size;
      }
      return;
    }
    let [address, o] = readStr(b, 0);
    if (!address.startsWith('/')) return;
    const args = [];
    if (o < b.length && b[o] === 0x2c) {
      let tags; [tags, o] = readStr(b, o);
      for (const t of tags.slice(1)) {
        if (t === 'i') { args.push(b.readInt32BE(o)); o += 4; } else if (t === 'f') { args.push(Number(b.readFloatBE(o).toPrecision(7))); o += 4; } else if (t === 'd') { args.push(b.readDoubleBE(o)); o += 8; } else if (t === 'h') { args.push(Number(b.readBigInt64BE(o))); o += 8; } else if (t === 's' || t === 'S') { let v; [v, o] = readStr(b, o); args.push(v); } else if (t === 'T') args.push(true);
        else if (t === 'F') args.push(false);
        else if (t === 'N') args.push(null);
        else break;
      }
    }
    out.push({ address, args });
  };
  try { walk(Buffer.from(buf), 0); } catch { /* malformed: what was read so far */ }
  return out;
}

/** The value of a message as the agent reads it: its arguments, separated by spaces ("31.5", "tag 12"). */
export const oscValue = (args) => args.map((a) => (a === true ? '1' : a === false ? '0' : a == null ? '' : String(a))).join(' ').trim();

/**
 * A pattern "when an OSC message arrives" ({address, test: 'any'|'above'|'below', threshold}), for one message:
 * does it fire? `edge` ({fired}) is the pattern's memory in the conversation. "any" fires on every message.
 * "above"/"below" fire when the value crosses the threshold, then again only once the value has gone back past
 * it by 2 % (a sensor that hovers around the threshold does not fire again and again).
 */
export function oscFires(when, value, edge) {
  if (when.test !== 'above' && when.test !== 'below') return true;
  const v = Number(String(value).split(' ')[0]);
  if (!Number.isFinite(v)) return false;
  const t = Number(when.threshold) || 0;
  const margin = Math.max(Math.abs(t) * 0.02, 1e-6);
  const met = when.test === 'above' ? v > t : v < t;
  if (met) { if (edge.fired) return false; edge.fired = true; return true; }
  if (when.test === 'above' ? v < t - margin : v > t + margin) edge.fired = false;      // clearly back: armed again
  return false;
}

/** The latest values (Map address → {value, at}) as the language model reads them, or ''. */
export function liveDataPrompt(values, now = Date.now()) {
  if (!values || !values.size) return '';
  const ago = (ms) => (ms < 60000 ? '' : ms < 3600000 ? ` (${Math.round(ms / 60000)} min ago)` : ' (over an hour ago)');
  const items = [...values].map(([address, x]) => `${address} = ${String(x.value).slice(0, 100) || '(no value)'}${ago(now - x.at)}`);
  return `Live data, right now (the latest OSC messages from sensors and buttons; they replace any value said earlier in the conversation): ${items.join('; ')}.`;
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

/** The setting oscIn → a port to listen on, or 0 (empty, not a port: not listening). */
export function oscPort(v) {
  const t = String(v == null ? '' : v).trim();
  const n = /^\d{1,5}$/.test(t) ? Number(t) : 0;
  return n > 0 && n < 65536 ? n : 0;
}

/**
 * OSC in: listens on a UDP port (the agent's setting oscIn), on every network interface (an Arduino
 * on the network); VIK_OSC_IN_HOST narrows it (the tests: 127.0.0.1). onMessage({address, args}) for each
 * message of each packet. A port already taken comes to onError. Returns {close()}.
 */
export function listenOsc(port, onMessage, onError) {
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
  let closed = false;
  s.on('message', (b) => { for (const m of decodeOsc(b)) onMessage(m); });
  s.on('error', (e) => { if (!closed) onError(e); closed = true; try { s.close(); } catch { /* closed */ } });
  s.bind(port, process.env.VIK_OSC_IN_HOST || '0.0.0.0');
  return { close() { if (closed) return; closed = true; try { s.close(); } catch { /* closed */ } } };
}
