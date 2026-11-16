# Changing an ArtLux scene by voice

Say "show me the forest" and ArtLux switches to its **Grove** scene. The VIK agent decides which scene was asked for, and its pattern sends ArtLux an OSC message. Nothing else to run.

**The full tutorial, with the ArtLux project, is in ArtLux's repository: [examples/vik-voice](https://github.com/urbandronedesign/artlux/tree/main/examples/vik-voice)** (scenes by voice, then the show machine by voice, with one OSC address per state: `/vik/{scene}`).

`artlux-scenes.vik.json` is the agent **ArtLux scenes**: a **Scenes** table (one row per ArtLux scene, with the other words for it) and one pattern:

> **When** the person mentions an entry of **Scenes** → **Send OSC** `/artlux/scene/recall` with the value `{scene}`, then **Say** "Here is {scene}."

## Run it

**1. ArtLux.** Open **Preferences ▸ OSC / Tracking**. Turn **OSC receive** on, with **Listen port** `10000`. Then **File ▸ Open…** the project `examples/vik-voice/vik-voice.artlux` from the ArtLux folder. Its scenes are **Attract**, **Ember**, **Tide**, **Grove** and **Blackout**.

**2. VIK** (3.3 or later). Choose **Manage ▸ Import a file…** and pick `artlux-scenes.vik.json`. In **Settings ▸ OSC**, **Send to** is `127.0.0.1:10000` (ArtLux on this computer).

**3. Talk.** Click **Start** and say a scene:

| You say | ArtLux shows |
|---|---|
| "show me the forest", "the trees", "la forêt" | Grove |
| "the fire please", "flames", "le feu" | Ember |
| "I want to see the sea", "waves", "la mer" | Tide |
| "lights out", "darkness", "noir" | Blackout |
| "go back to the start" | Attract |

In **Talk**, "Why it answered" shows the scene found and the message sent: `OSC to 127.0.0.1:10000: /artlux/scene/recall Grove.` You can type a sentence instead of speaking.

## Your own show

- **Your scenes:** in **Knowledge ▸ Scenes**, one row per scene of your ArtLux project. The **first cell** is the scene's name, written exactly as in ArtLux, then the other words for it, separated by `|`: `Grove | forest | trees | forêt`. The **looks like** column helps when someone describes the scene instead of naming it.
- **Other messages:** in **Interactions**, add **Send OSC** to any pattern. Its **When** says what triggers it: a sentence, an entry mentioned, a client's signal, the start of the conversation. ArtLux also understands `/artlux/cue/fire <cue>` and `/artlux/state/trigger <transition>` (its docs/OSC.md).
- **Another computer, or several:** in **Settings ▸ OSC**, **Send to** takes several `address:port`, separated by commas.

ArtLux finds a scene by its name or its id. Its state machine doesn't stop a recall: in this example it stays in **Attract**, and the scene asked for stays on until the next one.

## When nothing happens

- **"Why it answered" shows no OSC line.** The pattern didn't fire: check which pattern was chosen, and that the agent is **ArtLux scenes**.
- **"OSC … not sent: no address in Settings".** Fill **Settings ▸ OSC ▸ Send to**.
- **The OSC line is there, but ArtLux doesn't move.** Check that OSC receive is on, on the same port, and that the name matches a scene of the open project.
