# The VIK studio (Windows and Mac M1)

A **desktop app** to install on each student's computer. It is the **brain** of the kit: you build an agent in it, you talk to it, and you see why it answered. It listens, decides and speaks on the computer, with open models and no key. The replies that need writing can come from a model on the computer, from an LLM farm on the local network, or from an online service. **Gemini Live** is there too, as an all-online mode to compare with.

| role | model | size |
|---|---|---|
| hearing | Whisper small (by default), with the Silero speech detector | 264 MB + 1 MB |
| deciding | EmbeddingGemma 300M: compares what was said with the agent's patterns and knowledge | 330 MB |
| writing a reply | Qwen3 1.7B (by default, thinking turned off to reply quickly); or an LLM farm, or a service | 1.06 GB |
| speaking | Supertonic 3: 31 languages including English and French, voices F1–F5 and M1–M5 | 127 MB |
| knowing when you have finished (optional) | Smart Turn v3.2 | 8.7 MB, included in the app |

These models run on Tether's [QVAC](https://github.com/tetherto/qvac) SDK (llama.cpp, whisper.cpp, GGML). On first launch the app downloads them (about 1.8 GB) and shows the progress, then offers to download the two other voice engines, Parler and Chatterbox, once and for all (see "Downloading the models").

## The studio

One window, a few views. Everything is saved as you type, and **Start** / **Stop** stay at the top, so you can talk to the agent while you change it.

| view | what you do there |
|---|---|
| **Talk** | talk with the agent: its presence (rings that follow the voices, in the colour of the state), the words, the choice buttons, the measured waits, and **Why it answered**: for each turn, the pattern chosen, how sure it was, the entry found, what came close, the signals sent, the stage reached |
| **Persona** | its name, title, language, greeting, and the persona: a markdown text the language model reads before every reply. "What the model reads" shows the whole prompt |
| **Knowledge** | its tables, as a spreadsheet: one per kind of thing (artworks, dishes, departures). The first column is how people name an entry (other names after a `\|`); a cell that names an entry of another table links the two (shown in blue). Import a CSV from a spreadsheet, export one. "What it would look up" tries a sentence |
| **Interactions** | its **stages** and **patterns**, "When … → Then …". When the person says something like these examples, mentions an entry of this table, when the conversation starts, when a client sends a signal, or when nothing else fits; then say a line (filled from the entry: `{price}`), let the language model answer (with an instruction), show choices, set a mood, send a signal to the clients, go to another stage. **Try a sentence** shows what the agent would decide, and why. **Confidence** sets how close a sentence must be for a pattern to fire |
| **Voice & timing** | the voice, turn-taking, and what it does while it thinks |
| **Settings** | this computer's settings: the engine, the language model, speech recognition, the decision model's state, the clients' address. They never travel with an agent |
| **Guide** | the documentation, built in: eleven short pages for students, from getting started to troubleshooting, and the **tutorial**. Each view's intro links to its page |

