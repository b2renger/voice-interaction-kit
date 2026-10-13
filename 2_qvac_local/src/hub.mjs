// The hub: the Voice Lab window is the brain (it runs the conversation, with the local engine or Gemini,
// with its persona, knowledge and settings), and any number of clients (a cables.gl patch, a p5.js sketch,
// a web page) follow that conversation and drive it.
//   /brain   the lab window: publishes the agent's events and levels, runs the clients' commands
//   /events  the clients: get {type:'hello', …snapshot}, then every event and the levels; send commands
// The messages are described in CONTRACT.md ("The clients protocol").

const COMMANDS = new Set(['start', 'stop', 'interrupt', 'text', 'context', 'choose', 'tool.result']);
const MAX_TEXT = 20000;

export function createHub(log = () => {}) {
  let brain = null;
  const clients = new Set();
  const snap = { name: '', engine: null, state: 'idle', userText: '', botText: '', question: '', choices: [], mood: 'neutral', status: '', levels: { user: 0, bot: 0 } };

  const hello = () => ({ type: 'hello', app: !!brain, ...snap });
  const broadcast = (m) => { const s = JSON.stringify(m); for (const c of clients) c.send(s); };

  /** What a client sees on connecting: the conversation as it is right now. */
  function fold(ev) {
    if (typeof ev.state === 'string') snap.state = ev.state;
    if (ev.type === 'connecting' || ev.type === 'start') snap.engine = ev.engine || snap.engine;
    else if (ev.type === 'user.text') snap.userText = String(ev.text || '');
    else if (ev.type === 'bot.end') snap.botText = String(ev.text || '');
    else if (ev.type === 'ui.choices') { snap.question = String(ev.question || ''); snap.choices = Array.isArray(ev.options) ? ev.options : []; }
    else if (ev.type === 'thinking') { snap.question = ''; snap.choices = []; }
    else if (ev.type === 'ui.mood') snap.mood = String(ev.mood || 'neutral');
    else if (ev.type === 'status') snap.status = String(ev.text || '');
    else if (ev.type === 'ended') { snap.mood = 'neutral'; snap.levels = { user: 0, bot: 0 }; }
  }

  function fromBrain(m) {
    if (m.type === 'event' && m.event && typeof m.event.type === 'string') { fold(m.event); broadcast(m.event); }
    else if (m.type === 'levels') { snap.levels = { user: Number(m.user) || 0, bot: Number(m.bot) || 0 }; broadcast({ type: 'levels', ...snap.levels }); }
    else if (m.type === 'info') { snap.name = String(m.name || ''); snap.engine = m.engine || snap.engine; broadcast(hello()); }
  }

  function fromClient(ws, m) {
    const bad = (message) => ws.sendJson({ type: 'error', code: 'bad-command', message, fatal: false });
    if (!COMMANDS.has(m.type)) return bad(`Unknown command "${m.type}". Commands: ${[...COMMANDS].join(', ')}.`);
    for (const k of ['text', 'option']) if (m[k] != null && (typeof m[k] !== 'string' || m[k].length > MAX_TEXT)) return bad(`"${k}" must be a string (at most ${MAX_TEXT} characters).`);
    if (!brain) return ws.sendJson({ type: 'error', code: 'no-app', message: 'The Voice Lab window is not open.', fatal: false });
    brain.sendJson({ type: 'command', command: m });
  }

  function onMessage(ws, data, handle) {
    if (typeof data !== 'string') return;                // no binary on the hub
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m && typeof m.type === 'string') handle(m);
  }

  return {
    brain(ws) {
      if (brain) brain.close(1000, 'another lab window took over');
      brain = ws;
      log('▸ hub: the lab window is connected');
      ws.on('message', (d) => onMessage(ws, d, fromBrain));
      ws.on('close', () => {
        if (brain !== ws) return;
        brain = null;
        snap.state = 'idle'; snap.levels = { user: 0, bot: 0 };
        broadcast(hello());
      });
      broadcast(hello());
    },
    client(ws) {
      clients.add(ws);
      ws.on('message', (d) => onMessage(ws, d, (m) => fromClient(ws, m)));
      ws.on('close', () => clients.delete(ws));
      ws.sendJson(hello());
    },
    close() { for (const c of clients) c.close(1001, 'server shutting down'); if (brain) brain.close(1001, 'server shutting down'); },
  };
}
