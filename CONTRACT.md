# The shared vocabulary

The **Voice Lab app** is the brain of the kit: it listens, thinks and speaks, with the local QVAC engine or with Gemini Live, and it holds the persona, its knowledge and the settings. Its **clients** (the cables.gl op, a p5.js sketch, a web page) all follow the same conversation through the app's hub, and drive it with the same commands. Both engines produce **the same states and the same events**, so an interface designed with one works with the other: you only switch the engine in the app.

Everything is defined in [`common/voice-core.js`](common/voice-core.js), which the lab window runs. This file describes that vocabulary, then the two protocols: the clients protocol (the hub), and the audio protocol between the lab window and the local engine.

## The states

A turn goes through these states, in this order:

| state | what is happening | boolean port of the op |
|---|---|---|
| `idle` | nothing has started | — |
| `connecting` | opening the mic and the session | — |
| `listening` | the agent is waiting for someone to speak | `Listening` |
| `hearing` | someone is speaking | `Hearing` |
| `thinking` | the person has finished, the agent is preparing its reply | `Thinking` |
| `speaking` | the agent's voice is playing | `Speaking` |
| `ended` | the conversation is closed, the mic is off | — |
| `error` | an error stopped everything (the message is on the `Error` port) | — |

Two moments are events, not states. When the person stays silent, the agent stays in `listening` and `user.away` fires. When someone talks over the agent and its voice dips, it stays in `speaking` until the kit decides (`interruption.pending`, then `interruption.cancelled` or `interrupted`).

## The events

Every event has the shape `{type, state, t, …data}`: `t` is the time in milliseconds since start, `state` is the state at the time of the event.

| event | when | data | op trigger |
|---|---|---|---|
| `state` | on every state change | `prev` | `On state change` |
| `connecting` | Start was pressed | `engine` | — |
| `start` | mic open and session ready | `engine` | — |
| `listening` | back to listening | — | — |
| `status` | information (loading, reconnecting…) | `text`, `progress` | — (`Status` port) |
| `user.start` | the person starts speaking | `source` (`client`, `server`, `interruption`) | `On user start` |
| `user.partial` | transcript in progress | `text` | — (`User text` port) |
| `user.text` | what the person said, in full | `text`, `typed` (typed on the keyboard) | — (`Last user text` port) |
| `user.end` | end of their turn (silence, or the Smart Turn model) | `speechMs` | `On user end` |
| `user.cancel` | false alarm (cough, noise), or no reply. `reason` `stop`: a stop phrase ("stop", "wait"…) cut the agent off, and it listens without replying | `reason` | — |
| `turn.prediction` | the Smart Turn model has judged the turn (local, `turnDetection` = `smart`) | `probability` (0 to 1), `complete`, `ms` | — (`Turn probability (local)` port) |
| `user.away` | the person has stayed silent for `awayAfterMs` while the agent listens. It fires again after each further silence of that length | `afterMs`, `count` (1, 2, 3…) | `On away` |
| `not.understood` | nothing understandable (local engine) | `text` | `On not understood` |
| `thinking` | the agent is preparing its reply | — | `On thinking` |
| `bot.start` | the first sound of the reply | `waitMs` (the wait you feel) | `On reply start` |
| `bot.text` | the reply, as it comes | `text` | — (`Agent text` port) |
| `bot.sentence` | a sentence starts (local engine) | `text`, `index` | — |
| `bot.filler` | a spoken filler starts, while the agent thinks (local) | `text` | `On filler` |
| `bot.end` | the reply is finished | `text` | `On reply end` |
| `interruption.pending` | someone talks over the agent: its voice dips while the kit decides (local, `interruptAfterMs` above 0) | `by` (`user`) | `On interruption pending` |
| `interruption.cancelled` | it was only a backchannel ("mm-hm") or a noise: the voice comes back and the reply carries on | `reason` (`backchannel` or `noise`), `text` | `On interruption cancelled` |
| `interrupted` | the agent was cut off | `by` (`user` or `client`), `said` | `On interruption` |
| `turn` | summary of a turn | `user`, `bot`, `interrupted`, `ms` | `On turn` |
| `ui.choices` | the agent offers choices | `question`, `options` | `On choices` |
| `ui.mood` | the agent changes mood | `mood` | `On mood` |
| `tool.call` | the agent calls a tool declared in the settings (`extraTools`, Gemini). A client sends the result back (`tool.result`) | `id`, `name`, `args` | `On tool call` |
| `tool.cancel` | Gemini cancels tool calls | `ids` | — |
| `timing` | measurements from the local server | `turnId`, `ms` | — |
| `error` | an error | `code`, `message`, `fatal` | `On error` |
| `ended` | conversation closed | `reason` | — |

