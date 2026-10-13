// A web page that follows the conversation running in the Voice Lab app, and drives it.
// 1. Open the Voice Lab app.  2. Open this folder through a local web server (VS Code's Live Server,
//    or `npx serve` in this folder) and go to the page it shows. A double-clicked file (file://) is refused:
//    the browser hides where it comes from, so it could be any website.
// The app listens and speaks; this page only shows what happens and sends commands.
// Everything goes through one WebSocket: the app sends JSON messages, the page sends JSON commands.
// All the messages: CONTRACT.md, "The clients protocol".
const APP = 'ws://localhost:8790/events';   // Voice Lab menu: Engine → Copy address for clients
const $ = (id) => document.getElementById(id);
let ws;

function connect() {
  if (location.protocol === 'file:') {
    $('app').textContent = 'Opened as a file, so the app refuses it: open this folder through a local web server (see examples/README.md).';
    return;
  }
  ws = new WebSocket(APP);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    $('app').textContent = 'Voice Lab app not found: open it (this page reconnects on its own).';
    setTimeout(connect, 2000);
  };
}

function send(command) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(command));
}

function onMessage(m) {
  switch (m.type) {
    case 'hello':          // on connecting, and when the lab window opens or closes: the conversation as it is
      $('app').textContent = m.app ? `Connected to ${m.name || 'the agent'} (${m.engine})` : 'The Voice Lab app is running, but its window is closed.';
      $('name').textContent = m.name || 'Agent';
      showState(m.state);
      $('user').textContent = m.userText;
      $('bot').textContent = m.botText;
      showChoices(m.choices);
      break;
    case 'state': showState(m.state); break;                          // idle, listening, hearing, thinking, speaking…
    case 'user.partial': case 'user.text': $('user').textContent = m.text; break;
    case 'bot.text': $('bot').textContent = m.text; break;              // the reply, as it comes
    case 'thinking': showChoices([]); break;
    case 'ui.choices': showChoices(m.options); break;
    case 'levels':                                                      // about 30 times a second, 0 to 1
      $('orb').style.setProperty('--mic', m.user);
      $('orb').style.setProperty('--voice', m.bot);
      break;
    case 'error': $('app').textContent = m.message; break;
  }
}

function showState(state) {
  $('orb').className = state;
  $('state').textContent = state;
}

function showChoices(options) {
  $('choices').replaceChildren(...(options || []).map((option) => {
    const b = document.createElement('button');
    b.textContent = option;
    b.onclick = () => send({ type: 'choose', option });
    return b;
  }));
}

// The commands: start, stop, interrupt, text, context, choose.
$('start').onclick = () => send({ type: 'start' });
$('stop').onclick = () => send({ type: 'stop' });
$('interrupt').onclick = () => send({ type: 'interrupt' });
$('contextForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('context').value.trim();
  if (text) send({ type: 'context', text });               // the agent knows it for its next reply, without answering
  $('context').value = '';
};

connect();
