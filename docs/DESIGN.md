# VIK: how it is built

**VIK, the Voice Interaction Kit**, is a kit for designing agents you talk to: a desktop app (the VIK studio), its clients (a cables.gl op, p5.js and HTML examples), and this documentation. This file describes the architecture and the file formats. It is the reference for anyone who changes the code or writes agent files by hand.

## 1. The pipeline

```
 microphone ─► HEAR ──────────► DECIDE ─────────────────────► REPLY ───────────────► SPEAK ─► speakers
              Whisper           the decision model             a fixed line,          the local voice
              (local)           (local, always):               or a language model:   (Supertonic,
                                patterns, stages,              QVAC on this computer,  Parler,
                                knowledge                      an LLM farm, or any     Chatterbox)
                                                               OpenAI-compatible
                                                               service
```

- **Hearing, deciding and speaking always run on the computer.** Only the replies that a pattern hands to a language model (and the free answers) can go to another computer: an LLM farm on the local network, or an online service, if the person running the studio chooses one.
- **Gemini Live** stays available as a separate, all-online mode: Gemini hears, decides and speaks by itself. It gets the persona and the knowledge in its prompt, but not the patterns. It is there to compare: a cloud agent next to a designed one.

## 2. Agents

An **agent** is everything a designer makes: who it is, what it knows, how it decides. Each agent is a folder:

```
agents/
  museum-guide/
    persona.md            who it is, how it speaks, its voice and its timing
    knowledge/
      artworks.csv        what it knows, one table per kind of thing
      artists.csv
    interactions.json     its stages and patterns: how it decides
```

The studio edits these files and saves them as you type. They stay readable, so they can also be written by hand, shared, or kept in git. **Export** packs an agent into one `.vik.json` file, and **Import** unpacks it (the studio also imports the persona JSON files of earlier versions).

Where the folder lives: in the app's settings folder (`%APPDATA%\VIK\agents` on Windows, `~/Library/Application Support/VIK/agents` on a Mac). On first launch, the example agents of `app/agents/` are copied there, so they can be edited.

### 2.1 `persona.md`

Markdown, with a block of settings at the top (the "front matter"):

```markdown
---
name: Ada
title: Museum guide
language: en
greeting: Hello, welcome to the museum!
localVoice: F3
endSilenceMs: 900
fillerLines: Hmm, let me see…|Good question…
---

You are Ada, a curious, warm guide at the great gallery.
You help visitors discover the artworks, and you ask what interests them.

## How you speak
Short sentences. One question at a time.
```

- **The body** is the persona: the text the language model reads before every reply. Markdown headings and paragraphs are fine.
- **The front matter** holds one `key: value` per line. The keys are the settings of [`CONTRACT.md`](../CONTRACT.md) ("The settings"): voice, turn-taking, feedback. A value is text, a number, or `true`/`false`. Only the keys that differ from the defaults are written. `title` is the agent's name in the studio's list.

### 2.2 Knowledge: `knowledge/*.csv`

One CSV file per table (comma or semicolon separated, UTF-8, quotes as in a spreadsheet). The first line names the columns. **The first column is each entry's name**: it is what a person says to mention the entry ("the Water Lilies", "the 10:42 to Lyon").

```csv
name,artist,year,room,description
Water Lilies,Claude Monet,1916,3,"A pond seen from above, with no horizon."
The Raft of the Medusa,Théodore Géricault,1819,1,Survivors of a shipwreck on a makeshift raft.
```

**Other names.** The first cell can give several names, separated by `|`: `Water Lilies | Nymphéas`. The entry is found by any of them (useful when people speak another language than the table), and shown by the first. A leading article need not be said: "du Penseur" names `Le Penseur`.

**Links.** A cell that holds a name of an entry of another table links the two: above, `Claude Monet` links to the row `Claude Monet` of `artists.csv`. When an entry is used, its linked entries come with it (one step). This makes the tables a light graph, without a graph editor.

### 2.3 Interactions: `interactions.json`

