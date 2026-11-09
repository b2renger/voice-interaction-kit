# The cables.gl op "VoiceAgent"

An op you paste into the cables.gl editor, **without touching the cables code**. It connects your patch to the **VIK studio** (folder [`app`](../app/)), which is the brain: it listens, decides and speaks, and it holds the agent (persona, knowledge, interactions, voice). The op follows that conversation and gives you everything you need to design the interaction:

- the state of the conversation: listening, hearing, thinking, speaking;
- the voice and mic levels, about 30 times a second;
- the transcripts;
- the choices offered, the mood, the tool calls;
- what the agent decided: the pattern, the entry, the stage, and the **signals** its patterns send ("show-artwork: Water Lilies");
- triggers for every moment of the turn;
- commands: Start, Stop, Interrupt, a typed message, context, a choice, and **signals** to the agent (a sensor, a button: its patterns "when a client sends this signal" answer).

The op is one client among others: a p5.js sketch or a web page can follow the same conversation at the same time (see [`../examples/`](../examples/)). Whichever engine the app uses, the op's ports behave the same.

## Install the op (5 minutes)

1. Open the **VIK app** on this computer, and keep it open.
2. In cables.gl, open your patch. It must belong to you: otherwise the op creation menus are greyed out.
3. Your avatar menu, top right → **Code a new op**. You can also find it with `Ctrl/Cmd + P` by typing "Code a new op".
4. Name: `VoiceAgent`, namespace: the patch's one (`Ops.Patch.P…`), then **Create Op**.
5. The code editor opens. Delete everything, paste **all** of [`VoiceAgent.op.js`](VoiceAgent.op.js), then save (`Ctrl/Cmd + S`).
6. The op appears in the patch, with its ports. `App connected` goes to 1: it found the app.

A "patch op" travels with the patch: if you share or clone the patch, the op comes along.

**The agent (persona, knowledge, patterns, voice, timing) and the engine are chosen in the VIK studio**, not on the op: see [`../app/README.md`](../app/README.md). That's also where Gemini's key or token server goes.

> **Upgrading a patch made with the earlier op** (which ran Gemini itself): paste the new code over it. The outputs and triggers keep their names, so their links stay. The settings ports are gone (they live in the app now), and so are the two audio outputs: use `Voice level` and `Mic level`.

## The ports

### Inputs

| port | role |
|---|---|
| App address | the studio's address for clients: `ws://localhost:8790/events` (VIK: **Settings → Clients**) |
| Start, Stop | open or close the conversation in the app (Start during a conversation = restart) |
| Text + Send text | type instead of talking, or a button that "says" something: the agent replies |
| Context + Send context | inform the agent without it replying ("the user is looking at room 2"). Sent while the agent speaks, it waits for the end of the reply, so it does not cut it off |
| Choice index + Choose | answer a choice by its number (0 = the first one) |
| Interrupt | cut it off with a gesture |
| Tool result + Send tool result | answer a tool call |
| Signal name, Signal value + Send signal | a signal for the agent: a sensor, a button, a moment of the scene (`visitor-near`). Its pattern "when a client sends this signal" answers, if it has one |
| Render | optional: put the op in a render chain (`Render` → `Next`) |

### What it gives you (outputs)

| port | what it is |
|---|---|
| App connected | 1 when the app and its window are open |
| Agent name, Engine | the agent's name, and `local` or `gemini` |
| State | `idle`, `connecting`, `listening`, `hearing`, `thinking`, `speaking`, `ended`, `error` |
| Connected, Listening, Hearing, Thinking, Speaking | 0 or 1, to drive an animation directly |
| Mic level, Voice level | 0 to 1: a mouth, a ring, a glow… |
| User text, Agent text | the subtitles, as they come |
| Last user text, Last agent reply | the last complete turn |
| Conversation | all the turns since Start: `[{user, bot, interrupted, ms}]` |
| Choices, Question | the options offered by the agent (array) |
| Mood | neutral, happy, curious, focused, sorry, surprised, excited |
| Tool call, Tool name | `{id, name, args}` |
| Wait (ms) | between the end of your sentence and its voice: the wait you feel (a filler does not count: it measures the real reply) |
| Turn probability (local) | 0 to 1: how sure the Smart Turn model is that you have finished (end of turn = `silence + Smart Turn` in the app). It updates at each pause in your speech; above 0.5, the turn ends |
| Turn timing | `{speech, firstSound, total}` in milliseconds |
| Status, Error | readable messages (also shown on the op) |
| Decision, Decision score, Entry | what the agent decided for the last sentence (local engine): the pattern's name (empty for a free answer), its score from 0 to 1, the entry found ("Water Lilies") |
| Stage | the agent's current stage (local engine): `welcome`, `tour`… |
| Agent signal, Agent signal value | the last signal the agent's patterns sent: `show-artwork`, `Water Lilies` |
| Event + On event | any event (see [`../CONTRACT.md`](../CONTRACT.md)) |

The triggers: `On state change`, `On user start`, `On user end`, `On thinking`, `On reply start`, `On reply end`, `On interruption`, `On not understood`, `On turn`, `On choices`, `On mood`, `On tool call`, `On error`, and:

