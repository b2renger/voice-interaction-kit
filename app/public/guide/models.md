# Models and engines

The models are this computer's choice, in [Settings](view:settings): they never travel with an agent. A model that isn't on the computer downloads the first time you choose it, with a progress bar, then stays.

## What runs where

| role | model, by default | size |
|---|---|---|
| hearing | Whisper small | 264 MB |
| deciding | EmbeddingGemma 300M | 330 MB |
| writing a reply | Qwen3 1.7B, or a farm, or a service | 1.06 GB |
| speaking | Supertonic | 127 MB |

**Download everything once** (the menu **Files → Download all models**): afterwards the studio works without the internet.

## Speech recognition

**Settings → Hearing and deciding → Speech recognition.** Whisper tiny and base are faster and make more mistakes; Whisper large v3 turbo is the most accurate, and slow without a graphics card.

## The language model

**Settings → Language model** chooses who writes the replies that a pattern hands over (an **Answer**), and the free answers. A line said as written (a **Say**) never needs one.

- **On this computer**: a QVAC model, private and offline. A bigger model writes better replies but answers later: compare the felt wait.
- **An LLM farm**: a bigger model on another computer of the room (LlmOnLan). The farms the studio hears are listed: choose one. Not listed? Type the farm computer's address and click **Add**. On the farm computer, **Share compute** must be on.
- **A service**: Ollama or LM Studio on this computer, or OpenAI, Gemini, Mistral or OpenRouter online, with a key from their website. Choose it in the list, type the key, then **List its models** and pick one.

Hearing, deciding and speaking always stay on this computer. With a farm or a service, the persona, the knowledge found and the conversation go there as text (never the sound). With an online service, they go to that company, under its terms.

## Gemini Live

**Settings → Engine → Gemini Live, online.** Gemini then hears, decides and speaks by itself, at Google, with the persona and the knowledge in its prompt. The patterns don't apply: Gemini improvises. Comparing a designed agent with an improvising one is a good exercise.

It needs an API key (from aistudio.google.com) or a token server set up by your teacher. The key stays on this computer.

> **Data:** on Gemini's free tier, Google may use the conversations to improve its models. Agree on a clear rule about what is said.

## The simulated engine

The menu **Engine → Simulated** restarts the studio without any model: it hears a voice-like noise, replies with a short script, and speaks with a hum. The patterns still decide, with the words matcher. Useful to design an interface right away, or on a computer that is too weak.
