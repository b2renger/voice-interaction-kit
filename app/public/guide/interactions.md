# Interactions

Interactions are how the agent decides what to do. They are **patterns**, "When … → Then …", grouped in **stages**. Open them in [Interactions](view:interactions).

## Patterns

A pattern says what the agent does when something happens: "When someone asks when we open, say our opening hours." Click **New pattern**, give it a name, then choose its **When** and its **Then**.

## When

| when | fires when | example |
|---|---|---|
| **the person says something like** | the sentence is close to one of your example sentences | "when do you open?", "what time do you close?" |
| **the person mentions an entry of** | the sentence names an entry of a table, or describes it | "tell me about the Water Lilies", "the train to Lyon" |
| **the conversation starts** | you click **Start** (it replaces the greeting) | |
| **a client sends the signal** | cables, p5.js or a page sends this signal | `visitor-near`, from a sensor |
| **nothing else fits, in this stage** | no other pattern of the stage is close enough | a line that brings people back on topic |

For **says**, write a few examples, each followed by Enter. **Write whole sentences, as people say them**: a single word matches too many things.

## Then

A pattern does one or more things, in order:

| then | what it does |
|---|---|
| **Say** | says a line, as written: exact and instant |
| **Answer** | the language model writes the reply, following your instruction ("in two sentences, then ask a question") |
| **Show choices** | buttons on the screen, with an optional question |
| **Set the mood** | a mood for the interface: happy, curious, sorry… |
| **Change voice** | from this reply on, the agent speaks with one of its saved voices (Voice & timing), or with its own again |
| **Send a signal** | a signal to cables, p5.js and pages: `show-artwork` with the value `{name}` |
| **Go to** | moves the conversation to another stage |

A **Say** line can be filled from the entry found: write the column names in braces. `A {name}? That's {description}, {price}.` If no column fills a placeholder, the editor says so under the line. `{said}` is what the person said. Several lines separated by `|`: one is picked at random.

Use **Say** for facts (a price, a time, a platform), and **Answer** for stories and explanations.

## Stages

The agent is in one stage at a time, and a pattern can belong to one stage (**Applies**) or to every stage. Stages make a conversation in steps: a welcome, then a tour, then a goodbye; or a recipe, step by step, where the same "next" moves to a different step each time.

- **Add a stage** makes one; click a stage's name to rename it.
- **Every conversation starts in** chooses the first stage.
- A **Go to** action moves to another stage. Put what opens the next stage in the same pattern, before it: **Say** "Now crack two eggs.", then **Go to** Eggs.
- A pattern "when the conversation starts" fires once, on **Start**, in the first stage.

## Confidence

**Confidence** is how close a sentence must be for a pattern to fire. Lower: patterns fire more often, sometimes wrongly. Higher: more is left to the language model. 50 % is a good start.

## Try a sentence

Type a sentence as a person would say it, in a given stage: you see which pattern would fire, its score, what it would do, and the runners-up. The pattern that would fire opens in the editor. This is the fastest way to improve an agent: try the sentences people will really say.

More on scores, and why a pattern does or doesn't fire, in [How it decides](decisions.md).
