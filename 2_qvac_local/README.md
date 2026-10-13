# 2. "Voice Lab": the QVAC app (Windows and Mac M1)

A **desktop app** to install on each student's computer. It is the **brain** of the kit: it listens, thinks and speaks. By default the agent is **100% local and open**, with no cloud and no key, using three models, plus a small optional one for the end of turn. It can also use **Gemini Live** (online) instead: see "Using Gemini".

| role | default model | size |
|---|---|---|
| hearing | Whisper small, with the Silero speech detector | 265 MB + 1 MB |
| understanding and replying | Qwen3 1.7B (thinking turned off to reply quickly) | 1.06 GB |
| speaking | Supertonic 3: 31 languages including English and French, voices F1–F5 and M1–M5 | 127 MB |
| knowing when you have finished (optional) | Smart Turn v3.2 | 8.7 MB, included in the app |

These models run on Tether's [QVAC](https://github.com/tetherto/qvac) SDK (llama.cpp, whisper.cpp, GGML). On first launch, the app downloads them (about 1.5 GB) and shows the progress. Two other voice engines, Parler and Chatterbox, download only if you choose them (see "The three voice engines").

Once open, the app does two things:

- **the lab window** is for designing a voice agent: engine, persona, voice, turn-taking sliders, animated face, subtitles, choice buttons, wait measurements, settings export. It runs the conversation, with the mic and the speakers;
- **a hub** (`ws://localhost:8790/events`) lets **clients** follow that conversation and drive it: the cables op `VoiceAgent`, the p5.js and HTML examples, your own pages. The menu **Engine → Copy address for clients** copies this address. See "Clients".

The states, events and settings are the same with both engines (see [`../CONTRACT.md`](../CONTRACT.md)).

## For students: install

| | |
|---|---|
| **Windows** (x64) | run `VoiceLab-Setup-<version>-windows-x64.exe`. If Windows shows "Windows protected your PC", click **More info → Run anyway** (the app is not signed). |
| **Mac Apple Silicon** (M1 or later) | open `VoiceLab-<version>-mac-arm64.dmg` and drag the app into Applications, then launch it once. The app is not signed, so macOS blocks it: see below. Then allow the mic. |

The installers are on the **Releases** page of the kit's GitHub repository (for example `VoiceLab-Setup-1.0.0-windows-x64.exe`). If your teacher built them on their own machine, they are called `VoiceLab-Setup.exe` and `Voice Lab.dmg`.

**Unblocking the app on a Mac** (once per computer):

1. Launch "Voice Lab". macOS says it cannot verify the app: click **Done** (or **OK**).
2. Open **System Settings → Privacy & Security**, scroll down to the line "Voice Lab was blocked…" and click **Open Anyway**, then confirm with your login password.
3. Launch the app again: from now on it opens normally.

On macOS 15 (Sequoia) and later, "right-click → Open" is no longer enough: you have to go through System Settings as above. If macOS instead says the app **is damaged** and offers to move it to the Trash (this happens with a file downloaded from GitHub), open Terminal and type:

```bash
xattr -cr "/Applications/Voice Lab.app"
```

then launch it again. This command only removes the "downloaded from the Internet" mark.

You also need:

- **On Windows**: an up-to-date graphics driver. QVAC needs **Vulkan 1.4**, even without a dedicated graphics card; recent NVIDIA, AMD and Intel drivers have it.
- **On Mac**: 16 GB of memory is comfortable. With 8 GB, use lighter models (see "Changing models").
- **About 2 GB of disk space** for the models, in `~/.qvac/models` (the menu **Files → Open models folder** takes you there). Add about 1.2 GB if you try Parler, and 1.1 GB for Chatterbox.

On first launch, the progress bar follows the model download. When the window says "Models ready", click **Start** and talk.

The menu **Engine → Simulated** restarts the app **without models**. The agent hears a "voice-like noise", replies with a short pre-written script (choices, mood, a long reply you can cut off) and speaks with a hum. Each conversation replays the same script from the start. This is useful to design the interface right away, for a repeatable demo, or on a machine that is too weak.