**Turn timing** (`turn.ms`): `speech` is how long the person's sentence lasted. `firstSound` runs from the end of their sentence to the agent's first sound: it is the wait you feel. `total` runs from the end of their sentence to the end of the reply. The local engine adds `asr` (waiting for the transcript), `firstToken` (the model's first word), `firstAudio` (first voice frame), `reply`, `filler` (from the end of the person's turn to the start of the filler, when there is one) and `smartTurn` (how long the Smart Turn model took). A filler does not count as the reply: `firstSound` and `Wait (ms)` still measure the wait for the real reply.

**The levels** are not events: the lab window reads them on every frame (`agent.levels()` → `{user, bot}`, from 0 to 1), and the clients get them in `levels` messages, about 30 times a second (`Mic level` and `Voice level` ports). For debugging, `agent.debug()` also gives `duck` (1, or 0.3 while the voice is lowered because someone talks over it) and `gain`.

**The moods**: `neutral`, `happy`, `curious`, `focused`, `sorry`, `surprised`, `excited`.

## The settings

They are set in the Voice Lab window, or in a persona file. Clients don't change them.

| key | default | what it changes | Gemini | local |
|---|---|---|---|---|
| `engine` | `gemini` | the engine | | |
| `name`, `persona` | Ada, a museum guide | who the agent is | system prompt | system prompt |
| `language` | `en` | the language | in the prompt (Gemini picks on its own) | Whisper + voice + prompt |
| `greeting` | empty | what it says first (empty = it waits) | asked of the model | said as written |
| `shortAnswers` | yes | short spoken answers | prompt | prompt |
| `creativity` | 1 | 0 calm → 2 unpredictable | `temperature` | `temp` × 0.7 |
| `speakingStyle` | empty | way of speaking ("slow, calm") | prompt | — |
| `geminiVoice` | Kore | one of the 30 Gemini voices | `voiceName` | — |
| `localVoiceEngine` | `supertonic` | the local voice engine: `supertonic` (10 preset voices), `parler` (a voice described in words, English only) or `chatterbox` (multilingual, can clone a voice) | — | voice reload |
| `localVoice`, `localSpeed` | F1, 1 | Supertonic voice (F1–F5, M1–M5); speed (Supertonic and Chatterbox) | — | voice reload |
| `voiceDescription` | empty | Parler only: the voice described in words ("A warm, low-pitched female voice…"). Empty = Parler's template voice | — | sent with each sentence (no reload) |
| `endSilenceMs` | 800 | silence that ends a turn | `silenceDurationMs` | Whisper end of turn (with Smart Turn: the longest wait) |
| `turnDetection` | `silence` | how the end of turn is decided: `silence` (the end silence alone) or `smart` (silence + the Smart Turn model: a sentence that sounds finished ends the turn at once) | — | Smart Turn model |
| `startSensitivity` | `high` | how easily the start of speech is detected | `startOfSpeechSensitivity` | Silero VAD threshold |
| `endSensitivity` | `high` | how easily it decides you're done | `endOfSpeechSensitivity` | minimum silence in a segment |
| `prefixPaddingMs` | 20 | minimum speech before a start counts | `prefixPaddingMs` | — |
| `interruptible` | yes | can you interrupt it? | `activityHandling` | cancels the reply |
| `interruptAfterMs` | 0 | 0 = any speech over the agent stops it at once. Above 0 (up to 2,000 ms), its voice dips first, and it only stops if the person keeps talking this long. A backchannel ("mm-hm") or a noise lets it carry on; a stop phrase ("stop") makes it stop and listen | — | server |
| `listenWhileSpeaking` | yes | the mic stays open while it speaks | browser | browser |
| `micMuted` | no | mic muted | browser | browser |
| `awayAfterMs` | 0 (never) | silence while listening before `user.away` (up to 3,600,000 ms) | browser | browser |
| `repromptLine` | empty | what the agent says **once** when the person stays silent (at the first `user.away`) | asked of the model, in its own words | said as written |
| `replyDelayMs` | 0 | delay added before the voice | browser | server |
| `earcons` | `soft` | small interface sounds (`off`, `soft`, `clear`) | browser | browser |
| `thinkingSound` | `off` | sound while thinking (`off`, `tick`, `hum`) | browser | browser |
| `repairLine` | empty | what it says when it understood nothing | — | server |
| `fillerLines` | empty (off) | short phrases said while it thinks, separated by `\|` (up to 20): "Hmm, let me see…\|Good question…" | — | server |
| `fillerAfterMs` | 1200 | say a filler if the reply's voice has not started this long after the end of the person's turn (0 = never; up to 30,000) | — | server |
| `volume`, `playVoice` | 1, yes | volume, play through speakers | browser | browser |
| `uiTools` | yes | it can show choices and a mood | `show_choices`, `set_mood` tools | `[[choices: …]]`, `[[mood: …]]` tags |
| `extraTools` | empty | extra tools (JSON) | function declarations | — |
| `geminiModel`, `apiKey`, `tokenUrl`, `geminiEndpoint` | gemini-3.8-live | connection to Gemini | | |
| `serverUrl` | `ws://localhost:8790/voice` | address of the local backend | | |

