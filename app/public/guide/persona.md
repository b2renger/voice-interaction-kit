# Persona

The persona is who the agent is: its name, its language, what it says first, and a text that the language model reads before every reply. Open it in [Persona](view:persona).

## The fields

| field | what it does |
|---|---|
| **Name** | the name the agent gives itself: "Your name is Lou." |
| **Title in the list** | how the agent appears in the list at the top. It can differ from the name: the title "Café", the name "Lou" |
| **Language** | the language it speaks and hears, and the one you write it in: persona, knowledge, lines to say. Each conversation starts in it (see [Another language](#another-language)) |
| **Greeting** | what it says first, when you click **Start**. Empty: it waits to be spoken to. A pattern "when the conversation starts" replaces it |
| **Persona** | the character sheet, in markdown |

## Another language

A conversation stays in one language. It changes only when someone asks:

- in [Talk](view:talk), the language switch next to **Send a signal…**, during a conversation;
- a pattern's action **Change language**, so that a sentence switches it ("can we speak English?"), see [Interactions](interactions.md);
- a client's `language` command (a language button in an installation, see [Clients](clients.md)).

Hearing and the voice reload, which takes a few seconds. The language model then answers in the new language, and the lines you wrote are translated by it: write them in the agent's **Language**, never in another one, or they are said as written. The next conversation starts again in the agent's language.

## Writing the persona

Write it in the second person, like a character sheet:

```
You are Lou. You serve at a small café near the station.
You are warm and brief. You love the cakes, and you say so.
When you don't know something, you say it simply and offer
what you do know.
```

Say who they are, where they are, what they care about, how they speak, and what they do when they don't know. Short sentences work best: the agent speaks, it doesn't write essays.

You don't need to put the facts in the persona: prices, opening hours and lists belong in [Knowledge](knowledge.md), where the agent looks them up for each sentence.

## The options

- **Short answers, one question at a time.** Almost always better when spoken.
- **Can show choices and a mood by itself.** The language model can then add buttons to the screen and set a mood. Patterns can do it too, see [Interactions](interactions.md).
- **Creativity.** Low: predictable and steady. High: surprising, sometimes off topic.

## What the model reads

**What the model reads**, on the right, shows the whole text the language model gets: your persona, plus the rules VIK adds so that replies sound right when spoken. For each reply, it also gets the entries of the knowledge it found, and the instruction of the pattern that fired.

> **Gemini Live** reads the persona too, with the knowledge added to it. See [Models and engines](models.md#gemini-live).
