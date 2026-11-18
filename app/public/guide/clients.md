# Clients and signals

The studio is the brain: it listens, decides and speaks. **Clients** are the faces: a cables.gl patch, a p5.js sketch or a web page that follows the conversation and drives it. Any number of them can follow at once.

## The address

Clients connect to the address shown in **Settings → Clients** (`ws://localhost:8790/events` by default), on this computer. The studio's window must stay open.

## What clients get

- the state: listening, hearing, thinking, speaking;
- the words, as they come, and the levels of the microphone and the voice;
- the choices and the mood;
- what the agent decided: the pattern, its score, the entry found, the stage;
- the **signals** sent by the agent's patterns, like `show-artwork` with the value `Water Lilies`.

## What clients send

Start, Stop, Interrupt, a typed message, a choice, context ("the visitor is in room 2"), the conversation's language (a language button: `{type:'language', language:'fr'}`), and **signals** of their own.

## Signals

Signals connect the voice to the space around it.

- **From the agent to the scene.** A pattern's **Send a signal** action: `show-artwork` = `{name}`. The patch shows the artwork, lights a lamp, plays a sound. The voice and the scene stay in step.
- **From the scene to the agent.** A sensor (a mouse zone, a webcam's motion, a button) sends `visitor-near`. The agent's pattern **a client sends the signal** `visitor-near` greets the visitor.

In [Talk](view:talk), **Send a signal…** does it by hand, to try a pattern without a sensor.

## OSC

A pattern's **Send OSC** action sends a message to the software and devices that speak OSC: ArtLux, an Arduino, a show controller, TouchDesigner. No client to write: VIK sends it itself, at the moment it decides, before the agent speaks.

- **The message** belongs to the pattern: an address, like `/artlux/scene/recall`, and a value. Both can be filled from the entry found: the value `{name}`, or the address `/vik/{name}`, one address per entry. Or they are fixed (`Grove`, `1`). A number is sent as a number, anything else as text. Empty: no value.
- **What triggers it** is the pattern's **When**: a sentence ("show me the forest"), an entry mentioned (a scene of a **Scenes** table), a client's signal, the start of the conversation.
- **Where it goes** is set in [Settings](view:settings), under **OSC**: one or more `address:port`, separated by commas. It is this computer's setting, so an agent shared by someone else cannot send your conversation elsewhere. ArtLux on this computer: `127.0.0.1:10000`.

In [Talk](view:talk), "Why it answered" shows each message sent, and where it went. Type a sentence there to try a pattern without speaking.

**ArtLux.** In ArtLux, turn **OSC receive** on (Preferences ▸ OSC / Tracking, port 10000). `/artlux/scene/recall` with a scene's name changes the scene; `/artlux/cue/fire` fires a cue; `/artlux/state/trigger` fires a state machine transition. A ready-made agent is in the [examples](https://github.com/b2renger/voice-interaction-kit/tree/main/examples/artlux).

## cables.gl

The **VoiceAgent** op connects a patch to the studio. Paste the op's code in a new op of your patch, and **App connected** goes to 1. Its outputs and triggers are described in the [cables README](https://github.com/b2renger/voice-interaction-kit/blob/main/cables/README.md). From cables.gl online, Chrome may ask for access to the local network: accept it.

## p5.js and web pages

Start from the [examples](https://github.com/b2renger/voice-interaction-kit/tree/main/examples). Open them through a local web server (VS Code's Live Server, or `npx serve`) or the p5.js web editor: a page opened by double-click is refused. The heart of it:

```js
const ws = new WebSocket('ws://localhost:8790/events');
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'state') { /* m.state: listening, thinking… */ }
  if (m.type === 'signal') { /* m.name, m.value */ }
};
ws.send(JSON.stringify({ type: 'signal', name: 'visitor-near', value: '1' }));
```

Every message is described in the [protocol](https://github.com/b2renger/voice-interaction-kit/blob/main/CONTRACT.md).
