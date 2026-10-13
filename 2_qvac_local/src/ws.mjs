// A small WebSocket server (RFC 6455) with no dependencies: text, binary, fragmentation, ping/pong, close.
// Enough for a browser client on the same machine; no extensions (no compression).
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 16 * 1024 * 1024;

export class WebSocketConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.readyState = 1;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.partsOpcode = 0;
    this.partsLen = 0;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish(1006, ''));
    socket.on('error', () => this.finish(1006, ''));
  }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        const hi = this.buf.readUInt32BE(2);
        if (hi !== 0) { this.close(1009, 'too big'); return; }
        len = this.buf.readUInt32BE(6); off = 10;
      }
      if (len > MAX_MESSAGE) { this.close(1009, 'too big'); return; }
      const maskOff = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (masked) {
        const mask = this.buf.subarray(maskOff, maskOff + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(off + len);
      this.onFrame(fin, opcode, payload);
      if (this.readyState !== 1) return;
    }
  }

  onFrame(fin, opcode, payload) {
    if (opcode === 0x8) {                                    // close
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
      if (this.readyState === 1) this.writeFrame(0x8, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0));
      this.finish(code, reason);
      try { this.socket.end(); } catch { /* closed */ }
      return;
    }
    if (opcode === 0x9) { this.writeFrame(0xA, payload); return; }   // ping → pong
    if (opcode === 0xA) return;                                       // pong
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) { this.deliver(opcode, payload); return; }
      this.parts = [payload]; this.partsOpcode = opcode; this.partsLen = payload.length;
      return;
    }
    if (opcode === 0x0) {                                             // continuation of a fragmented message
      this.parts.push(payload); this.partsLen += payload.length;
      if (this.partsLen > MAX_MESSAGE) { this.close(1009, 'too big'); return; }
      if (fin) { const all = Buffer.concat(this.parts); this.parts = []; this.deliver(this.partsOpcode, all); }
      return;
    }
    this.close(1002, 'unknown opcode');
  }

  deliver(opcode, payload) {
    if (opcode === 0x1) this.emit('message', payload.toString('utf8'), false);
    else this.emit('message', payload, true);
  }

  writeFrame(opcode, data) {
    if (this.socket.destroyed) return;
    const len = data.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([head, data]));
  }

  /** @param {string|Buffer|ArrayBufferView} data */
  send(data) {
    if (this.readyState !== 1) return false;
    if (typeof data === 'string') this.writeFrame(0x1, Buffer.from(data, 'utf8'));
    else this.writeFrame(0x2, Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return true;
  }

  sendJson(obj) { return this.send(JSON.stringify(obj)); }

  close(code = 1000, reason = '') {
    if (this.readyState !== 1) return;
    const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.writeFrame(0x8, p);
    this.readyState = 2;
    setTimeout(() => { try { this.socket.destroy(); } catch { /* closed */ } this.finish(code, reason); }, 200);
  }

  finish(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', code, reason);
  }
}

/**
 * Attaches a WebSocket server to a Node HTTP server.
 * @param {import('node:http').Server} server
 * @param {{path?: string|RegExp, onConnection: (ws: WebSocketConnection, req: any) => void, allowOrigin?: (origin: string|undefined) => boolean}} o
 */
export function attachWebSocket(server, o) {
  server.on('upgrade', (req, socket) => {
    const url = (req.url || '/').split('?')[0];
    const pathOk = !o.path || (o.path instanceof RegExp ? o.path.test(url) : url === o.path);
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (!pathOk || !key || upgrade !== 'websocket') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    if (o.allowOrigin && !o.allowOrigin(req.headers.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', '',
    ].join('\r\n'));
    const ws = new WebSocketConnection(socket, req);
    o.onConnection(ws, req);
  });
}
