# Guide: designing a voice agent with the "Voice interaction" kit

This guide is for the teacher who prepares the workshop, and for the students who take it. It explains what the kit contains, how to install and use it, and how each **edge case** of a voice conversation becomes a **design material**. It ends with the architecture, troubleshooting and the limits.

To check that the kit really does what is expected of it, see the [human test protocol](HUMAN_TESTS.md).

For what already exists in open source, see [the open-source landscape](OPEN_SOURCE_LANDSCAPE.md).

---

## 1. What the kit contains

Two prototypes share the same vocabulary.

| | **1. The cables.gl op "VoiceAgent"** | **2. The "Voice Lab" app** |
|---|---|---|
| engine | Gemini Live (Google, online) | QVAC (open models, 100% local) |
| where it runs | in the browser, in a cables.gl patch | a Windows / Mac M1 app installed on each computer |
| what you need | a cables.gl account, a Gemini key (or a token server) | nothing but the app. The models download once (~1.5 GB, ~2 GB on disk). |
| voice quality | very smooth, low latency, fine understanding | slower, smaller models, decent synthetic voice. Three voice engines: preset voices, a voice described in words, a cloned voice |
| data | the voices go through Google | nothing leaves the computer |
| for designing | with all the visual and sound ops of cables | in the app's lab window, **or** from cables (the op connects to it) |

**The key point:** both prototypes expose **the same states, the same events and the same settings** (see [`../CONTRACT.md`](../CONTRACT.md)). An interface built in cables with Gemini works as is with the local engine: only the `Engine` port changes. So students can design online, then test their interface offline (and the other way round), and compare.

### Which one to choose for a workshop?

- **Exploring interaction design** (shapes, animations, sounds, calls to action): the cables op with Gemini. It has the most believable voice, and cables offers the whole graphic vocabulary.
- **No key, limited network, or sensitive data**: the Voice Lab app, with the QVAC engine.
- **Designing the interface before you have the models, or on a weak machine**: the Voice Lab with the **simulated engine**. The agent hears a "voice-like noise", replies with a short pre-written script (choices, mood, a long reply you can cut off) and speaks with a hum. Each conversation replays the same script, which makes demos repeatable.
- **Getting students to think about latency and quality**: both, side by side. The measurements of each turn (`Wait (ms)`, `Turn timing`) let you compare with numbers.

---

## 2. Quick start

### 2.1 The cables.gl op with Gemini (10 minutes)

1. Open a patch that belongs to you on cables.gl.
2. Avatar, top right → **Code a new op** → name `VoiceAgent` → **Create Op**.
3. In the code editor that opens: delete everything, paste **all** of [`1_cables_gemini_live/VoiceAgent.op.js`](../1_cables_gemini_live/VoiceAgent.op.js), save (`Ctrl/Cmd + S`).
4. On the op: paste a Gemini key into `Gemini API key` (created at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)).
5. Click `Start`, allow the mic, talk.

The cables code is not modified: the op is a "patch op" that lives in the patch and travels with it. The key is **never** saved in the patch. For a whole class, a **token server** is better: the key stays on the teacher's computer, and each browser gets a token valid for 30 minutes. See [`1_cables_gemini_live/README.md`](../1_cables_gemini_live/README.md).

### 2.2 The Voice Lab app (teacher: once; students: 5 minutes)

**The teacher publishes the installers once.** The simplest way: put the kit on GitHub and push a version tag (`v1.0.0`). GitHub Actions then builds the Windows and Mac installers and publishes them as a **GitHub Release**, with no Mac needed on your side. Step by step: [`PUBLISHING.md`](../PUBLISHING.md). You can also build them on your own machine (`npm install` then `npm run make`: an `.exe` on a PC, a `.dmg` on a Mac). Details in [`2_qvac_local/README.md`](../2_qvac_local/README.md).

**Each student** downloads the installer from the repository's **Releases** page: `VoiceLab-Setup-<version>-windows-x64.exe` (Windows) or `VoiceLab-<version>-mac-arm64.dmg` (Mac M1 and later), then launches it. (Built on your own machine, they are called `VoiceLab-Setup.exe` and `Voice Lab.dmg`.) The app is not signed:

