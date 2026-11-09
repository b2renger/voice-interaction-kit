# How it decides

Before any language model writes a word, the agent decides what to do with the sentence. This page explains how, so that you can design patterns that fire when you want them to.

## The decision model

The decision model is **EmbeddingGemma**, a small model (330 MB) that turns a sentence into numbers that can be compared. Two sentences that mean the same thing get close numbers, even with different words: "I need a taxi" is close to "where can I get a cab?". It works across languages: a French sentence finds an English pattern.

A decision takes about 20 milliseconds, on this computer.

Until EmbeddingGemma is downloaded and loaded (and with the simulated engine), a simpler **words** matcher decides instead: it only finds close wordings, not meanings. [Settings](view:settings) shows which one is at work, under **Hearing and deciding**.

## In what order

For each sentence, in the current stage:

1. **Every pattern gets a score**, from 0 to 1. A **says** pattern: how close the sentence is to its closest example. A **mentions** pattern: how well the sentence matches the best entry of its table (a name said word for word scores at least 95 %).
2. **The best score at or above the confidence wins**: its actions run.
3. **Otherwise**, the stage's **nothing else fits** pattern runs, if there is one.
4. **Otherwise**, the language model answers freely, with what the agent knows.

A choice tapped on the screen is decided like a sentence: tapping "Painting" is like saying "Painting". A signal sent by a client fires the pattern made for that signal.

## The entry in focus

When a pattern finds an entry, it becomes the **entry in focus**. The next sentences are answered about it: "who painted it?", right after the Water Lilies, is answered about the Water Lilies.

A vague question that fits every entry equally ("who painted it?" fits every painting) is not taken as a mention of one of them: the language model answers it, with the entry in focus.

## Reading Why it answered

In [Talk](view:talk), **Why it answered** shows each turn:

- what you said, and the pattern that fired, with its score and the entry it found;
- the runners-up, with their scores: a pattern that came close to the winner;
- the stage reached and the signals sent;
- the felt wait, and how long the decision took.

**A free answer** means no pattern reached the confidence.

## Writing patterns that fire

- **Examples are whole sentences**, as people say them. A single word ("paintings") matches too many things.
- **Try the sentences people will really say**, in [Interactions](view:interactions), and watch the runners-up. Two patterns that come close need clearer examples.
- **A pattern never fires?** Its score is below the confidence: add examples closer to what people say, or lower the confidence. Check that it is on, and in the right stage.
- **A pattern fires when it shouldn't?** Its examples are too short or too vague: write whole sentences, or raise the confidence.
- **Other languages:** examples match across languages, but entry names need their other names in the first cell (`Water Lilies | Nymphéas`).
