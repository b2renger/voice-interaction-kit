# The shared vocabulary

The **VIK studio** is the brain of the kit: it listens, decides and speaks with the local engine (or lets Gemini Live do it all), and it holds the agent: its persona, its knowledge, its patterns and its settings ([`docs/DESIGN.md`](docs/DESIGN.md)). Its **clients** (the cables.gl op, a p5.js sketch, a web page) all follow the same conversation through the app's hub, and drive it with the same commands. Both engines produce **the same states and the same events**, so an interface designed with one works with the other: you only switch the engine in the app.

Everything is defined in [`common/voice-core.js`](common/voice-core.js), which the studio runs. This file describes that vocabulary, then the two protocols: the clients protocol (the hub), and the audio protocol between the studio and the local engine.

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
| `user.text` | what the person said, in full | `text`, `typed` (typed on the keyboard), `speaker` (only when people are recorded in Settings → People: their name, `''` someone not recognized) | — (`Last user text` port) |
| `speaker` | who is speaking, recognized by their voice (local engine, people recorded in Settings → People): at the end of each spoken turn, before its `user.text` | `name` (`''`: someone not recognized), `closest` (the closest person anyway), `score` (0 to 1; null when too short), `short` (too short to tell) | — |
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
| `interrupted` | the agent was cut off | `by` (`user`, `client`, or `error`: its reply failed, an `error` event says why), `said` | `On interruption` |
| `turn` | summary of a turn | `user`, `bot`, `interrupted`, `ms` | `On turn` |
| `ui.choices` | the agent offers choices | `question`, `options` | `On choices` |
| `ui.mood` | the agent changes mood | `mood` | `On mood` |
| `voice` | a pattern changed the agent's voice to one of its saved voices (VIK, the local engine), or back to its own | `voice` (the saved voice's id, `''` = its own), `name` | — |
| `osc.in` | an OSC message arrived on the port `oscIn` (a sensor, a button; local engine). A stream comes thinned out: at most 5 per second per address, always the latest | `address`, `args` | — |
| `language` | the conversation's language: once at the start (the agent's), then at each change (the Talk view, a pattern's "Change language", a client's `language` command; local engine) | `language` (`en`, `fr`, `es`, `de`, `it`, `pt`), `own` (it is the agent's own) | — |
| `tool.call` | the agent calls a tool declared in the settings (`extraTools`, Gemini). A client sends the result back (`tool.result`) | `id`, `name`, `args` | `On tool call` |
| `tool.cancel` | Gemini cancels tool calls | `ids` | — |
| `timing` | measurements from the local server | `turnId`, `ms` | — |
| `decision` | the local decision model has decided what to do with a sentence, a signal or the start (docs/DESIGN.md §3) | `text`, `stage`, `kind` (`pattern`, `otherwise`, `free`, `denied`: the pattern is kept for some people, and the person speaking is not one of them, or `outside`: nothing fits, the agent keeps to its subject and says it can't help), `speaker` (who said it, null when nobody is recorded), `who` (the people the pattern is kept for), `pattern` (`{id, name, kind}` or null), `score` (0 to 1), `example` (the closest one), `entry` (`{table, key}` or null), `candidates` (the next best: `{id, name, score, example, entry}`), `matcher` (`EmbeddingGemma 300M` or `Words`), `ms` | `On decision` (`Decision`, `Decision score`, `Entry` ports) |
| `stage` | the agent moves to another stage (and once at the start) | `stage`, `from` | `On stage` (`Stage` port) |
| `signal` | a pattern sends a signal to the clients ("show-artwork: Water Lilies") | `name`, `value` | `On agent signal` (`Agent signal`, `Agent signal value` ports) |
| `osc` | a pattern has sent an OSC message (ArtLux, an Arduino…), to the addresses of the setting `oscTo` | `address`, `args` (its value: none or one), `to` (`host:port` list; empty: not sent) | — |
| `error` | an error | `code`, `message`, `fatal` | `On error` |
| `ended` | conversation closed | `reason` | — |

**Turn timing** (`turn.ms`): `speech` is how long the person's sentence lasted. `decide` is how long the decision model took. `firstSound` runs from the end of their sentence to the agent's first sound: it is the wait you feel. `total` runs from the end of their sentence to the end of the reply. The local engine adds `asr` (waiting for the transcript), `firstToken` (the model's first word), `firstAudio` (first voice frame), `reply`, `filler` (from the end of the person's turn to the start of the filler, when there is one) and `smartTurn` (how long the Smart Turn model took). A filler does not count as the reply: `firstSound` and `Wait (ms)` still measure the wait for the real reply.

**The levels** are not events: the studio reads them on every frame (`agent.levels()` → `{user, bot}`, from 0 to 1), and the clients get them in `levels` messages, about 30 times a second (`Mic level` and `Voice level` ports). `agent.mic()` → `{db, open}` is the mic after the gain (dBFS) and the gate's state, for a meter (Settings → Microphone). For debugging, `agent.debug()` also gives `duck` (1, or 0.3 while the voice is lowered because someone talks over it) and `gain`.

**The moods**: `neutral`, `happy`, `curious`, `focused`, `sorry`, `surprised`, `excited`.

## The settings

They are set in the studio. Clients don't change them. They belong to the **agent** and are saved in its `persona.md`, so that an agent reopened on another computer behaves the same: since 3.8.0 the engine, the models, the language model, OSC, the microphone and the clients' settings are always written there (an agent of an earlier version gets those last used on the computer, the first time it is opened). Those marked **(this computer)** are keys, passwords and this computer's own addresses: they are kept in the studio, never in an agent, never exported, and an imported agent cannot set them. Importing an agent whose settings send something elsewhere (`engine: gemini`, a farm or a service on another computer, `oscTo` with another computer's address, `oscIn`, `clientsMayStart`), the studio lists them first; Cancel turns those off (`local`, empty, no).

| key | default | what it changes | Gemini | local |
|---|---|---|---|---|
| `engine` | `local` in the studio | the engine: `local` (VIK hears, decides, speaks) or `gemini` (Gemini Live does it all) | | |
| `agent` | empty | the agent (its folder name): its knowledge and its patterns decide | — | the decision model |
| `name`, `persona` | Ada, a museum guide | who the agent is | system prompt | system prompt |
| `language` | `en` | the agent's language: the one its persona, knowledge and lines are written in, and the one each conversation starts in. In another conversation language (local engine), its fixed lines are translated by the language model | in the prompt (Gemini picks on its own) | Whisper + voice + prompt |
| `greeting` | empty | what it says first (empty = it waits) | asked of the model | said as written; translated first if it is written in another language than the conversation's |
| `shortAnswers` | yes | short spoken answers | prompt | prompt |
| `freeTalk` (an agent's, in its `persona.md`) | yes, or no for an agent with an `otherwise` pattern | what no pattern catches: the language model answers (yes), or only when something in the knowledge fits, else the `otherwise` pattern or a fixed line (no) | — | the decision model |
| `creativity` | 1 | 0 calm → 2 unpredictable | `temperature` | `temp` × 0.7 |
| `speakingStyle` | empty | way of speaking ("slow, calm") | prompt | — |
| `geminiVoice` | Kore | one of the 30 Gemini voices | `voiceName` | — |
| `localVoiceEngine` | `supertonic` | the local voice engine: `supertonic` (10 preset voices), `chatterbox` (multilingual, can clone a voice: `referenceAudio`) or `zonos` (a voice designed with sliders, spoken by Zonos's engine in the studio's window, on the graphics card: [`docs/ZONOS.md`](docs/ZONOS.md); when it cannot speak, the default voice does and a status says so) | — | voice reload (`zonos`: waits for its engine to load) |
| `localVoice`, `localSpeed` | F1, 1 | Supertonic voice (F1–F5, M1–M5); speed (Supertonic and Chatterbox) | — | voice reload |
| `referenceAudio` | empty | Chatterbox only: the voice it imitates, a recording kept in the agent, `voices/<name>.wav` (Voice & timing → Clone a voice). Empty or anything else: `models.tts.chatterbox.referenceAudio` in `config.json`, else Chatterbox's own voice | — | voice reload |
| `zonosVoice` | empty | Zonos only: one of its voices, by its name ("Gaspard") or its id. Empty = `voice` in `config.json`, else the first default voice | — | sent with each sentence (no reload) |
| `voiceDesign` | empty | Zonos only: the voice designed, as a line of slider names and values: "age +1.5, deep 3, gender -1" (the sliders Zonos lists; a raw `<set>.<direction>` dose is sent as written). Unknown names are left out | — | sent with each sentence (no reload) |
| `localAsr`, `localLlm` | empty (= `src` in `config.json`) | the speech recognition and local language models: a QVAC name among the `choices` in `config.json` (any other value = the default) | — | model reload |
| `llm` | `local` | who writes the replies: `local` (`localLlm`), `farm` (an [LlmOnLan](https://github.com/b2renger/LlmOnLan) farm on the network) or `service` (any OpenAI-compatible address: Ollama, LM Studio, OpenAI, Gemini, Mistral, OpenRouter) | — | switching loads or frees the local model |
| `llmUrl`, `llmModel`; `llmKey` (this computer) | empty | the farm's or the service's OpenAI address (`http://<host>:4000/v1`), the model there; its key or password | — | sent with each reply |
| `oscTo` | `127.0.0.1:10000` | where the patterns' "Send OSC" messages go: one or more `host:port`, separated by commas | — | applies to the next message |
| `oscIn` | empty | the UDP port sensors and buttons send OSC to, on every network interface, during a conversation. Empty: not listening. A port already taken gives the error `osc` | — | listens again at once |
| `endSilenceMs` | 800 | silence that ends a turn | `silenceDurationMs` | Whisper end of turn (with Smart Turn: the longest wait) |
| `turnDetection` | `silence` | how the end of turn is decided: `silence` (the end silence alone) or `smart` (silence + the Smart Turn model: a sentence that sounds finished ends the turn at once) | — | Smart Turn model |
| `startSensitivity` | `high` | how easily the start of speech is detected | `startOfSpeechSensitivity` | Silero VAD threshold |
| `endSensitivity` | `high` | how easily it decides you're done | `endOfSpeechSensitivity` | minimum silence in a segment |
| `prefixPaddingMs` | 20 | minimum speech before a start counts | `prefixPaddingMs` | — |
| `interruptible` | yes | can you interrupt it? | `activityHandling` | cancels the reply |
| `interruptAfterMs` | 0 | 0 = any speech over the agent stops it at once. Above 0 (up to 2,000 ms), its voice dips first, and it only stops if the person keeps talking this long. A backchannel ("mm-hm") or a noise lets it carry on; a stop phrase ("stop") makes it stop and listen | — | server |
| `listenWhileSpeaking` | yes | the mic stays open while it speaks (untick with speakers) | browser | browser |
| `micMuted` (this computer) | no | mic muted | browser | browser |
| `micGain` | 0 | the mic's gain in dB (-12 to +24), before anything listens to it | browser | browser |
| `micGate` | -80 (off) | the gate's threshold in dBFS (-80 = off, to -10): quieter than this, after the gain, the agent hears silence; it closes 300 ms after the last loud sound | browser | browser |
| `micAutoGain` | yes | the browser's automatic level (`autoGainControl`); untick it to set the gain yourself in a noisy room. At the next Start | browser | browser |
| `awayAfterMs` | 0 (never) | silence while listening before `user.away` (up to 3,600,000 ms) | browser | browser |
| `repromptLine` | empty | what the agent says **once** when the person stays silent (at the first `user.away`) | asked of the model, in its own words | said as written (translated first, like the greeting) |
| `replyDelayMs` | 0 | delay added before the voice | browser | server |
| `earcons` | `soft` | small interface sounds (`off`, `soft`, `clear`) | browser | browser |
| `repairLine` | empty | what it says when it understood nothing | — | server |
| `fillerLines` | empty (off) | short phrases said while it thinks, separated by `\|` (up to 20): "Hmm, let me see…\|Good question…" | — | server |
| `fillerAfterMs` | 1200 | say a filler if the reply's voice has not started this long after the end of the person's turn (0 = never; up to 30,000) | — | server |
| `volume`, `playVoice` | 1, yes | volume, play through speakers | browser | browser |
| `uiTools` | yes | it can show choices and a mood | `show_choices`, `set_mood` tools | `[[choices: …]]`, `[[mood: …]]` tags |
| `extraTools` | empty | extra tools (JSON) | function declarations | — |
| `geminiModel`; `apiKey`, `tokenUrl`, `geminiEndpoint` (this computer) | gemini-3.8-live | connection to Gemini: the model; the key or the token server | | |
| `serverUrl` (this computer) | the studio's own server | address of the local backend | | |
| `title` | the name | the agent's name in the studio's list (persona.md only) | | |

On the Gemini side, an open session cannot change persona, voice or turn rules. The studio then says "click Start to restart". On the local side, everything applies live, except the server address. The settings added with the open-source borrowings (`turnDetection`, `interruptAfterMs`, `awayAfterMs`, `repromptLine`, `fillerLines`, `fillerAfterMs`, `localVoiceEngine`, `voiceDescription`, `zonosVoice`, `voiceDesign`) never need a restart, nor do the model choices (`localAsr`, `localLlm`, `llm`…) or the agent (`agent`: back to its first stage). A "—" in the Gemini column means Gemini ignores the setting.

## The clients protocol (the hub)

Any page can follow the conversation and drive it through one WebSocket: `ws://localhost:8790/events` (VIK menu **Engine → Copy address for clients**). The cables op, the examples in [`examples/`](examples/) and your own pages all use it.

Allowed pages: those served from this computer (`http://localhost:*`, `http://127.0.0.1:*`), cables.gl and the p5.js web editor (`allowedOrigins` in `config.json`): any patch or sketch from those sites, in a browser of this computer, can connect, and receives everything said during a conversation. A program of this computer sends no origin and is accepted too, here and on the studio's own addresses: VIK cannot tell it from the studio. Requests must be named `127.0.0.1` or `localhost` (a web page whose name was pointed at this computer is refused), unless `host` in `config.json` opens the server to the network. A page opened by double-click (`file://`) is refused: the browser hides where it comes from, so it could be any website. Open it through a local web server instead (VS Code's Live Server, or `npx serve`).

**The app sends** (JSON):

- `{type:'hello', app, name, engine, state, stage, language, userText, botText, question, choices, mood, status, levels}`: on connecting, and again when the studio opens or closes, or when the agent's name or engine changes. It is everything a client needs to draw the conversation as it is now. `app` is `false` when no studio is connected (the server runs on its own, `npm run server`, with no lab page open): nothing happens until one opens;
- every event of the table above, as it is: `{type, state, t, …data}`;
- `{type:'levels', user, bot}`: the mic and the voice, from 0 to 1, about 30 times a second while they move;
- `{type:'error', code, message, fatal:false}` when a command is refused: `no-app` (the studio is closed), `bad-command`, or `start-refused` (the agent does not let clients start a conversation).

**The client sends** (JSON):

| command | what it does |
|---|---|
| `{type:'start'}` | starts the conversation, like the studio's Start button, if the agent allows it (the studio's **Settings → Clients → Clients may start a conversation**, off at first; the agent's setting `clientsMayStart`): otherwise refused, with `{type:'error', code:'start-refused'}` to every client. Nothing happens during a conversation |
| `{type:'stop'}` | stops it |
| `{type:'interrupt'}` | cuts the agent's reply |
| `{type:'text', text}` | a typed message: the agent replies to it |
| `{type:'context', text}` | information for the agent, with no reply ("the visitor is in room 2") |
| `{type:'choose', option}` | picks one of the choices the agent offered |
| `{type:'tool.result', id, result}` | the result of a `tool.call` (Gemini) |
| `{type:'signal', name, value}` | a signal (a sensor, a button, a moment of a scene): the agent's pattern "when a client sends this signal" answers it, if there is one; otherwise the agent knows it as context (Gemini: as context) |
| `{type:'language', language}` | the conversation's language, like the switch of the Talk view (a language button in an installation): `en`, `fr`, `es`, `de`, `it`, `pt`, or `''` for the agent's own. Hearing and the voice reload (a few seconds); the conversation after goes back to the agent's language. Local engine only |

Every client sees the same conversation, and any of them can drive it. The mic and the speakers are the app's: clients only show and command.

## The audio protocol (studio ↔ local engine)

The studio streams the mic to the local engine and plays its voice through a WebSocket: `ws://localhost:8790/voice`. Clients never use it: they use the hub. The app only accepts its own page there.

**The browser sends:**

- as binary: the mic as 16-bit PCM, mono, 16 kHz (100 ms packets);
- as JSON:
  - `{type:'start', settings}`: start;
  - `{type:'settings', settings}`: change a setting;
  - `{type:'text', text}`: a typed message, or a choice (`(The user chose: "…")`: the decision is made on the option itself). `speaker` (optional): decided as if this person had said it (the studio's "as Léa"); without it, when people are recorded, a typed message is from someone not recognized;
  - `{type:'context', text}`: information for the agent, with no reply. It never cuts the agent off: the local engine keeps it for the next reply (the last 5), and the Gemini engine holds it while the agent is speaking, then sends it at the end of the reply;
  - `{type:'interrupt'}`: cut the reply;
  - `{type:'say', text}`: the agent says this line as written (translated first if it is written in another language than the conversation's: English and French are recognized), with no thinking state, and it goes into the history as the agent's message (used for the reprompt line);
  - `{type:'signal', name, value}`: a client's signal, for the agent's patterns "when a client sends this signal";
  - `{type:'language', language}`: the conversation's language (`''`: the agent's own). An unknown one is ignored;
  - `{type:'playback', state:'ended', turnId}`: the voice has finished playing;
  - `{type:'stop'}`: stop.

**The server replies:**

- as JSON:
  - `{type:'status', text, progress}`;
  - `{type:'ready', engine, voices, models, voiceEngine}`: `voices` is empty (`[]`) for Chatterbox and Zonos. With `localVoiceEngine: 'zonos'` and a Zonos that cannot speak (not installed, no WebGPU, the studio's window closed), `voiceEngine` is the default voice's, `voiceFallback` holds the reason, and a `status` says "Zonos voice unavailable (…): the default voice speaks instead.";
  - `{type:'vad', speaking}`;
  - `{type:'user.partial'|'user.text', text}`. A stop phrase comes as `{type:'user.text', text, reply:false}`: it goes into the history, but the agent does not reply. With people recorded (Settings → People), a `user.text` has a `speaker`, and a `{type:'speaker', name, closest, score, short}` comes just before it: the turn's voice (its last 8.5 s, without its silences) compared with each voiceprint;
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
  - `{type:'voice', voice, name}`: a pattern's "Change voice" took effect (`voice` `''`: the agent's own again);
  - `{type:'osc.in', address, args}`: an OSC message on the port `oscIn` (at most 5 per second per address, the latest). Its value is in what the language model reads; a pattern "when an OSC message arrives" that fires is a `decision` whose `text` is the message (`/arduino/temp 29`), said at the next pause (the agent silent, nobody talking, for 1.5 s);
  - `{type:'language', language, own}`: the conversation's language, right after `ready`, then at each change. A change reloads speech recognition and the voice (`status` "Changing language…"); a pattern's reply waits for it. While it is not the agent's own, its fixed lines (a pattern's "Say", the repair line) are translated by the language model and there are no spoken fillers;
  - `{type:'timing', turnId, ms}`: `ms` includes `smartTurn` when the model was used, and `decide` (the decision model);
  - `{type:'decision', …}`, `{type:'stage', stage, from}`, `{type:'signal', name, value}`: as the events of the same names. A decision comes after `thinking`; a pattern's choices, mood, signals and stage come right after it, before the reply's sentences;
  - `{type:'error', code, message, fatal}`.

  Two `status` texts are warnings, not errors: "Smart Turn is unavailable here: using silence only." (once per conversation) and "Parler only speaks English: replies will sound English-accented." (until 3.7.4: Parler is gone since 3.8.0)
- as binary: the voice, with an 8-byte header followed by the sound. The first 4 bytes give the sample rate (unsigned 32-bit integer, little-endian), the next 4 the turn number (same format), then comes the 16-bit mono PCM. The browser ignores the voice of a turn it has interrupted. A turn number of `0xFFFFFFFF` (4294967295) marks the audio of a **filler**: the browser plays it, but it is not part of the reply.

One conversation at a time. A second studio that connects takes over, and the first one receives the `replaced` error.

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
