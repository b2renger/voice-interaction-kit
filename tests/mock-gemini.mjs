// A fake Gemini Live server for the tests: it speaks the same protocol (setup, realtimeInput,
// clientContent, toolResponse → setupComplete, serverContent, toolCall, goAway…).
// JSON messages go out as BINARY frames, like Google's, to exercise the decoding.
//
// Like the real server:
//   - any clientContent cuts the generation in progress ("interrupted", then the old reply's
//     turnComplete if opts.turnCompleteAfterInterrupt), and only turnComplete:true asks for a reply;
//   - an unknown field in a tool response (e.g. "scheduling" outside "response") closes the session (1007).
// In addition, for the tests:
//   - the key "silent-key" opens the connection but never finishes the setup (a start that hangs);
//   - POST /token hands out ephemeral tokens tok-1, tok-2… (like token-server/server.mjs).
import { createServer } from 'node:http';
import { attachWebSocket } from '../2_qvac_local/src/ws.mjs';

const FUNCTION_RESPONSE_KEYS = new Set(['id', 'name', 'response', 'willContinue', 'parts']);

export async function startMockGemini({ port = 0, key = 'test-key', token = 'tok-0' } = {}) {
  const log = [];          // everything that arrives, in order
  const setups = [];
  const conns = new Set();
  const issued = new Set([token]);
  const connections = [];  // { auth, constrained, closedBy } for each connection
  const errors = [];       // protocol violations spotted
  let tokenCount = 0;
  const opts = { vad: true, voiceActivity: true, confirmInterrupt: true, turnCompleteAfterInterrupt: true, replyDelay: 250 };

  const server = createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
    if (req.url === '/log') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ log, setups })); return; }
    if (req.url === '/token' && req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.url === '/token' && req.method === 'POST') {
      const t = `tok-${++tokenCount}`;
      issued.add(t);
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: t, expiresAt: new Date(Date.now() + 30 * 60000).toISOString() }));
      return;
    }
    res.writeHead(404, cors); res.end();
  });

  attachWebSocket(server, {
    path: /BidiGenerateContent(Constrained)?$/,
    onConnection(ws, req) {
      const url = new URL(req.url, 'http://x');
      const constrained = url.pathname.endsWith('Constrained');
      const auth = constrained ? url.searchParams.get('access_token') : url.searchParams.get('key');
      const silent = !constrained && auth === 'silent-key';
      const ok = silent || (constrained ? issued.has(auth) : auth === key);
      const info = { auth, constrained, closedBy: null };
      connections.push(info);
      if (!ok) { setTimeout(() => ws.close(1008, 'API key not valid. Please pass a valid API key.'), 20); return; }
      conns.add(ws);
      const st = { speechChunks: 0, silentChunks: 0, inSpeech: false, setup: null, responding: null };
      const out = (obj) => ws.send(Buffer.from(JSON.stringify(obj)));
      ws.on('close', () => { conns.delete(ws); if (!info.closedBy) info.closedBy = 'client'; if (st.responding) st.responding.cancel(); });
      const reject = (why) => { errors.push(why); info.closedBy = 'server'; ws.close(1007, why.slice(0, 120)); };

      ws.on('message', (data) => {
        const msg = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : data);
        const kind = Object.keys(msg)[0];
        log.push({ kind, msg: kind === 'realtimeInput' ? summarizeAudio(msg) : msg, t: Date.now() });
        if (kind === 'setup') {
          st.setup = msg.setup; setups.push(msg.setup);
          if (!silent) setTimeout(() => out({ setupComplete: {} }), 30);
          return;
        }
        if (!st.setup) { reject('The first message must be "setup".'); return; }
        if (kind === 'realtimeInput') { onAudio(msg); return; }
        if (kind === 'toolResponse') {
          for (const fr of msg.toolResponse.functionResponses || []) {
            const extra = Object.keys(fr).filter((k) => !FUNCTION_RESPONSE_KEYS.has(k));
            if (extra.length) { reject(`Invalid JSON payload received. Unknown name "${extra[0]}" at 'tool_response.function_responses[0]'`); return; }
          }
          return;
        }
        if (kind === 'clientContent') {
          const text = (msg.clientContent.turns || []).map((t) => (t.parts || []).map((p) => p.text).join('')).join(' ');
          if (st.responding) interrupt();               // any clientContent cuts the generation in progress
          if (msg.clientContent.turnComplete) respond(text);
        }
      });

      function interrupt() {
        st.responding.cancel();
        if (!opts.confirmInterrupt) return;
        out({ serverContent: { interrupted: true } });
        if (opts.turnCompleteAfterInterrupt) out({ serverContent: { turnComplete: true } });
      }

      function onAudio(msg) {
        const a = msg.realtimeInput.audio;
        if (!a || !opts.vad) return;
        const pcm = Buffer.from(a.data, 'base64');
        let sum = 0;
        for (let i = 0; i + 1 < pcm.length; i += 2) { const v = pcm.readInt16LE(i) / 32768; sum += v * v; }
        const level = Math.sqrt(sum / Math.max(1, pcm.length / 2));
        const silenceChunks = Math.ceil((st.setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs || 800) / 100);
        if (level > 0.05) {
          st.speechChunks++; st.silentChunks = 0;
          if (!st.inSpeech && st.speechChunks >= 2) {
            st.inSpeech = true;
            if (opts.voiceActivity) out({ voiceActivity: { type: 'ACTIVITY_START' } });
            if (st.responding && st.setup.realtimeInputConfig.activityHandling !== 'NO_INTERRUPTION') interrupt();
          }
        } else if (st.inSpeech) {
          st.silentChunks++;
          if (st.silentChunks >= silenceChunks) {
            st.inSpeech = false; st.speechChunks = 0;
            if (opts.voiceActivity) out({ voiceActivity: { type: 'ACTIVITY_END' } });
            out({ serverContent: { inputTranscription: { text: 'Hello ' } } });
            out({ serverContent: { inputTranscription: { text: 'Ada.' } } });
            respond('AUDIO');
          }
        } else st.speechChunks = 0;
      }

      function respond(text) {
        let cancelled = false;
        const timers = [];
        const later = (ms, f) => timers.push(setTimeout(() => { if (!cancelled) f(); }, ms));
        st.responding = { cancel() { cancelled = true; timers.forEach(clearTimeout); st.responding = null; } };
        const long = /LONG|INTERRUPT_ME/.test(text);
        const seconds = long ? 4 : 1.2;
        const chunks = Math.round(seconds / 0.2);
        const words = long ? ['Once ', 'upon ', 'a ', 'time, ', 'a ', 'very ', 'long ', 'story.'] : ['Hello, ', 'I ', 'am ', 'Ada.'];
        later(opts.replyDelay, () => {
          for (let i = 0; i < chunks; i++) {
            later(i * 60, () => {
              out({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: tone(0.2, 220 + 20 * (i % 3), 24000).toString('base64') } }] } } });
              if (i < words.length) out({ serverContent: { outputTranscription: { text: words[i] } } });
            });
          }
          if (/CHOICES/.test(text)) later(100, () => out({ toolCall: { functionCalls: [{ id: 'fc-1', name: 'show_choices', args: { question: 'Which do you prefer?', options: ['Painting', 'Sculpture'] } }] } }));
          if (/MOOD/.test(text)) later(100, () => out({ toolCall: { functionCalls: [{ id: 'fc-2', name: 'set_mood', args: { mood: 'happy' } }] } }));
          if (/TOOL/.test(text)) later(100, () => out({ toolCall: { functionCalls: [{ id: 'fc-3', name: 'open_door', args: { room: 'room 2' } }] } }));
          if (/GOAWAY/.test(text)) later(50, () => { out({ sessionResumptionUpdate: { newHandle: 'handle-1', resumable: true } }); out({ goAway: { timeLeft: '1s' } }); });
          if (/INTERRUPT_ME/.test(text)) later(700, () => interrupt());
          later(chunks * 60 + 30, () => { st.responding = null; out({ serverContent: { generationComplete: true } }); out({ serverContent: { turnComplete: true } }); });
        });
      }
    },
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const p = server.address().port;
  return {
    port: p,
    endpoint: `ws://127.0.0.1:${p}/ws/google.ai.generativelanguage.v1beta.GenerativeService`,
    tokenUrl: `http://127.0.0.1:${p}/token`,
    log, setups, opts, connections, errors,
    get openConnections() { return conns.size; },
    clear() { log.length = 0; setups.length = 0; },
    closeAll(code = 1011, reason = 'test') { for (const c of conns) c.close(code, reason); },
    close() { for (const c of conns) c.close(1001, 'bye'); server.close(); },
  };
}

function summarizeAudio(msg) {
  const a = msg.realtimeInput.audio;
  if (!a) return msg;
  const pcm = Buffer.from(a.data, 'base64');
  let sum = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) { const v = pcm.readInt16LE(i) / 32768; sum += v * v; }
  return { audio: { mimeType: a.mimeType, samples: pcm.length / 2, rms: Math.sqrt(sum / Math.max(1, pcm.length / 2)) } };
}

/** A fake voice sound: a fundamental and harmonics, with an envelope. */
export function tone(seconds, f0, rate) {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.sin(Math.PI * i / n);
    const v = 0.35 * env * (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(4 * Math.PI * f0 * t) + 0.25 * Math.sin(6 * Math.PI * f0 * t)) / 1.75;
    b.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return b;
}
