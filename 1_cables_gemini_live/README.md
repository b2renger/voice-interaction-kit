# 1. The cables.gl op "VoiceAgent" (Gemini Live)

An op you paste into the cables.gl editor, **without touching the cables code**. It opens the mic and talks with Gemini Live (native voice, online), then exposes everything you need to design the interaction:

- the state of the conversation: listening, hearing, thinking, speaking;
- the voice and mic levels, on every frame;
- the transcripts;
- the choices offered, the mood, the tool calls;
- triggers for every moment of the turn;
- sliders for the voice, the personality and turn-taking.

The same op can also talk to the **local app "Voice Lab"** (QVAC, folder `2_qvac_local`): just open the app and set `Engine` to `Local (QVAC)`. The patch does not change.

## Install the op (5 minutes)

1. In cables.gl, open your patch. It must belong to you: otherwise the op creation menus are greyed out.
2. Your avatar menu, top right → **Code a new op**. You can also find it with `Ctrl/Cmd + P` by typing "Code a new op".
3. Name: `VoiceAgent`, namespace: the patch's one (`Ops.Patch.P…`), then **Create Op**.
4. The code editor opens. Delete everything, paste **all** of [`VoiceAgent.op.js`](VoiceAgent.op.js), then save (`Ctrl/Cmd + S`).
5. The op appears in the patch, with its ports.

> **Optional:** to send the agent's voice to the cables audio ops (analyzer, effects), add the cables audio library to the op: **Manage Op → Add Dependency → Core-Lib → webaudio**. The op and the audio ops then share the same audio context. Without it, the op still works.

A "patch op" travels with the patch: if you share or clone the patch, the op comes along.

## Connect to Gemini

There are two ways.

**A. An API key (simplest, to test on your own).** Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and paste it into `Gemini API key`. It is **never saved in the patch**: it disappears when you reload, unless you tick `Remember key (this browser)`, which keeps it in this browser only.

**B. A token server (for a class, or a shared key).** The key stays on one computer, and the browser gets a single-use token, valid for 30 minutes.

```bash
cd 1_cables_gemini_live/token-server
cp .env.example .env        # then put your key in .env: GEMINI_API_KEY=...
node server.mjs             # Node 18 or later, nothing to install
```

In the op, `Token server` = `http://localhost:8787/token`. Chrome may ask for permission to access the "local network": accept it.

The server only gives tokens to cables.gl pages and local pages (`http://localhost`, `http://127.0.0.1`). For a patch exported and hosted elsewhere, add its address to `ALLOWED_ORIGINS` (in the `.env` file).

Then click **Start** and allow the mic.

> **Data:** on Gemini's free tier, Google may use the conversations to improve its models, and people may review them. For students' voices, use a paid project or set a clear rule about what is said. The mic only opens with **Start**, and closes with **Stop** or when you delete the op.

## The ports

### Settings (inputs)

A port marked **(local)** only works with the local engine (the Voice Lab app): Gemini ignores it. The ports added for the open-source borrowings never need a restart.

**Connection**

| port | role |
|---|---|
| Engine | `Gemini Live` or `Local (QVAC)` |
| Start, Stop | open or close the conversation (Start during a conversation = restart) |
| Gemini model | `gemini-3.8-live` |
| Gemini API key | the key (never saved in the patch) |
| Remember key (this browser) | keep it in this browser |
| Token server | the address of the token server (instead of the key) |
| Local server | `ws://localhost:8790/voice` |

**Persona**

| port | role |
|---|---|
| Name | the agent's name |
| Persona | who it is, what it knows, how it behaves |
| Language | its language |
| Greeting | what it says first (empty = it waits to be spoken to) |
| Short answers | one to three sentences, one question at a time |
| Creativity | 0 = calm, 2 = unpredictable |

**Voice**

| port | role |
|---|---|
| Gemini voice | one of the 30 voices (Kore, Puck, Charon, Sulafat…) |
| Speaking style (Gemini) | "slow and calm", "with a smile"… (asked of the model) |
| Local voice engine | the local voice engine: `Supertonic` (10 preset voices, the default), `Parler` (you describe the voice in words, English only) or `Chatterbox` (multilingual). A change reloads the voice; the first use of Parler or Chatterbox downloads it (over 1 GB) |
| Local voice | voice of the local engine, Supertonic only: F1–F5, M1–M5 |
| Speed (local) | speed of the local voice (Supertonic and Chatterbox) |
| Voice description (Parler) | the voice described in words, in English: "A warm, low-pitched female voice, speaking slowly and clearly, very close to the microphone." It applies from the next sentence, with no reload |
| Volume | voice volume |
| Play through speakers | untick it if the voice goes through an audio op |

