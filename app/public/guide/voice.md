# Voice and timing

How the agent sounds, when it takes its turn, and what it does while it thinks. These settings belong to the agent: a hurried kiosk and a patient guide differ in their silences as much as in their words. Open them in [Voice & timing](view:voice).

## The voice

| engine | the voice | good to know |
|---|---|---|
| **Supertonic** | ten preset voices (F1 to F5, M1 to M5), and a speed | fast, 31 languages |
| **Parler** | a voice you describe in words | English only; downloads about 1.2 GB on first use |
| **Chatterbox** | many languages, and it can clone a voice | downloads about 1.1 GB on first use; every output carries a watermark |

With Parler, write the voice like a persona: who speaks (pitch, pace, warmth) and how it is recorded. "A warm, low-pitched female voice, speaking slowly and clearly, very close to the microphone." The new description applies from the next sentence.

> **Cloning a voice needs consent.** A voice identifies someone, like a face. Only clone a voice with the clear, written consent of the person, for this exercise only, and delete the recording afterwards.

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
