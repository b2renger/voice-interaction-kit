# The tests

They run without a Gemini key, without models and without Electron: "fakes" take their place, and speak the same protocols.

**To run them all:** `npm test` at the root of the kit (the same as `node tests/run-all.mjs`). Each suite runs in its own Node process, then a summary table shows what passed, failed and was skipped.

```bash
npm test                              # all the suites
node tests/run-all.mjs protocol local # only the suites whose name contains one of these words
node tests/run-all.mjs --strict       # a browser suite that finds no Playwright counts as a failure (for CI)
```

Without `--strict`, a browser suite that can't find Playwright is reported as "skipped", not failed.

| command | what it checks | you need |
|---|---|---|
| `node tests/test-text.mjs` | sentence splitting, cleanup for the voice, the `[[choices: …]]` tags, the same prompt on the browser side and the server side, and the Gemini tools as text or as an array, and the mic's gain and gate (block by block) | Node |
| `node tests/test-protocol.mjs` | the local server protocol (simulated engine): turns, audio, typed text, interruption, voice change, Smart Turn (with a fake verdict), the voice dipping for a backchannel, stop phrases, spoken fillers | Node 22+ |
| `node tests/test-protocol.mjs fake-qvac` | the same, with the QVAC adapter connected to a fake SDK that checks the options passed to QVAC, including the Chatterbox voice and a voice cloned in an agent, and an agent still set to Parler (removed) speaking with Supertonic | Node 22+ |
| `node tests/test-models.mjs` | the models on this computer (QVAC adapter, fake SDK): a download is found by name and size and loaded from its file; "Download all models" downloads only the missing ones and gives up on a peer-to-peer download that receives nothing; a failed warm-up is not final; the models offered in the window (`choices`), and that nothing else loads; an LLM farm frees the local model; on Windows, QVAC's worker starts without a console window; the voices from the mirror over HTTPS (size and SHA-256 checked; a wrong or silent mirror falls back to peer to peer), and a file put in the models folder by hand; Chatterbox on the CPU on Windows | Node 22+ |
| `node tests/test-agents.mjs` | the agents on disk (`app/src/agent/`): `persona.md` (front matter + markdown), CSV tables (separators, quotes, Excel's UTF-8 mark), `interactions.json` (normalized), the store (examples on first launch, old personas imported, trash, copy, export/import, hand edits seen, names that cannot leave the folder), and the studio's API through the server (a request named for another site refused, `/health` without the agents folder for websites, a quick stop with sockets open); files written by people and other programs (semicolons in a title, 200 000 rows, a BOM, `menu.CSV`, stages named as written) | Node 22+ |
| `node tests/test-folder.mjs` | the VIK folder (`app/electron/folder.cjs`): the usual places and a chosen folder (agents, people, models), the choice kept in `folder.json`, a move (what it copies, what it refuses, its progress, nothing copied twice), the old copies removed at the next launch (only those found at the new place) | Node 22+ |
| `node tests/test-session.mjs` | a conversation when things go wrong (`app/src/session.mjs`, the simulated engine): text typed too early, a model chosen during the first loading, a reload or a language that cannot load (the agent keeps hearing), a reply that fails (the turn ends, the next works), a closed conversation, OSC in from anything on the network; the voice kept at a steady level (a quiet sentence raised, a loud one lowered, silence untouched, no clipping) | Node 22+ |
| `node tests/test-decide.mjs` | the decision model (`app/src/agent/`): knowledge (links, other names, placeholders), the words matcher, the decider on the example agents (patterns, stages, `otherwise`, free answers, the entry in focus, confidence, ambiguity, signals, an agent that talks about anything or keeps to its subject, and its fixed line in a conversation, a name inside another: Paris Nord), the model matcher (prompts, batches, cache, two big calls at once), and conversations that follow the decisions (lines filled from rows, signals out and in, `answer` with the entry and its links sent to a fake farm, `start` patterns), and OSC out (the action, its value typed by its look, the destinations of this computer, the bytes, a conversation that sends it to two listeners), the conversation's language (a pattern, a client, translated lines), OSC in (the bytes and bundles, thresholds with their margin, the live data the model reads, a conversation with a fake Arduino that waits for a pause), and people recognized by their voice (a fake speaker model, the voice a pitch: recorded through the API, who is speaking, a family car whose route is kept for the parents, by typing and by voice, a voice too short to tell) | Node 22+ |
| `node tests/test-speakers.mjs` | recognizing people (`app/src/speakers/`): the filter banks against Kaldi's (fixtures from `tests/tools/make_speaker_fixtures.py`, kaldi-native-fbank), the voice without its silences, `people.json` (add, the same name again, delete, another model), the line that goes up with the length of the voice, and the real model on three LibriSpeech clips (`tests/fixtures/voices/`) when onnxruntime-node is installed | Node 22+ |
| `node tests/test-guide.mjs` | the studio's built-in guide: its markdown reader (`app/public/js/markdown.js`: headings, lists, tips, code, tables with `\|` in cells, italics that leave `snake_case` alone, HTML kept as text), its pages (each listed in `pages.json`, one title, no link that leads nowhere: pages, sections, views, the tutorial, websites), the views' help links, and the tutorial's steps pointing at elements that exist | Node |
| `node tests/test-farm.mjs` | language models elsewhere against a fake farm (`mock-farm.mjs`): LLM farms found by their UDP beacon or by their address; replies streamed from a farm or a service; refusals said in words (password or key, full, model gone, off, too many requests); a service's model list; cancelling; `/models`, `/farms`, `/api/llm/models`; a conversation whose replies come from the farm | Node 22+ |
| `node tests/test-electron-main.mjs` | the Electron app with a fake Electron: Windows installer (shortcuts), built-in server, window, mic and clipboard permissions, menus (Check for updates opens the studio's Updates window; from the source code, the version and nothing to check), personas and their knowledge files, a window that never leaves the studio (a link, a dropped file), closing the window (the edits saved first), quitting | Node 22+ |
| `node tests/test-updates.mjs` | new versions (`app/electron/updates.cjs`) with a fake GitHub and a fake updater: version numbers; which copy updates how (installed on Windows, the portable .zip, a Mac, the source code); the state the Updates window shows, and when it opens by itself: the Mac notice (once per version, the latest version, offline, a version found then offline, a time limit, `"updates": false`); the Windows updater (its address on update.electronjs.org, checks, downloading, a download that stalls, ready, Restart now, no more checks once installed, errors) | Node |
| `node tests/test-hub.mjs` | the hub (`app/src/hub.mjs`) through the real server: a fake studio publishes, two clients follow; snapshots, events, levels, commands, refused commands, who may connect | Node 22+ |
| `node tests/test-smart-turn.mjs` | the Smart Turn end-of-turn pipeline (`app/src/turn/`), see below | Node 22+ (optional: Python 3 with numpy and onnxruntime) |
| `node tests/test-zonos.mjs` | the Zonos voice (`app/src/engines/zonos.mjs`), with a fake Zonos server (`mock-zonos.mjs`) and a fake in-browser engine (`fixtures/zonos-engine/`): the design line and the doses it becomes; Zonos speaking (language, voice, design in each request; audio at 44.1 kHz), and the default voice taking over when Zonos is missing, refuses a request or disappears mid-reply; the engine in the studio's window (the default): its files and its model served by the app, downloaded once and usable offline, a window that answers over the bridge, loads, fails, closes and comes back; and, with Playwright, the studio hosting the engine, its voice picker and its design sliders | Node 22+ (optional: Playwright) |
| `node tests/test-voices.mjs` | the saved voices (`app/src/agent/voices.mjs`) and the pattern action "Change voice": what a saved voice holds, where an agent keeps them (duplicate, export, import); a conversation where patterns change the voice (at once within an engine, after a reload across engines), the change lasting, ending, and never leaking into a new conversation; and, with Playwright, saving, using and deleting a voice in the studio (the list of saved voices, the one in use marked, Persona → Voice, Listen in French), and the action in a pattern | Node 22+ (optional: Playwright) |
| `node tests/test-network.mjs` | VIK listening on the network (`"host"` in `config.json`): another computer is a client (the conversation's events, the pages, `/health`) and nothing more; the agents, the people, the updates, the conversation itself, the hub's brain and the Zonos bridge answer this computer only | Node 22+ |
| `node tests/test-gemini.mjs` | voice-core's Gemini Live engine (run by the studio) in Chromium, with a fake mic, against a fake Gemini Live server, including away and the reprompt | Node + Playwright |
| `node tests/test-local.mjs` | the studio in Chromium, with the simulated engine and a fake mic: a conversation (the voice dipping, fillers, away, the voice fields, a new conversation after an interruption); a client's Start refused, then allowed (Settings → Clients), and a second Start that changes nothing; the microphone's gain and gate (a gate above the voice, between the room and the voice, +12 dB); Settings (the models, an LLM farm added by its address, a service, an imported agent that cannot change them); an agent built entirely in the studio (named with Enter, persona, a table, Save and Ctrl+S, a pattern with a signal and an OSC message, a try, "Talks about anything" off and a sentence outside its subject, the Updates window (Settings → Version, the source code, a version ready and Restart now, a failed check), a conversation that follows it, its signal and its OSC message, an export, a table changed outside); Settings → People with the real speaker model (someone recorded, "Who is speaking?", a pattern kept for them, typed as them in Talk, deleted); the Guide (every page, its links to pages, views and websites, the views' help links) and the tutorial done as a newcomer would (by hand and with "Do it for me", left and picked up after a reload, down to a conversation with the café it built, the examples untouched); and its clients through the hub: the cables op (signals, stage, decisions), the HTML and p5.js examples (p5.js comes from its CDN) | Node + Playwright |

Playwright: `npm install` at the root of the kit (it is a development dependency there), then `npx playwright install chromium`.

## The counts

| suite | passed | skipped |
|---|---|---|
| test-text | 45 | 0 |
| test-protocol (simulated engine) | 48 | 0 |
| test-protocol fake-qvac | 43 | 0 |
| test-agents | 78 | 0 |
| test-decide | 106 | 0 |
| test-session | 15 | 0 |
| test-folder | 13 | 0 |
| test-guide | 26 | 0 |
| test-models | 49 | 0 |
| test-farm | 39 | 0 |
| test-electron-main | 38 | 0 |
| test-updates | 34 | 0 |
| test-smart-turn | 41 | 1 |
| test-speakers | 26 | 0 |
| test-zonos | 127 | 0 |
| test-voices | 48 | 0 |
| test-network | 9 | 0 |
| test-gemini | 89 | 0 |
| test-hub | 23 | 0 |
| test-local | 182 | 0 |
| **total** | **1079** | **1** |

test-smart-turn's count is with Python 3, numpy and onnxruntime installed (as on GitHub): without them, its Python reference checks are skipped, and it counts 26 (1064 in all). Its one skipped check is the real Smart Turn prediction through `onnxruntime-node`, when that package cannot be installed (`npm install` in `app` adds it).

**Checked with the real QVAC** (not in the automated suites, which use fakes): on Windows, with QVAC 0.21, the default models load from their files, and EmbeddingGemma 300M decides as intended on the example agents (34 sentences, English and French). Its score ranges (`models.decide.calibration`) were measured there; check them again after a QVAC upgrade.

## The Smart Turn suite

`test-smart-turn.mjs` checks the JavaScript port of Pipecat's Smart Turn pipeline in four ways:

1. **feature parity**: the audio features computed in JavaScript (`whisper-features.mjs`) match those of Pipecat's Python reference, on deterministic test signals. The reference values are in `fixtures/smart-turn-features.json`;
2. **model parity**: the real Smart Turn model, run from Python with onnxruntime, gives the same probability on the JavaScript features as on the reference ones. Measured here: a maximum difference of 0 (identical results) on 15 signals. This part is **skipped** when Python, numpy or onnxruntime is missing;
3. **the module** (`smart-turn.mjs`): the `SMART_TURN_FAKE` hook, and a clean "unavailable" when the model or the runtime is missing;
4. **speed**: the features of 8 s of audio take less than 200 ms (about 19 ms here).

The Python tools are in `tools/`: `make_smart_turn_fixtures.py` makes the reference values, `smart_turn_parity.py` runs the real model, and `_whisper_features.py` is a copy of Pipecat's reference (BSD-2).

## On GitHub

`.github/workflows/tests.yml` runs `node tests/run-all.mjs --strict` on every push to `main` and on every pull request, with Playwright's Chromium and Python's numpy and onnxruntime. So on GitHub, the browser suites and model parity always run. The `onnxruntime-node` check may still be skipped there, since the workflow only installs the root dependencies.

## The "fakes"

- `cables-shim.js` + `op-harness.html`: a fake cables, which runs `VoiceAgent.op.js` the way cables does (the code is the body of a class constructor, in strict mode);
- `core-harness.html` + `fixtures/core-ports.js`: the same fake cables running `common/voice-core.js` behind the ports of the former op (which ran Gemini itself), so `test-gemini.mjs` can drive the Gemini engine port by port;
- `mock-gemini.mjs`: a fake Gemini Live server (setup, audio, transcripts, tools, interruption, `goAway`). It is as strict as the real one: an unknown field closes the session, and any `clientContent` cuts off the current reply. It can also make a startup hang (key `silent-key`) and hand out ephemeral tokens (`POST /token`);
- `fake-qvac-sdk.mjs`: a fake `@qvac/sdk` (same functions and same data as version 0.21). Like QVAC, it accepts only one recognition stream at a time per model, released shortly after it closes. It checks the voice calls (Parler's too, which VIK no longer makes) against QVAC 0.21's docs and schemas;
- `fixtures/zonos-engine/engine.js`: a fake of Zonos's in-browser engine (the same two exports as the real `engine.js`, no WebGPU), loaded by the studio's page in the tests.
- `mock-zonos.mjs`: a fake Zonos server (ZONOS3-Mini's HTTP API: health, voices, design sliders, `/v2/generate`). As strict as the real one's schema: an unknown field is a 422, an unknown voice, language or control a 400.
- `electron-stub/`: a fake `electron` module.

**Test hooks** (environment variables, read by the VIK server or by the tests):

| variable | what it does |
|---|---|
| `SMART_TURN_FAKE` | replaces the Smart Turn model: `complete` (probability 0.95), `incomplete` (0.05), or a number between 0 and 1 |
| `MOCK_LLM_DELAY_MS` | simulated engine: an extra delay before the model's first word, to get a slow reply (and a filler) |
| `MOCK_SHORT_TEXT` | simulated engine: what a short sound over the agent is heard as (default "Mm-hmm."; "Stop." to try a stop phrase) |
| `PYTHON` | the Python interpreter for the model-parity check (default `python3`) |

These tests don't replace trials with real voices and real machines: see [`../docs/HUMAN_TESTS.md`](../docs/HUMAN_TESTS.md).
