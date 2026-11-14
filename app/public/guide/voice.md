# Voice and timing

How the agent sounds, when it takes its turn, and what it does while it thinks. These settings belong to the agent: a hurried kiosk and a patient guide differ in their silences as much as in their words. Open them in [Voice & timing](view:voice).

## The voice

| engine | the voice | good to know |
|---|---|---|
| **Supertonic** | ten preset voices (F1 to F5, M1 to M5), and a speed | fast, 31 languages |
| **Parler** | a voice you describe in words | English only; downloads about 1.2 GB on first use |
| **Chatterbox** | many languages, and it can clone a voice | downloads about 1.1 GB on first use; every output carries a watermark |
| **Zonos** | a voice you design with sliders: age, gender, pitch, texture, mood | many languages, French included; runs on the graphics card and downloads about 1 GB on first use, see below |

With Parler, write the voice like a persona: who speaks (pitch, pace, warmth) and how it is recorded. "A warm, low-pitched female voice, speaking slowly and clearly, very close to the microphone." The new description applies from the next sentence.

### Designing a voice with sliders (Zonos)

Zonos starts from one of its ready-made voices and lets you move it: older or younger, more masculine or feminine, deeper, raspier, softer, calmer, happier. No recording of anyone is needed. Each slider you move is written in **The voice, designed**, as a line such as `age +1.5, deep 3, gender -1`. That line is the design: it is saved with the agent, you can type it by hand, and it applies from the next sentence.

- Stay near the middle of a slider. The far ends can break the voice, or turn it into someone else.
- A slider at zero leaves the line. **Reset the design** empties it.
- Design a voice the way you write a persona: decide who speaks first, then move two or three sliders, and listen.

Zonos runs inside this window, on the computer's graphics card. The first time you choose it, its model is downloaded (about 1 GB) and kept on the computer: next to "Voice" you see "loading", then "ready". On a computer whose graphics card cannot run it, you see "cannot run here": the agent speaks with the default voice instead, and the conversation goes on. Keep this window open while Zonos speaks. Numbers and dates are read as written, so spell them out in fixed lines ("half past twelve", not "12:30"). More in the kit's `docs/ZONOS.md`.

> **Cloning a voice needs consent.** A voice identifies someone, like a face. Only clone a voice with the clear, written consent of the person, for this exercise only, and delete the recording afterwards.

### Saved voices: several voices for one agent

Under the voice, **Save this voice…** keeps the voice as it is set (its engine, its voice, its speed or its design) under a name: "the old sailor", "the child", "calm". The list holds the agent's saved voices, and those of the other agents on this computer.

- **Use** gives the agent the voice chosen in the list: it becomes its own voice.
- In a pattern, the action **Change voice** makes the agent answer in a saved voice from that reply on: a storyteller who becomes the wolf when you ask for the wolf, a guide who whispers in the last room. The change lasts until another pattern changes the voice again, or gives the agent "its own voice" back. A new conversation always starts in the agent's own voice.
- A voice of the same engine changes at once. A voice of another engine has to be loaded first ("Changing voice…"), which takes a moment: for a quick back-and-forth between characters, save voices of the same engine.

Saved voices belong to the agent: they are duplicated, exported and imported with it.

## Turn-taking: when have you finished?

The agent has to guess when you have finished speaking. Too early, and it cuts off someone who hesitates. Too late, and it seems slow.

- **End-of-turn silence**: the silence that ends a turn. 300 ms makes an impatient agent; 2,000 ms a patient but slow one.
- **End of turn**: silence only, or **silence and the Smart Turn model**, which also listens to how your sentence ends (its intonation). With Smart Turn, set the silence to 2,000 ms: the agent replies quickly to a finished sentence, and still waits during an "um…".
- **Start-of-speech** and **end-of-speech sensitivity**: how easily it hears that you started, and how quickly it decides you stopped.

## Interruptions

- **Can be interrupted**: talk over the agent to stop it.
- **Talk over it this long to interrupt**: at 0, any speech over the agent stops it. Above 0 (600 ms is a good start), its voice first dips: a "mm-hm" or a noise lets it carry on, "stop" or "wait" makes it stop and listen, anything longer interrupts it.
- **Listens while speaking**: untick it with speakers, or the agent hears itself and cuts itself off. Headphones are better.

## While it thinks

Between the end of your sentence and the agent's voice, there is always a wait, measured on every turn (the **felt wait**, in Talk).

- **Extra delay before replying** adds a wait on purpose, to design it.
- **Thinking sound** and **Interface sounds**: a tick or a hum while it thinks; small sounds when it hears you or shows choices.
- **Filler lines**: short phrases said if the reply is late ("Hmm, let me see…"), separated by `|`, after **Say a filler after**.

## Silence, and not understanding

- **Away after**: how long a silence before the agent considers you away. **Said once when the person stays silent**: "Are you still there?"
- **When nothing was understood**: what it says when it heard nothing useful.

The full workshop on these edge cases, with research and exercises, is in the [course guide](https://github.com/b2renger/voice-interaction-kit/blob/main/docs/GUIDE.md).