- **Windows:** "Windows protected your PC" → **More info → Run anyway**.
- **Mac:** on first launch, macOS blocks the app. Open **System Settings → Privacy & Security → Open Anyway**. If macOS says the app "is damaged": `xattr -cr "/Applications/Voice Lab.app"` in Terminal.

On first launch, the models download: the window's banner shows the percentage, and a bar moves along on the app icon. When the window says "Models ready", click **Start**.

To connect **cables** to the local engine: leave the app open, and in the op set `Engine` = `Local (QVAC)`. The menu **Engine → Copy address for cables.gl** gives the server address (usually `ws://localhost:8790/voice`).

---

## 3. The vocabulary of voice interaction

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

## 4. The edge cases, one by one

This is the heart of the workshop. For each case: what happens, the settings that change it, the signals to design with, and some ideas.

> **With Gemini**, an open session does not pick up live changes to persona, voice, language, creativity, short answers, end silence, sensitivities or `Interruptible`: the op asks you to click `Start`. Volume, delay, sounds and mic change live. **With the local engine**, everything applies live.
>
> A port marked **(local)** only works with the local engine: Gemini ignores it. The settings borrowed from open source (end of turn, interrupt after, away, fillers, voice engine) never need a restart.

### 4.1 Identity: voice and personality

| lever | setting | note |
|---|---|---|
| who it is, what it knows, how it behaves | `Name`, `Persona` | write in the second person: "You are… You help… You never talk about…" |
| its tone | `Creativity` (0 calm → 2 unpredictable), `Short answers` | when spoken, short answers are almost always better |
| what it says first | `Greeting` | empty = it waits to be spoken to (another design choice) |
| its voice | `Gemini voice` (30 voices), `Speaking style (Gemini)`; or, locally, `Local voice engine`: Supertonic (`Local voice` F1–F5, M1–M5, `Speed (local)`), Parler (`Voice description (Parler)`) or Chatterbox | `Speaking style (Gemini)` is an instruction given to the model ("slow and calm", "with a smile"). The model follows it more or less. |
| its displayed mood | `On-screen choices and mood` → `Mood` output | 7 moods: neutral, happy, curious, focused, sorry, surprised, excited |

The **example personas** (museum guide, station host, gardener, chef) are in `2_qvac_local/personas/`. You pick them in the lab window, and you can export and import them as JSON ("Share settings").

**Designing a voice in words (Parler, local).** With `Local voice engine` = `Parler`, there are no preset voices: you write the voice, like a persona. For example: "A warm, low-pitched female voice, speaking slowly and clearly, very close to the microphone." Describe who speaks (gender, pitch, pace, how expressive) and how it is recorded (close to the mic or far, a small room or a hall). The new description applies from the next sentence, with no restart. Parler only speaks English, and its first use downloads about 1.16 GB.

**Cloning a voice (Chatterbox, local).** Chatterbox speaks many languages, French included, and it can imitate a voice from a short WAV recording (`referenceAudio` in `config.json`, see the [Voice Lab README](../2_qvac_local/README.md)). This raises real questions, and they belong in the workshop. Whose voice is it? Did they agree, to what, and for how long? What if the clone says something they would never say? The rules for class: the clear, written consent of the person; for the exercise only; delete the recording afterwards; never someone who isn't there, and never a public figure. Every Chatterbox output carries a watermark (Resemble AI's "Perth"), so it can be identified as synthetic. That is a good starting point for a discussion: how should a synthetic voice announce itself?

**On the Gemini side**, the voices are predefined. A developer reported in September 2026 that voices made with Gemini's Voice Design cannot be used with Gemini Live (a single report, still to be confirmed: see [the open-source landscape](OPEN_SOURCE_LANDSCAPE.md)). If it holds, designed and cloned voices only exist in the local engine. That contrast is worth discussing, rather than treating it as a defect.

> **To try in the workshop:** the same persona with three different voices. What changes in how much you trust it? (And exercise 10: design a voice in words.)

### 4.2 End of turn: when have you finished speaking?

The agent has to guess when the person has finished. Too early, and it cuts off someone who is hesitating ("um…"). Too late, and it seems slow.

