# Third-party notices

The kit's own code is under the MIT license (see `LICENSE`). It includes, or downloads at run time, components that keep their own licenses. Check the upstream pages for the current terms before redistributing.

## Included in this repository

| component | where | license | source |
|---|---|---|---|
| Smart Turn v3.2 model (CPU, int8) | `2_qvac_local/models/smart-turn-v3.2-cpu.onnx` | BSD-2-Clause, © Daily (see `2_qvac_local/models/SMART_TURN_LICENSE.txt`) | [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn), file from [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) |
| Whisper log-mel feature extraction, ported to JavaScript | `2_qvac_local/src/turn/whisper-features.mjs` | BSD-2-Clause, © Daily (port of Pipecat's `_whisper_features.py`) | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) |
| Pipecat's `_whisper_features.py` (test reference) | `tests/tools/_whisper_features.py` | BSD-2-Clause, © Daily | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) |

## Installed by npm (not in the repository)

| component | used by | license |
|---|---|---|
| `@qvac/sdk` (Tether QVAC) | Voice Lab: speech recognition, language model, voice | Apache-2.0 |
| `onnxruntime-node` (optional) | Voice Lab: Smart Turn | MIT |
| Electron, Electron Forge | Voice Lab app and installers | MIT |
| Playwright (development only) | browser test suites | Apache-2.0 |

## Models downloaded by Voice Lab on first use (not in the repository)

| model | role | license (upstream) |
|---|---|---|
| Whisper (whisper.cpp builds) | speech recognition | MIT |
| Silero VAD | voice activity detection | MIT |
| Qwen3 (1.7B instruct, by default) | language model | Apache-2.0 |
| Supertonic 3 | default voice engine | OpenRAIL-M (use restrictions apply; upstream archived in September 2026) |
| Parler-TTS Mini v1 | voice engine "Parler" | Apache-2.0 |
| Chatterbox multilingual | voice engine "Chatterbox" | MIT. Every output carries Resemble AI's Perth audio watermark. |

## Online services

The cables.gl op can use **Google Gemini Live**, a paid/free-tier online service under Google's terms. On the free tier, Google may use the conversations to improve its models. Voice Lab sends nothing online after the models are downloaded.