```json
{
  "version": 1,
  "start": "welcome",
  "stages": [
    { "id": "welcome", "name": "Welcome" },
    { "id": "tour", "name": "Tour" }
  ],
  "confidence": 0.5,
  "patterns": [
    {
      "id": "hours",
      "name": "Opening hours",
      "stage": "",
      "when": { "kind": "says", "examples": ["when do you open", "what time do you close"] },
      "then": [{ "do": "say", "text": "We are open every day from ten to six." }]
    },
    {
      "id": "artwork",
      "name": "An artwork",
      "stage": "tour",
      "when": { "kind": "mentions", "table": "artworks" },
      "then": [
        { "do": "answer", "instruction": "Describe it in two sentences, then ask what they see." },
        { "do": "signal", "name": "show-artwork", "value": "{name}" }
      ]
    }
  ]
}
```

**Stages** make a small state machine: the agent is in one stage at a time (`start` is the first). A pattern with a `stage` only applies in that stage; `""` means every stage. The `go` action moves to another stage.

**When** (one per pattern):

| `kind` | fires when | fields |
|---|---|---|
| `says` | the person says something close to one of the examples | `examples`: phrases |
| `mentions` | the person mentions an entry of a table | `table` |
| `start` | the conversation starts (instead of the greeting) | — |
| `signal` | a client sends this signal (a sensor, a button in cables or p5.js) | `name` |
| `otherwise` | nothing else fired, in this stage | — |

**Then** (a list of actions, run in order):

| `do` | what it does | fields |
|---|---|---|
| `say` | says this line as written. Several lines separated by `\|`: one is picked at random | `text` |
| `answer` | the language model writes the reply, following the instruction, with the entry found (and its links) | `instruction` |
| `choices` | shows choice buttons | `question`, `options` (separated by `\|`) |
| `mood` | sets the agent's mood | `mood` |
| `signal` | sends a signal to the clients (cables, p5.js, pages) | `name`, `value` |
| `go` | moves to another stage | `stage` |

**Placeholders.** In `text`, `question`, `options` and `value`, `{column}` is replaced by that column of the entry found (or of the entry in focus): `{name}`, `{artist}`, `{year}`. `{said}` is what the person said.

## 3. The decision model

Every time the person finishes speaking (or types, or picks a choice), the agent decides **before** any language model runs:

1. **Score the patterns of the current stage.** A `says` pattern scores the similarity between the sentence and its closest example (an example said exactly scores 1). A `mentions` pattern scores the best entry of its table: the sentence against the entry's names, and against its whole row. A name said word for word scores at least 0.95. Without a name said, an entry that hardly beats the next one in its table ("who painted it?" fits every painting) is doubtful: its score shrinks with its lead (less than 0.15 ahead: proportionally less).
2. **The best score at or above the confidence wins** (`confidence`, 0 to 1: how sure the agent must be; 0.5 by default), and its actions run. Otherwise the stage's `otherwise` pattern runs, if there is one.
3. **Otherwise, a free answer:** the language model replies with the persona, and the knowledge entries closest to the sentence (at most three, plus the entry in focus, plus their links).

**The entry in focus.** The last entry found stays in focus, so that "who painted it?" after "tell me about the Water Lilies" is answered from the right row.

**A choice button** arrives as `(The user chose: "Paintings")`: the decision is made on the option itself.

**The matcher.** Similarity is the cosine between two embeddings, mapped to a 0–1 score. The studio uses:

- **EmbeddingGemma 300M** (Google, multilingual, 330 MB from Hugging Face, through QVAC) when it is loaded. Sentences and entries get the prompts the model was trained with (`task: sentence similarity | query: …`, `task: search result | query: …`, `title: … | text: …`). Its raw cosines do not start at 0: measured with QVAC 0.21, two sentences that mean the same score 0.79–0.97 and two unrelated ones 0.43–0.65; a sentence against the row it means 0.53–0.66, against another row 0.24–0.43. So a score is the cosine rescaled from [0.55, 0.95] for two sentences and from [0.35, 0.70] for a sentence against a row (`models.decide.calibration` in `config.json`). It understands paraphrases ("I need a taxi" → the taxis entry) and other languages (French sentences against English patterns and tables score 0.7–0.95). The model takes one job at a time: the studio sends its requests one after the other.
- **Words** otherwise: a vector of the words (plurals made singular, common English and French words left out) and of their letter trigrams. It needs no model and gives the same result every time; it is what the simulated engine and the tests use. It only matches close wordings.

