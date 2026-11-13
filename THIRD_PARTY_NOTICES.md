# Third-party notices

The kit's own code is under the MIT license (see `LICENSE`). It includes, or downloads at run time, components that keep their own licenses. Check the upstream pages for the current terms before redistributing.

## Included in this repository

| component | where | license | source |
|---|---|---|---|
| Smart Turn v3.2 model (CPU, int8) | `app/models/smart-turn-v3.2-cpu.onnx` | BSD-2-Clause, © Daily (see `app/models/SMART_TURN_LICENSE.txt`) | [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn), file from [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) |
| Whisper log-mel feature extraction, ported to JavaScript | `app/src/turn/whisper-features.mjs` | BSD-2-Clause, © Daily (port of Pipecat's `_whisper_features.py`) | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) |
| Pipecat's `_whisper_features.py` (test reference) | `tests/tools/_whisper_features.py` | BSD-2-Clause, © Daily | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) |
| Schibsted Grotesk (variable font, latin and latin-ext) | `app/public/fonts/` | SIL Open Font License 1.1, © The Schibsted Grotesk Project Authors (see `app/public/fonts/OFL.txt`) | [schibsted/schibsted-grotesk](https://github.com/schibsted/schibsted-grotesk), files from [Fontsource](https://fontsource.org) |

## Installed by npm (not in the repository)

| component | used by | license |
|---|---|---|
| `@qvac/sdk` (Tether QVAC) | VIK: speech recognition, language model, voice | Apache-2.0 |
| `onnxruntime-node` (optional) | VIK: Smart Turn | MIT |
| Electron, Electron Forge | VIK app and installers | MIT |
| Playwright (development only) | browser test suites | Apache-2.0 |

## Models downloaded by VIK on first use (not in the repository)

| model | role | license (upstream) |
|---|---|---|
| Whisper (whisper.cpp builds) | speech recognition | MIT |
| Silero VAD | voice activity detection | MIT |
| Qwen3 (0.6B to 8B; 1.7B instruct by default) | language model | Apache-2.0 |
| Llama 3.2 1B instruct (if chosen) | language model | Llama 3.2 Community License |
| EmbeddingGemma 300M | the decision model (embeddings) | Gemma Terms of Use (use restrictions apply) |
| Supertonic 3 | default voice engine | OpenRAIL-M (use restrictions apply; upstream archived in September 2026) |
| Parler-TTS Mini v1 | voice engine "Parler" | Apache-2.0 |
| Chatterbox multilingual | voice engine "Chatterbox" | MIT. Every output carries Resemble AI's Perth audio watermark. |
| ZONOS3-Mini (Zyphra) | voice engine "Zonos". Not shipped with the kit and not downloaded by it: VIK only talks to a Zonos server you install yourself ([docs/ZONOS.md](docs/ZONOS.md)) | weights Apache-2.0, runtime MIT |

## Online services

VIK can use **Google Gemini Live**, a paid/free-tier online service under Google's terms. On the free tier, Google may use the conversations to improve its models. A **language model service** chosen in Settings (OpenAI, Gemini, Mistral, OpenRouter…) receives the text of the replies it writes, under its own terms; an LLM farm (LlmOnLan) receives it on the local network. Otherwise VIK sends nothing online after the models are downloaded.
