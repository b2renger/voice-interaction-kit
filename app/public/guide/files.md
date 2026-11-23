# Files and sharing

An agent is a project: a folder of plain files that holds everything it needs to behave the same on another computer. You can open them with any text editor or spreadsheet, share them, and keep them in git.

```
cafe/
  persona.md          the persona, with its settings at the top
  knowledge/
    menu.csv          the tables, one CSV file each
  interactions.json   the stages and the patterns
  voices.json         its saved voices
  voices/lea.wav      a voice recorded for cloning (Chatterbox)
  people.json         the people it recognizes by their voice (their voiceprints)
```

## Where they are

In the **VIK folder**: by default the studio's settings folder, or the folder chosen in [Settings](view:settings) → **VIK folder** (with the people recorded and the downloaded models; **Move…** takes them all to another folder or drive). The menu **Files → Open agents folder** opens it. A file changed there by hand shows up when you come back to the studio's window.

## The Manage menu

Next to the agent's name, at the top:

- **New agent…** makes an empty one.
- **Duplicate** makes a copy you can change freely: a good start from an example.
- **Export to a file** makes one `.vik.json` file with the persona and its settings, the knowledge, the interactions and the saved voices. When the agent has people or recorded voices, it asks whether to include them: they identify real people, share them only with their consent.
- **Import a file…** opens such a file, on another computer for instance.
- **Add the example agents** brings back the museum guide, the station kiosk, the chef and the gardener.
- **Delete this agent…** moves its folder to the agents' trash folder, from where it can be put back by hand.

## What an agent carries

Everything that makes it behave the same elsewhere: its persona, knowledge, interactions and voices, and its settings ([Settings](view:settings)): the engine and the models, the language model or the farm it uses, its OSC destinations and port, the microphone's gain and gate, whether clients may start it, and its people (in an export, only if you say so).

**Never:** keys and passwords (a service's key, Gemini's key), which stay on each computer: type them again there.

**Importing someone else's agent:** when its settings send things elsewhere (its conversation to Gemini, its replies written by a farm or a service on another computer, OSC to another computer, a port listening to the network, clients allowed to open the microphone), VIK lists them and asks. **Cancel** turns them off: the agent then uses VIK's own language model on this computer, sends no OSC there, listens to none, and only this window starts a conversation.

An agent made before 3.8 gets the settings last used on this computer the first time it is opened.

## persona.md

The settings sit between two `---` lines at the top, one `key: value` per line; the persona's text follows.

```
---
name: Lou
title: Café
language: en
greeting: Hi! What can I get you?
---

You are Lou. You serve at a small café near the station.
```

## The tables

Each table is a CSV file in `knowledge/`: the first line holds the column names, the first column the entries' names. Edit them in a spreadsheet, and save as CSV.