| setting | effect |
|---|---|
| `End silence (ms)` | the silence that ends a turn. 300 ms: impatient agent. 2,000 ms: patient agent, but slow. |
| `Start sensitivity` | high: hears even a whisper (and noise); low: only a clear voice |
| `End sensitivity` | high: decides quickly; low: waits to be sure |
| `End of turn (local)` | `silence only`, or `silence + Smart Turn`: a small model also listens to how your sentence ends. A finished sentence ends the turn at once; a pause in the middle waits up to `End silence (ms)`. |

**Signals:** `Hearing` (1 while the person is speaking), `Mic level`, `On user end`, `User text` (as it comes), `Turn probability (local)`. A false alarm (a cough, a short noise) does not create a turn: the agent goes back to listening.

**Silence or Smart Turn?** Silence alone is one number, the same for every sentence. So it often gets something wrong: either it cuts off hesitations, or it is slow. Smart Turn is a small open model from Pipecat (about 8 MB). It hears intonation and rhythm, not words: "I'd like to… um…" sounds unfinished, "I'd like a coffee." sounds finished. Use it with `End silence (ms)` = 2,000: the agent is quick on finished sentences and patient during hesitations. After each pause, its verdict arrives on `Turn probability (local)` (0 to 1; above 0.5 = finished) and in the lab's "Events" log (`turn.prediction · p 0.95 · complete · 1 ms`). If the app can't run the model, it says so once ("Smart Turn is unavailable here: using silence only.") and uses silence alone.

**Four ways to decide that a turn is over** (a discussion, from [the open-source landscape](OPEN_SOURCE_LANDSCAPE.md)):