The menu **Manage** (next to the agent's name) creates, duplicates, exports, imports and deletes agents, and brings back the examples.

**The tutorial** ("Build your first agent", about ten minutes) is offered on first launch, in the navigation, and in **Guide**. It walks through a café agent step by step: a ring shows where to act, a card says what to do, and each step moves on when the studio shows it done. **Do it for me** does a step in your place. It can be left and picked up later, and it only edits the agent it made.

**The Guide's pages** are markdown files in `public/guide/`, listed in `pages.json` (order, title, group): a teacher can reword a page or add one, then rebuild the installers. Links can open another page (`knowledge.md#links-between-tables`), a view (`view:interactions`), the tutorial (`tour:first-agent`) or a website; `node tests/test-guide.mjs` checks that none leads nowhere.

## Agents: the files you build

An agent is a folder, readable and editable by hand (the format is in [`../docs/DESIGN.md`](../docs/DESIGN.md)):

```
museum-guide/
  persona.md            the persona (markdown), with its settings at the top
  knowledge/
    artworks.csv        the tables, one CSV file each
    artists.csv
  interactions.json     the stages and the patterns
```

- **Where they live:** in the app's settings folder: `%APPDATA%\VIK\agents` on Windows, `~/Library/Application Support/VIK/agents` on a Mac (menu **Files → Open agents folder**). A file changed there by hand (a table edited in a spreadsheet) is seen at once.
- **The examples** (museum guide, station kiosk, chef, gardener) are copied there on first launch, so they can be changed. **Manage → Add the example agents** brings back the ones deleted.
- **Sharing:** **Manage → Export to a file** makes one `.vik.json` file (persona, knowledge, interactions); **Import a file…** opens it on another computer. The JSON files of the earlier "Voice Lab" app import too, and its personas become agents on first launch.
- **Deleting** moves the folder to `agents/.trash`, from where it can be put back by hand.
- **Safety:** an agent never carries this computer's settings: no engine, no language model, no address, no key. An agent from someone else cannot send the conversation elsewhere.

## The decision model

Before any language model writes a word, the agent decides: it compares what was said with the patterns of its current stage, and the closest one at or above the **confidence** fires. Otherwise the stage's "otherwise" pattern does, if there is one, or the language model answers freely, with the entries of the knowledge closest to the sentence and the entry in focus (the last one found: "who painted it?" is answered about the right artwork).

It runs on **EmbeddingGemma 300M** (Google, multilingual), through QVAC. It understands paraphrases ("I need a taxi" finds the taxis entry) and other languages: French sentences against English patterns and tables work. A decision takes about 20 ms. Until EmbeddingGemma is downloaded and loaded (and with the simulated engine), a **words** matcher decides instead: it only matches close wordings. **Settings → Hearing and deciding** says which one is at work, and each decision in **Why it answered** says it too.

Writing good patterns:

- **Examples are whole sentences**, as people say them: a single word ("paintings") matches too many things ("who painted it?").
- **Try your sentences** in **Interactions → Try a sentence**, and watch the runners-up: a pattern that comes close to another one needs clearer examples.
- **A vague question that fits every entry** ("who painted it?" fits every painting) is not taken as a mention: the language model answers it with the entry in focus.
- **A line said as written** (a `say`) is instant and exact: use it for facts (opening hours, prices, platforms). An `answer` is the language model's own words: use it for stories and explanations.
- **Other languages:** examples in English match French speech, but entry names need their other names in the first cell (`Water Lilies | Nymphéas`).

## For students: install

| | |
|---|---|
| **Windows** (x64) | run `VIK-Setup-<version>-windows-x64.exe`. If Windows shows "Windows protected your PC", click **More info → Run anyway** (the app is not signed). |
| **Mac Apple Silicon** (M1 or later) | open `VIK-<version>-mac-arm64.dmg` and drag the app into Applications, then launch it once. The app is not signed, so macOS blocks it: see below. Then allow the mic. |

The installers are on the **Releases** page of the kit's GitHub repository. If your teacher built them on their own machine, they are called `VIK-Setup.exe` and `VIK.dmg`.

**Unblocking the app on a Mac** (once per computer):

1. Launch "VIK". macOS says it cannot verify the app: click **Done** (or **OK**).
2. Open **System Settings → Privacy & Security**, scroll down to the line "VIK was blocked…" and click **Open Anyway**, then confirm with your login password.
3. Launch the app again: from now on it opens normally.

On macOS 15 (Sequoia) and later, "right-click → Open" is no longer enough: go through System Settings as above. If macOS instead says the app **is damaged** and offers to move it to the Trash (this happens with a file downloaded from GitHub), open Terminal and type:

```bash
xattr -cr "/Applications/VIK.app"
```

then launch it again. This command only removes the "downloaded from the Internet" mark.

You also need:

- **On Windows**: an up-to-date graphics driver. QVAC needs **Vulkan 1.4**, even without a dedicated graphics card; recent NVIDIA, AMD and Intel drivers have it.
- **On Mac**: 16 GB of memory is comfortable. With 8 GB, choose lighter models (see "Choosing the models").
- **About 2 GB of disk space** for the models, in `~/.qvac/models` (menu **Files → Open models folder**). Add about 1.2 GB for Parler and 1.1 GB for Chatterbox.

On first launch, the banner follows the model download. When it says "The models are ready", click **Start** and talk.

The menu **Engine → Simulated** restarts the app **without models**: the agent hears a "voice-like noise", replies with a short pre-written script (choices, mood, a long reply you can cut off) and speaks with a hum. The patterns still decide, with the words matcher. Useful to design the interface right away, for a repeatable demo, or on a machine that is too weak.

## For the teacher: build the installers

**The simplest way: let GitHub build them.** Put the kit on GitHub, then push a version tag (`v3.0.0`). The **Release** workflow (`.github/workflows/release.yml`) builds the Windows installer on a Windows machine and the Mac installer on an Apple Silicon Mac, then publishes a GitHub Release with `VIK-Setup-<version>-windows-x64.exe`, `VIK-<version>-mac-arm64.dmg` and a `.zip` of each. Step by step: [`../PUBLISHING.md`](../PUBLISHING.md). To build without publishing: **Actions → Release → Run workflow**, then download them from the run page, under "Artifacts".

**On your own machine.** Each platform is built **on that platform**: QVAC's native libraries are installed for the machine doing the build.

```bash
cd app
npm install
npm start            # try the app as is (the models download)
npm run make         # → out/make/: VIK-Setup.exe (Windows) or VIK.dmg (Mac), plus a .zip
```

You need **Node.js 22.17 or later** on the build machine, not on the students' machines. Packaging goes through QVAC's Electron Forge plugin (`@qvac/sdk/electron-forge`); `qvac.config.json` limits the app to the four building blocks it uses (Whisper, llama.cpp completion, llama.cpp embeddings, TTS). The icons (`build/icon.ico`, `build/icon.icns`) are made from `public/logo.svg` by `node scripts/make-icons.mjs`.

**QVAC is pinned to exactly version 0.21.0** (in `package.json`): QVAC shipped four releases with breaking changes between August and October 2026. Upgrade between terms only: change the version, run `npm run selftest` on a Windows PC and on a Mac, check the decision model (its score ranges are measured for 0.21, see `models.decide.calibration`), then publish a new release.

**`@qvac/inference` is pinned too** (`overrides` in `package.json`, to the version released with the SDK). The SDK 0.21.0 accepts any `@qvac/inference` 0.21.x, but 0.21.1 asks for newer llama.cpp addons as *peer* dependencies: npm then puts two copies apart, Electron's packager drops the one `@qvac/inference` uses, and in the installed app the QVAC worker cannot start, so no model loads or downloads (while `npm start` works). When you upgrade the SDK, set this pin to the `@qvac/inference` version its release names. `node scripts/check-package.mjs`, after `npm run package` or `make`, checks that the packaged app can reach every QVAC addon and has the Guide's pages; the Release workflow runs it before publishing.

**Other commands:**

```bash
npm run start:mock   # the app with the simulated engine
npm run selftest     # checks QVAC without a window: loads the models, makes the voice speak, listens back to it,
                     # asks Smart Turn whether the sentence is finished, asks for a reply (selftest-*.wav)
npm run server       # the server alone, without a window (the studio in a browser: http://localhost:8790)
npm run server:mock
```

`npm run server` uses the same agents folder as the app; `--agents <folder>` (or the `VIK_AGENTS` environment variable) points it elsewhere.

## Choosing the models

**Settings → Language model** and **Settings → Hearing and deciding** show what writes and what listens, and offer other models. Each choice gives its size and says whether it is already downloaded; one that isn't downloads the first time you choose it (with a progress bar), then stays on the computer. A change applies at once, even during a conversation. These are **this computer's** choices: an agent does not carry them.

| Speech recognition (listens) | size | |
|---|---|---|
| Whisper tiny | 44 MB | the fastest, more mistakes |
| Whisper base | 82 MB | fast, a few mistakes |
| **Whisper small** (default) | 264 MB | accurate |
| Whisper large v3 turbo | 1.6 GB | the most accurate, slow without a graphics card |

| Language model (writes the replies) | size | |
|---|---|---|
| Qwen3 0.6B | 382 MB | the fastest, simple replies |
| Llama 3.2 1B | 773 MB | fast, best in English |
| **Qwen3 1.7B** (default) | 1.06 GB | balanced |
| Qwen3 4B | 2.5 GB | smarter, slower: a graphics card helps |
| Qwen3 8B | 5.0 GB | the smartest here, needs a strong graphics card |

A bigger model writes better replies, but you wait longer: compare the **felt wait** of each turn. With the patterns, many turns need no language model at all (a line said as written). All these models download from Hugging Face, so they work on networks that block QVAC's peer-to-peer downloads.

These lists are the `choices` in `config.json` (`models.asr.choices` and `models.llm.choices`). A teacher can add or remove models there: any name from the QVAC catalogue (or a file path or a URL), with a label. `src` stays the default. The app only loads the models in these lists.

## Language models elsewhere: an LLM farm, a service

**Settings → Language model** has three choices. Hearing, deciding and speaking always stay on this computer; only the text of the replies to write goes elsewhere.

**An LLM farm** ([LlmOnLan](https://github.com/b2renger/LlmOnLan)) is a computer with a graphics card that serves a language model (by default Gemma 4 12B) to the whole room:

1. On the farm computer, start the LlmOnLan Farm app and turn on **Settings → Share compute** (a farm is private until then).
2. In VIK, **Settings → Language model → An LLM farm**. The farms the app hears are listed with their model and how many places are taken. Choose one.
3. If it has a password, type it in **Farm password**.

Not in the list? A farm announces itself by broadcast, and some networks don't carry it (another subnet, some school Wi-Fi): type the farm computer's address and click **Add**. The first time you look for a farm, Windows may ask whether VIK can use the network: allow it on private networks (adding by address works anyway).

**A service** is any OpenAI-compatible address: **Ollama** or **LM Studio** on this computer (no key), or **OpenAI**, **Gemini**, **Mistral**, **OpenRouter** online (a key from their website). Choose one in the list (it fills the address), type the key, then **List its models** and pick one.

Good to know:

- With a farm or a service, the local language model is unloaded, which frees its memory.
- **What goes there:** the persona, the knowledge entries found and the conversation, as text (never the sound). On a farm, over the local network; with an online service, to that company, under its terms.
- When it is off, full, or refuses the key, each reply fails with a message that says so: choose another model.
- The address, the model and the key are this computer's settings: never exported with an agent.

## Downloading the models

**Download everything once.** When the app is ready, it offers to download all the models it does not have yet, the three voices and the decision model included (about 4 GB, once): click **Download everything**. It is also in the menu **Files → Download all models**. Afterwards, nothing downloads again, and the app works without the internet.

Whisper, Silero, Qwen and EmbeddingGemma come straight from **Hugging Face** over HTTPS (`"download": "http"`, the default), which works on most networks. The voices (Supertonic, Parler, Chatterbox) only exist in QVAC's registry, which downloads **peer to peer** (Hyperswarm), and some school networks block this: a voice that receives nothing for 90 seconds is given up, and the app says which ones are missing. Do that download once on an open network (home Wi-Fi, a phone hotspot). While a model loads, the banner shows a progress bar; "waiting for data" that keeps counting means the network is blocking the download.

`"download"` in `config.json` can also be `"auto"` (QVAC's registry first, Hugging Face after it gives up) or `"p2p"` (the registry only). If the network blocks everything: do the first launch on another network, then copy the `~/.qvac/models` folder from one computer to another, or put the **path of a model file** in `config.json` instead of its name.

## Changing the app's settings

The menu **Files → Open settings folder** creates a personal `config.json`, which takes priority over the app's own: write in it only the keys you change (each section is merged with the app's), so that the app's next versions still apply their own settings.

```json
"models": {
  "asr": { "src": "WHISPER_SMALL_Q8_0", "vad": "VAD_SILERO_5_1_2", "useGpu": true, "choices": [ … ] },
  "llm": { "src": "QWEN3_1_7B_INST_Q4", "ctxSize": 4096, "maxTokens": 320, "thinking": false, "choices": [ … ] },
  "decide": { "src": "EMBEDDINGGEMMA_300M_Q8_0", "calibration": { "similar": [0.55, 0.95], "search": [0.35, 0.7] } },
  "tts": {
    "src": "TTS_MULTILINGUAL_SUPERTONIC3_Q8_0", "voice": "F1", "speed": 1, "mode": "sentence",
    "parler": { "src": "TTS_MINI_V1_EN_PARLER_TTS_Q8_0", "voice": "Laura" },
    "chatterbox": { "src": "TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0", "s3gen": "TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0", "referenceAudio": "" }
  }
},
"turn": { "smartTurn": { "model": "models/smart-turn-v3.2-cpu.onnx", "threshold": 0.5, "threads": 1 } }
```

`decide.calibration` is the decision model's measured range of cosines, for two sentences (`similar`) and for a sentence against an entry (`search`): change it only with another embedding model. A few optional keys: `parler.seed`, `parler.useGpu`, `chatterbox.useGpu`, and a `mock` section for the simulated engine (`llmDelayMs`: a slower reply, to try fillers; `shortText`: what a short sound is heard as).

| if… | try |
|---|---|
| the machine is modest (8 GB, no graphics card) | Whisper base and Qwen3 0.6B in Settings, or an LLM farm |
| you want better replies | Qwen3 4B, an LLM farm, or a service |
| you only speak French | `WHISPER_FRENCH_BASE_Q8_0` (Whisper fine-tuned for French; peer to peer only): add it to `models.asr.choices` |
| the voice needs to come out faster | `"steps": 3` (slightly lower quality) |
| you want the voice as a continuous stream | `"mode": "stream"` (by default, `"sentence"` says one sentence at a time) |
| Smart Turn ends turns too early, or too late | `"threshold"` in `turn.smartTurn`: higher = it needs to be surer that you have finished |

A change in `config.json` takes effect when you restart the app.

## What the settings do here

| setting | with the local engine |
|---|---|
| Confidence (Interactions) | the score (0–1) a pattern needs to fire. 50 % by default |
| Speech recognition, Language model (Settings) | reloaded when they change |
| End-of-turn silence | silence after which Whisper declares the end of the turn. With Smart Turn, it becomes the longest wait |
| End of turn | "silence only", or "silence and the Smart Turn model" (see below) |
| Start-of-speech sensitivity | Silero detector threshold (0.45 for "high", 0.6 for "low") |
| End-of-speech sensitivity | silence that splits a sentence (300 or 500 ms) |
| Can be interrupted | as soon as Silero hears someone over the agent's voice, generation and voice are cancelled (with "Talk over it this long" at 0) |
| Talk over it this long to interrupt | above 0, the agent's voice drops to 30 % within 80 ms, and the app waits up to 1.5 s for the transcript. A backchannel ("mm-hm", "yeah", "d'accord") or a noise: the voice comes back, and your words are not a turn. A stop phrase ("stop", "wait", "attends", "chut"): the agent stops and listens. Anything else, or talking longer than this: a real interruption |
| Away after, said once when the person stays silent | after this much silence while listening, the `user.away` event; the line is said as written, once |
| Extra delay before replying | wait added before deciding and replying |
| Filler lines, Say a filler after | if the reply's voice hasn't started this long after the end of your turn, one filler is said, then the reply follows |
| When nothing was understood | said when Whisper hears nothing useful, including its phantom phrases ("Thanks for watching!") |
| Can show choices and a mood by itself | the language model writes `[[choices: A \| B]]` and `[[mood: happy]]`: they become buttons and a mood, never read aloud. Patterns can also show choices and set a mood |
| Voice engine, voice, speed, language | the voice is reloaded (one or two seconds; the first use of Parler or Chatterbox downloads it) |
| The voice, described (Parler) | sent with each sentence: the next sentence already has the new voice |

## Smart Turn: knowing when you have finished

**What it is.** [Smart Turn v3.2](https://github.com/pipecat-ai/smart-turn) is a small open model from Pipecat (BSD-2, © Daily, about 8 million parameters). It listens to **how** your sentence ends (intonation, rhythm), not to the words, in 23 languages, French included. Silence alone cannot tell "I'd like to… um…" from "I'd like a coffee." Smart Turn can, most of the time.

**How the app uses it** (Voice & timing → End of turn = "Silence and the Smart Turn model"). After each piece of speech, if the agent isn't speaking, the model looks at your turn so far (up to the last 8.5 s): above 0.5, the sentence sounds finished and the turn ends now; otherwise the end-of-turn silence decides. So set the **silence to 2,000 ms** with Smart Turn: the agent replies quickly to a finished sentence and still waits during a hesitation. "Every event" in Talk shows each verdict, and cables gets it on `Turn probability (local)`.

**What it needs.** The model file is inside the app (`models/smart-turn-v3.2-cpu.onnx`, with its license). It runs on `onnxruntime-node`, an **optional** dependency that `npm install` adds. If it is missing, nothing breaks: the banner says once "Smart Turn is unavailable here: using silence only." Settings in `config.json`, under `turn.smartTurn`: `model`, `threshold` (0.5), `threads` (1).

## The three voice engines

Choose one in **Voice & timing → Voice engine** (it belongs to the agent). A change reloads the voice.

| engine | the voice | languages | download | good to know |
|---|---|---|---|---|
| **Supertonic** (default) | 10 preset voices (F1–F5, M1–M5), speed | 31, including English and French | 127 MB | fast. Its makers archived the project in September 2026: it keeps working, but there will be no new voices |
| **Parler** | **you describe the voice in words**: "A warm, low-pitched female voice, speaking slowly and clearly, very close to the microphone." Empty = a template voice | English only | about 1.16 GB, on first use | the description applies from the next sentence. In another language, the banner warns that replies will sound English-accented |
| **Chatterbox** | its default voice, speed, and **voice cloning** from a short recording | many, including English, French, Spanish, German, Italian (not Japanese or Chinese here) | about 345 MB + 788 MB, on first use | every output carries a watermark (Resemble AI's "Perth"), so it can be identified as synthetic |

**Voice cloning (Chatterbox).** Put the path of a WAV file in `config.json`, under `models.tts.chatterbox.referenceAudio`, then restart the app.

> **Consent first.** A voice is personal: it identifies someone, like a face. Only clone a voice with the clear, written consent of the person, for this exercise only, and delete the recording afterwards. Never clone a public figure, a classmate who isn't there, or a teacher as a joke. The watermark does not make a clone harmless: it only helps detect it.

## Using Gemini Live

**Settings → Engine → Gemini Live, online.** Gemini then hears, decides and speaks by itself, with the agent's persona and its knowledge in its prompt; the patterns don't apply. Give it access in one of two ways:

**A. An API key** (to test on your own): create one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and paste it in **Settings → Gemini Live → API key**. It stays on this computer and is never exported.

**B. A token server** (for a class, or a shared key): the key stays on one computer, and the studio gets a single-use token, valid for 30 minutes.

```bash
cd cables/token-server
cp .env.example .env        # then put your key in .env: GEMINI_API_KEY=...
node server.mjs             # Node 18 or later, nothing to install
```

In **Settings → Gemini Live**, the token server = `http://localhost:8787/token`. Then click **Start**: every client follows the conversation exactly as with the local engine.

> **Data:** on Gemini's free tier, Google may use the conversations to improve its models, and people may review them. For students' voices, use a paid project or set a clear rule about what is said. The mic only opens with **Start**, and closes with **Stop**.

## Clients: cables.gl, p5.js, your own pages

Any number of clients can follow the conversation and drive it, at the same time, through `ws://localhost:8790/events` (**Settings → Clients**, or the menu **Engine → Copy address for clients**). They get the states, the words, the levels, the choices and the mood, and what the agent decided: the pattern, the entry, the stage, and the **signals** its patterns send (`show-artwork: Water Lilies`). They send Start, Stop, Interrupt, a typed message, context, a choice, and **signals** of their own (a sensor, a button: the agent's patterns "when a client sends this signal" answer them). In **Talk**, **Send a signal…** does the same by hand.

- **cables.gl**: the `VoiceAgent` op, see [`../cables/README.md`](../cables/README.md). From cables.gl online, Chrome may ask for permission to access the "local network": accept it.
- **p5.js, or a plain web page**: start from [`../examples/`](../examples/). Open them through a local web server (VS Code's Live Server, `npx serve`) or the p5.js web editor: a page opened by double-click is refused.
- **Your own**: the messages are in [`../CONTRACT.md`](../CONTRACT.md), "The clients protocol". Allowed pages are listed in `allowedOrigins` (`config.json`); clients on other computers are not accepted.

**The app must stay open**: its window is the one that listens and speaks.

## Known limits

- **No echo cancellation.** With speakers, the agent may hear itself and cut itself off. Use headphones, or untick "Listens while speaking".
- **Small language models** make more mistakes and are weaker in languages other than English. The patterns help: a fact said as written is never wrong.
- **The words matcher** (simulated engine, or EmbeddingGemma not loaded) only matches close wordings.
- **The app is not signed.** Hence the Windows and macOS warnings the first time you open it.
- **What has been checked.** The studio, the decision model and the conversation are covered by automated tests against faithful fakes (QVAC, Electron, an LLM farm, Gemini Live). On a Windows computer with the real QVAC 0.21, the default models load and EmbeddingGemma decides as intended (34 sentences, English and French); the packaged Windows app (3.0.0) boots, loads them and decides. **Not yet** checked for real: the Mac installer, Parler and Chatterbox, the models other than the defaults (Llama 3.2 above all, since the app turns off a "thinking" it doesn't have), a real LlmOnLan farm and the online services, `onnxruntime-node` inside the packaged app. First step on a real machine: `npm install`, `npm run selftest`, then `npm start`.

## If something goes wrong

| symptom | what to check |
|---|---|
| Vulkan error (Windows) | update the graphics driver |
| loading stays stuck at 0% ("waiting for data") | the network blocks the download (often peer to peer, for the voices): see "Downloading the models" |
| no sound from the mic (Mac) | System Settings → Privacy & Security → Microphone → allow "VIK" |
| the first reply is slow | the models load at startup: wait for "The models are ready" |
| a pattern never fires | try the sentence in **Interactions → Try a sentence**: its score is below the confidence. Add examples closer to what people say, or lower the confidence. Check that the pattern is on and in the right stage |
| a pattern fires when it shouldn't | its examples are too short (one word): write whole sentences, or raise the confidence |
| "Decides with Words" while QVAC runs | EmbeddingGemma did not load: **Files → Download all models**, and look at **Files → Server log** |
| "No column fills {…}" under a line | the placeholder is not a column of the table the pattern mentions |
| `npm run make` fails on native libraries | build on the target platform, run `npm install` again, or let GitHub build the installers |
| the installed app never loads a model ("RPC initialization timed out", and `Cannot find module '@qvac/llm-llamacpp'` in the server log), while `npm start` works | the package lost QVAC's llama.cpp addons: check the `@qvac/inference` pin (see "For the teacher"), then `node scripts/check-package.mjs` after packaging |
| "Smart Turn is unavailable here: using silence only." | `onnxruntime-node` is missing: run `npm install` again, then `npm run selftest` |
| after choosing Parler or Chatterbox, nothing is said for a long time | the first use downloads the voice (over 1 GB): watch the banner |
| the agent stops for a "mm-hm" | "Talk over it this long to interrupt" is at 0: try 600 ms |
| Files → Server log | the server's latest messages, to understand an error |
