# Getting started

VIK is a studio for building agents you talk to. You write who the agent is, what it knows and how it decides; then you talk to it, and you see why it answered the way it did.

Everything runs on this computer: it hears you, decides and speaks with open models, without a key and without the internet (once the models are downloaded).

## How an agent works

Every time you finish a sentence, the agent goes through four steps:

1. **It hears.** A speech recognition model (Whisper) turns your voice into text.
2. **It decides.** A small decision model compares the sentence with the agent's *patterns* and its *knowledge*, and picks what to do. This is the part you design.
3. **It replies.** Either a line you wrote, said as written, or a reply written by a language model, with what the agent knows.
4. **It speaks.** A voice model reads the reply aloud.

The decision happens before any language model writes a word. That's what makes an agent reliable: a price, a time or a platform number is said exactly as you wrote it.

## Your first conversation

1. Pick an example agent at the top, for instance the **Museum guide**.
2. On first launch, wait until the banner says **The models are ready**.
3. Click **Start**, and talk. Or type in **Type instead of speaking**.
4. Watch **Why it answered**, on the right of [Talk](view:talk): for each sentence, the pattern that fired, how sure the agent was, and what came close.

> **No microphone, or no models yet?** Type your sentences instead. And the menu **Engine → Simulated** runs the studio without any model: the patterns still decide, and a little script replies.

## Build your own

The quickest way in is the tutorial: in about ten minutes, you build a café agent that answers questions about its menu.

[Start the tutorial: build your first agent](tour:first-agent)

## The views

| view | what you do there |
|---|---|
| [Talk](view:talk) | talk to the agent, and see why it answered |
| [Persona](view:persona) | who it is and how it speaks |
| [Knowledge](view:knowledge) | what it knows: tables, like a spreadsheet |
| [Interactions](view:interactions) | how it decides: stages and patterns |
| [Voice & timing](view:voice) | how it sounds, and when it takes its turn |
| [Settings](view:settings) | this computer's settings: the engine and the models |

Everything is saved as you type. **Start** and **Stop** stay at the top, so you can talk to the agent while you change it.

The **Manage** menu, next to the agent's name, creates, duplicates, exports, imports and deletes agents. See [Files and sharing](files.md).