1. **Silence**: wait for a set amount of quiet. The kit's `End silence (ms)`.
2. **A prosodic audio model**: listen to how the sentence ends. Smart Turn, in the Voice Lab.
3. **Semantic detection inside the transcription**: the speech recognizer itself predicts the end of the turn from the words, like Kyutai's `stt-1b-en_fr` model ([Kyutai DSM](https://github.com/kyutai-labs/delayed-streams-modeling)).
4. **Asking the language model** whether the sentence is complete, as Micdrop does ([Micdrop blog](https://micdrop.dev/blog/open-source-voice-agent-frameworks)).

The first two are in the kit; the other two are counter-examples to discuss. What does each one actually listen to? Which one would cut off "I'd like… the… the blue one"? Which one gets a list wrong ("apples, pears, and…")? Which one adds waiting time? And there is a fifth way, which people use all the time: a gesture, a look or a button that says "I'm done". Exercise 9 compares them.

> **Ideas:** show that the agent "holds the door open" during a hesitation; make visible the moment it decides you're done (`Turn probability (local)`); a gesture or a key to say "I'm done" without waiting for the silence.

### 4.3 Interruption: can you cut it off?

Three ways to interrupt, all of which give the `interrupted` event (`On interruption`):

| how | who | what happens |
|---|---|---|
| **by voice**: you talk while it is talking | `by: user` | the voice stops at once, the agent switches to "hearing". Needs `Interruptible` and `Listen while speaking`. |
| **by gesture**: button or key → `Interrupt` | `by: client` | the voice stops, the agent goes back to listening. The model is told what it had already said. |
| **by typing or choosing** while it is talking (`Send text`, `Choose`) | `by: client` | a single interruption, then the new request is handled normally |

`Interruptible` unticked: the agent always finishes its sentences, whatever you say.

**Talking over it, more finely (local): `Interrupt after (ms) (local)`.** People often talk over someone without wanting to interrupt: "mm-hm", "yeah", "right". At 0 (the default), any speech over the agent stops it at once. Above 0 (600 ms is a good start; the station host persona uses it), the agent's voice first dips, and the kit listens to what you said:

| what you say over it | what happens | events (triggers) |
|---|---|---|
| a **backchannel**: "mm-hm", "yeah", "okay", "right", "I see", "oui", "d'accord"… | the voice dips (to 30 %), then comes back; the agent carries on, and your words don't count as a turn | `interruption.pending` (`On interruption pending`), then `interruption.cancelled` with `reason` `backchannel` (`On interruption cancelled`) |
| a cough, a noise | the same | `interruption.cancelled` with `reason` `noise` |
| a **stop phrase**: "stop", "wait", "hold on", "be quiet", "attends", "chut"… (up to four words: "No, stop", "Okay, stop") | the agent stops and listens, **without replying** | `interrupted` (`On interruption`), then `user.cancel` with `reason` `stop` |
| anything else, or talking longer than the setting | a real interruption, then a normal turn | `interrupted` (`On interruption`) |

Other toolkits have names for this. LiveKit calls a cancelled interruption a **false interruption** (`agent_false_interruption`), after which the agent picks its sentence back up. TEN's turn model treats "wait" as its own intent: the person wants the agent to be quiet, which is not the same as "I'm done". A very short sound (under about 250 ms) isn't even detected as speech, so the voice doesn't dip at all. A CHI '25 study on agents that interrupt (Liu et al., [PDF](https://www.mingmingfan.com/papers/CHI25-BargeIn.pdf)) recommends adjustable settings for pause detection and interruptions, and an agent that yields the floor promptly.

**Echo:** with speakers, the agent hears itself and may cut itself off. Solutions: headphones, or untick `Listen while speaking` (you then interrupt it with a gesture). This is also a real design topic: how do you signal that it isn't listening while it talks?

> **Ideas:** what does the interface show at the exact moment of the interruption? Should the agent apologize, pick up again, forget? (You set this in the `Persona`.) What does it show while its voice dips (`On interruption pending`): an ear, a glance? Should it acknowledge a "mm-hm" with a small nod?

### 4.4 Thinking and analysis: what to do during the wait?

Between the end of the person's sentence and the agent's voice, there is always a wait. It is **measured** on every turn: the `Wait (ms)` output, and `Turn timing` → `{speech, firstSound, total}`.

| setting | effect |
|---|---|
| `Reply delay (ms)` | adds latency on purpose, so you can design it. With Gemini, the voice does not start before this delay (counted from the end of the sentence). With the local engine, the model is only asked after this delay: the wait adds up with the computing time. |
| `Thinking sound` | off, tick (a discreet clock) or hum |
| `Earcons` | off, soft or clear: a sound when the session opens, when the sentence has been heard, when choices arrive, on an error |
| `Filler lines (local)` | short phrases said while it thinks, separated by `\|`: "Hmm, let me see…\|Good question…\|One moment…". Empty = no filler. |
| `Filler after (ms) (local)` | say a filler if the reply's voice hasn't started this long after the end of your sentence (default 1,200 ms; 0 = never) |

**Signals:** `Thinking`, `On thinking` (start), `On filler`, `On reply start` (end of the wait).

**Spoken fillers (local).** If the reply is late, the agent says one filler, picked at random (never the same twice in a row), then the reply follows. One filler per turn at most, and only if the reply hasn't started yet. The thinking sound keeps playing under the filler. `Wait (ms)` still measures the real reply, not the filler (`Turn timing` → `filler` gives the time until the filler). The museum guide persona has fillers. The very first filler may be skipped while it is being prepared. Gemini ignores fillers: with Gemini, describe waiting phrases in the `Persona` instead.

**What research says.** A CUI '25 study with 54 participants varied the reply delay (1.5, 4 and 6.5 s) and how the wait was filled: nothing, a processing icon with a sound, or a thinking gesture with a "Hmm, let's see…". Beyond about 4 s, the experience drops. Natural fillers clearly improve how fast the reply feels; the icon and the sound do not significantly improve the overall impression ([arXiv 2507.22352](https://arxiv.org/html/2507.22352v1)). This goes against a common design reflex (add a spinner). Exercise 8 reproduces the study with the kit.

If nothing comes (10 s with Gemini, 90 s locally), the agent gives up on that turn and goes back to listening.

> **Ideas:** raise `Reply delay (ms)` to 2,000. When does the wait start to feel awkward? Does an animation make it feel shorter? Is a "hmm" better than silence? (Measure it: exercise 8.)

### 4.5 Not understanding

- **Local engine:** when Whisper hears nothing useful (including its phantom phrases such as "Thanks for watching!" or, in French, "Sous-titres réalisés par…"), the `not.understood` event arrives (`On not understood`) and the agent says the `Repair line (local)` (e.g. "Sorry, can you say that again?").
- **Gemini:** no dedicated event, the model decides. You set its behavior in the `Persona` ("if you didn't understand, ask the person to repeat in one short sentence").

> **Ideas:** visual feedback for "I didn't understand" that doesn't make the person feel at fault; offering choices instead of an open question.

### 4.6 Silence from the person (away, or "no input")

The person says nothing. Maybe they are thinking, distracted, gone, or they don't know what to say. Conversation designers call this "no input" (and "no match" when the agent didn't understand, as in 4.5).

| setting | effect |
|---|---|
| `Away after (ms)` | how long a silence (while the agent listens) before `On away`. 0 = never. It fires again after each further silence of the same length: `count` 1, 2, 3… Any speech, typed text or choice starts the count again. Both engines. |
| `Reprompt line` | said **once**, at the first `On away`: "Are you still there?". Gemini says it in its own words; the local engine says it as written. |

**Signals:** `On away`, and the `user.away` event with `afterMs` and `count` (in the lab's "Events" log: `silent 8.0 s · 1×`).

With Gemini, if `Away after (ms)` is shorter than the time the greeting takes, `On away` can fire before the greeting. LiveKit switches its user to `away` after 15 s by default. Accessibility matters here: the W3C's NAUR requirements ask voice interfaces for no unnecessary time-outs, or adjustable ones with a warning ([W3C NAUR](https://w3c.github.io/naur/), REQ 20). So design this case gently.

> **Ideas:** what does the agent do at count 2 and 3, without speaking? A face that dims, then falls asleep; a screen that offers choices instead of an open question. How long before "Are you still there?" feels rude, or pushy?

### 4.7 Calls to action

| tool | how | in the interface |
|---|---|---|
| **choices** | the agent offers options (Gemini: `show_choices` tool; local: `[[choices: A \| B]]` tag, never read aloud) | `Choices` (array), `Question` (Gemini only) and `On choices` outputs. To answer: `Choice index` = the number of the choice, **counting from 0** (0 = the first one), then `Choose`. |
| **a mood** | `set_mood` tool / `[[mood: …]]` tag | `Mood` output, `On mood` |
| **a patch tool** (Gemini) | described in JSON in `Tools (JSON)` (e.g. `change_color`) | `On tool call`, `Tool call` = `{id, name, args}`. Answer with `Tool result` + `Send tool result` (otherwise an automatic answer after 10 s). |
| **typing instead of talking** | `Text` + `Send text` | a button can "say" a sentence in the person's place |
| **informing without asking for a reply** | `Context` + `Send context` | "the user is looking at room 2". The agent does not reply. If you send it while the agent is speaking, the context waits for the end of its reply, so it does not cut it off. |

### 4.8 Accidents

| situation | what the kit does |
|---|---|
| key refused, server missing, mic refused | `error` state, readable message on `Error`, `On error`, and the message shows on the op |
| Gemini closes the session (15-minute limit) | the op reconnects on its own and picks the conversation up again. With a token server, it asks for a fresh token. |
| setting changed during a session (persona, voice… with Gemini) | the op shows "click Start to restart" |
| `Stop` during connection or the mic request | nothing starts afterwards, the mic is released |
| a 2nd page connects to the local engine | it takes over; the 1st one stops and shows "Another page opened a conversation, so this one is stopping." (one conversation per machine) |
| you delete the op | the session and the mic close |

---

## 5. Exercise ideas

Each exercise builds on one or two edge cases. Suggested length: 1 hour to half a day.

1. **Three voices, one persona.** Keep the same persona and change the voice and the `Speaking style (Gemini)`. Note what changes in the impression it makes. Deliverable: a voice identity sheet.
2. **The minimal face.** In cables, with only `Mic level`, `Voice level` and the 4 state booleans, make "listening / hearing / thinking / speaking" understandable without any text.
3. **The wait.** `Reply delay (ms)` at 0, 1,000 then 3,000. Design three ways to fill the wait (visual, sound, a waiting phrase in the persona) and compare them with `Wait (ms)`.
4. **Cutting it off.** Design the moment of interruption: by voice, by gesture, by keyboard. What do you see, what do you hear? Should the agent pick up again?
5. **The spoken menu.** A reception agent (station, museum) that always offers choices on screen, `Choices` → buttons → `Choose`. Where does the voice stop, and where does the screen take over?
6. **Offline.** Reconnect the interface from exercise 2 or 5 to the local engine (`Engine` = `Local (QVAC)`). What breaks when latency and quality drop? How does the interface make up for it?
7. **The agent that acts.** Declare a tool (`change_color`, `open_door`…) and make the patch react to the voice.
8. **The wait, measured (after CUI '25).** Reproduce a published experiment with the Voice Lab: three delays × three ways to fill the wait.

   | delay (`Wait (ms)`) | nothing | thinking sound | spoken filler |
   |---|---|---|---|
   | about 1.5 s | | | |
   | about 4 s | | | |
   | about 6.5 s | | | |

   - **The delays.** First measure the natural wait with `Reply delay (ms)` = 0 (the `Wait (ms)` output, or the "Turns" table in the lab window). Then set `Reply delay (ms)` to the target minus that natural wait. `Wait (ms)` is the number you report: it measures the real reply, never the filler.
   - **The three conditions.** *Nothing*: `Thinking sound` off, `Filler lines (local)` empty. *Thinking sound*: `Thinking sound` = hum or tick, plus a thinking animation (the closest to the study's "icon + sound"). *Spoken filler*: `Filler lines (local)` = "Hmm, let's see…\|Let me think…\|Good question…", `Filler after (ms) (local)` = 500, thinking sound off.
   - **The participants** (other students) ask three questions in each condition, in a shuffled order. After each condition, a short questionnaire, from 1 to 5: "It answered quickly enough." "The wait felt natural." "I'd like to keep talking with it." And one open question: "How long did you wait, in seconds?" (the perceived wait).
   - **Compare with the study.** Does the experience drop after 4 s? Does the spoken filler beat the sound? Deliverable: the table, a chart, and one design rule.

   On a slow machine, the natural wait may already be over 1.5 s: drop that row, or use the fastest machine. The protocol comes from the CUI '25 study ([arXiv 2507.22352](https://arxiv.org/html/2507.22352v1)). Its code has no license, so we reuse the protocol only.
9. **Four ways to end a turn.** Prepare five test sentences: a complete question; a sentence with a hesitation ("I'd like to… um… see room 2"); a list ("apples, pears, and…"); a one-word answer ("yes"); a question that ends with a rising tone. Say each one with `End silence (ms)` at 300, then 2,000, then `End of turn (local)` = `silence + Smart Turn` with 2,000. For each, note: did it cut in? How long before it replied? What did `Turn probability (local)` say? Then discuss the two ways the kit doesn't have (section 4.2): what would they get right or wrong on your five sentences? Deliverable: a comparison table, and a recommendation for one persona (a station kiosk is not a museum guide).
10. **Design a voice in words (Parler).** Choose a persona, for example the station kiosk. Set `Local voice engine` = `Parler`, `Language` = English. Write three descriptions of its voice in `Voice description (Parler)`: vary the pitch, the pace, the warmth, and the recording (close to the mic or far, a small room or a hall). Listen to each one with the same three questions. Then rework the description as you would a persona sheet, until the voice matches the character. Compare with the closest Supertonic voice. Deliverable: a voice sheet with the final description, the words that changed the most, and what Parler ignored. (Outside the kit, Qwen3-TTS VoiceDesign does the same and speaks French; see [the landscape](OPEN_SOURCE_LANDSCAPE.md). It is untested on student laptops.)
11. **Storyboard before you prototype (after VoiceIt).** Three short exercises taken from [VoiceIt](https://github.com/kortuem/voiceit), a tool by Gerd Kortuem for TU Delft's IDEM307 course (MIT license). Write each dialogue as a script: a character, a voice, the lines, and stage directions for `SOUND`, `LIGHT`, `SCREEN` and `(pause N)`, as VoiceIt does. Mark the moments with the kit's names (`hearing`, `thinking`, `On away`, `On interruption`…), so the script turns into a patch later.
    - **Same scene, two characters.** The same exchange (buying a train ticket) with two different agents. What changes, beyond the words?
    - **Same character, two scenes.** One agent in two situations (a quiet morning, a rush hour). What should stay the same, and what should adapt?
    - **The limits of stereotypes.** Why does the nurse get a soft female voice, and the security guard a deep male one? Swap them. Which choices were lazy, and which were justified?

    Then play the best script live with the kit, and note what the real behavior (latency, interruptions, misunderstandings) changes. VoiceIt is for storyboarding before a model is plugged in; the kit brings the real behavior.

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

## 6. Architecture (for the teacher or a developer)

```
common/voice-core.js        the core, in the browser: mic (16 kHz PCM), voice playback, levels,
                            states, events, earcons, measurements. Two engines:
  ├─ GeminiEngine           direct WebSocket to Gemini Live (setup, audio, transcripts, tools, resumption)
  └─ LocalEngine            WebSocket to the Voice Lab server (protocol described in CONTRACT.md)

1_cables_gemini_live/
  op-glue.js                the cables op's ports (English names, groups)
  build.mjs                 assembles voice-core + op-glue → VoiceAgent.op.js (the file to paste)
  token-server/             Gemini ephemeral token server, no dependencies (Node 18+)

2_qvac_local/               the Electron app "Voice Lab"
  electron/main.cjs         window, menus, mic (granted only to its own page), Windows installer
  src/app-server.mjs        built-in HTTP + WebSocket server (lab page, /health, /personas, /voice)
  src/session.mjs           one conversation: recognition → model → voice sentence by sentence, interruptions,
                            Smart Turn, the voice dipping (backchannels, stop phrases), fillers
  src/turn/                 Smart Turn: smart-turn.mjs (the model, through onnxruntime-node, optional)
                            and whisper-features.mjs (its audio features, a port of Pipecat's Python code)
  src/engines/qvac.mjs      the QVAC adapter: Whisper + Silero (listening), Qwen3 (reply),
                            Supertonic, Parler or Chatterbox (voice)
  src/engines/mock.mjs      the simulated engine (no models)
  models/                   the Smart Turn v3.2 model (8.7 MB, BSD-2) and its license
  public/index.html         the lab window
  config.json, personas/    the models, the default settings, the personas

tests/                      the automated tests (npm test), with Smart Turn's Python reference in tests/tools/
.github/workflows/          tests.yml (the tests, on every push to main) and release.yml (the installers)
```

**Changing the op:** never edit `VoiceAgent.op.js` by hand. Edit `common/voice-core.js` or `op-glue.js`, then `node 1_cables_gemini_live/build.mjs`, and paste the op into cables again.

**Changing the Voice Lab:** `npm start` in `2_qvac_local` to try it; `npm run start:mock` for the simulated engine; `npm run make` to rebuild the installers. The lab page picks up `common/voice-core.js` automatically.

**Publishing new installers:** the releases are built by GitHub Actions. Push a version tag (`v1.1.0`): the Release workflow builds the Windows and Mac installers on GitHub's machines and publishes them on the repository's Releases page. See [`PUBLISHING.md`](../PUBLISHING.md). QVAC is pinned to version 0.21.0: upgrade it between terms only, after `npm run selftest` on a Windows PC and a Mac.

**Changing the local models:** menu **Files → Open settings folder**, edit `config.json`, then restart the app. Lighter models exist for modest machines (see the Voice Lab README).

**Automated tests:** `tests/` (see [`tests/README.md`](../tests/README.md)). They run without a key, without models and without Electron, against "fakes" that speak the same protocols: 344 checks today, plus 1 skipped where `onnxruntime-node` can't be installed. `npm test`, at the root, runs them all. On GitHub, they run on every push to `main`.

---

## 7. Troubleshooting

| symptom | what to check |
|---|---|
| the op is red: "Gemini refused the session" | the key is wrong or the model is not available for this account |
| the op gets no token | is the token server running? Did Chrome get permission to access the "local network"? Is the page's address in `ALLOWED_ORIGINS`? |
| the agent cuts itself off | echo: headphones, or untick `Listen while speaking` |
| the agent cuts in too early | increase `End silence (ms)`, set `End sensitivity` to low (with Gemini, then `Start`) |
| the agent doesn't react to a quiet voice | `Start sensitivity` on high; check the mic chosen by the system |
| no sound | click once in the page (browsers block sound before a click); check `Volume` and `Play through speakers` |
| Voice Lab: loading stuck at 0% | the network blocks peer to peer: see "Downloading the models" in the Voice Lab README |
| Voice Lab: Vulkan error (Windows) | update the graphics driver |
| Voice Lab: no mic (Mac) | System Settings → Privacy & Security → Microphone → allow "Voice Lab" |
| cables can't reach the local engine | is the app open? Is the address the one from the menu **Engine → Copy address for cables.gl**? |
| Voice Lab: "Smart Turn is unavailable here: using silence only." | the optional `onnxruntime-node` is missing or did not load. Run `npm install` again in `2_qvac_local`, then `npm run selftest` (⚠ on "end of turn: Smart Turn" means it is still missing). Meanwhile, turns end on silence. |
| Voice Lab: "Parler only speaks English: replies will sound English-accented." | Parler is English only: set the language to English, or use Supertonic or Chatterbox |
| Voice Lab: nothing is said for a long time after choosing Parler or Chatterbox | the first use downloads the voice (about 1.16 GB for Parler, 345 MB + 788 MB for Chatterbox): watch the banner. Do it once, on a good network. |
| the agent stops for a "mm-hm" (local) | `Interrupt after (ms) (local)` is 0, so it stops at once: try 600 |
| no filler is heard | Gemini ignores fillers. Locally: check `Filler lines (local)` and `Filler after (ms) (local)`; a quick reply comes before the filler; the very first one can be skipped while it is prepared |
| understanding a Voice Lab error | **Files → Server log** |

---

## 8. Known limits, and what remains to be checked

- **Not yet tried for real:** the real Gemini API (no key in the build environment), the real QVAC models and the Electron packaging (QVAC and Electron could not be installed there). Everything else is checked by the automated tests, against faithful imitations of the protocols. The [human test protocol](HUMAN_TESTS.md) starts with exactly that.
- **Gemini 3.8 Live** picks its language on its own, has only predefined voices and no "affective dialog". Sessions last 15 minutes at most (the op reconnects on its own).
- **Local engine:** no echo cancellation, small models (less refined replies, weaker in languages other than English, choice tags sometimes forgotten), latency that depends a lot on the machine.
- **Not yet tried for real, among the borrowed features:** `onnxruntime-node` inside Electron 42, and the Smart Turn model inside the installers (only the Python check has run the real model); the real Parler and Chatterbox voices in QVAC (a fake SDK checks the calls against QVAC 0.21's docs); Smart Turn's accuracy on real speech, and its timing with QVAC's speech detector; what real Whisper writes for a short "mm-hm"; echo with speakers while the voice dips; how fast fillers get prepared, since QVAC makes one synthesis at a time; how real Gemini answers the reprompt instruction. Tests A12, B5, B6, D5, E6 to E8, F6 and I8 of the [human test protocol](HUMAN_TESTS.md) check them.
- **Local voices:** Supertonic, the default, was archived by its makers in September 2026: it keeps working, but there will be no new voices. Parler only speaks English. Chatterbox has no Japanese or Chinese here.
- **QVAC changes fast:** four releases with breaking changes in six weeks (August to October 2026). The app is pinned to 0.21.0.
- **Unsigned apps:** Windows and macOS warnings on first launch.

## 9. Data and privacy

- With **Gemini**, the students' voices go to Google. On the free tier, Google may use them to improve its models, and people may review them. For classroom use: a paid project, or a clear rule about what is said to the agent.
- The **Gemini key** is never saved in the patch. With the token server, it never leaves the teacher's computer.
- With the **Voice Lab**, nothing leaves the computer (except the model downloads: at first launch, and the first time you choose Parler or Chatterbox). The mic is only granted to the app's page.
- In both cases, the mic only opens with **Start** and closes with **Stop**.
- **Voice cloning** (Chatterbox): a voice recording is personal data. Only with the clear, written consent of the person, for the exercise only, and delete the recording afterwards. The cloned voice carries a watermark, but that does not make it harmless.