The studio says which one decided. Embeddings of the examples and entries are computed when the agent is first used (about 10–20 ms per text with EmbeddingGemma, after a first batch that warms the model up), then kept in memory; a decision then takes about 20 ms. **Write examples as whole sentences:** one word ("paintings") matches too many things ("who painted it?").

**Explaining a decision.** Each decision is an event (`decision`) with the sentence, the stage, the pattern chosen (or none), its score, the entry found, and the next best candidates. The studio shows it in the conversation's trace, and the **Interactions** view has a test field: type a sentence, see what the agent would decide, and why.

## 4. Language models

The reply of an `answer` action, or a free answer, comes from one of:

| choice | where | settings |
|---|---|---|
| **On this computer** | a QVAC model (Qwen3 0.6B to 8B, Llama 3.2 1B), from `models.llm.choices` in `config.json` | `localLlm` |
| **LLM farm** | an [LlmOnLan](https://github.com/b2renger/LlmOnLan) farm on the local network, found by its beacon or its address | `llm: "farm"`, `llmUrl`, `llmModel`, `llmKey` |
| **A service** | any OpenAI-compatible address: Ollama, LM Studio, OpenAI, Gemini, Mistral, OpenRouter… | `llm: "service"`, `llmUrl`, `llmModel`, `llmKey` |

The farm and the services speak the same protocol (`POST <url>/chat/completions`, streamed). Their address, model and key are settings of this computer: they are never exported with an agent.

## 5. The studio

One window, a few views, saved as you type:

| view | what you edit |
|---|---|
| **Talk** | nothing: you talk with the agent, and read the trace of its decisions |
| **Persona** | the name, the language, the greeting, and the persona's text (markdown) |
| **Knowledge** | the tables: a spreadsheet, CSV import and export, and a search field to see what the agent finds |
| **Interactions** | the stages and the patterns (When → Then), and the test field |
| **Voice & timing** | the voice, turn-taking, feedback |
| **Settings** | the engine, the models, the language model, the clients' address |

The top bar holds the agent (and **Manage**: new, duplicate, export, import, delete, the examples), "Saved", the live state with the last words said, and **Start** / **Stop**: an agent can be tested from any view while it is being edited.

**The look.** One family, Schibsted Grotesk (bundled: the studio works offline); a cool studio grey; one pigment, ultramarine; and the colours of the conversation's states (listening ultramarine, hearing cerulean, thinking violet, speaking amber). The agent's presence in Talk is the one bold element: a body and rings that leave it with the voices, in the state's colour. Light and dark follow the system.

**Saving.** Each field is saved a moment after you stop typing (`persona.md`, the CSV of a table, `interactions.json`). When the window comes back to the front, the agent is read again from disk (a table edited in a spreadsheet), unless the studio still has edits of its own to save.

**This computer's settings** (the engine, the language model and its address and key, the models, the speakers) are kept in the window, never in an agent: the server drops them from any `persona.md` it reads, writes or imports, and the page ignores them in an agent. An agent from someone else cannot send the conversation elsewhere.

The server behind the window (`app/src/app-server.mjs`) serves the page and a small API (`app/src/api.mjs`): `GET/PUT/POST/DELETE /api/agents/…` (the files), `POST /api/decide` (the test field), `POST /api/llm/models` (a service's models), `GET /models` and `GET /farms`. The API only answers the studio's own page (`sec-fetch-site`, `origin`).

## 6. Protocol additions

On top of [`CONTRACT.md`](../CONTRACT.md):

- **Events:** `decision` (`text`, `stage`, `pattern`, `score`, `entry`, `candidates`, `matcher`), `stage` (`stage`, `from`), `signal` (`name`, `value`). They reach every client through the hub.
- **Command (clients → agent):** `signal` (`name`, `value`): fires the patterns `when.kind = "signal"`.
- **Settings:** `agent` (the agent's folder name), `llm`, `llmUrl`, `llmModel`, `llmKey`, `localAsr`, `localLlm`.

## 7. Not in this version

- A canvas to draw the stages (the Interactions view shows them as chips, and the patterns per stage).
- Patterns that remember an answer for later (slot filling), and `silence` patterns (the persona's reprompt line covers silence).
- The patterns with Gemini Live.
