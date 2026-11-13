# The Zonos voice: a voice designed with sliders

VIK can speak with [ZONOS3-Mini](https://huggingface.co/Zyphra/ZONOS3-Mini), Zyphra's open text-to-speech model (weights Apache-2.0, runtime MIT). In **Voice & timing**, choose the voice engine **Zonos**: you pick one of its ready-made voices, then design it with sliders (age, gender, pitch, texture, delivery, mood). No recording of anyone is needed, and it speaks French.

Zonos is an extra voice. It does not replace anything: hearing, deciding and the language model stay as they are, and the other voices (Supertonic, Parler, Chatterbox) are untouched.

## What you need: a Zonos server on this computer

Zonos does not run through QVAC, and VIK does not ship or download it. VIK talks to a **Zonos server** running on the same computer, at `http://127.0.0.1:1919` by default. Zyphra publishes that server in [github.com/Zyphra/ZONOS3-Mini](https://github.com/Zyphra/ZONOS3-Mini); follow its README, which is the reference. In short, as of 13 November 2026:

| computer | server | how |
|---|---|---|
| Mac with Apple Silicon | MLX server | `uv sync --locked --package zonos3-mlx`, download the `gguf/` files, then `servers/mlx/scripts/serve.sh` |
| Windows, Linux, any Mac | C++/ggml server (`zonos3-server`), on the processor, CUDA, Metal or Vulkan | build it from `servers/ggml` (CMake and a Rust toolchain), download the `gguf/` files, then `start-zonos3.sh` or `start-zonos3.bat` |
| Linux with an NVIDIA card | CUDA server | `servers/sgl/scripts/serve.sh` |

For designing voices you only need the small files: the backbone (`gguf/backbone-ptq.gguf`, 663 MB), the light decoder (`gguf/zac-keep2.gguf`, 452 MB), the steering file that holds the sliders (`gguf/steer.gguf`, 205 kB) and the default voices (`gguf/voices/`). The large encoder files are for cloning a voice from a recording, which VIK does not use.

The server is ready when `http://127.0.0.1:1919/v2/health` answers `{"status": "ok"}`. Its own page, `http://127.0.0.1:1919/`, is Zonos Voice Studio: a good place to check that it speaks before trying it in VIK.

**No prebuilt server yet.** On 13 November 2026 the Zonos repository published no ready-made binaries, and its notes give no step-by-step Windows build (they say Windows builds "depend on the installed toolchain"; a `start-zonos3.bat` launcher is there for when binaries exist). Until then, a Mac with Apple Silicon is the easy way to try this voice.

## In VIK

1. Start the Zonos server.
2. In VIK, open **Voice & timing** and choose the voice engine **Zonos**. Next to "Voice" it says **server found**.
3. Choose a voice. "Gaspard" is the one French voice among the defaults; the `gender`, `age` and `pitch` sliders are how you get other French voices from it. Whether the other default voices sound right in French remains to be heard.
4. Move the sliders, click **Start**, and talk. The design applies from the next sentence, without reloading anything.

The design is one line of text, written by the sliders in **The voice, designed**, for example:

```
age +1.5, deep 3, gender -1
```

It is saved in the agent's `persona.md` (`voiceDesign`, next to `zonosVoice` and `localVoiceEngine`), so a designed voice travels with the agent. The names are the server's sliders. With the server's default steering file:

| group | sliders |
|---|---|
| Who | `gender` (masculine ↔ feminine), `age` (younger ↔ older), `pitch` (lower ↔ higher), `range` (monotone ↔ varied) |
| Texture | `deep`, `bright`, `husky`, `raspy`, `soft`, `authority` |
| Room | `room` (phone ↔ studio) |
| Delivery | `projection` (whisper ↔ loud), `pace` (slower ↔ faster), `chatty` (read ↔ chatty), `hesitant`, `lively`, `emphasis` |
| Mood | `valence` (negative ↔ positive), `arousal` (calm ↔ excited), `angry`, `happy`, `sad`, `calm`, `scared`, `confused` |

Each slider has a range, and a narrower "safe" part of it: past that, the voice can change identity or break. Zonos's own notes say, for example, that `age` at ±2 moves the apparent age by 10 to 30 years, and that `gender` at ±2 flips the gender of the default voices. A name the server does not know is left out.

## When there is no server

Nothing breaks. With the voice engine Zonos chosen and no server answering:

- Voice & timing says **no server** and why; **Check again** looks for it again;
- the conversation starts all the same, the status line says "Zonos voice unavailable (…): the default voice speaks instead.", and the default voice (Supertonic) speaks;
- if the server stops in the middle of a conversation, the sentence it could not say is said by the default voice, and so are the next ones, until the server is found again (choose the voice again, or click Start).

## Settings (`config.json`)

```json
"models": { "tts": { "zonos": { "url": "http://127.0.0.1:1919", "voice": "", "token": "" } } }
```

- `url`: where the Zonos server listens.
- `voice`: the voice used when the agent names none (a name such as "Gaspard", or an id). Empty: the server's first default voice.
- `token`: the server's access token, if it was started with `ZONOS3_ACCESS_TOKEN`.
- `options` (optional): extra fields added to every request, for example `{ "seed": 42 }` for a voice that sounds the same from one sentence to the next, or `{ "temperature": 0.6 }`. See the server's `servers/api/openapi.yaml`.

## Good to know

- **Not tried with a real Zonos server yet.** This voice was written from Zonos's published API description and tested against a fake server that follows it (`tests/test-zonos.mjs`). How fast it is on a student laptop, and how the sliders sound in French, remain to be heard.
- **The sliders were tuned in English.** Zonos's notes say its steering directions were fitted on another checkpoint and may respond differently; listen before you trust a number.
- **Speed.** The setting `localSpeed` does not apply to Zonos: use the `pace` slider.
- **Text.** VIK sends one sentence at a time, with the agent's language. Zonos writes out numbers and dates itself in English, French, German, Spanish, Italian, Portuguese, Japanese, Chinese and Korean; in its other languages the text is read as written.
- **Memory.** Supertonic stays loaded next to Zonos, so that it can take over at once.