On the Gemini side, an open session cannot change persona, voice or turn rules. The lab window then says "click Start to restart". On the local side, everything applies live, except the server address. The settings added with the open-source borrowings (`turnDetection`, `interruptAfterMs`, `awayAfterMs`, `repromptLine`, `fillerLines`, `fillerAfterMs`, `localVoiceEngine`, `voiceDescription`) never need a restart. A "—" in the Gemini column means Gemini ignores the setting.

## The clients protocol (the hub)

Any page can follow the conversation and drive it through one WebSocket: `ws://localhost:8790/events` (Voice Lab menu **Engine → Copy address for clients**). The cables op, the examples in [`examples/`](examples/) and your own pages all use it.

Allowed pages: those served from this computer (`http://localhost:*`, `http://127.0.0.1:*`), cables.gl and the p5.js web editor (`allowedOrigins` in `config.json`). A page opened by double-click (`file://`) is refused: the browser hides where it comes from, so it could be any website. Open it through a local web server instead (VS Code's Live Server, or `npx serve`).

**The app sends** (JSON):

- `{type:'hello', app, name, engine, state, userText, botText, question, choices, mood, status, levels}`: on connecting, and again when the lab window opens or closes, or when the agent's name or engine changes. It is everything a client needs to draw the conversation as it is now. `app` is `false` when the app runs but its window is closed: nothing happens until it opens;
- every event of the table above, as it is: `{type, state, t, …data}`;
- `{type:'levels', user, bot}`: the mic and the voice, from 0 to 1, about 30 times a second while they move;
- `{type:'error', code, message, fatal:false}` when a command is refused: `no-app` (the lab window is closed) or `bad-command`.

**The client sends** (JSON):

| command | what it does |
|---|---|
| `{type:'start'}` | starts the conversation, like the lab window's Start button |
| `{type:'stop'}` | stops it |
| `{type:'interrupt'}` | cuts the agent's reply |
| `{type:'text', text}` | a typed message: the agent replies to it |
| `{type:'context', text}` | information for the agent, with no reply ("the visitor is in room 2") |
| `{type:'choose', option}` | picks one of the choices the agent offered |
| `{type:'tool.result', id, result}` | the result of a `tool.call` (Gemini) |

Every client sees the same conversation, and any of them can drive it. The mic and the speakers are the app's: clients only show and command.

## The audio protocol (lab window ↔ local engine)

The lab window streams the mic to the local engine and plays its voice through a WebSocket: `ws://localhost:8790/voice`. Clients never use it: they use the hub.

**The browser sends:**

- as binary: the mic as 16-bit PCM, mono, 16 kHz (100 ms packets);
- as JSON:
  - `{type:'start', settings}`: start;
  - `{type:'settings', settings}`: change a setting;
  - `{type:'text', text}`: a typed message, or a choice;
  - `{type:'context', text}`: information for the agent, with no reply. It never cuts the agent off: the local engine keeps it for the next reply (the last 5), and the Gemini engine holds it while the agent is speaking, then sends it at the end of the reply;
  - `{type:'interrupt'}`: cut the reply;
  - `{type:'say', text}`: the agent says this line as written, with no thinking state, and it goes into the history as the agent's message (used for the reprompt line);
  - `{type:'playback', state:'ended', turnId}`: the voice has finished playing;
  - `{type:'stop'}`: stop.

**The server replies:**

- as JSON:
  - `{type:'status', text, progress}`;
  - `{type:'ready', engine, voices, models, voiceEngine}`: `voices` is empty (`[]`) for Parler and Chatterbox;
  - `{type:'vad', speaking}`;
  - `{type:'user.partial'|'user.text', text}`. A stop phrase comes as `{type:'user.text', text, reply:false}`: it goes into the history, but the agent does not reply;
  - `{type:'turn.prediction', probability, complete, ms}`: the Smart Turn model's verdict on the turn;
  - `{type:'not.understood', text}`;
  - `{type:'thinking', turnId}`;
  - `{type:'bot.text'|'bot.sentence', text, turnId}`;
  - `{type:'bot.done', turnId, text}`;
  - `{type:'interrupted', turnId, by}`;
  - `{type:'bot.duck', turnId}`: someone talks over the agent, lower its voice;
  - `{type:'bot.unduck', turnId, reason, text}`: it was a backchannel or a noise (`reason`: `backchannel` or `noise`), bring the voice back;
  - `{type:'bot.filler', text, turnId}`: a spoken filler, followed by its audio frames;
  - `{type:'ui.choices', question, options}`;
  - `{type:'ui.mood', mood}`;
  - `{type:'timing', turnId, ms}`: `ms` includes `smartTurn` when the model was used;
  - `{type:'error', code, message, fatal}`.

  Two `status` texts are warnings, not errors: "Smart Turn is unavailable here: using silence only." (once per conversation) and "Parler only speaks English: replies will sound English-accented."
- as binary: the voice, with an 8-byte header followed by the sound. The first 4 bytes give the sample rate (unsigned 32-bit integer, little-endian), the next 4 the turn number (same format), then comes the 16-bit mono PCM. The browser ignores the voice of a turn it has interrupted. A turn number of `0xFFFFFFFF` (4294967295) marks the audio of a **filler**: the browser plays it, but it is not part of the reply.

One conversation at a time. A second lab window that connects takes over, and the first one receives the `replaced` error.

## Mapping to other toolkits

The kit keeps its own short names, because they are easy for students. Other voice toolkits use other names for the same moments. This table lets you read their docs (or rebuild one of their interfaces) without getting lost.

One difference matters. **LiveKit** separates the agent's state from the user's state. So the kit's `hearing` is, in LiveKit's words, "agent `listening` + user `speaking`".

| the kit | [LiveKit Agents](https://docs.livekit.io/agents/build/events/) | [Pipecat RTVI](https://docs.pipecat.ai/client/rtvi-standard) | [ElevenLabs UI Orb](https://github.com/elevenlabs/ui/blob/HEAD/apps/www/registry/elevenlabs-ui/ui/orb.tsx) | [Home Assistant Assist pipeline](https://developers.home-assistant.io/docs/voice/pipelines/) |
|---|---|---|---|---|
| `idle`, `ended` | `disconnected` (UI hooks, [useAgent.ts](https://github.com/livekit/components-js/blob/HEAD/packages/react/src/hooks/useAgent.ts)) | — | — | — |
| `connecting` | agent `initializing`; UI hooks `connecting`, `pre-connect-buffering` (the mic already records before the session is ready) | — (`bot-ready` marks its end) | — | — |
| `listening` | agent `listening` | between `bot-stopped-speaking` and `user-started-speaking` | `listening` | `stt-start` |
| `hearing` | agent `listening` + user `speaking` | `user-started-speaking` → `user-stopped-speaking` | (input volume) | `stt-vad-start` → `stt-vad-end` |
| `thinking` | `thinking` | `bot-llm-started`, `llm-function-call-*` | `thinking` | `intent-start`, `intent-progress` |
| `speaking` | `speaking` | `bot-started-speaking` → `bot-stopped-speaking` | `talking` | `tts-start` → `tts-end` |
| `error` | `failed` (UI hooks) | `error` | — | `error` |
| `user.away` (`On away`) | user `away` (after 15 s of inactivity by default) | — | — | — |
| `interruption.cancelled` (`On interruption cancelled`) | `agent_false_interruption`, with a `resumed` field: the agent picks its sentence back up | — | — | — |
| `Mic level`, `Voice level` | (audio visualizers) | — | input volume, output volume | — |
| `ui.choices`, `tool.call` | client-side RPC tools | function calls, and the UI channel (`ui-command`, `ui-event`, `ui-snapshot`) | — | — |
| `turn` (end of a turn) | — | — | — | `run-end` (one pipeline run) |

*An approximate mapping, based on the event lists linked above and collected in [`docs/OPEN_SOURCE_LANDSCAPE.md`](docs/OPEN_SOURCE_LANDSCAPE.md). The columns do not always line up exactly.*

Two more neighbours:

- A **stop phrase** (`user.cancel` with `reason` `stop`) is close to the *wait* class of TEN's turn model, which means "the user wants the agent to be quiet", as opposed to "I'm done" ([TEN Turn Detection](https://huggingface.co/TEN-framework/TEN_Turn_Detection)).
- The **Smart Turn** model behind `turnDetection` = `smart` comes from Pipecat ([pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn)). Here, its verdict is the `turn.prediction` event.
