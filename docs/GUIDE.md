# Guide: designing a voice agent with VIK, the Voice Interaction Kit

This guide is for the teacher who prepares the workshop, and for the students who take it. It explains what the kit contains, how to build an agent in the studio, and how each **edge case** of a voice conversation becomes a **design material**. It ends with exercises, the architecture, troubleshooting and the limits.

To check that the kit really does what is expected of it, see the [human test protocol](HUMAN_TESTS.md). How it is built: [`DESIGN.md`](DESIGN.md). What already exists in open source: [the open-source landscape](OPEN_SOURCE_LANDSCAPE.md).

---

## 1. What the kit contains

One studio, several clients.

- **The VIK studio** (Windows / Mac M1, installed on each computer) is the brain. You build an agent there (its persona, its knowledge, its interactions, its voice), you talk to it, and you see why it answered.
- **Its clients** follow the conversation and drive it: the cables.gl op `VoiceAgent`, and the p5.js and HTML/CSS/JS examples in [`../examples/`](../examples/), starting points for your own pages. Several clients can follow the same conversation at once (a cables scene and a p5.js screen, say). They also exchange **signals** with the agent: a sensor tells the agent someone came near; the agent tells the screen to show an artwork.

The studio has two engines:

| | **VIK (local)** | **Gemini Live** |
|---|---|---|
| who decides | **your patterns**, through a small local decision model; a language model writes the free answers | Gemini, by itself |
| where it runs | hearing, deciding, speaking on the computer; the language model on the computer, on an LLM farm, or at a service | online, at Google |
| what you need | nothing but the app. The models download once (~1.8 GB, ~2 GB on disk) | a Gemini key (or a token server) |
| voice | three voice engines: preset voices, a voice described in words, a cloned voice | very smooth, low latency |
| data | nothing leaves the computer (unless you choose a farm or a service for the replies) | the voices go through Google |

**The key point:** both engines produce **the same states, the same events and the same settings** (see [`../CONTRACT.md`](../CONTRACT.md)). A client built with one works with the other. Students can design an agent with patterns, then compare it with Gemini improvising from the same persona and knowledge.

### Which engine for a workshop?

