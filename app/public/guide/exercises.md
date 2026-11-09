# Exercises

A few exercises to explore what makes a voice agent work. Each one takes from an hour to half a day. The [course guide](https://github.com/b2renger/voice-interaction-kit/blob/main/docs/GUIDE.md) has more, with the research behind them.

## The kiosk without a language model

Build a station kiosk from scratch: a departures table, patterns that only **say** lines filled from the rows (`{time}`, `{platform}`), and a **nothing else fits** pattern that brings people back on topic. Then turn the same patterns into **answers**, the language model's own words. Compare the felt wait, the mistakes and the tone.

*Deliverable:* where a designed line beats a generated one, and the other way round.

## From a spreadsheet

Take a real table (a café's menu, the school's rooms, a festival's programme), import it as CSV, link it to a second table, and write **mentions** patterns. Ask ten classmates to question the agent without seeing the table, and write down every sentence. Try each one in **Try a sentence**, and add examples, other names and fallbacks until most land right.

*Deliverable:* the sentences, what the agent decided, and what you changed.

## A conversation in stages

A recipe, a quiz, a guided tour: draw the stages on paper first, and what moves from one to the next. Then build it with stages and **Go to**. What happens when the person says something the current stage did not expect?

*Deliverable:* the drawing next to the patterns.

## The sensor and the screen

In cables or p5.js, a sensor sends the signal `visitor-near` and a pattern greets; the agent's patterns send `show-…` signals, and the screen follows. Who leads the interaction, the space or the voice?

*Deliverable:* a short video of the installation.

## The wait

Set **Extra delay before replying** to 0, then 1,000, then 3,000 ms. Design three ways to fill the wait: a visual, a sound, a filler line. Compare them with the felt wait. When does the wait start to feel awkward?

*Deliverable:* a design rule, with the numbers behind it.

## Designed or improvised

The same persona and knowledge twice: VIK with your patterns, then Gemini Live improvising. Ask both the same ten questions. Compare reliability (did it say the right price?), tone, wait, and what you could control.

*Deliverable:* a table, and a position: when should an agent be designed, and when can it improvise?

## Two languages

Your tables are in English, your visitors speak French (or the other way round). Try their sentences: the patterns' examples match across languages, the entries' names don't always. Add other names in the first cells and try again.

*Deliverable:* the sentences that failed, and why.
