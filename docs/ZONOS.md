# The Zonos voice: a voice designed with sliders

VIK can speak with [ZONOS3-Mini](https://huggingface.co/Zyphra/ZONOS3-Mini), Zyphra's open text-to-speech model (weights Apache-2.0, runtime MIT). In **Voice & timing**, choose the voice engine **Zonos**: you pick one of its ready-made voices, then design it with sliders (age, gender, pitch, texture, delivery, mood). No recording of anyone is needed, and it speaks French.

Zonos is an extra voice. It does not replace anything: hearing, deciding and the language model stay as they are, and the other voices (Supertonic, Parler, Chatterbox) are untouched.

## How it runs: in VIK's own window, on the graphics card

Zonos does not run through QVAC. VIK uses Zyphra's **in-browser engine**, the one behind [their playground](https://zyphra.com/zonos3-mini/localplayground): it runs inside the VIK window, on the computer's graphics card, through WebGPU. There is no server to install and nothing to build on Windows.

```
a sentence to say ──▶ VIK's server ──▶ the VIK window (Zonos engine, WebGPU) ──▶ audio ──▶ VIK's server ──▶ the conversation
```

- **The first time**, choosing Zonos downloads its model: about 1 GB, from Hugging Face. It is kept on the computer, next to the other models (`~/.qvac/models/zonos3-web`). After that the voice works offline.
- **It needs WebGPU**, so a graphics card or a recent integrated one. If your computer runs Zyphra's playground smoothly, it runs Zonos in VIK. Without WebGPU, Voice & timing says "cannot run here", and the default voice speaks.
- **The VIK window does the speaking.** If you close or reload it during a conversation driven from elsewhere, the default voice takes over until the window is back.

### Getting the engine

The installers (the Releases page) carry the engine. From a checkout of the repository, build it once:

```bash
cd app
npm run zonos:engine
```

This needs `git` and Node 22. It fetches Zyphra's sources at a pinned version and runs their own build, into `app/zonos-engine/` (not committed). Without it, Voice & timing says "not installed" and the default voice speaks.

## In VIK

1. Open **Voice & timing** and choose the voice engine **Zonos**. Next to "Voice" you see **loading 40 %**, then **ready**.
2. Choose a voice. "Gaspard" is the one French voice among the defaults; the `gender`, `age` and `pitch` sliders are how you get other French voices from it. Whether the other default voices sound right in French remains to be heard.
3. Move the sliders, click **Start**, and talk. The design applies from the next sentence, without reloading anything.

If you click Start while the voice is still loading, VIK waits for it and shows the progress, as for any model.

The design is one line of text, written by the sliders in **The voice, designed**, for example:

```
age +1.5, deep 3, gender -1
```

It is saved in the agent's `persona.md` (`voiceDesign`, next to `zonosVoice` and `localVoiceEngine`), so a designed voice travels with the agent. The names are the engine's sliders. With Zonos's default steering file:

| group | sliders |
|---|---|
| Who | `gender` (masculine ↔ feminine), `age` (younger ↔ older), `pitch` (lower ↔ higher), `range` (monotone ↔ varied) |
| Texture | `deep`, `bright`, `husky`, `raspy`, `soft`, `authority` |
| Room | `room` (phone ↔ studio) |
| Delivery | `projection` (whisper ↔ loud), `pace` (slower ↔ faster), `chatty` (read ↔ chatty), `hesitant`, `lively`, `emphasis` |
| Mood | `valence` (negative ↔ positive), `arousal` (calm ↔ excited), `angry`, `happy`, `sad`, `calm`, `scared`, `confused` |

Each slider has a range, and a narrower "safe" part of it: past that, the voice can change identity or break. Zonos's own notes say, for example, that `age` at ±2 moves the apparent age by 10 to 30 years, and that `gender` at ±2 flips the gender of the default voices. A name the engine does not know is left out.

## When Zonos cannot speak

Nothing breaks. Voice & timing says why (**not installed**, **loading**, **cannot run here**), and:

- the conversation starts all the same, the status line says "Zonos voice unavailable (…): the default voice speaks instead.", and the default voice (Supertonic) speaks;
- if the engine stops in the middle of a conversation, the sentence it could not say is said by the default voice, and so are the next ones, until it is back;
- **Check again** loads the engine again.

## Settings (`config.json`)

```json
"models": { "tts": { "zonos": { "mode": "web", "voice": "" } } }
```

- `mode`: `web` (the default: the engine in VIK's window) or `server` (see below).
- `voice`: the voice used when the agent names none (a name such as "Gaspard", or an id). Empty: the first default voice.
- `options` (optional): extra fields added to every request, for example `{ "seed": 42 }` for a voice that sounds the same from one sentence to the next, or `{ "temperature": 0.6 }`. See `servers/api/openapi.yaml` in Zonos's repository.
- `models`: where the model is downloaded from (default: the `web/` folder of `Zyphra/ZONOS3-Mini` on Hugging Face). A school can mirror that folder on its own network and put its address here. Empty: never download.
- `modelsDir`: where the model is kept (default `~/.qvac/models/zonos3-web`). To prepare computers without internet, copy this folder from one that has it.
- `engineDir`: where the engine is (default `zonos-engine`, in the app folder).

### With a Zonos server instead (`"mode": "server"`)

VIK can also talk to a Zonos server running on the computer, for example Zyphra's MLX server on a Mac: `"zonos": { "mode": "server", "url": "http://127.0.0.1:1919", "token": "" }`. Everything else is the same. Installing such a server is described in [Zonos's repository](https://github.com/Zyphra/ZONOS3-Mini); on 13 November 2026 it published no ready-made binaries.

## Good to know

- **Not tried with the real engine inside VIK yet.** This voice was written from Zonos's published sources and API description, and tested with a stand-in for the engine (`tests/test-zonos.mjs`). The first real run is yours: please report what you see.
- **Numbers and dates.** The in-browser engine does not spell out numbers, dates or abbreviations (Zonos's servers do). VIK sends the sentence as written: "12 h 30" or "3 €" may be read oddly. Write such things in words in fixed lines, and ask the persona to do the same.
- **The sliders were tuned in English.** Zonos's notes say its steering directions may respond differently from one model version to another; listen before you trust a number.
- **Speed.** The setting `localSpeed` does not apply to Zonos: use the `pace` slider.
- **Memory.** Supertonic stays loaded next to Zonos, so that it can take over at once. On a small graphics card, Whisper, the language model and Zonos share its memory: if the voice stutters, choose a smaller language model.
- **"Download all models"** (the Files menu) does not include Zonos: its model downloads when you first choose the voice.
