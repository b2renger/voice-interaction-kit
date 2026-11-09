# Files and sharing

An agent is a folder of plain files. You can open them with any text editor or spreadsheet, share them, and keep them in git.

```
cafe/
  persona.md          the persona, with its settings at the top
  knowledge/
    menu.csv          the tables, one CSV file each
  interactions.json   the stages and the patterns
```

## Where they are

In the studio's settings folder: the menu **Files → Open agents folder**. A file changed there by hand shows up when you come back to the studio's window.

## The Manage menu

Next to the agent's name, at the top:

- **New agent…** makes an empty one.
- **Duplicate** makes a copy you can change freely: a good start from an example.
- **Export to a file** makes one `.vik.json` file with the persona, the knowledge and the interactions.
- **Import a file…** opens such a file, on another computer for instance.
- **Add the example agents** brings back the museum guide, the station kiosk, the chef and the gardener.
- **Delete this agent…** moves its folder to the agents' trash folder, from where it can be put back by hand.

## What never travels

An agent never carries this computer's settings: no engine, no language model, no address, no key. An agent from someone else cannot send the conversation elsewhere, and exporting yours never shares your keys.

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
