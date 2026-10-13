// A p5.js sketch that follows the conversation running in the Voice Lab app, and drives it.
// 1. Open the Voice Lab app.  2. Paste this sketch into the p5.js web editor (editor.p5js.org), or open
//    this folder through a local web server (VS Code's Live Server, or `npx serve` in this folder).
//    A double-clicked file (file://) is refused: the browser hides where it comes from.
// The orb's colour is the agent's state, its size the agent's voice, its halo your microphone.
// Click: start or stop the conversation. Keys 1, 2, 3: tell the agent which room the visitor is in.
// All the messages: CONTRACT.md, "The clients protocol".
const APP = 'ws://localhost:8790/events';   // Voice Lab menu: Engine → Copy address for clients

// One colour per state, the same as the Voice Lab window
const COLORS = {
  idle: [168, 163, 154], connecting: [168, 163, 154], listening: [62, 142, 126], hearing: [42, 167, 160],
  thinking: [107, 95, 181], speaking: [216, 116, 59], ended: [168, 163, 154], error: [192, 57, 43],
};

let ws;
let agent = { app: false, name: '', state: 'idle', userText: '', botText: '', levels: { user: 0, bot: 0 } };
let voice = 0;
let mic = 0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  connect();
}

function connect() {
  ws = new WebSocket(APP);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'hello') agent = m;                       // on connecting: the conversation as it is now
    else if (m.type === 'state') agent.state = m.state;      // idle, listening, hearing, thinking, speaking…
    else if (m.type === 'levels') agent.levels = m;          // about 30 times a second, 0 to 1
    else if (m.type === 'user.partial' || m.type === 'user.text') agent.userText = m.text;
    else if (m.type === 'bot.text') agent.botText = m.text;  // the reply, as it comes
  };
  ws.onclose = () => { agent.app = false; setTimeout(connect, 2000); };
}

function send(command) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(command));
}

function draw() {
  background(244, 242, 238);
  voice = lerp(voice, agent.levels.bot, 0.3);   // smoothed, so the orb breathes instead of flickering
  mic = lerp(mic, agent.levels.user, 0.3);
  const [r, g, b] = COLORS[agent.state] || COLORS.idle;
  const size = min(width, height) * 0.45;
  const thinking = agent.state === 'thinking' ? 0.06 * sin(frameCount * 0.15) : 0;

  noStroke();
  fill(r, g, b, 60);
  circle(width / 2, height / 2, size * (1.1 + mic * 0.8));        // the halo: your microphone
  fill(r, g, b);
  circle(width / 2, height / 2, size * (1 + voice * 0.4 + thinking));  // the orb: the agent's voice

  fill(29, 28, 26);
  textAlign(CENTER, TOP);
  textSize(18);
  const status = location.protocol === 'file:' ? 'Opened as a file, so the app refuses it: use a local web server or the p5.js editor'
    : agent.app ? `${agent.name || 'Agent'} · ${agent.state}` : 'Open the Voice Lab app…';
  text(status, width / 2, 24);
  textSize(15);
  text(agent.userText || '', 40, height - 130, width - 80, 50);
  fill(109, 106, 100);
  text(agent.botText || '', 40, height - 75, width - 80, 60);
}

function mousePressed() {
  const live = ['connecting', 'listening', 'hearing', 'thinking', 'speaking'].includes(agent.state);
  send({ type: live ? 'stop' : 'start' });
}

function keyPressed() {
  // context: the agent knows it for its next reply, without answering
  if (['1', '2', '3'].includes(key)) send({ type: 'context', text: `The visitor is now in room ${key}.` });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
