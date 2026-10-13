# Examples: your own clients for the Voice Lab app

The Voice Lab app is the brain: it listens, thinks and speaks (local engine or Gemini), with its persona and knowledge. Any page can follow that conversation and drive it through one WebSocket, `ws://localhost:8790/events`. These two examples are starting points: copy one, then change everything.

| folder | what it shows |
|---|---|
| [`html-css-js/`](html-css-js/) | a plain web page: an orb coloured by the state and sized by the levels (CSS only), the subtitles, the choices as buttons, Start / Stop / Interrupt, and a field that sends context |
| [`p5js/`](p5js/) | a p5.js sketch: an orb drawn every frame from the state and the levels, the subtitles. Click: start / stop. Keys 1, 2, 3: tell the agent which room the visitor is in |

## Run one

1. Open the **Voice Lab app** (and keep its window open).
2. Open the example **through a web server**, not by double-clicking the file:
   - **VS Code**: install the *Live Server* extension, right-click `index.html` → **Open with Live Server**;
   - **or** in a terminal, inside the example's folder: `npx serve`, then open the address it shows.
   - For the p5.js sketch, you can also paste `sketch.js` into the [p5.js web editor](https://editor.p5js.org/).
3. Click **Start** (or click the sketch). Talk: the page follows.

Why not a double-click? A page opened from a file (`file://`) gives no origin to the app, so the app can't tell it from any website, and it refuses it. The pages allowed are those served from this computer, cables.gl and the p5.js web editor (`allowedOrigins` in the app's `config.json`).

## The 20 lines that matter

```js
const ws = new WebSocket('ws://localhost:8790/events');
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'hello') { /* the conversation as it is now: m.state, m.name, m.choices… */ }
  if (m.type === 'state') { /* m.state: idle, listening, hearing, thinking, speaking, ended… */ }
  if (m.type === 'levels') { /* m.user (mic) and m.bot (voice), 0 to 1, about 30 times a second */ }
  if (m.type === 'user.text') { /* what the person said */ }
  if (m.type === 'bot.text') { /* the reply, as it comes */ }
  if (m.type === 'ui.choices') { /* m.options: buttons to show */ }
};
// the commands
ws.send(JSON.stringify({ type: 'start' }));
ws.send(JSON.stringify({ type: 'context', text: 'The visitor is in room 2.' }));
ws.send(JSON.stringify({ type: 'choose', option: 'Painting' }));
```

All the messages and commands: [`../CONTRACT.md`](../CONTRACT.md), "The clients protocol". Every event there reaches your page as it is, with the same name.
