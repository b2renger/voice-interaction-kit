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
| `node tests/test-electron-main.mjs` | the Electron app with a fake Electron: Windows installer (shortcuts), built-in server, window, mic permission, menus, personas and their knowledge files, closing | Node 22+ |
| `node tests/test-hub.mjs` | the hub (`2_qvac_local/src/hub.mjs`) through the real server: a fake lab window publishes, two clients follow; snapshots, events, levels, commands, refused commands, who may connect | Node 22+ |
| `node tests/test-smart-turn.mjs` | the Smart Turn end-of-turn pipeline (`2_qvac_local/src/turn/`), see below | Node 22+ (optional: Python 3 with numpy and onnxruntime) |
| `node tests/test-gemini.mjs` | voice-core's Gemini Live engine (run by the lab window) in Chromium, with a fake mic, against a fake Gemini Live server, including away and the reprompt | Node + Playwright |
| `node tests/test-local.mjs` | the lab window in Chromium, with the simulated engine and a fake mic, including the voice dipping, fillers, away and the voice engine fields; and its clients through the hub: the cables op, the HTML and p5.js examples (p5.js comes from its CDN) | Node + Playwright |

Playwright: `npm install` at the root of the kit (it is a development dependency there), then `npx playwright install chromium`.

## The counts

| suite | passed | skipped |
|---|---|---|
| test-text | 36 | 0 |
| test-protocol (simulated engine) | 49 | 0 |
| test-protocol fake-qvac | 46 | 0 |
| test-electron-main | 25 | 0 |
| test-smart-turn | 41 | 1 |
| test-gemini | 89 | 0 |
| test-hub | 18 | 0 |
| test-local | 74 | 0 |
| **total** | **378** | **1** |

The skipped check is the real Smart Turn prediction through `onnxruntime-node`, which could not be installed where the kit was built. It runs when `onnxruntime-node` is installed (`npm install` in `2_qvac_local`).

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

**Test hooks** (environment variables, read by the Voice Lab server or by the tests):

| variable | what it does |
|---|---|
| `SMART_TURN_FAKE` | replaces the Smart Turn model: `complete` (probability 0.95), `incomplete` (0.05), or a number between 0 and 1 |
| `MOCK_LLM_DELAY_MS` | simulated engine: an extra delay before the model's first word, to get a slow reply (and a filler) |
| `MOCK_SHORT_TEXT` | simulated engine: what a short sound over the agent is heard as (default "Mm-hmm."; "Stop." to try a stop phrase) |
| `PYTHON` | the Python interpreter for the model-parity check (default `python3`) |

These tests don't replace trials with real voices and real machines: see [`../docs/HUMAN_TESTS.md`](../docs/HUMAN_TESTS.md).