**Turn-taking**

| port | role |
|---|---|
| End silence (ms) | silence that ends a turn: short = impatient agent, long = patient agent |
| Start sensitivity | high: hears even a whisper; low: only a clear voice |
| End sensitivity | high: decides quickly; low: waits to be sure |
| Interruptible | can you interrupt it? |
| Listen while speaking | untick it with speakers, otherwise it hears itself |
| Mic muted | mutes the mic |
| End of turn (local) | `silence only`, or `silence + Smart Turn`: a small model also listens to how your sentence ends. A finished sentence ends the turn at once; a pause in the middle waits up to `End silence (ms)`. Try it with `End silence (ms)` = 2000 |
| Interrupt after (ms) (local) | 0 = any speech over the agent stops it at once. Above 0 (up to 2,000), its voice dips first: a short "mm-hm" lets it carry on, "stop" makes it stop and listen, and talking this long interrupts it. 600 is a good start |
| Away after (ms) | silence (while it listens) before `On away` fires; 0 = never. It fires again after each further silence of the same length. Both engines |
| Reprompt line | said **once** when the person stays silent, at the first `On away` ("Are you still there?"). Gemini says it in its own words; the local engine says it as written |

**Feedback**

| port | role |
|---|---|
| Reply delay (ms) | delay added before the voice: latency as a design material |
| Earcons | off, soft or clear |
| Thinking sound | off, tick or hum |
| Repair line (local) | what it says when it understood nothing |
| Filler lines (local) | short phrases said while it thinks, separated by `\|`: `Hmm, let me see…\|Good question…\|One moment…`. Empty = no filler |
| Filler after (ms) (local) | say a filler if the reply's voice hasn't started this long after the end of your sentence (default 1,200; 0 = never). One filler per turn at most |

**Actions**

| port | role |
|---|---|
| On-screen choices and mood | the agent can show choice buttons and a mood |
| Tools (JSON) | other functions the agent can call (see below) |
| Text + Send text | type instead of talking, or a button that "says" something |
| Context + Send context | inform the agent without it replying ("the user is looking at room 2"). If you send it while the agent is speaking, the context waits for the end of its reply, so it does not cut it off. |
| Choice index + Choose | answer a choice by its number (0 = the first one) |
| Interrupt | cut it off with a gesture |
| Tool result + Send tool result | answer a tool call |

**Advanced**

| port | role |
|---|---|
| Render | connect it to a `MainLoop` if you want the levels to follow your loop (optional) |
| Gemini endpoint (advanced) | another address, for a proxy or for tests |

### What it gives you (outputs)

| port | what it is |
|---|---|
| State | `idle`, `connecting`, `listening`, `hearing`, `thinking`, `speaking`, `ended`, `error` |
| Connected, Listening, Hearing, Thinking, Speaking | 0 or 1, to drive an animation directly |
| Mic level, Voice level | 0 to 1, on every frame: a mouth, a ring, a glow… |
| User text, Agent text | the subtitles, as they come |
| Last user text, Last agent reply | the last complete turn |
| Conversation | all the turns: `[{user, bot, interrupted, ms}]` |
| Choices, Question | the options offered by the agent (array) |
| Mood | neutral, happy, curious, focused, sorry, surprised, excited |
| Tool call, Tool name | `{id, name, args}` |
| Wait (ms) | between the end of your sentence and its voice: the wait you feel (a filler does not count: it measures the real reply) |
| Turn probability (local) | 0 to 1: how sure the Smart Turn model is that you have finished (with `End of turn (local)` = `silence + Smart Turn`). It updates at each pause in your speech; above 0.5, the turn ends |
| Turn timing | `{speech, firstSound, total}` in milliseconds |
| Status, Error | readable messages (also shown on the op) |
| Event + On event | any event (see `CONTRACT.md`) |
| Voice (audio), Mic (audio) | audio nodes, for the WebAudio ops |

The triggers: `On state change`, `On user start`, `On user end`, `On thinking`, `On reply start`, `On reply end`, `On interruption`, `On not understood`, `On turn`, `On choices`, `On mood`, `On tool call`, `On error`, and:

| trigger | when |
|---|---|
| On interruption pending | (local) someone talks over the agent and its voice dips, while the kit decides |
| On interruption cancelled | (local) it was only a "mm-hm" or a noise: the voice comes back and the reply carries on |
| On filler | (local) a filler starts ("Hmm, let me see…") |
| On away | the person has stayed silent for `Away after (ms)` (both engines) |