## For the teacher: build the installers

**The simplest way: let GitHub build them.** Put the kit on GitHub, then push a version tag (`v1.0.0`). The **Release** workflow (`.github/workflows/release.yml`) builds the Windows installer on a Windows machine and the Mac installer on an Apple Silicon Mac, then publishes a GitHub Release with `VoiceLab-Setup-<version>-windows-x64.exe`, `VoiceLab-<version>-mac-arm64.dmg` and a `.zip` of each. Students download them from the **Releases** page. No Mac needed on your side. Step by step: [`../PUBLISHING.md`](../PUBLISHING.md). To build without publishing (to try the installers first): **Actions → Release → Run workflow**, then download them from the run page, under "Artifacts".

**On your own machine.** Each platform is built **on that platform**: QVAC's native libraries are installed for the machine doing the build. So the `.exe` is made on a Windows PC, and the `.dmg` on an Apple Silicon Mac.

```bash
cd 2_qvac_local
npm install
npm start            # try the app as is (the models download)
npm run make         # → out/make/: VoiceLab-Setup.exe (Windows) or Voice Lab.dmg (Mac), plus a .zip
```

You need **Node.js 22.17 or later** on the build machine, but not on the students' machines.

Packaging goes through QVAC's official Electron Forge plugin (`@qvac/sdk/electron-forge`). It bundles the QVAC "worker" and keeps only the libraries for the target platform. `qvac.config.json` limits the app to the three building blocks it uses (Whisper, llama.cpp, TTS), which reduces its size. The `models/` folder (the Smart Turn model) goes into the app as is.

**QVAC is pinned to exactly version 0.21.0** (in `package.json`). QVAC shipped four releases with breaking changes between late August and early October 2026, and this app was written against 0.21. Upgrade between terms only: change the version, run `npm run selftest` on a Windows PC and on a Mac, then publish a new release.

**Other commands:**

```bash
npm run start:mock   # the app with the simulated engine
npm run selftest     # checks QVAC without a window: loads the models, makes the voice speak,
                     # listens back to it, asks Smart Turn whether the sentence is finished,
                     # asks for a reply, and writes selftest-voice.wav / selftest-reply.wav
npm run server       # the server alone, without a window (lab page in the browser: http://localhost:8790)
npm run server:mock
```

## Downloading the models

Whisper, Silero and Qwen come straight from **Hugging Face** over HTTPS (`"download": "http"`, the default), which works on most networks. The voices (Supertonic, Parler, Chatterbox) only exist in QVAC's registry, which downloads **peer to peer** (Hyperswarm), and some school networks block this. Supertonic downloads on the first launch; Parler and Chatterbox the first time you choose them: do it once on an open network. The Smart Turn model needs no download: it is inside the app. While a model loads, the window shows a progress bar; "waiting for data" that keeps counting means the network is blocking the download.

