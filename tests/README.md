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
| `node tests/test-text.mjs` | sentence splitting, cleanup for the voice, the `[[choices: …]]` tags, the same prompt on the browser side and the server side, and the Gemini tools as text or as an array | Node |
| `node tests/test-protocol.mjs` | the local server protocol (simulated engine): turns, audio, typed text, interruption, voice change, Smart Turn (with a fake verdict), the voice dipping for a backchannel, stop phrases, spoken fillers | Node 22+ |
| `node tests/test-protocol.mjs fake-qvac` | the same, with the QVAC adapter connected to a fake SDK that checks the options passed to QVAC, including the Parler and Chatterbox voices | Node 22+ |
| `node tests/test-models.mjs` | the models on this computer (QVAC adapter, fake SDK): a download is found by name and size and loaded from its file; "Download all models" downloads only the missing ones and gives up on a peer-to-peer download that receives nothing; a failed warm-up is not final; the models offered in the window (`choices`), and that nothing else loads; an LLM farm frees the local model; on Windows, QVAC's worker starts without a console window; the voices from the mirror over HTTPS (size and SHA-256 checked; a wrong or silent mirror falls back to peer to peer), and a file put in the models folder by hand | Node 22+ |
| `node tests/test-agents.mjs` | the agents on disk (`app/src/agent/`): `persona.md` (front matter + markdown), CSV tables (separators, quotes, Excel's UTF-8 mark), `interactions.json` (normalized), the store (examples on first launch, old personas imported, trash, copy, export/import, hand edits seen, names that cannot leave the folder), and the studio's API through the server | Node 22+ |
| `node tests/test-decide.mjs` | the decision model (`app/src/agent/`): knowledge (links, other names, placeholders), the words matcher, the decider on the example agents (patterns, stages, `otherwise`, free answers, the entry in focus, confidence, ambiguity, signals), the model matcher (prompts, batches, cache), and conversations that follow the decisions (lines filled from rows, signals out and in, `answer` with the entry and its links sent to a fake farm, `start` patterns) | Node 22+ |
| `node tests/test-guide.mjs` | the studio's built-in guide: its markdown reader (`app/public/js/markdown.js`: headings, lists, tips, code, tables with `\|` in cells, italics that leave `snake_case` alone, HTML kept as text), its pages (each listed in `pages.json`, one title, no link that leads nowhere: pages, sections, views, the tutorial, websites), the views' help links, and the tutorial's steps pointing at elements that exist | Node |
| `node tests/test-farm.mjs` | language models elsewhere against a fake farm (`mock-farm.mjs`): LLM farms found by their UDP beacon or by their address; replies streamed from a farm or a service; refusals said in words (password or key, full, model gone, off, too many requests); a service's model list; cancelling; `/models`, `/farms`, `/api/llm/models`; a conversation whose replies come from the farm | Node 22+ |
| `node tests/test-electron-main.mjs` | the Electron app with a fake Electron: Windows installer (shortcuts), built-in server, window, mic permission, menus, personas and their knowledge files, closing | Node 22+ |
| `node tests/test-hub.mjs` | the hub (`app/src/hub.mjs`) through the real server: a fake studio publishes, two clients follow; snapshots, events, levels, commands, refused commands, who may connect | Node 22+ |
| `node tests/test-smart-turn.mjs` | the Smart Turn end-of-turn pipeline (`app/src/turn/`), see below | Node 22+ (optional: Python 3 with numpy and onnxruntime) |
| `node tests/test-gemini.mjs` | voice-core's Gemini Live engine (run by the studio) in Chromium, with a fake mic, against a fake Gemini Live server, including away and the reprompt | Node + Playwright |
| `node tests/test-local.mjs` | the studio in Chromium, with the simulated engine and a fake mic: a conversation (the voice dipping, fillers, away, the voice fields); Settings (the models, an LLM farm added by its address, a service, an imported agent that cannot change them); an agent built entirely in the studio (persona, a table, a pattern, a try, a conversation that follows it, its signal, an export, a table changed outside); the Guide (every page, its links to pages, views and websites, the views' help links) and the tutorial done as a newcomer would (by hand and with "Do it for me", left and picked up after a reload, down to a conversation with the café it built, the examples untouched); and its clients through the hub: the cables op (signals, stage, decisions), the HTML and p5.js examples (p5.js comes from its CDN) | Node + Playwright |

Playwright: `npm install` at the root of the kit (it is a development dependency there), then `npx playwright install chromium`.

## The counts

| suite | passed | skipped |
|---|---|---|
| test-text | 36 | 0 |
| test-protocol (simulated engine) | 49 | 0 |
| test-protocol fake-qvac | 46 | 0 |
| test-agents | 51 | 0 |
| test-decide | 50 | 0 |
| test-guide | 26 | 0 |
| test-models | 45 | 0 |
| test-farm | 37 | 0 |
| test-electron-main | 28 | 0 |
| test-smart-turn | 41 | 1 |
| test-gemini | 89 | 0 |
| test-hub | 22 | 0 |
| test-local | 128 | 0 |
| **total** | **648** | **1** |

test-smart-turn's count is with Python 3, numpy and onnxruntime installed (as on GitHub): without them, its Python reference checks are skipped, and it counts 26 (633 in all). Its one skipped check is the real Smart Turn prediction through `onnxruntime-node`, when that package cannot be installed (`npm install` in `app` adds it).

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
- `fake-qvac-sdk.mjs`: a fake `@qvac/sdk` (same functions and same data as version 0.21). Like QVAC, it accepts only one recognition stream at a time per model, released shortly after it closes. It checks the Parler and Chatterbox calls against QVAC 0.21's docs and schemas;
- `electron-stub/`: a fake `electron` module.

**Test hooks** (environment variables, read by the VIK server or by the tests):

| variable | what it does |
|---|---|
| `SMART_TURN_FAKE` | replaces the Smart Turn model: `complete` (probability 0.95), `incomplete` (0.05), or a number between 0 and 1 |
| `MOCK_LLM_DELAY_MS` | simulated engine: an extra delay before the model's first word, to get a slow reply (and a filler) |
| `MOCK_SHORT_TEXT` | simulated engine: what a short sound over the agent is heard as (default "Mm-hmm."; "Stop." to try a stop phrase) |
| `PYTHON` | the Python interpreter for the model-parity check (default `python3`) |

These tests don't replace trials with real voices and real machines: see [`../docs/HUMAN_TESTS.md`](../docs/HUMAN_TESTS.md).