| trigger | when |
|---|---|
| On interruption pending | (local) someone talks over the agent and its voice dips, while the kit decides |
| On interruption cancelled | (local) it was only a "mm-hm" or a noise: the voice comes back and the reply carries on |
| On filler | (local) a filler starts ("Hmm, let me see…") |
| On away | the person has stayed silent for "Away after" (both engines) |
| On decision | (local) the agent has decided what to do with a sentence: read `Decision`, `Decision score`, `Entry` |
| On stage | (local) the agent moves to another stage: read `Stage` |
| On agent signal | (local) one of the agent's patterns sends a signal: read `Agent signal` and `Agent signal value` |

## Design recipes

cables op names sometimes change between versions. To find an op, type the keyword given here in the op search (`Esc`). "In the app" means a setting of the VIK window.

- **A face that breathes and talks.** `Voice level` → the scale of a circle or the opening of a "mouth". `Mic level` → a ring around it, which shows "I hear you". `Thinking` → the speed of a rotation. The booleans `Listening`, `Hearing`, `Thinking` and `Speaking` connect directly to switches or color mixes (search for *switch*, *mix*, *interpolate*).
- **Subtitles.** `User text` and `Agent text` → a text op (search for *text*), in HTML or WebGL.
- **A gesture that interrupts.** A click or a key (search for *mouse*, *keyboard*) → `Interrupt`.
- **Call-to-action buttons.** `Choices` → an array of strings (search for *array* to read an item). A click on button number *i* → `Choice index` = *i* (counting from 0), then `Choose`. The agent receives "the user chose X" and carries on.
- **The agent drives the scene.** A pattern of the agent sends a signal (`show-artwork` = `{name}`): on `On agent signal`, read `Agent signal value` and show that artwork, light that lamp. The voice and the scene stay in step, decided by the agent's patterns.
- **The scene wakes the agent up.** A sensor (a mouse zone, a webcam's motion, a pressure pad) sets `Signal name` = `visitor-near` and triggers `Send signal`: the agent's pattern for that signal greets the visitor.
- **Follow the stages.** `On stage` → `Stage`: one look per stage (welcome, tour, goodbye).
- **The scene informs the agent.** When the visitor moves to another room, or picks up an object, set `Context` ("The visitor is in front of the blue painting.") and trigger `Send context`: the agent knows it for its next reply.
- **Making thinking visible or audible.** `On thinking` starts an animation, `On reply start` stops it. Or, in the app, Thinking sound = hum.
- **Latency as a design material.** In the app, raise Reply delay to 2,000 ms: what should the interface do during that time?
- **Not understanding.** `On not understood` (local) or `On interruption` → a "sorry?" animation.
- **"The agent thinks you're done."** In the app, local engine, End of turn = `silence + Smart Turn` and End silence = 2000. Connect `Turn probability (local)` to the fill of a bar, or to how far an "ear" turns towards you. Say a complete question, then a sentence with a pause in the middle: the bar fills on the first, stays low on the second. Show the moment it crosses 0.5 (search for *greater*): that's when the agent takes its turn.
- **"Are you still there?"** In the app, Away after = 8000 and Reprompt line = "Are you still there?". `On away` → the face slowly dims or looks around; `On user start` → it wakes up. The line is said once; after that, `On away` keeps firing with no voice, so the interface can carry on alone (a slower breathing, then sleep).
- **A voice that dips, then decides.** In the app, Interrupt after = 600 (local): `On interruption pending` → the mouth shrinks and an "ear" appears; `On interruption cancelled` → back to normal, the agent carries on; `On interruption` → it gives you the floor.
- **A thinking gesture.** With Filler lines filled in, in the app (local), `On filler` → a small head tilt or a glance upwards while it says "Hmm…".
- **An agent that acts on the patch (Gemini).** Declare a tool in a persona file of the app (menu **Files → Open settings folder**, then its `personas` folder), with the key `extraTools`:

  ```json
  "extraTools": [{
    "name": "change_color",
    "description": "Changes the color of the scene when the user asks.",
    "parameters": { "type": "OBJECT", "properties": { "color": { "type": "STRING", "description": "a color name in English, e.g. red" } }, "required": ["color"] }
  }]
  ```

  When the user says "make it red", `On tool call` fires. `Tool call.args.color` is then `"red"` (search for *object* and *get* to read the value). Then reply with `Tool result` = `{"ok": true}` and `Send tool result`. If no client replies, the app replies on its own after 10 s.

## Good to know

- **The app must stay open**, with its window. If it closes, `App connected` goes to 0 and the op says so on its frame; it reconnects on its own when the app comes back.
- **The mic and the speakers are the app's.** The op shows and commands; it never opens the mic.
- **Echo.** With speakers, the agent may hear itself and cut itself off. Use headphones, or untick "Listen while speaking" in the app: you then interrupt it with `Interrupt`.
- **Several clients at once.** The op, a p5.js sketch and a web page can follow the same conversation; any of them can send commands.
- **Triggers fire as soon as the message arrives**, not necessarily during the render loop: use them to start animations, not to draw.
- **The messages** the op receives and sends are described in [`../CONTRACT.md`](../CONTRACT.md), "The clients protocol".

## Testing

`node tests/test-local.mjs` (Playwright required) runs the op in a fake cables, in Chromium, against the real studio with the simulated engine: connection, states, texts, choices, mood, levels, the commands, and the app closing. `node tests/test-hub.mjs` tests the hub itself. `npm test`, at the root of the kit, runs all the suites (see [`../tests/README.md`](../tests/README.md)).