`"download"` in `config.json` can also be `"auto"` (QVAC's registry first, Hugging Face only after the registry gives up, which can take minutes) or `"p2p"` (the registry only).

If the network blocks everything:

- do the first launch on another network, then copy the `~/.qvac/models` folder from one computer to another (USB stick);
- or put the **path of a model file** in `config.json` instead of its name.

## Changing models or settings

The menu **Files → Open settings folder** creates a personal `config.json`, which takes priority over the app's own. You can also drop **personas** in its `personas` folder (JSON files, same keys as the settings, plus `title`), and they show up in the window. To give a persona facts to draw on (a menu, opening hours, the artworks of a room), write them in a text file in the same folder and name it in the persona: `"knowledge": "museum.md"`. Its text is added to the persona under "What you know:". Keep it to a few pages: with the default `ctxSize` (4096), persona and knowledge together should stay under about 2,000 words, and the model reads all of it before every reply, so longer texts also make replies slower.

```json
"models": {
  "asr": { "src": "WHISPER_SMALL_Q8_0", "vad": "VAD_SILERO_5_1_2", "language": "en", "useGpu": true },
  "llm": { "src": "QWEN3_1_7B_INST_Q4", "ctxSize": 4096, "maxTokens": 320, "thinking": false },
  "tts": {
    "src": "TTS_MULTILINGUAL_SUPERTONIC3_Q8_0", "voice": "F1", "speed": 1, "mode": "sentence",
    "parler": { "src": "TTS_MINI_V1_EN_PARLER_TTS_Q8_0", "voice": "Laura" },
    "chatterbox": {
      "src": "TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0",
      "s3gen": "TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0",
      "referenceAudio": ""
    }
  }
},
"turn": {
  "smartTurn": { "model": "models/smart-turn-v3.2-cpu.onnx", "threshold": 0.5, "threads": 1 }
}
```

Your `config.json` only needs the keys you change: each section is merged with the app's defaults. A few optional keys: `parler.seed`, `parler.useGpu`, `chatterbox.useGpu`, and a `mock` section for the simulated engine (`llmDelayMs`: a slower reply, to try fillers; `shortText`: what a short sound is heard as). `models.tts.engine` is no longer read: the voice engine is now a setting (`Local voice engine`), chosen in the window or from cables.

| if… | try |
|---|---|
| the machine is modest (8 GB, no graphics card) | `WHISPER_BASE_Q8_0` and `QWEN3_600M_INST_Q4` |
| you want better replies (M1 16 GB, good NVIDIA card) | `QWEN3_4B_INST_Q4_K_M` |
| you only speak French | `WHISPER_FRENCH_BASE_Q8_0` (Whisper fine-tuned for French) |
| the voice needs to come out faster | `"steps": 3` (slightly lower quality) |
| you want to try the voice as a continuous stream | `"mode": "stream"` (by default, `"sentence"` says one sentence at a time) |
| Smart Turn ends turns too early, or too late | `"threshold"` in `turn.smartTurn`: higher = it needs to be surer that you have finished (default 0.5) |

The names come from the QVAC catalog; a file path or a URL also works. You need to restart the app for a change to take effect.

## What the settings do here

| setting | in the local engine |
|---|---|
| End silence | silence after which Whisper declares the end of the turn. With Smart Turn, it becomes the longest wait |
| End of turn | "silence only", or "silence + Smart Turn model" (see "Smart Turn" below) |
| Start sensitivity | Silero detector threshold (0.45 for "high", 0.6 for "low") |
| End sensitivity | silence that splits a sentence (300 or 500 ms) |
| Interruptible | as soon as Silero hears someone over the agent's voice, generation and voice are cancelled (with "Talk over it this long to interrupt (ms)" at 0) |
| Talk over it this long to interrupt (ms) (`interruptAfterMs`) | above 0, the agent's voice drops to 30 % within 80 ms, and the app waits up to 1.5 s for the transcript of what you said. A backchannel ("mm-hm", "yeah", "d'accord") or a noise: the voice comes back within 150 ms, and your words are not a turn. A stop phrase ("stop", "wait", "attends", "chut"): the agent stops and listens, with no reply. Anything else, or talking longer than this: a real interruption |
| Away after, Reprompt line | after this much silence while listening, the `user.away` event; the reprompt line is said as written, once, and goes into the history as the agent's message |
| Reply delay | wait added before asking the model |
| Filler lines, Say a filler after | if the reply's voice hasn't started this long after the end of your turn (reply delay included), one filler is said, picked at random (never the same twice in a row), then the reply follows. Fillers are prepared in the background for the current voice, so the very first one may be skipped |
| Repair line | said when Whisper hears nothing useful, including its phantom phrases such as "Thanks for watching!" (or, in French, "Sous-titres réalisés par…") |
| Choices and mood | the model writes `[[choices: A \| B]]` and `[[mood: happy]]`. These tags become buttons and a mood, and are never read aloud |
| Local voice engine, voice, speed, language | the voice is reloaded (one or two seconds; the first use of Parler or Chatterbox downloads it) |
| Voice description (Parler) | sent with each sentence: no reload, the next sentence already has the new voice |

## Smart Turn: knowing when you have finished

**What it is.** [Smart Turn v3.2](https://github.com/pipecat-ai/smart-turn) is a small open model from Pipecat (BSD-2, © Daily, about 8 million parameters). It listens to **how** your sentence ends (intonation, rhythm), not to the words. It covers 23 languages, French included. Silence alone cannot tell "I'd like to… um…" from "I'd like a coffee." Smart Turn can, most of the time.

**How the app uses it** (setting "End of turn" = "silence + Smart Turn model"; in cables, `End of turn (local)` = `silence + Smart Turn`). After each piece of speech (QVAC reports a short pause, usually 300–500 ms), if the agent isn't speaking, the model looks at your turn so far (up to the last 8.5 s):

- probability above 0.5: the sentence sounds finished, the turn ends now (the app still waits for the transcript);
- otherwise: the end silence decides, as before. It becomes the longest wait.

So set **End silence to 2,000 ms** with Smart Turn: the agent replies quickly to a finished sentence and still waits during a hesitation. In the automated tests (simulated engine, 3 s end silence), a turn judged "complete" ended 0.38 s after the speech, and one judged "not finished" 2.95 s after. The events log shows each verdict (`turn.prediction · p 0.95 · complete · 1 ms`), and cables gets it on `Turn probability (local)`.

**What it needs.** The model file is inside the app (`models/smart-turn-v3.2-cpu.onnx`, 8.7 MB, with its license). It runs on `onnxruntime-node`, an **optional** dependency that `npm install` adds. The app only loads it the first time a conversation uses Smart Turn. If it is missing, nothing breaks: the window says once "Smart Turn is unavailable here: using silence only." and turns end on silence. `npm run selftest` has a step "end of turn: Smart Turn": ⚠ means the runtime is missing (a warning: the self-test still passes).

Settings in `config.json`, under `turn.smartTurn`: `model` (the file), `threshold` (0.5), `threads` (1).

## The three voice engines

Choose one with **Local voice engine** in the window (or `Local voice engine` in cables). A change reloads the voice.

| engine | the voice | languages | download | good to know |
|---|---|---|---|---|
| **Supertonic** (default) | 10 preset voices (F1–F5, M1–M5), speed | 31, including English and French | 127 MB (with the other models) | fast. Its makers archived the project in September 2026: it keeps working, but there will be no new voices |
| **Parler** | **you describe the voice in words**: "A warm, low-pitched female voice, speaking slowly and clearly, very close to the microphone." Empty = a template voice (Laura) | English only | about 1.16 GB, on first use | the description applies from the next sentence, with no reload. No speed setting. In another language, the window warns: "Parler only speaks English: replies will sound English-accented." |
| **Chatterbox** | its default voice, speed, and **voice cloning** from a short recording | many, including English, French, Spanish, German, Italian (not Japanese or Chinese here; other languages fall back to English) | about 345 MB + 788 MB, on first use | every output carries a watermark (Resemble AI's "Perth"), so it can be identified as synthetic |

**Voice cloning (Chatterbox).** Put the path of a WAV file in `config.json`, under `models.tts.chatterbox.referenceAudio` (a path relative to the app folder, or an absolute path, which is simpler with the installed app). Restart the app. Chatterbox then speaks with a voice close to the recording.

> **Consent first.** A voice is personal: it identifies someone, like a face. Only clone a voice with the clear, written consent of the person, for this exercise only, and delete the recording afterwards. Never clone a public figure, a classmate who isn't there, or a teacher as a joke. The watermark does not make a clone harmless: it only helps detect it.

## Using Gemini

In the lab window, **Engine** = `Gemini Live (online)`. Then give it access, in one of two ways:

**A. An API key (simplest, to test on your own).** Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and paste it into the lab window's key field. It stays on this computer (in the window's storage) and is never exported with the settings.

**B. A token server (for a class, or a shared key).** The key stays on one computer, and the lab window gets a single-use token, valid for 30 minutes.

```bash
cd 1_cables_gemini_live/token-server
cp .env.example .env        # then put your key in .env: GEMINI_API_KEY=...
node server.mjs             # Node 18 or later, nothing to install
```

In the lab window, the token server field = `http://localhost:8787/token`.

Then click **Start**. Every client follows the Gemini conversation exactly as it follows a local one.

> **Data:** on Gemini's free tier, Google may use the conversations to improve its models, and people may review them. For students' voices, use a paid project or set a clear rule about what is said. The mic only opens with **Start**, and closes with **Stop**.

## Clients: cables.gl, p5.js, your own pages

The app is the brain; any number of clients can follow the conversation and drive it, at the same time, through `ws://localhost:8790/events` (menu **Engine → Copy address for clients**). They get the states, the texts, the levels, the choices and the mood, and they send Start, Stop, Interrupt, a typed message, context or a choice. The persona, its knowledge and the settings stay in the app.

- **cables.gl**: the `VoiceAgent` op, see [`../1_cables_gemini_live/README.md`](../1_cables_gemini_live/README.md). From cables.gl online, Chrome may ask for permission to access the "local network": accept it.
- **p5.js, or a plain web page**: start from [`../examples/`](../examples/). Open them through a local web server (VS Code's Live Server, `npx serve`) or the p5.js web editor: a page opened by double-click is refused, because the app can't tell where it comes from.
- **Your own**: the messages are in [`../CONTRACT.md`](../CONTRACT.md), "The clients protocol". Allowed pages are listed in `allowedOrigins` (`config.json`); clients on other computers are not accepted.

**The app must stay open**: its window is the one that listens and speaks. Closing the window quits the app; the clients then say they can't reach it, and reconnect on their own when it opens again.

## Known limits

- **No echo cancellation.** With speakers, the agent may hear itself and cut itself off. Use headphones, or untick "Listens while speaking".
- **Small models** make more mistakes, sometimes forget the choice tags, and are weaker than Gemini in languages other than English. This is also a design material.
- **The app is not signed.** Hence the Windows and macOS warnings the first time you open it.
- **What has been checked, and what hasn't.** The app was written from the QVAC 0.21 source code, then tested with a fake QVAC SDK and a fake Electron: protocol, model loading, interruptions, window, mic permissions, menus, Smart Turn, backchannels, fillers, away and the three voice engines. The Smart Turn pipeline gives exactly the same results as Pipecat's reference, with the real model run from Python. It has **not yet** run with the real models (including Parler and Chatterbox) or been packaged, because neither QVAC nor Electron could be installed where it was built. Not checked either: `onnxruntime-node` inside the app, Smart Turn's accuracy on real voices, what real Whisper writes for a short "mm-hm", and echo with speakers while the voice dips. First step on a real machine: `npm install`, `npm run selftest`, then `npm start`.

## If something goes wrong

| symptom | what to check |
|---|---|
| Vulkan error (Windows) | update the graphics driver |
| loading stays stuck at 0% ("waiting for data") | the network blocks the download (often peer to peer, for the voices): see "Downloading the models" |
| no sound from the mic (Mac) | System Settings → Privacy & Security → Microphone → allow "Voice Lab" |
| the first reply is slow | the models load at startup: wait for "Models ready" |
| `npm run make` fails on native libraries | build on the target platform (see above), and run `npm install` again, or let GitHub build the installers ([`../PUBLISHING.md`](../PUBLISHING.md)) |
| "Smart Turn is unavailable here: using silence only." | `onnxruntime-node` is missing or did not load: run `npm install` again, then `npm run selftest` (step "end of turn: Smart Turn"). Meanwhile, turns end on silence |
| "Parler only speaks English: replies will sound English-accented." | set Language to English, or use Supertonic or Chatterbox for other languages |
| after choosing Parler or Chatterbox, nothing is said for a long time | the first use downloads the voice (over 1 GB): watch the banner, and do it once on a good network |
| the agent stops for a "mm-hm" | "Talk over it this long to interrupt (ms)" is at 0 (it stops at once): try 600 ms |
| Files → Server log | the server's latest messages, to understand an error |