## Design recipes

cables op names sometimes change between versions. To find an op, type the keyword given here in the op search (`Esc`).

- **A face that breathes and talks.** `Voice level` → the scale of a circle or the opening of a "mouth". `Mic level` → a ring around it, which shows "I hear you". `Thinking` → the speed of a rotation. The booleans `Listening`, `Hearing`, `Thinking` and `Speaking` connect directly to switches or color mixes (search for *switch*, *mix*, *interpolate*).
- **Subtitles.** `User text` and `Agent text` → a text op (search for *text*), in HTML or WebGL.
- **A gesture that interrupts.** A click or a key (search for *mouse*, *keyboard*) → `Interrupt`.
- **Call-to-action buttons.** `Choices` → an array of strings (search for *array* to read an item). A click on button number *i* → `Choice index` = *i* (counting from 0), then `Choose`. The agent receives "the user chose X" and carries on.
- **Making thinking visible or audible.** `On thinking` starts an animation, `On reply start` stops it. Or set `Thinking sound` = hum.
- **Latency as a design material.** Raise `Reply delay (ms)` to 2,000 ms: what should the interface do during that time?
- **Not understanding.** `On not understood` (local) or `On interruption` → a "sorry?" animation.
- **"The agent thinks you're done."** With the local engine, set `End of turn (local)` = `silence + Smart Turn` and `End silence (ms)` = 2000. Connect `Turn probability (local)` to the fill of a bar, or to how far an "ear" turns towards you. Say a complete question, then a sentence with a pause in the middle: the bar fills on the first, stays low on the second. Show the moment it crosses 0.5 (search for *greater*): that's when the agent takes its turn.
- **"Are you still there?"** `Away after (ms)` = 8000 and `Reprompt line` = "Are you still there?". `On away` → the face slowly dims or looks around; `On user start` → it wakes up. The line is said once; after that, `On away` keeps firing with no voice, so the interface can carry on alone (a slower breathing, then sleep).
- **A voice that dips, then decides.** With `Interrupt after (ms) (local)` = 600: `On interruption pending` → the mouth shrinks and an "ear" appears; `On interruption cancelled` → back to normal, the agent carries on; `On interruption` → it gives you the floor.
- **A thinking gesture.** With `Filler lines (local)` filled in, `On filler` → a small head tilt or a glance upwards while it says "Hmm…".
- **An agent that acts on the patch.** Declare a tool in `Tools (JSON)`:

  ```json
  [{
    "name": "change_color",
    "description": "Changes the color of the scene when the user asks.",
    "parameters": { "type": "OBJECT", "properties": { "color": { "type": "STRING", "description": "a color name in English, e.g. red" } }, "required": ["color"] }
  }]
  ```

  When the user says "make it red", `On tool call` fires. `Tool call.args.color` is then `"red"` (search for *object* and *get* to read the value). Then reply with `Tool result` = `{"ok": true}` and `Send tool result`. If you don't reply, the op replies on its own after 10 s.

## Good to know

- **Echo.** With speakers, the agent may hear itself and cut itself off. Use headphones, or untick `Listen while speaking`: you then interrupt it with the `Interrupt` button.
- **Changing the persona, the voice or the turn rules** during a session means clicking **Start** again. The op says so on its frame. Volume, delay, sounds and mic change live, and so do `Away after (ms)` and `Reprompt line`.
- **Gemini sessions last 15 minutes at most.** The op reconnects on its own when Gemini announces the end, and picks the conversation up again.
- **Gemini 3.8 Live** picks its language on its own (state it in the persona if needed). Its voices are predefined, and it no longer has "affective dialog" (reacting to the user's emotional tone).
- **Triggers fire as soon as the event arrives**, not necessarily during the render loop: use them to start animations, not to draw.
- **Changing the op.** Don't edit `VoiceAgent.op.js` by hand. Edit `../common/voice-core.js` (the engine) or `op-glue.js` (the ports), then rebuild the file with `node build.mjs`.

## Testing without a key

The `tests/` folder has a fake Gemini Live server and a fake cables. `node tests/test-op-gemini.mjs` (Playwright required) checks 89 points of the op in Chromium, with a fake mic: the setup sent, audio, turns, choices, tools, interruptions, context, away and the reprompt, the new ports, stopping during startup, the token server, reconnection and errors. `npm test`, at the root of the kit, runs all the suites (see [`../tests/README.md`](../tests/README.md)).
