# Changing an ArtLux scene by voice

Say "show me the forest" and ArtLux switches to its **Grove** scene. The VIK agent decides which scene was asked for. A small script turns that decision into an OSC message for ArtLux.

| File | What it is |
|---|---|
| `artlux-scenes.vik.json` | the agent **ArtLux scenes**: a **Scenes** table (one row per ArtLux scene, with the other words for it) and one pattern, "the person mentions a scene", which sends the signal `artlux-scene` with the scene's name |
| `vik-to-artlux.mjs` | the bridge: it follows the studio like any client, and turns each `artlux-scene` signal into `/artlux/scene/recall <name>` for ArtLux. It needs Node 22 or later, and no install |

```
you speak ─► VIK studio ─► signal artlux-scene "Grove" ─► vik-to-artlux.mjs ─► OSC /artlux/scene/recall "Grove" ─► ArtLux
```

## Run it

**1. ArtLux.** Open **Preferences ▸ OSC / Tracking**. Turn **OSC receive** on, with **Listen port** `10000`. Then **File ▸ Open…** the project `examples/state-machine/03-interactive-installation.artlux` from the ArtLux folder. Its scenes are **Attract**, **Ember**, **Tide**, **Grove** and **Blackout**.

**2. VIK.** In the studio, choose **Manage ▸ Import a file…** and pick `artlux-scenes.vik.json`. The agent **ArtLux scenes** opens.

**3. The bridge.** In a terminal, from this repository's folder:

```bash
node examples/artlux/vik-to-artlux.mjs
```

It should print `Following VIK…`. You can start it before VIK: it waits.

**4. Talk.** Click **Start** in VIK and say a scene:

| You say | ArtLux shows |
|---|---|
| "show me the forest", "the trees", "la forêt" | Grove |
| "the fire please", "flames", "le feu" | Ember |
| "I want to see the sea", "waves", "la mer" | Tide |
| "lights out", "darkness", "noir" | Blackout |
| "go back to the start" | Attract |

The terminal prints each message it sends: `/artlux/scene/recall "Grove"`. In VIK, **Why** shows which scene was found, and how sure the agent was. You can also type a sentence instead of speaking.

## Your own show

Open the agent's **Knowledge ▸ Scenes** table, and give it one row per scene of your ArtLux project:

- the **first cell** is the scene's name, written exactly as in ArtLux. Then come the other words for it, separated by `|`: `Grove | forest | trees | forêt`;
- the **looks like** column describes the scene. It helps the agent when someone describes the scene instead of naming it.

ArtLux finds a scene by its name or its id. Its state machine doesn't stop a recall: in this example it stays in **Attract**, and the scene asked for stays on until the next one.

Options for the bridge: `--host 192.168.0.10` sends to ArtLux on another computer, and `--port 10001` sends to another listen port. `--vik ws://192.168.0.20:8790/events` follows a VIK studio on another computer.

## When nothing happens

- **The terminal prints nothing when you speak.** The pattern didn't fire. Check in **Why** what the agent decided. The agent must be **ArtLux scenes**.
- **The terminal prints `/artlux/scene/recall` but ArtLux doesn't move.** Check that OSC receive is on, on port 10000. The name must match a scene of the open project. ArtLux's log shows `[osc] listening on …` when it listens.
- **"The studio window is closed".** The bridge is connected, but nothing happens until the VIK window is open.