- **Designing an agent that behaves as intended** (a kiosk, a guide, a recipe, a game): the local engine, with patterns. What it says for known questions is exact and instant; the language model only fills the rest.
- **Exploring interaction design** (shapes, animations, sounds, calls to action): either. Gemini has the most believable voice; the local engine sends signals and stages the interface can use.
- **No key, limited network, or sensitive data**: the local engine.
- **Designing the interface before you have the models, or on a weak machine**: the **simulated engine** (menu **Engine → Simulated**). The agent hears a "voice-like noise", replies with a short pre-written script and speaks with a hum; the patterns still decide (with the words matcher).
- **Getting students to think about latency and quality**: the measurements of each turn (felt wait, decision time) let you compare with numbers. The same agent with Qwen3 0.6B and Qwen3 4B, or with patterns and without, makes the trade-off audible.
- **A room with one powerful computer**: an **LLM farm** ([LlmOnLan](https://github.com/b2renger/LlmOnLan)) writes the replies for every laptop, with a model too big for them (see the [studio's README](../app/README.md), "Language models elsewhere").

---

## 2. Quick start

### 2.1 The VIK studio (teacher: once; students: 5 minutes)

**The teacher publishes the installers once.** The simplest way: put the kit on GitHub and push a version tag (`v3.0.0`). GitHub Actions then builds the Windows and Mac installers and publishes them as a **GitHub Release**, with no Mac needed on your side. Step by step: [`PUBLISHING.md`](../PUBLISHING.md). You can also build them on your own machine (`npm install` then `npm run make`). Details in [`app/README.md`](../app/README.md).

**Each student** downloads the installer from the repository's **Releases** page: `VIK-Setup-<version>-windows-x64.exe` (Windows) or `VIK-<version>-mac-arm64.dmg` (Mac M1 and later), then launches it. The app is not signed:

- **Windows:** "Windows protected your PC" → **More info → Run anyway**.
- **Mac:** on first launch, macOS blocks the app. Open **System Settings → Privacy & Security → Open Anyway**. If macOS says the app "is damaged": `xattr -cr "/Applications/VIK.app"` in Terminal.

On first launch, the models download: the banner shows a progress bar. When it says "The models are ready", pick an example agent at the top (the museum guide, say), click **Start**, and talk. Then open **Interactions**, type a sentence in "Try a sentence", and see what the agent would do.

**The tutorial** comes next: the studio offers it on first launch (and in **Guide**). In about ten minutes, each student builds a café agent that answers questions about its menu, step by step, then talks to it. It is a good first half hour of a workshop, before this guide's edge cases. The studio's **Guide** also holds a short version of section 3 and of the troubleshooting, offline, with links to each view.

**Gemini instead of the local engine:** **Settings → Engine → Gemini Live**, then a key, or the address of a token server (for a class: the key stays on the teacher's computer, and each studio gets a token valid for 30 minutes). See "Using Gemini Live" in [`app/README.md`](../app/README.md).

### 2.2 A client: the cables.gl op (5 minutes)

1. Keep the VIK studio open.
2. Open a patch that belongs to you on cables.gl.
3. Avatar, top right → **Code a new op** → name `VoiceAgent` → **Create Op**.
4. In the code editor that opens: delete everything, paste **all** of [`cables/VoiceAgent.op.js`](../cables/VoiceAgent.op.js), save (`Ctrl/Cmd + S`).
5. `App connected` goes to 1. Click `Start` on the op (or in the studio), talk.

The op follows the studio's conversation; the agent and the engine are chosen in the studio. See [`cables/README.md`](../cables/README.md).

**p5.js or a plain web page instead:** start from [`../examples/`](../examples/). Open them through a local web server (VS Code's Live Server, `npx serve`) or the p5.js web editor; a page opened by double-click is refused.

---

## 3. Building an agent

An agent is four things, each with its view in the studio. Everything is saved as you type, and **Start** stays at the top: talk to the agent while you build it.

### 3.1 The persona: who it is

**Persona** holds its name, its language, its greeting (said first; empty: it waits to be spoken to), and the persona itself: a text the language model reads before every reply. Write it like a character sheet, in markdown: who they are, where they are, what they care about, how they speak, what they do when they don't know. "What the model reads" shows the full prompt, with the rules the studio adds for speech.

### 3.2 The knowledge: what it knows

**Knowledge** holds tables, one per kind of thing: the artworks of a room, the dishes of a menu, the trains of the day, the plants of a shop. Each row is an **entry**; its **first cell is how people name it**. A table can come from a spreadsheet: **Import a CSV** (Excel, Numbers and Google Sheets all export CSV).

- **Other names:** separate them with `|` in the first cell: `Water Lilies | Nymphéas`. The entry is found by any of them. This matters when people speak another language than the table.
- **Links:** a cell that names an entry of another table links the two (shown in blue): the artwork's `artist` cell `Claude Monet` links to the row `Claude Monet` of the artists table. When the agent talks about an artwork, it knows its artist too.
- **What it would look up:** type a sentence: the entries the agent would give the language model.

The agent does not read its whole knowledge before every reply: for each sentence, it looks up the entries that matter (the one named, the one in focus, the closest ones). So a table can be long.

### 3.3 The interactions: how it decides

**Interactions** holds **patterns**: "When … → Then …". Before any language model writes a word, the **decision model** (EmbeddingGemma, a small model that turns sentences into numbers that can be compared) scores what was said against the patterns, and the closest one fires, if it is close enough.

**When**, one of:

- **the person says something like** a few example sentences ("when do you open", "what time do you close");
- **the person mentions an entry of** a table ("tell me about the Water Lilies", "the train to Lyon");
- **the conversation starts** (instead of the greeting);
- **a client sends the signal** `visitor-near` (a sensor in cables, a button on a page);
- **nothing else fits**, in this stage (a fallback).

**Then**, in order, any of:

- **Say** a line, as written. It can be filled from the entry found: `The train to {destination} leaves at {time} from platform {platform}.` Several lines separated by `|`: one at random.
- **Answer**: the language model writes the reply, with an instruction ("tell it as a story in two sentences, then ask what they notice") and the entry found.
- **Show choices**, **set the mood**, **send a signal** to the clients (`show-artwork` = `{name}`), **go to** another stage.

**Stages** make a small state machine: the agent is in one stage at a time, and a pattern can belong to one. The chef's "next" moves from step to step: the same word, another stage, another step.

**Try a sentence** shows what the agent would decide, in a given stage, with the score of each pattern. **Confidence** sets how close a sentence must be for a pattern to fire: lower, it fires more often (sometimes wrongly); higher, it leaves more to the language model. When nothing fires, the language model answers freely, with what the agent knows.

In **Talk**, **Why it answered** shows each decision as it happens: the pattern, its score, the entry, what came close, and how long it took.

**What makes good patterns:**

- examples are **whole sentences**, as people say them (a single word matches too many things);
- a **fact** (a price, a time, a place) is a **Say**: exact and instant. A **story** is an **Answer**;
- **try** the sentences people will really say, and watch the runners-up;
- a **fallback** ("nothing else fits") keeps a kiosk on topic.

### 3.4 The voice and the timing

**Voice & timing** holds how it sounds and when it takes its turn: the edge cases of section 5. They belong to the agent: a hurried kiosk and a patient guide differ in their silences as much as in their words.

### 3.5 Sharing an agent

**Manage → Export to a file** makes one `.vik.json` file: persona, knowledge, interactions (never the keys or this computer's settings). **Import a file…** opens it on another computer. An agent is also a folder of plain files (`persona.md`, `knowledge/*.csv`, `interactions.json`), in the studio's settings folder (**Files → Open agents folder**): they can be edited with any text editor or spreadsheet, and kept in git.

---

## 4. The vocabulary of voice interaction

A voice conversation is a series of **turns**. At every moment, the agent is in **one state**, and each move from one state to another is an **event** the interface can react to.

```
            ┌───────────── Start ──────────────┐
            ▼                                  │
 idle ──► connecting ──► listening ──► hearing ──► thinking ──► speaking ──┐
                            ▲                                              │
                            └──────────── end of reply / interruption ◄────┘
                         ended (Stop)      error (problem, readable message)
```

| state | what is happening | what the interface can show |
|---|---|---|
| `listening` | mic open, nobody is speaking | "I'm here": a calm presence, a breathing |
| `hearing` | the person is speaking | "I hear you": a ring that follows `Mic level`, live subtitles |
| `thinking` | the person has finished, the agent is preparing its reply | "I'm thinking": an animation, a sound, or nothing (that's a choice) |
| `speaking` | the agent is speaking | the mouth or glow that follows `Voice level`, the agent's subtitles |

In cables, each state has its **boolean output** (`Listening`, `Hearing`, `Thinking`, `Speaking`) and each moment its **trigger** (`On user start`, `On user end`, `On thinking`, `On filler`, `On reply start`, `On reply end`, `On interruption pending`, `On interruption cancelled`, `On interruption`, `On away`, `On not understood`, `On choices`, `On mood`, `On tool call`, `On error`…). The full list is in [`CONTRACT.md`](../CONTRACT.md), with a table that maps these names to other toolkits (LiveKit, Pipecat, ElevenLabs, Home Assistant).

Some moments are events, not states. When the person stays silent, the agent stays in `listening` and `On away` fires. When someone talks over the agent and its voice dips, it stays in `speaking` until the kit decides whether it was a real interruption.

---

## 5. The edge cases, one by one

This is the heart of the workshop. For each case: what happens, the settings that change it, the signals to design with, and some ideas.

> **With Gemini**, an open session does not pick up live changes to persona, voice, language, creativity, short answers, end silence, sensitivities or `Interruptible`: the studio asks you to click `Start`. Volume, delay, sounds and mic change live. **With the local engine**, everything applies live.
>
> A port marked **(local)** only works with the local engine: Gemini ignores it. The settings borrowed from open source (end of turn, interrupt after, away, fillers, voice engine) never need a restart.

### 5.1 Identity: voice and personality

| lever | setting | note |
|---|---|---|
| who it is, what it knows, how it behaves | **Persona**: name, the persona's text; **Knowledge**; **Interactions** | write the persona in the second person: "You are… You help… You never talk about…" |
| its tone | Creativity (0 calm → 2 unpredictable), Short answers | when spoken, short answers are almost always better |
| what it says first | Greeting, or a pattern "when the conversation starts" | empty = it waits to be spoken to (another design choice) |
| its voice | **Voice & timing**: voice engine Supertonic (voices F1–F5, M1–M5, speed), Parler (the voice described in words) or Chatterbox; with Gemini, 30 Gemini voices and a way of speaking | Gemini's way of speaking is an instruction given to the model ("slow and calm", "with a smile"). The model follows it more or less. |
| its displayed mood | "Can show choices and a mood by itself", or a pattern that sets the mood → `Mood` output | 7 moods: neutral, happy, curious, focused, sorry, surprised, excited |

The **example agents** (museum guide, station kiosk, chef, gardener) come with the studio. Pick one at the top; **Manage** duplicates, exports and imports agents (section 3.5).

**Designing a voice in words (Parler, local).** With the voice engine Parler, there are no preset voices: you write the voice, like a persona. For example: "A warm, low-pitched female voice, speaking slowly and clearly, very close to the microphone." Describe who speaks (gender, pitch, pace, how expressive) and how it is recorded (close to the mic or far, a small room or a hall). The new description applies from the next sentence, with no restart. Parler only speaks English, and its first use downloads about 1.16 GB.

**Cloning a voice (Chatterbox, local).** Chatterbox speaks many languages, French included, and it can imitate a voice from a short WAV recording (`referenceAudio` in `config.json`, see the [studio's README](../app/README.md)). This raises real questions, and they belong in the workshop. Whose voice is it? Did they agree, to what, and for how long? What if the clone says something they would never say? The rules for class: the clear, written consent of the person; for the exercise only; delete the recording afterwards; never someone who isn't there, and never a public figure. Every Chatterbox output carries a watermark (Resemble AI's "Perth"), so it can be identified as synthetic. That is a good starting point for a discussion: how should a synthetic voice announce itself?

**On the Gemini side**, the voices are predefined. A developer reported in September 2026 that voices made with Gemini's Voice Design cannot be used with Gemini Live (a single report, still to be confirmed: see [the open-source landscape](OPEN_SOURCE_LANDSCAPE.md)). If it holds, designed and cloned voices only exist in the local engine. That contrast is worth discussing, rather than treating it as a defect.

> **To try in the workshop:** the same persona with three different voices. What changes in how much you trust it? (And exercise 10: design a voice in words.)

### 5.2 End of turn: when have you finished speaking?

The agent has to guess when the person has finished. Too early, and it cuts off someone who is hesitating ("um…"). Too late, and it seems slow.

| setting | effect |
|---|---|
| **End-of-turn silence** | the silence that ends a turn. 300 ms: impatient agent. 2,000 ms: patient agent, but slow. |
| **Start-of-speech sensitivity** | high: hears even a whisper (and noise); low: only a clear voice |
| **End-of-speech sensitivity** | high: decides quickly; low: waits to be sure |
| **End of turn** | `silence only`, or `silence + Smart Turn`: a small model also listens to how your sentence ends. A finished sentence ends the turn at once; a pause in the middle waits up to **End-of-turn silence**. |

**Signals:** `Hearing` (1 while the person is speaking), `Mic level`, `On user end`, `User text` (as it comes), `Turn probability (local)`. A false alarm (a cough, a short noise) does not create a turn: the agent goes back to listening.

**Silence or Smart Turn?** Silence alone is one number, the same for every sentence. So it often gets something wrong: either it cuts off hesitations, or it is slow. Smart Turn is a small open model from Pipecat (about 8 MB). It hears intonation and rhythm, not words: "I'd like to… um…" sounds unfinished, "I'd like a coffee." sounds finished. Use it with **End-of-turn silence** = 2,000: the agent is quick on finished sentences and patient during hesitations. After each pause, its verdict arrives on `Turn probability (local)` (0 to 1; above 0.5 = finished) and in the lab's "Events" log (`turn.prediction · p 0.95 · complete · 1 ms`). If the app can't run the model, it says so once ("Smart Turn is unavailable here: using silence only.") and uses silence alone.

**Four ways to decide that a turn is over** (a discussion, from [the open-source landscape](OPEN_SOURCE_LANDSCAPE.md)):

1. **Silence**: wait for a set amount of quiet. The kit's **End-of-turn silence**.
2. **A prosodic audio model**: listen to how the sentence ends. Smart Turn, in the VIK.
3. **Semantic detection inside the transcription**: the speech recognizer itself predicts the end of the turn from the words, like Kyutai's `stt-1b-en_fr` model ([Kyutai DSM](https://github.com/kyutai-labs/delayed-streams-modeling)).
4. **Asking the language model** whether the sentence is complete, as Micdrop does ([Micdrop blog](https://micdrop.dev/blog/open-source-voice-agent-frameworks)).

The first two are in the kit; the other two are counter-examples to discuss. What does each one actually listen to? Which one would cut off "I'd like… the… the blue one"? Which one gets a list wrong ("apples, pears, and…")? Which one adds waiting time? And there is a fifth way, which people use all the time: a gesture, a look or a button that says "I'm done". Exercise 9 compares them.

> **Ideas:** show that the agent "holds the door open" during a hesitation; make visible the moment it decides you're done (`Turn probability (local)`); a gesture or a key to say "I'm done" without waiting for the silence.

### 5.3 Interruption: can you cut it off?

Three ways to interrupt, all of which give the `interrupted` event (`On interruption`):

| how | who | what happens |
|---|---|---|
| **by voice**: you talk while it is talking | `by: user` | the voice stops at once, the agent switches to "hearing". Needs `Interruptible` and **Listens while speaking**. |
| **by gesture**: button or key → `Interrupt` | `by: client` | the voice stops, the agent goes back to listening. The model is told what it had already said. |
| **by typing or choosing** while it is talking (`Send text`, `Choose`) | `by: client` | a single interruption, then the new request is handled normally |

`Interruptible` unticked: the agent always finishes its sentences, whatever you say.

**Talking over it, more finely (local): **Talk over it this long to interrupt**.** People often talk over someone without wanting to interrupt: "mm-hm", "yeah", "right". At 0 (the default), any speech over the agent stops it at once. Above 0 (600 ms is a good start; the station host persona uses it), the agent's voice first dips, and the kit listens to what you said:

| what you say over it | what happens | events (triggers) |
|---|---|---|
| a **backchannel**: "mm-hm", "yeah", "okay", "right", "I see", "oui", "d'accord"… | the voice dips (to 30 %), then comes back; the agent carries on, and your words don't count as a turn | `interruption.pending` (`On interruption pending`), then `interruption.cancelled` with `reason` `backchannel` (`On interruption cancelled`) |
| a cough, a noise | the same | `interruption.cancelled` with `reason` `noise` |
| a **stop phrase**: "stop", "wait", "hold on", "be quiet", "attends", "chut"… (up to four words: "No, stop", "Okay, stop") | the agent stops and listens, **without replying** | `interrupted` (`On interruption`), then `user.cancel` with `reason` `stop` |
| anything else, or talking longer than the setting | a real interruption, then a normal turn | `interrupted` (`On interruption`) |

Other toolkits have names for this. LiveKit calls a cancelled interruption a **false interruption** (`agent_false_interruption`), after which the agent picks its sentence back up. TEN's turn model treats "wait" as its own intent: the person wants the agent to be quiet, which is not the same as "I'm done". A very short sound (under about 250 ms) isn't even detected as speech, so the voice doesn't dip at all. A CHI '25 study on agents that interrupt (Liu et al., [PDF](https://www.mingmingfan.com/papers/CHI25-BargeIn.pdf)) recommends adjustable settings for pause detection and interruptions, and an agent that yields the floor promptly.

**Echo:** with speakers, the agent hears itself and may cut itself off. Solutions: headphones, or untick **Listens while speaking** (you then interrupt it with a gesture). This is also a real design topic: how do you signal that it isn't listening while it talks?

> **Ideas:** what does the interface show at the exact moment of the interruption? Should the agent apologize, pick up again, forget? (You set this in the `Persona`.) What does it show while its voice dips (`On interruption pending`): an ear, a glance? Should it acknowledge a "mm-hm" with a small nod?

### 5.4 Thinking and analysis: what to do during the wait?

Between the end of the person's sentence and the agent's voice, there is always a wait. It is **measured** on every turn: the `Wait (ms)` output, and `Turn timing` → `{speech, firstSound, total}`.

| setting | effect |
|---|---|
| **Extra delay before replying** | adds latency on purpose, so you can design it. With Gemini, the voice does not start before this delay (counted from the end of the sentence). With the local engine, the model is only asked after this delay: the wait adds up with the computing time. |
| `Thinking sound` | off, tick (a discreet clock) or hum |
| **Interface sounds** | off, soft or clear: a sound when the session opens, when the sentence has been heard, when choices arrive, on an error |
| **Filler lines** | short phrases said while it thinks, separated by `\|`: "Hmm, let me see…\|Good question…\|One moment…". Empty = no filler. |
| **Say a filler after** | say a filler if the reply's voice hasn't started this long after the end of your sentence (default 1,200 ms; 0 = never) |

**Signals:** `Thinking`, `On thinking` (start), `On filler`, `On reply start` (end of the wait).

**Spoken fillers (local).** If the reply is late, the agent says one filler, picked at random (never the same twice in a row), then the reply follows. One filler per turn at most, and only if the reply hasn't started yet. The thinking sound keeps playing under the filler. `Wait (ms)` still measures the real reply, not the filler (`Turn timing` → `filler` gives the time until the filler). The museum guide persona has fillers. The very first filler may be skipped while it is being prepared. Gemini ignores fillers: with Gemini, describe waiting phrases in the `Persona` instead.

**What research says.** A CUI '25 study with 54 participants varied the reply delay (1.5, 4 and 6.5 s) and how the wait was filled: nothing, a processing icon with a sound, or a thinking gesture with a "Hmm, let's see…". Beyond about 4 s, the experience drops. Natural fillers clearly improve how fast the reply feels; the icon and the sound do not significantly improve the overall impression ([arXiv 2507.22352](https://arxiv.org/html/2507.22352v1)). This goes against a common design reflex (add a spinner). Exercise 8 reproduces the study with the kit.

If nothing comes (10 s with Gemini, 90 s locally), the agent gives up on that turn and goes back to listening.

> **Ideas:** raise **Extra delay before replying** to 2,000. When does the wait start to feel awkward? Does an animation make it feel shorter? Is a "hmm" better than silence? (Measure it: exercise 8.)

### 5.5 Not understanding

- **Local engine:** when Whisper hears nothing useful (including its phantom phrases such as "Thanks for watching!" or, in French, "Sous-titres réalisés par…"), the `not.understood` event arrives (`On not understood`) and the agent says the **When nothing was understood** (e.g. "Sorry, can you say that again?").
- **Gemini:** no dedicated event, the model decides. You set its behavior in the `Persona` ("if you didn't understand, ask the person to repeat in one short sentence").

> **Ideas:** visual feedback for "I didn't understand" that doesn't make the person feel at fault; offering choices instead of an open question.

### 5.6 Silence from the person (away, or "no input")

The person says nothing. Maybe they are thinking, distracted, gone, or they don't know what to say. Conversation designers call this "no input" (and "no match" when the agent didn't understand, as in 5.5).

| setting | effect |
|---|---|
| **Away after** | how long a silence (while the agent listens) before `On away`. 0 = never. It fires again after each further silence of the same length: `count` 1, 2, 3… Any speech, typed text or choice starts the count again. Both engines. |
| **Said once when the person stays silent** | said **once**, at the first `On away`: "Are you still there?". Gemini says it in its own words; the local engine says it as written. |

**Signals:** `On away`, and the `user.away` event with `afterMs` and `count` (in the lab's "Events" log: `silent 8.0 s · 1×`).

With Gemini, if **Away after** is shorter than the time the greeting takes, `On away` can fire before the greeting. LiveKit switches its user to `away` after 15 s by default. Accessibility matters here: the W3C's NAUR requirements ask voice interfaces for no unnecessary time-outs, or adjustable ones with a warning ([W3C NAUR](https://w3c.github.io/naur/), REQ 20). So design this case gently.

> **Ideas:** what does the agent do at count 2 and 3, without speaking? A face that dims, then falls asleep; a screen that offers choices instead of an open question. How long before "Are you still there?" feels rude, or pushy?

### 5.7 Calls to action

| tool | how | in the interface |
|---|---|---|
| **choices** | a pattern shows them ("Show choices"), or the agent offers them by itself (Gemini: `show_choices` tool; local: `[[choices: A \| B]]` tag, never read aloud) | `Choices` (array), `Question` (Gemini only) and `On choices` outputs. To answer: `Choice index` = the number of the choice, **counting from 0** (0 = the first one), then `Choose`. |
| **a mood** | `set_mood` tool / `[[mood: …]]` tag | `Mood` output, `On mood` |
| **a signal from the agent** (local) | a pattern's "Send a signal": `show-artwork` = `{name}` | `Agent signal`, `Agent signal value`, `On agent signal`: the patch shows the artwork, lights a lamp… |
| **a signal to the agent** | `Signal name` + `Send signal` (a sensor, a button, a moment of the scene) | the agent's pattern "when a client sends this signal" answers ("Hello! Where are you going?") |
| **the stage** (local) | patterns that "go to" another stage | `Stage`, `On stage`: the patch follows the conversation's progress (welcome, tour, goodbye) |
| **a patch tool** (Gemini) | described in JSON under `extraTools`, in the agent's `persona.md` (on one line; e.g. `change_color`) | `On tool call`, `Tool call` = `{id, name, args}`. Answer with `Tool result` + `Send tool result` (otherwise an automatic answer after 10 s). |
| **typing instead of talking** | `Text` + `Send text` | a button can "say" a sentence in the person's place |
| **informing without asking for a reply** | `Context` + `Send context` | "the user is looking at room 2". The agent does not reply. If you send it while the agent is speaking, the context waits for the end of its reply, so it does not cut it off. |

### 5.8 Accidents

| situation | what the kit does |
|---|---|
| key refused, server missing, mic refused | `error` state, readable message on `Error`, `On error`, and the message shows in the studio and on the op |
| Gemini closes the session (15-minute limit) | the studio reconnects on its own and picks the conversation up again. With a token server, it asks for a fresh token. |
| setting changed during a session (persona, voice… with Gemini) | the studio shows "click Start to restart" |
| `Stop` during connection or the mic request | nothing starts afterwards, the mic is released |
| a 2nd page connects to the local engine | it takes over; the 1st one stops and shows "Another page opened a conversation, so this one is stopping." (one conversation per machine) |
| you delete the op | the op disconnects; the conversation goes on in the app (Stop closes it and the mic) |

---

## 6. Exercise ideas

Each exercise builds on one or two edge cases. Suggested length: 1 hour to half a day.

1. **Three voices, one persona.** Keep the same persona and change the voice and the `Speaking style (Gemini)`. Note what changes in the impression it makes. Deliverable: a voice identity sheet.
2. **The minimal face.** In cables, with only `Mic level`, `Voice level` and the 4 state booleans, make "listening / hearing / thinking / speaking" understandable without any text.
3. **The wait.** **Extra delay before replying** at 0, 1,000 then 3,000. Design three ways to fill the wait (visual, sound, a waiting phrase in the persona) and compare them with `Wait (ms)`.
4. **Cutting it off.** Design the moment of interruption: by voice, by gesture, by keyboard. What do you see, what do you hear? Should the agent pick up again?
5. **The spoken menu.** A reception agent (station, museum) that always offers choices on screen, `Choices` → buttons → `Choose`. Where does the voice stop, and where does the screen take over?
6. **Offline.** Switch the studio to the local engine (**Settings → Engine → VIK, on this computer**) and keep the interface from exercise 2 or 5 as it is. What breaks when latency and quality drop? How does the interface make up for it?
7. **The agent that acts.** Declare a tool (`change_color`, `open_door`…) and make the patch react to the voice.
8. **The wait, measured (after CUI '25).** Reproduce a published experiment with the VIK: three delays × three ways to fill the wait.

   | delay (`Wait (ms)`) | nothing | thinking sound | spoken filler |
   |---|---|---|---|
   | about 1.5 s | | | |
   | about 4 s | | | |
   | about 6.5 s | | | |

   - **The delays.** First measure the natural wait with **Extra delay before replying** = 0 (the `Wait (ms)` output, or the felt wait in **Talk**). Then set **Extra delay before replying** to the target minus that natural wait. `Wait (ms)` is the number you report: it measures the real reply, never the filler.
   - **The three conditions.** *Nothing*: `Thinking sound` off, **Filler lines** empty. *Thinking sound*: `Thinking sound` = hum or tick, plus a thinking animation (the closest to the study's "icon + sound"). *Spoken filler*: **Filler lines** = "Hmm, let's see…\|Let me think…\|Good question…", **Say a filler after** = 500, thinking sound off.
   - **The participants** (other students) ask three questions in each condition, in a shuffled order. After each condition, a short questionnaire, from 1 to 5: "It answered quickly enough." "The wait felt natural." "I'd like to keep talking with it." And one open question: "How long did you wait, in seconds?" (the perceived wait).
   - **Compare with the study.** Does the experience drop after 4 s? Does the spoken filler beat the sound? Deliverable: the table, a chart, and one design rule.

   On a slow machine, the natural wait may already be over 1.5 s: drop that row, or use the fastest machine. The protocol comes from the CUI '25 study ([arXiv 2507.22352](https://arxiv.org/html/2507.22352v1)). Its code has no license, so we reuse the protocol only.
9. **Four ways to end a turn.** Prepare five test sentences: a complete question; a sentence with a hesitation ("I'd like to… um… see room 2"); a list ("apples, pears, and…"); a one-word answer ("yes"); a question that ends with a rising tone. Say each one with **End-of-turn silence** at 300, then 2,000, then **End of turn** = "Silence and the Smart Turn model" with 2,000. For each, note: did it cut in? How long before it replied? What did `Turn probability (local)` say? Then discuss the two ways the kit doesn't have (section 5.2): what would they get right or wrong on your five sentences? Deliverable: a comparison table, and a recommendation for one persona (a station kiosk is not a museum guide).
10. **Design a voice in words (Parler).** Choose a persona, for example the station kiosk. Set `Local voice engine` = `Parler`, `Language` = English. Write three descriptions of its voice in **The voice, described**: vary the pitch, the pace, the warmth, and the recording (close to the mic or far, a small room or a hall). Listen to each one with the same three questions. Then rework the description as you would a persona sheet, until the voice matches the character. Compare with the closest Supertonic voice. Deliverable: a voice sheet with the final description, the words that changed the most, and what Parler ignored. (Outside the kit, Qwen3-TTS VoiceDesign does the same and speaks French; see [the landscape](OPEN_SOURCE_LANDSCAPE.md). It is untested on student laptops.)
11. **Storyboard before you prototype (after VoiceIt).** Three short exercises taken from [VoiceIt](https://github.com/kortuem/voiceit), a tool by Gerd Kortuem for TU Delft's IDEM307 course (MIT license). Write each dialogue as a script: a character, a voice, the lines, and stage directions for `SOUND`, `LIGHT`, `SCREEN` and `(pause N)`, as VoiceIt does. Mark the moments with the kit's names (`hearing`, `thinking`, `On away`, `On interruption`…), so the script turns into a patch later.
    - **Same scene, two characters.** The same exchange (buying a train ticket) with two different agents. What changes, beyond the words?
    - **Same character, two scenes.** One agent in two situations (a quiet morning, a rush hour). What should stay the same, and what should adapt?
    - **The limits of stereotypes.** Why does the nurse get a soft female voice, and the security guard a deep male one? Swap them. Which choices were lazy, and which were justified?

    Then play the best script live with the kit, and note what the real behavior (latency, interruptions, misunderstandings) changes. VoiceIt is for storyboarding before a model is plugged in; the kit brings the real behavior.
12. **The kiosk without a language model.** Build a station kiosk from scratch: a departures table, patterns that only **say** lines filled from the rows (`{time}`, `{platform}`), and a fallback ("nothing else fits") that brings people back on topic. Then turn the same patterns into **answers** (the language model's own words). Compare the felt wait, the mistakes, and the tone. Deliverable: where a designed line beats a generated one, and the other way round.
13. **From a spreadsheet.** Take a real table (a café's menu, the school's rooms, a festival's programme), import it as CSV, link it to a second table, and write "mentions" patterns. Ask ten classmates to question the agent without seeing the table, and write down every sentence. In **Interactions → Try a sentence**, check what each one decided; add examples, other names (`|`) and fallbacks until most land right. Deliverable: the sentences, what the agent decided, and what you changed.
14. **A conversation in stages.** A recipe, a quiz, a guided tour, an onboarding: draw the state machine on paper first (the stages, and what moves from one to the next), then build it with stages and "go to". What happens when the person says something the current stage did not expect? Deliverable: the drawing next to the patterns.
15. **The sensor and the screen.** In cables or p5.js: a sensor (the mouse entering a zone, a webcam motion, a button) sends the signal `visitor-near`, and a pattern greets; the agent's patterns send `show-…` signals, and the screen follows (an image, a colour, a light). Who leads the interaction, the space or the voice? Deliverable: a short video of the installation.
16. **Designed or improvised.** The same persona and the same knowledge, twice: the local engine with your patterns, then Gemini Live improvising. Ask both the same ten questions. Compare reliability (did it say the right price?), tone, latency, and what you could control. Deliverable: a table, and a position: when should an agent be designed, and when can it improvise?
17. **Two languages.** Your tables are in English, your visitors speak French (or the other way round). Try their sentences: the patterns' examples match across languages, the entries' names don't always. Add other names in the first cells (`Water Lilies | Nymphéas`) and try again. Deliverable: the sentences that failed, and why.

### Visual references

Ideas from open-source voice interfaces, to rebuild in cables:

- **The ElevenLabs Orb** ([ElevenLabs UI](https://github.com/elevenlabs/ui), MIT; [orb.tsx](https://github.com/elevenlabs/ui/blob/HEAD/apps/www/registry/elevenlabs-ui/ui/orb.tsx)): a sphere driven by very little. Two colours, the state (`thinking`, `listening`, `talking`), and the input and output volume. In cables: `State`, `Mic level`, `Voice level` and two colours. A good brief: a shader with 4 or 5 inputs.
- **Captions that breathe** (Pipecat's [TranscriptOverlay](https://github.com/pipecat-ai/voice-ui-kit/blob/HEAD/package/src/components/elements/TranscriptOverlay.tsx), BSD-2): each word fades in over about 300 ms, and the caption fades out over about 1 s. In cables: `Agent text` → a text op, with the opacity animated word by word.
- **A typology of visualizers** (LiveKit's [Agents UI](https://docs.livekit.io/frontends/agents-ui.md)): bar, grid, radial, wave and aura. Choose one per persona, and make it show the four states.
- **A mood that fades.** LiveKit's "Expressive Mode" lets a mood fade after two turns, "so a feeling doesn't outlive the moment that produced it" ([useAgentExpression.ts](https://github.com/livekit/components-js/blob/HEAD/packages/react/src/hooks/useAgentExpression.ts)). A good model for linking `Mood` to the colour of a visual.

### Open course resources

Material with an open license, to use in class:

- **FING, *Cahier HyperVoix*** (2020, in French, CC BY 4.0, [PDF](https://fing.org/wp-content/uploads/2020/02/Cahier-Hypervoix_fing.pdf)): a workshop notebook on the "promises and illusions" of voice interfaces. It has ENSCI student prototypes, a typology of designer roles, and the "moving debate" (participants physically take sides on a statement).
- **Google, Conversation Design** (CC BY 4.0, [guide](https://developers.google.com/assistant/conversation-design/how-do-i-get-started)): components such as acknowledgements, apologies, confirmations, earcons and errors.
- **W3C, NAUR** (Natural Language Interface Accessibility User Requirements, [w3c.github.io/naur](https://w3c.github.io/naur/)): accessibility requirements for voice interfaces, such as no unnecessary time-outs, and a confirmation before anything that can't be undone. A ready-made test grid.
- **Vocal sketching** ([SkAT-VG](https://www.kth.se/tmh/projects/skat-vg-sketching-audio-technologies-using-vocalizations-and-gestures-1.694187)): prototype earcons and thinking sounds with your own voice and gestures before you synthesize them.

For deeper reading: the CUI '25 study on waits and fillers ([arXiv 2507.22352](https://arxiv.org/html/2507.22352v1)), the CHI '25 study on interruptions ([PDF](https://www.mingmingfan.com/papers/CHI25-BargeIn.pdf)), and Full-Duplex-Bench, which measures pause handling, backchannels, turn-taking and interruption ([arXiv 2503.04721](https://arxiv.org/html/2503.04721v2)). The [human test protocol](HUMAN_TESTS.md) borrows its four axes.

---

## 7. Architecture (for the teacher or a developer)

How it fits together, in detail: [`DESIGN.md`](DESIGN.md).

```
common/voice-core.js        the conversation in the browser (run by the studio): mic (16 kHz PCM), voice playback,
                            levels, states, events, earcons, measurements. Two engines:
  ├─ GeminiEngine           direct WebSocket to Gemini Live (setup, audio, transcripts, tools, resumption)
  └─ LocalEngine            WebSocket to the VIK server (CONTRACT.md, the local engine's protocol)

cables/
  VoiceAgent.op.js          the cables op: a client of the studio (the file to paste)
  token-server/             Gemini ephemeral token server, no dependencies (Node 18+)

examples/                   clients to start from: p5js/ and html-css-js/

app/                        the VIK studio (Electron)
  electron/main.cjs         window, menus, mic (granted only to its own page), settings folder, Windows installer
  agents/                   the example agents, copied into the settings folder on first launch
  public/                   the studio: index.html, vik.css, fonts/, js/ (main, state, api, talk, knowledge,
                            interactions, settings, ui)
  src/app-server.mjs        HTTP + WebSocket server: the studio, its API (/api/agents…, /api/decide,
                            /api/llm/models), /health, /models, /farms, /voice, /brain, /events
  src/api.mjs               the studio's API: the agents' files, read and written
  src/agent/                agents.mjs (the folders), persona.mjs (persona.md), csv.mjs, interactions.mjs,
                            knowledge.mjs (entries, links, placeholders), matcher.mjs (EmbeddingGemma or words),
                            decide.mjs (the decision model)
  src/session.mjs           one conversation: recognition → decision → lines and replies → voice, sentence by
                            sentence; stages, signals, interruptions, Smart Turn, the voice dipping, fillers
  src/llm.mjs               a language model elsewhere: an LLM farm or an OpenAI-compatible service
  src/farm.mjs              LLM farms (LlmOnLan): found by their UDP beacon or their address
  src/hub.mjs               the hub: the studio (/brain) publishes its events and levels, the clients
                            (/events) follow them and send commands (CONTRACT.md, the clients protocol)
  src/engines/qvac.mjs      the QVAC adapter: Whisper + Silero (hearing), EmbeddingGemma (deciding), Qwen3…
                            (writing), Supertonic, Parler or Chatterbox (speaking)
  src/engines/mock.mjs      the simulated engine (no models)
  src/turn/                 Smart Turn: the model (through onnxruntime-node, optional) and its audio features
  models/                   the Smart Turn v3.2 model (8.7 MB, BSD-2) and its license
  config.json               the models and the choices offered, the decision model's calibration, the defaults

tests/                      the automated tests (npm test), with Smart Turn's Python reference in tests/tools/
.github/workflows/          tests.yml (the tests, on every push to main) and release.yml (the installers)
```

**Changing the op:** edit `cables/VoiceAgent.op.js` (ports, and the messages of the clients protocol), then paste it into cables again.

**Changing the studio:** `npm start` in `app` to try it; `npm run start:mock` for the simulated engine; `npm run make` to rebuild the installers. The studio picks up `common/voice-core.js` automatically. `npm run server` serves the studio to a browser (`http://localhost:8790`), with the same agents.

**Publishing new installers:** the releases are built by GitHub Actions. Push a version tag: the Release workflow builds the Windows and Mac installers and publishes them on the repository's Releases page. See [`PUBLISHING.md`](../PUBLISHING.md). QVAC is pinned to version 0.21.0: upgrade it between terms only, after `npm run selftest` on a Windows PC and a Mac, and a check of the decision model.

**Changing the local models:** in **Settings** (lighter and bigger models, an LLM farm, a service). The list offered is `choices` in `config.json` (menu **Files → Open settings folder**, then restart the app): see the studio's README, "Choosing the models".

**Automated tests:** `tests/` (see [`tests/README.md`](../tests/README.md)). They run without a key, without models and without Electron, against "fakes" that speak the same protocols: more than 560 checks. `npm test`, at the root, runs them all. On GitHub, they run on every push to `main`.

---

## 8. Troubleshooting

| symptom | what to check |
|---|---|
| the studio says "Gemini refused the session" | the key is wrong or the model is not available for this account |
| the studio gets no token | is the token server running? Is the studio's address in `ALLOWED_ORIGINS`? |
| the agent cuts itself off | echo: headphones, or untick **Listens while speaking** |
| a pattern never fires | in **Interactions → Try a sentence**, its score is below the confidence: add examples closer to what people say (whole sentences), other names for the entries (`\|`), or lower the confidence. Check that it is on, and in the right stage |
| a pattern fires when it shouldn't | its examples are too short (one word), or too close to another pattern's: write whole sentences, or raise the confidence |
| "Decided by Words" with the local engine | EmbeddingGemma is not loaded: **Files → Download all models**, then restart; **Settings → Hearing and deciding** says which matcher works |
| "No column fills {…}" under a line | the placeholder is not a column of the table the pattern mentions |
| the replies fail with a farm or a service | the message says why: off, full, wrong key, model not served. **Settings → Language model**: choose another, or a local model |
| the agent cuts in too early | increase the end-of-turn silence, set the end-of-speech sensitivity to low (with Gemini, then `Start`) |
| the agent doesn't react to a quiet voice | **Start-of-speech sensitivity** on high; check the mic chosen by the system |
| no sound | click once in the studio (it blocks sound before a click); check Volume |
| VIK: loading stuck at 0% ("waiting for data") | the network blocks the download (often peer to peer, for the voices): see "Downloading the models" in the studio's README |
| VIK: Vulkan error (Windows) | update the graphics driver |
| VIK: no mic (Mac) | System Settings → Privacy & Security → Microphone → allow "VIK" |
| a client (cables, p5.js, a page) can't reach the app | is the app open, with its window? Is the address the one in **Settings → Clients**? A page opened by double-click (`file://`) is refused: open it through a local web server (VS Code's Live Server, `npx serve`). A refused page is named in **Files → Server log** |
| the cables op says the app "is too old" | the installed VIK predates the clients' hub (`/events`, version 2.0.0): install the latest version from the Releases page |
| the cables op can't reach the app although it is open (in the cables editor) | Chrome (since version 147) blocks connections from a website to this computer, and the editor runs the patch in a frame that cannot ask for that permission. Open the patch on its own page (`cables.gl/p/…`) and allow "Apps on your device" (or "Local network") when Chrome asks; in Chrome's settings, `chrome://settings/content/localNetwork` |
| a client says the app's window is closed | the server runs without its studio (`npm run server`): open `http://localhost:8790` in a browser. (In the installed app, closing the window quits the app: clients then say they can't reach it, and reconnect when it opens again.) |
| VIK: "Smart Turn is unavailable here: using silence only." | the optional `onnxruntime-node` is missing or did not load. Run `npm install` again in `app`, then `npm run selftest` (⚠ on "end of turn: Smart Turn" means it is still missing). Meanwhile, turns end on silence. |
| VIK: "Parler only speaks English: replies will sound English-accented." | Parler is English only: set the language to English, or use Supertonic or Chatterbox |
| VIK: nothing is said for a long time after choosing Parler or Chatterbox | the first use downloads the voice (about 1.16 GB for Parler, 345 MB + 788 MB for Chatterbox): watch the banner. Better: **Files → Download all models** once, on a good network. |
| VIK: "RPC initialization timed out" | QVAC's worker took too long to start (a first launch after a restart, the antivirus scanning its libraries): click **Start** again. **Files → Server log** shows the worker's own reason |
| the agent stops for a "mm-hm" (local) | **Talk over it this long to interrupt** is 0, so it stops at once: try 600 |
| no filler is heard | Gemini ignores fillers. Locally: check **Filler lines** and **Say a filler after**; a quick reply comes before the filler; the very first one can be skipped while it is prepared |
| understanding a VIK error | **Files → Server log** |

---

## 9. Known limits, and what remains to be checked

- **Tried for real:** on a Windows computer with QVAC 0.21, the default models load from their files, and EmbeddingGemma decides as intended on the example agents (34 sentences, English and French, about 20 ms each); the packaged Windows app (3.0.0) does the same. **Not yet tried for real:** the Gemini API, the Mac installer, Parler and Chatterbox, the local models other than the defaults, a real LlmOnLan farm and the online services. Everything else is checked by the automated tests, against faithful imitations of the protocols. The [human test protocol](HUMAN_TESTS.md) starts with exactly that.
- **Gemini 3.8 Live** picks its language on its own, has only predefined voices and no "affective dialog". Sessions last 15 minutes at most (the studio reconnects on its own).
- **Local engine:** no echo cancellation, small language models (less refined replies, weaker in languages other than English), latency that depends a lot on the machine. The patterns compensate: a designed line is exact and instant.
- **The decision model** compares meanings, not facts: two patterns with close examples compete, and an entry named in another language needs its other name in the table. The words matcher (simulated engine, or EmbeddingGemma not loaded) only matches close wordings. The patterns don't apply with Gemini Live.
- **Not yet tried for real, among the borrowed features:** `onnxruntime-node` inside Electron 42, and the Smart Turn model inside the installers (only the Python check has run the real model); the real Parler and Chatterbox voices in QVAC (a fake SDK checks the calls against QVAC 0.21's docs); Smart Turn's accuracy on real speech, and its timing with QVAC's speech detector; what real Whisper writes for a short "mm-hm"; echo with speakers while the voice dips; how fast fillers get prepared, since QVAC makes one synthesis at a time; how real Gemini answers the reprompt instruction. Tests A12, B5, B6, D5, E6 to E8, F6 and I8 of the [human test protocol](HUMAN_TESTS.md) check them.
- **Local voices:** Supertonic, the default, was archived by its makers in September 2026: it keeps working, but there will be no new voices. Parler only speaks English. Chatterbox has no Japanese or Chinese here.
- **QVAC changes fast:** four releases with breaking changes in six weeks (August to October 2026). The app is pinned to 0.21.0.
- **Unsigned apps:** Windows and macOS warnings on first launch.

## 10. Data and privacy

- With **Gemini**, the students' voices go to Google. On the free tier, Google may use them to improve its models, and people may review them. For classroom use: a paid project, or a clear rule about what is said to the agent.
- The **keys** (Gemini, a service, a farm's password) stay in the studio, on one computer: never in a patch, nor in an exported agent. An imported agent cannot change where the conversation goes. With the token server, the Gemini key never leaves the teacher's computer.
- With the **VIK**, nothing leaves the computer (except the model downloads: at first launch, and the first time you choose another model or voice). **With an LLM farm**, the text of the replies to write (persona, the knowledge entries found, what was said, never the sound) goes to the farm computer, over the local network. **With a service** (OpenAI, Gemini, Mistral, OpenRouter…), it goes to that company, under its terms: choose it knowingly. The mic is only granted to the app's page. The clients (cables, p5.js, pages) never get the mic: only what the app publishes, and only on this computer.
- In both cases, the mic only opens with **Start** and closes with **Stop**.
- **Voice cloning** (Chatterbox): a voice recording is personal data. Only with the clear, written consent of the person, for the exercise only, and delete the recording afterwards. The cloned voice carries a watermark, but that does not make it harmless.
