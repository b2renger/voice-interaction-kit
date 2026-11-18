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

- **The message** belongs to the pattern: an address and a value. Both can be filled from the entry found: the address `/vik/{name}`, one address per entry (`/vik/Grove`), or the value `{name}`. Or they are fixed (`/arduino/fan`, `1`). A number is sent as a number, anything else as text. Empty: no value.
- **What triggers it** is the pattern's **When**: a sentence ("show me the forest"), an entry mentioned (a scene of a **Scenes** table), a client's signal, the start of the conversation.
- **Where it goes** is set in [Settings](view:settings), under **OSC**: one or more `address:port`, separated by commas. It is this computer's setting, so an agent shared by someone else cannot send your conversation elsewhere. ArtLux on this computer: `127.0.0.1:10000`.

In [Talk](view:talk), "Why it answered" shows each message sent, and where it went. Type a sentence there to try a pattern without speaking.

**ArtLux.** In ArtLux, turn **OSC receive** on (Preferences ▸ OSC / Tracking, port 10000). To move its show machine, send one address per state, with no value: `/vik/{name}` gives `/vik/Grove`, and a **global rule** of the ArtLux project with the trigger `osc /vik/Grove` takes the show into Grove from any state, with its scene and its fade. `/artlux/scene/recall` with a scene's name changes the look only: a running show machine stays in its state. `/artlux/cue/fire` fires a cue. A ready-made agent is in the [examples](https://github.com/b2renger/voice-interaction-kit/tree/main/examples/artlux), and its ArtLux project, with the global rules, in ArtLux's [vik-voice tutorial](https://github.com/urbandronedesign/artlux/tree/main/examples/vik-voice).

## Sensors and buttons (OSC in)

An Arduino, a phone app or a show controller can send OSC to VIK: a temperature, a distance, a button, a tag. The agent then knows the values, and its patterns react to them.

- **Where they arrive:** in [Settings](view:settings), under **OSC**, **Listen on port** (for example `9000`). VIK listens during a conversation, and the list below the port shows the latest value of each address. The first time, Windows asks whether VIK may use the network: allow it, or the messages of another computer or an Arduino never arrive.
- **The agent knows the values.** The language model reads the latest value of each address before every reply: "is it warm in here?" gets the temperature. Say in the persona what each address means: "/arduino/temp is the room's temperature in degrees Celsius".
- **A pattern reacts.** Its **When** is **an OSC message arrives at** an address: any message (a button), or the value going above or below a number (a sensor). It fires when the value crosses the line, and again only once it has gone back a little, so a temperature hovering around 28 does not repeat itself. The agent speaks at the next pause, when it has finished and nobody is talking. `{value}` is the message's value and `{address}` its address, in a line to say, an instruction, or an OSC message sent back.

Together, they make a conversation with the room: the temperature passes 28, the agent says so and asks whether to turn on the fan, "yes please" sends `/arduino/fan 1`. This example, with its Arduino sketch and a script that plays the Arduino when you have none, is in the [examples](https://github.com/b2renger/voice-interaction-kit/tree/main/examples/arduino-osc).

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
