# Human test protocol

The automated tests (more than 560 checks) prove that the code does what it says, against imitations of Gemini, QVAC, Electron and an LLM farm. They don't tell you whether **what I built matches what you want**. This protocol is for that: scenarios to play yourself, with a real voice, real machines and real students.

For each test: the **requirement** from your request that it checks, the **steps**, the **expected result**, and a **verdict** line to fill in:

- **pass**: it does what it should;
- **needs work**: it works, but not the way you want it to (say how);
- **fail**: it doesn't work, or it isn't what you wanted.

**Where things happen:** the VIK studio is the brain. It runs the conversation with either engine (**Settings → Engine**: VIK, on this computer, or Gemini Live), and it holds the mic, the speakers, the agent (persona, knowledge, interactions, voice and timing), this computer's settings, and the keys. The cables op and the examples in `examples/` are **clients**: they follow that conversation and send commands (Start, Stop, Interrupt, a text, context, a choice), but they never change a setting and never open the mic. So every setting named below is a field of the studio (or a key of the agent's `persona.md`), and "Start" means the studio's button or `Start` on a client.

**A rule to keep in mind with Gemini:** an open session does not pick up live changes to persona, voice, language, creativity, short answers, end silence, sensitivities or "Can be interrupted". The studio then shows "Setting changed: click Start…": you need to click Start after each change of this kind. With the local engine, everything applies live. A setting marked **(local)** only works with the local engine: Gemini ignores it.

The tests marked ★ make up the **quick run**, to do first: about 2¾ hours for all the ★ tests, Windows and Mac included (plus the 15–25 minutes GitHub takes to build the installers in A12).

---

## Equipment

- a **Windows PC** typical of the students' machines (ideally the least powerful one), and an **Apple Silicon Mac** (M1 or later);
- Chrome, a cables.gl account, a **Gemini key** ([aistudio.google.com/apikey](https://aistudio.google.com/apikey));
- to open the examples (`examples/`): VS Code with the **Live Server** extension, or **Node.js** (for `npx serve`, and for the token server in A4);
- a **headset** with a mic, and **speakers** (for the echo tests);
- the VIK installers: from a GitHub Release (see A12 and [`PUBLISHING.md`](../PUBLISHING.md)), or built with `npm run make`;
- a GitHub account, for A12;
- for B6 (optional): a short WAV recording of a volunteer who has agreed, in writing, to have their voice cloned;
- for the K tests: one or two student volunteers.

## What your request requires, and the tests that check it

| | requirement | tests |
|---|---|---|
| R1 | a **cables.gl node** for Gemini Live, added in a code box, **without modifying cables** | A1 to A4, A13 |
| R2 | a **local QVAC backend** as an **Electron app**, installable on **every computer** (Windows and Mac M1) | A5 to A12 |
| R3 | **set up the voice** | B1 to B6 |
| R4 | play with the agent's **personality** | C1 to C7 |
| R5 | handle the **end of turn** through design | D1 to D6, L1 |
| R6 | handle **interruption** through design | E1 to E8, L1 |
| R7 | handle **thinking** and **analysis** through design | F1 to F6 |
| R8 | **voice and/or graphic** user **feedback** | G1 to G5, D6 |
| R9 | **calls to action** | H1 to H8 |
| R10 | the **basic UX/UI vocabulary**, usable by designers, and edge cases that don't break everything | I1 to I10, J2, A13 |
| R11 | **switch between cloud and local** without redoing everything | A10, J1, L1 |
| R12 | a **teaching** tool, usable by design students | K1 to K3, A14 |
| N1 | the features **borrowed from open source** ([landscape](OPEN_SOURCE_LANDSCAPE.md)): Smart Turn, backchannels and stop phrases, spoken fillers, away and the reprompt, the Parler and Chatterbox voices | B5, B6, D5, D6, E6 to E8, F6, I8, L1 |
| N2 | installers published as a **GitHub Release**, built by GitHub Actions | A12 |
| R13 | the name of everything is **VIK, the Voice Interaction Kit** | S1, A6, A7 |
| R14 | an interface that is **minimal, slick and elegant**, not messy | S1, S10, G5 |
| R15 | a clear way to **input data**: personas in **markdown**, knowledge bases as **CSV** tables, and to **build interactions** | S2, S3, S7, S8, C5, C7 |
| R16 | a **local decision model**, and a clear way to edit the **decision patterns** related to the knowledge | S3 to S6 |
| R17 | **everything editable in the app**; replies written by **any language model** (local, an LLM farm, a service) | S2, S9 |
| R18 | a **built-in documentation** and an **interactive tutorial** | T1 to T4 |

N1 and N2 were not in your original request: they cover what was added since. R13 to R17 come from the VIK rework; R18 from the Guide and the tutorial.

---

## A. Getting set up

The op only follows the VIK app, so A1 to A4 need the app installed and open (A5 to A7, or `npm start` in `app`). If you start from scratch, do A5 to A7 first.

### A1 ★ The op installs in cables without touching cables (R1)
1. Open the VIK app and keep it open.
2. Open a patch of your own on cables.gl. Avatar → **Code a new op** → name `VoiceAgent` → **Create Op**.
3. Delete the code, paste all of `cables/VoiceAgent.op.js`, save. Accept if Chrome asks for access to the "local network".

**Expected:** the op appears in the patch, with no error. Its ports are sorted into groups (Connection, Actions, Advanced), with no settings ports: those are in the studio. `App connected` goes to 1, and `Agent name` shows the name set in the studio. Nothing else has been installed in cables.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A2 ★ First conversation with Gemini (R1)
1. In the studio: Engine = "Gemini Live (online)", paste the key into "Gemini API key".
2. On the op, click `Start`. Allow the mic if the system asks (headset on).
3. Say: "Hello, who are you?"

**Expected:** the op's `Engine` shows `gemini`. `State` goes through `connecting` → `listening` → `hearing` (during your sentence) → `thinking` → `speaking` → `listening`. The agent replies out loud, through the app, within one or two seconds. `User text` and `Agent text` show the conversation, like the subtitles in the studio.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A3 The key is never exported with an agent (R1)
1. After A2, in the studio: **Manage → Export to a file**. Open the `.vik.json` file in a text editor.
2. Quit the VIK, then open it again.
3. **Manage → Import a file…** on another computer.

**Expected:** 1. the file holds the persona, the knowledge and the interactions, but no key and no engine. 2. the key is still in **Settings → Gemini Live**: it is kept on this computer only. 3. the import brings no key: the other computer's settings stay as they were. The patch never holds the key either: the op has no key port.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A4 The token server, for a class (R1)
1. `cd cables/token-server`, copy `.env.example` to `.env`, put the key in it, then `node server.mjs`.
2. In the studio (Engine = Gemini Live): clear the key, and put `http://localhost:8787/token` in the token server field. `Start` on the op.
3. Stop the token server (`Ctrl+C`), then `Start` again.

**Expected:** step 2 works like A2. At step 3, the studio clearly says that the token server isn't responding ("The token server isn't responding (…). Is it running?"), and the op's `Error` says the same.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A5 ★ The QVAC self-test and building the installers (R2)
1. In `app`: `npm install`, then `npm run selftest`.
2. `npm run make` (on each platform), or let GitHub build the installers (A12).

**Expected:** the self-test shows ✔ for "loading the three models", "voice: say a sentence", "recognition: listen back to the sentence", "end of turn: Smart Turn", "model: reply", "voice: say the reply", then "✔ QVAC works on this machine." A ⚠ on "end of turn: Smart Turn" means `onnxruntime-node` is missing: the self-test still passes and turns end on silence, but note it. `out/make/` contains `VIK-Setup.exe` (Windows) or `VIK.dmg` (Mac), plus a `.zip`.

Write down the times shown by the self-test, you will need them in F4:

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A6 ★ Installing on a student's Windows PC (R2)
1. Run the installer: `VIK-Setup-<version>-windows-x64.exe` from the Releases page, or `VIK-Setup.exe` if you built it yourself. Get past the warning ("More info → Run anyway").
2. Wait for the model download to finish, then click **Start** and talk.

**Expected:** a "VIK" shortcut appears in the Start menu and on the desktop. The app opens, and no terminal window opens with it (3.0.0 opened an empty one for QVAC's worker). The window's banner shows the download percentage (and a bar moves along on the icon, in the taskbar), then "Models ready". The conversation works.

Machine (processor, memory, graphics card): ……… Download time: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A7 ★ Installing on an M1 Mac (R2)
1. Open the `.dmg`, drag the app into Applications, launch it.
2. Unblock it: **System Settings → Privacy & Security → Open Anyway** (or `xattr -cr` if macOS says it is "damaged").
3. Allow the mic, wait for "Models ready", **Start**, talk.

**Expected:** the README instructions are enough to unblock the app without help. macOS asks for the mic with the sentence "VIK listens to your voice…". The conversation works.

Machine (chip, memory): ……… Download time: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A8 Uninstalling on Windows (R2)
1. Settings → Apps → "VIK" → Uninstall.

**Expected:** the app and its shortcuts disappear. The models stay in `~/.qvac/models`, so you don't have to download them again.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A9 The simulated engine, without models (R2, R12)
1. In the VIK: menu **Engine → Simulated**.
2. **Start**, talk (say anything), then start a second conversation.

**Expected:** the app restarts with the "simulated engine". The agent "hears" when you talk, replies with pre-written sentences, offers choices and a mood, and speaks with a hum. The second conversation replays the same script. This is useful to design an interface without waiting for the models.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A10 ★ The cables op connected to the VIK (R2, R11)
1. VIK open, showing "Models ready", Engine = "Local (QVAC, on this machine)". Menu **Engine → Copy address for clients**.
2. On the op: check that `App address` is this address (`ws://localhost:8790/events`, its default), then `Start`.

**Expected:** the conversation works from cables, with the local voice. The same outputs move as with Gemini, and `Engine` shows `local`. The studio shows the same conversation (face, subtitles, "Events"): the op does not open a conversation of its own, it follows and drives the app's.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A11 The first download on the school network (R2)
1. Do the first launch from A6 or A7 on the school Wi-Fi.

**Expected:** the models download (peer to peer or through the HTTP fallback). If not, the README procedure (copy `~/.qvac/models` from one machine to another) can be done in class.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A12 ★ The installers from a GitHub Release (R2)
1. Put the kit on GitHub as [`PUBLISHING.md`](../PUBLISHING.md) explains (first commit, then push). In the **Actions** tab, check that the **Tests** workflow turns green.
2. Push a version tag: `git tag v1.0.0`, then `git push origin v1.0.0`. (To try without publishing: **Actions → Release → Run workflow**.)
3. When the **Release** workflow has finished, download `VIK-Setup-1.0.0-windows-x64.exe` and `VIK-1.0.0-mac-arm64.dmg` from the release page (or from "Artifacts" on the run page). Install them as in A6 (Windows PC) and A7 (M1 Mac).
4. In each installed app, set "End of turn" to "silence + Smart Turn model" and have a short conversation.

**Expected:** both workflows finish green, the Release one in about 15–25 minutes. The release page lists four files: the `.exe` and a `.zip` for Windows, the `.dmg` and a `.zip` for Mac. Both installers install and run as in A6 and A7. At step 4, the window never says "Smart Turn is unavailable here: using silence only.", and the "Events" log shows `turn.prediction` lines: the model and its runtime made it into the installer.

Time taken by the Release workflow: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A13 ★ Several clients follow one conversation (R1, R10)
1. VIK open, the op in a patch (A1). Open both examples in Chrome through a local web server, as [`examples/README.md`](../examples/README.md) explains: VS Code's Live Server, or `npx serve` in each example's folder.
2. Click **Start** on the HTML page, and talk. Watch the page, the sketch, the op and the studio side by side.
3. Ask for a long story, and cut it off with the op's `Interrupt`. Then click the sketch to stop.

**Expected:** 2. all four show the same state at the same moment (the orbs' colour, `State`), the same subtitles and the same levels (the sketch's orb and halo, the op's `Voice level` and `Mic level`). 3. a command from any client works: Start from the page, Interrupt from the op, Stop from the sketch. Only the app uses the mic and speaks: no page asks for the mic.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A14 The p5.js example in the p5.js web editor (R12)
1. VIK open. On [editor.p5js.org](https://editor.p5js.org/), replace the new sketch's code with all of `examples/p5js/sketch.js`, then Play. Accept if Chrome asks for access to the "local network".
2. Click the sketch, talk, then click it again.

**Expected:** with no server to install, the sketch connects: its top line shows the agent's name and state (for example "Ada · listening"). The orb's colour follows the state, its size the agent's voice, its halo your mic. The first click starts the conversation, the second one stops it.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## B. The voice (R3)

### B1 ★ Changing the Gemini voice
1. In the studio (Engine = Gemini Live), "Gemini voice": try three contrasting voices, `Puck`, `Charon` and `Sulafat`, with the same question.

**Expected:** each change shows in the studio "Setting changed: click Start to restart the session with this setting." After `Start`, the voice is different and its stated character (upbeat, informative, warm) can be heard.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B2 The speaking style (Gemini)
1. In the studio, "Speaking style (asked of the model)" = "very slow, whispering", then "energetic, like a radio host". Start each time.

**Expected:** you can hear the difference. The model interprets the instruction: note how far it follows it.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B3 ★ Local voice and speed
1. VIK: `Local voice` F1, then M3. `Speed` 0.8, then 1.4. Talk between each change, **without** clicking Start.

**Expected:** each change applies live, after one or two seconds of reloading. The conversation carries on.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B4 The volume
1. In the studio, move "Volume" while it is speaking.

**Expected:** the volume changes live. (The op no longer has audio outputs: the sound is the app's. To animate with the voice, use `Voice level`.)

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B5 A voice described in words (Parler)
1. VIK, `Language` = English. "Local voice engine" = "Parler (describe the voice in words, English)". The first time, wait for the download (about 1.16 GB).
2. "Voice description (Parler)" = "A warm, low-pitched female voice, speaking slowly and clearly, very close to the microphone." Talk.
3. **Without** clicking Start, change it to "A fast, high-pitched male voice, far from the microphone, in a large echoing hall." Talk again.
4. Set `Language` to French.

**Expected:** 1. the F/M voice picker and the Speed slider disappear, and the description field appears. 2. the voice roughly matches the description. 3. the voice changes from the next sentence, with no reloading and no restart. 4. the window warns "Parler only speaks English: replies will sound English-accented."

Which words of the description did Parler follow, and which did it ignore? ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B6 Chatterbox speaks French
1. "Local voice engine" = "Chatterbox (multilingual, can clone a voice)". The first time, wait for the download (about 345 MB + 788 MB).
2. `Language` = French, a persona written in French, **Start**, speak French. Try `Speed` 0.8, then 1.3.
3. Switch back to "Supertonic (fast, 10 preset voices)" and redo step 2.
4. (Optional, with written consent) Put the path of the volunteer's WAV in `config.json`, under `models.tts.chatterbox.referenceAudio`. Restart the app and talk.

**Expected:** 2. Chatterbox speaks French, with a French accent, and the speed changes. 3. Supertonic speaks French too (its 31 languages include French). 4. the voice gets closer to the recorded one. Delete the recording afterwards.

How close is the cloned voice (1–5)? ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## C. The personality (R4)

### C1 ★ Two opposite personas
1. Type into the studio's "Persona" field, in turn. Persona A: "You are a warm, curious museum guide, and you ask questions." Persona B: "You are a hurried, terse station agent, and you answer in one sentence."
2. With each one (Gemini: Start after changing the persona), ask: "What can I do here?"

**Expected:** two clearly different behaviors (tone, length, questions asked), with Gemini **and** with the local engine. Note the quality gap between the two engines.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C2 Creativity
1. Ask the same question three times with "Creativity" = 0, then 2, in the studio (Gemini: Start after the change).

**Expected:** at 0, similar, calm answers. At 2, more varied and more surprising answers.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C3 Short answers
1. Ask "Explain impressionism to me", with and then without "Short answers" ticked in the studio (Gemini: Start after the change).

**Expected:** with it, one to three sentences and one question at a time. Without it, a longer answer.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C4 ★ The agent speaks first
1. In the studio, "Greeting" = "Welcome to the garden!", Start.
2. Clear the greeting, Start.

**Expected:** 1. the agent opens the conversation (Gemini says it in its own words; the local engine says it as written). 2. it waits in silence to be spoken to.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C5 The example agents, and sharing
1. At the top of the studio, pick each of the four example agents in turn, and say hello.
2. **Manage → Duplicate** one, change its persona, then **Manage → Export to a file**, and **Import a file…** on another computer.

**Expected:** each agent changes the name, the persona, the voice, the greeting, the knowledge and the patterns. An exported file imports back identically (the copy's name ends with "(copy)", or a number if it exists).

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C6 Another language
1. In the studio, "Language" = French. Persona written in French, Start, speak French.

**Expected:** the conversation happens in French. (Gemini picks its language on its own: the persona helps.)

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C7 An agent that knows things (a table)
1. **Manage → New agent…** "My guide". In **Knowledge**, **New table** "Paintings", with the columns `name`, `artist`, `year`, `room`, and a row the model can't guess: "The blue painting", "Léa Marchand", "1974", "2".
2. Ask: "Who painted the blue painting?", then "Which room is it in?" With both engines.

**Expected:** the agent answers from the table (Léa Marchand, room 2), with both engines (the local engine looks the entry up for each sentence; Gemini gets the tables in its prompt). In **Talk → Why it answered**, the local engine's turn shows "A free answer", and the language model got the entry.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## D. The end of turn (R5)

### D1 ★ Impatient agent, patient agent
1. In the studio, "End-of-turn silence" = 300 ms (Gemini: Start after the change). Say, with a real one-second hesitation in the middle: "I'd like to… um… go and see room 2."
2. Same sentence with 2,000 ms (Gemini: Start again).

**Expected:** at 300 ms, the agent starts replying during the hesitation. At 2,000 ms, it waits for the end of the sentence, but it is slower to reply. The difference is clearly felt, with both engines.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### D2 The sensitivities
1. In the studio, "Start-of-speech sensitivity" high, then low (Gemini: Start after each change): whisper a sentence, cough, tap on the table.
2. "End-of-speech sensitivity" high, then low: talk with pauses.

**Expected:** on low, the whisper and the noise are ignored; on high, the whisper is heard. A cough or a short noise does not trigger a reply: the agent goes back to listening. With end on low, it waits to be sure before replying.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### D3 ★ The "I hear you" signal
1. In cables, connect `Hearing` to a color change, and `Mic level` to the size of a circle.

**Expected:** the circle follows your voice with no annoying lag. The color changes as soon as you start talking and goes back when you have finished.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### D4 Subtitles of what you say
1. Show `User text` in a text op, and talk.

**Expected:** the text appears during the sentence or just after, and matches what was said.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### D5 ★ Smart Turn: a finished sentence ends fast, a pause waits
1. VIK (local engine). "End-of-turn silence" = 2000, "End of turn" = "silence + Smart Turn model".
2. Say a complete question, then stop: "What time does the museum close?"
3. Say, with a real one-second pause in the middle: "I'd like to… um… go and see room 2."
4. Set "End of turn" back to "silence only" (still 2000 ms) and redo step 2.

**Expected:** 2. the agent replies quickly, well before 2 s of silence. The "Events" log shows `turn.prediction · p 0.9… · complete`. 3. at the pause, the log shows "not finished", and the agent waits for the end of your sentence instead of cutting in. 4. with silence only, it always waits the full 2 s. Try it in French too: the model covers French.

Wait after the question (Smart Turn / silence only): ……… / ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### D6 Showing the model's guess (cables)
1. In the studio: Engine = Local, "End of turn" = "silence + Smart Turn model", "End-of-turn silence" = 2000. In cables, connect the op's `Turn probability (local)` to the width of a bar.
2. Say D5's two sentences.

**Expected:** the bar goes past the middle (0.5) on the complete question, and stays low at the hesitation. It moves at each pause in your speech, not continuously.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## E. Interruption (R6)

### E1 ★ Cutting it off by voice (headset)
1. Ask "Tell me a long story." While it is talking, say "Stop, tell me about the gardens instead."

**Expected:** the voice stops cleanly (in less than half a second), `On interruption` fires, and the agent answers the new request. With the local engine it is a little slower, but it works.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E2 An agent you can't interrupt
1. Untick "Can be interrupted" in the studio (Gemini: then Start), and redo E1.

**Expected:** the agent finishes its reply whatever you say.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E3 ★ Cutting it off with a gesture
1. Connect a keyboard key (or a click) to `Interrupt`. Ask for a long story, press while it is talking.
2. Then ask: "What were you saying?"

**Expected:** the voice stops immediately and the agent goes back to listening. Nothing from the old reply is replayed. On the next question, it knows it was cut off.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E4 Echo, with speakers
1. Without a headset, "Can be interrupted" ticked: ask it for a long reply.
2. Untick "Listens while speaking" in the studio and try again.

**Expected:** 1. it may hear itself and cut itself off (this is the known limit). 2. it no longer cuts itself off; you then interrupt it with a gesture (E3).

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E5 Typing or choosing while it talks
1. During a long reply, send a text (`Text` + `Send text`), or click a choice on screen.

**Expected:** a single interruption, then the agent answers the text or the choice, in full.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E6 ★ A "mm-hm" doesn't stop it (local)
1. Local engine, headset on. "Talk over it this long to interrupt (ms)" = 600 (the station persona already has it).
2. Ask "Tell me a long story." While it is talking, say a short "mm-hm"; a bit later, "yeah".
3. (Optional) Redo step 2 with speakers instead of the headset.

**Expected:** 2. the voice dips (gets quieter) at once, then comes back within a fraction of a second, and the story carries on. The "Events" log shows `interruption.pending`, then `interruption.cancelled` with what was heard. Your "mm-hm" is not a new turn, and it isn't in the conversation. A very short sound may not even make the voice dip: that is expected (under about 0.25 s, it isn't detected as speech). 3. note what happens: echo with speakers while the voice dips has not been checked yet.

What Whisper wrote for your "mm-hm" (in the log): ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E7 ★ "Stop" makes it stop and listen (local)
1. Same settings as E6. Ask for a long story. While it is talking, say "Stop." Do it again with "Wait." and, in French, "Attends."
2. Then ask: "What were you saying?"

**Expected:** 1. the voice dips, then stops. `On interruption` fires, and the agent goes back to listening **without replying** to "stop". The log shows `user.cancel`. 2. it knows it was cut off.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E8 Talking over it for longer still interrupts (local)
1. Same settings as E6. During a long reply, say a full sentence: "Actually, tell me about the gardens instead."

**Expected:** the voice dips, then stops about 0.6 s after you started talking. The agent answers the new request, as in E1.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## F. Thinking and analysis (R7)

### F1 ★ The "thinking" state is usable
1. Connect `Thinking` to an animation (a rotation). Have five turns of conversation with Gemini, writing down `Wait (ms)` each time.

**Expected:** the animation runs exactly between the end of your sentence and the start of its voice. The waits you noted are plausible (around one second with Gemini).

Waits noted: ……… / ……… / ……… / ……… / ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F2 ★ Latency as a design material
1. In the studio, "Extra delay before replying" = 2,000 ms (it applies live). Talk.

**Expected:** the agent "thinks" for at least two seconds before speaking. `Wait (ms)` is over 2,000.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F3 The thinking sound
1. In the studio, "Thinking sound" = tick, then hum.

**Expected:** the sound is only heard while it is thinking, and stops as soon as the voice starts.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F4 ★ Local engine latency on the students' machines
1. With the VIK, have five turns on the Windows PC, then five on the Mac, writing down the wait for each turn ("Turns" table in the window, in seconds).

**Expected:** it's up to you to set the acceptable threshold for the workshop (for example, under 3 s). Beyond that, lighter models exist (VIK README, "Changing models").

PC: ……… / ……… / ……… / ……… / ……… Mac: ……… / ……… / ……… / ……… / ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F5 A question that needs some analysis
1. Ask: "Compare these three options and tell me which one to choose for a family with two children: the museum, the park, the aquarium."

**Expected:** the wait is longer. The interface stays in the "thinking" state without freezing, then the agent replies. Note what this asks of the design.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F6 ★ Spoken fillers (local)
1. VIK (local engine). "Extra delay before replying" = 3000. "Filler lines" = "Hmm, let me see…|Good question…|One moment…", "Say a filler after (ms)" = 1200.
2. Ask three questions, one after the other.
3. Set "Thinking sound" = hum and ask one more.
4. Switch Engine to Gemini Live, leaving the filler lines filled in. Start, and ask a question.

**Expected:** 2. about 1.2 s after each question, you hear a filler, then the reply. The filler changes from one turn to the next (never the same twice in a row), and the log shows `bot.filler`. The "Turns" table and `Wait (ms)` show more than 3 s: they measure the reply, not the filler. The very first filler may be skipped while it is being prepared. 3. the hum keeps playing under the filler. 4. no filler with Gemini: it is a local feature.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## G. Voice and graphic feedback (R8)

### G1 ★ Earcons
1. In the studio, "Earcons" = off, then soft, then clear. Each time: Start, talk, wait for choices, cause an error (wrong key).

**Expected:** with soft and clear, you hear a sound when the session opens, a sound when your sentence has been heard, a sound when choices arrive, and an error sound. With off: nothing.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### G2 ★ The levels drive a smooth animation
1. In cables: `Voice level` on the scale of a circle (the "mouth"), `Mic level` on a ring around it.

**Expected:** the circle pulses with the agent's voice, the ring with yours, smoothly and with no visible lag.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### G3 The agent's subtitles
1. Show `Agent text`.

**Expected:** the text follows the voice closely enough to work as subtitles.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### G4 Messages a student can understand
1. Cause: a wrong key (studio, Gemini Live), a refused mic, the VIK closed while the op is in a patch.

**Expected:** each time, a message in plain English says what is happening and what to do. For the key and the mic: in the studio, and on the op (`Error` and its frame). For the closed app: on the op's frame, "Cannot reach the VIK app at …: open the app (it reconnects on its own)." For a refused key, the reason given by Google may be added in parentheses.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### G5 The studio
1. Look around **Talk** during a conversation: the presence, the words, the choices, the measured waits, "Why it answered", "Every event".

**Expected:** a student understands what they see. The current state is shown in words under the presence ("listening", "hearing you"…), "Why it answered" explains each turn, and "Every event" shows the vocabulary's events (`user.start`, `thinking`, `decision`, `bot.start`…) as the conversation goes on.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## H. Calls to action (R9)

### H1 ★ The agent offers choices on screen
1. Add to the studio's "Persona": "When it helps, offer two or three choices on screen." (Gemini: Start.) Ask: "What do you recommend?"

**Expected:** `Choices` contains the options, `Question` the question (Gemini only: with the local engine, `Question` stays empty), and `On choices` fires (with a sound). The agent does not read the choice syntax out loud.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H2 ★ Answering with a choice
1. Connect buttons: a click on a button sets `Choice index` to its number, then triggers `Choose`. **Careful: numbering starts at 0** (0 = the first choice, 1 = the second…).

**Expected:** the agent carries on with the chosen option, as if you had said it.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H3 The mood
1. Connect `Mood` to a color or a face. Talk: some good news, then a problem.

**Expected:** the mood changes plausibly (happy, sorry…).

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H4 An agent that acts on the patch (Gemini)
1. **Files → Open agents folder**: in an agent's `persona.md`, add the op README's `change_color` example in the settings at the top, as `extraTools: [ … ]` on one line (the JSON array of declarations). Back in the studio, open that agent.
2. Engine = Gemini Live, `Start` on the op, and say "make it red".

**Expected:** the op's `On tool call` fires, and `Tool call.args.color` is `red`. After `Tool result` + `Send tool result`, the agent confirms.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H5 Informing the agent without it replying
1. At rest: `Context` = "The user is looking at room 2", `Send context`. Then ask: "What am I looking at?"
2. During a long reply: send another context.

**Expected:** 1. the agent does not reply to the context, but afterwards it knows you are looking at room 2. 2. its reply is not cut off; the context is taken into account afterwards.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H6 Typing instead of talking
1. During a conversation, `Text` = "Hello!" + `Send text`, with the headset's mic muted.

**Expected:** the agent replies out loud, as if you had spoken.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H7 Choices with the small local model
1. Redo H1 five times with the VIK (QVAC engine).

**Expected:** the choices appear most of the time. Note how many times out of five: this is a known limit of small models.

Result: …… / 5

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H8 Context sent from a client
1. Open the p5.js example (A13 or A14), start the conversation, and let the agent finish its reply. Press `2`: the sketch sends the context "The visitor is now in room 2."
2. A few seconds later, ask: "Which room am I in?"
3. With the HTML example, during a long reply, send "The visitor is holding a map." from its context field. Then ask: "What am I holding?"

**Expected:** 1. the agent does not answer the context: it stays silent, in `listening`. 2. it says room 2. 3. its reply is not cut off, and the next answer uses the context. Try it with both engines.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## I. Edge cases that must not break anything (R10)

### I1 Not understanding (local)
1. Local engine: in the studio, "Repair line (when nothing was understood)" = "Sorry, can you say that again?". Mumble, or make a long noise.

**Expected:** the agent says the repair line, and `On not understood` fires.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I2 A session longer than 15 minutes (Gemini)
1. Leave a conversation open for more than 15 minutes, talking from time to time.

**Expected:** near the end, the studio announces a reconnection ("Reconnecting to Gemini…", also on the op's `Status`) and reconnects on its own: the conversation carries on without losing anything.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I3 A network outage
1. During a Gemini conversation, turn off the Wi-Fi for ten seconds.

**Expected:** a clear message (connection lost), then `Start` restarts normally.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I4 Stopping too early
1. On the op, `Start`, then `Stop` straight away, while `State` is still `connecting`.

**Expected:** nothing starts behind your back: `State` = `ended` (on the op and in the studio), no voice, and the system's mic indicator goes off.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I5 Deleting the op
1. During a conversation, delete the op from the patch.

**Expected:** only that client disconnects: the conversation carries on in the VIK (and in any other client). Stop, in the studio, closes it.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I6 A client joins a conversation already open
1. Start a conversation in the VIK window, and talk a little.
2. Open the patch with the op (or reload the cables page).
3. Click `Start` on the op.

**Expected:** 2. nothing stops: the op shows at once where the conversation stands (`State`, `Agent name`, `Last user text`, `Last agent reply`, `Choices`), then follows it. 3. the conversation restarts in the app, as if you had clicked Start in the studio. (The op no longer opens a conversation of its own, so it never takes over from the studio.)

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I7 Changing the agent mid-conversation
1. Gemini: edit the persona in **Persona** during a conversation. Local: same thing, then add a pattern in **Interactions** and say one of its examples.

**Expected:** with Gemini, the studio says to click Stop, then Start, to apply it. With the local engine, the new persona applies from the next reply, and the new pattern fires at once.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I8 ★ Away and the reprompt line, with both engines
1. VIK, local engine: "Away after (ms)" = 8000, "Reprompt line" = "Are you still there?". **Start**, then stay silent for about 30 seconds.
2. Say something, wait for the reply, then stay silent again.
3. Switch the studio to Engine = Gemini Live (same "Away after (ms)" and "Reprompt line", "Greeting" empty). In cables, connect the op's `On away` to a visible change. `Start`, then stay silent.

**Expected:** 1. after 8 s, the agent says "Are you still there?" word for word, and the log shows `user.away · silent 8.0 s · 1×`. After each further 8 s of silence, `user.away` comes again (2×, 3×…), but the agent says nothing more. 2. once you have spoken, the count starts again: the next silence brings the line back, once. 3. with Gemini, `On away` fires after 8 s, and the agent asks whether you are still there **in its own words**.

How Gemini phrased it: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I9 A double-clicked example
1. In the file explorer, double-click `examples/html-css-js/index.html`, then `examples/p5js/index.html` (they open as `file://…`).

**Expected:** each page says why it can't connect, and what to do. The HTML page: "Opened as a file, so the app refuses it: open this folder through a local web server (see examples/README.md)." The sketch: "Opened as a file, so the app refuses it: use a local web server or the p5.js editor". The studio is not affected.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I10 Closing the studio while clients follow
1. The op and both examples connected (A13), a conversation open. Close the VIK window (this quits the app).
2. Wait ten seconds, then open the VIK again.
3. (Optional, from the kit's folder) Quit the VIK, run `npm run server` in `app`, and open the lab page in Chrome (`http://localhost:8790`). Close only that tab, then open it again.

**Expected:** 1. every client says so: the op's `App connected` goes to 0 and its frame says "Cannot reach the VIK app at …"; the HTML page says "VIK app not found: open it (this page reconnects on its own)."; the sketch says "Open the VIK app…". 2. they all come back on their own, with no click: `App connected` = 1, the agent's name and state are back, and Start works again from any client. 3. with the server running but no lab page, the op and the HTML page say "The VIK app is running, but its window is closed." (`App connected` = 0); when the page is open again, they follow again on their own.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## J. One vocabulary, two engines (R10, R11)

### J1 ★ The same patch, two engines
1. Build a small interface with Gemini: D3, F1, G2, H1 and H2 together.
2. In the studio, switch Engine to "Local (QVAC, on this machine)" and Start again, without touching the patch.

**Expected:** the interface works as is, and the op's `Engine` shows `local`. The differences (latency, quality, choices) are visible, but nothing needs redoing.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### J2 Does the vocabulary cover your needs?
1. Write down five interactions you want the students to design. For each one, look for the port or trigger that makes it possible (the op's README, or [`CONTRACT.md`](../CONTRACT.md)).

**Expected:** each interaction finds its port. Note the ones that are missing: that's the list of things to add.

| interaction wanted | port / trigger | missing? |
|---|---|---|
| | | |
| | | |
| | | |
| | | |
| | | |

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## K. With students (R12)

### K1 ★ One student, 45 minutes, no technical help
1. Give a student the VIK (installed and open), the guide ([`GUIDE.md`](GUIDE.md)), an empty patch and the brief: "Make it clear, without text, when the agent is listening, hearing, thinking and speaking. Then make it offer two clickable choices."
2. Watch without helping. Note where they get stuck.

**Expected:** a first conversation in under 10 minutes, the brief done in 45 minutes.

Time to first conversation: ……… Where they got stuck:

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### K2 How the students felt
After a workshop, ask (on a scale of 1 to 5, plus a comment):

1. I understood what state the agent was in at every moment.
2. I could change its voice and personality the way I wanted.
3. I could design the end of turn, the interruption and the wait.
4. The tool let me focus on design rather than on technology.
5. What I missed most: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### K3 The fleet of machines
1. Install the VIK on three different student computers, including the weakest one.

**Expected:** it runs on all three. If not, note the machine and the symptom; the simulated engine (A9) remains a fallback for designing.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## L. Four-axis conversation grid (R5, R6, R11)

This grid borrows the four axes of **Full-Duplex-Bench**, a benchmark for spoken conversation that has already measured Gemini Live ([arXiv 2503.04721](https://arxiv.org/html/2503.04721v2)): **pause handling**, **backchannels**, **smooth turn-taking** and **user interruption**. It is not the benchmark itself, which uses recorded audio and automatic measures. It is a quick human version, to compare the two engines and place your scores next to published results.

### L1 Scoring both engines on four axes
1. Use the same person, the same headset and the same script for every column. Ideally, two people score separately, then compare.
2. Play each row with: Gemini (default settings); the local engine with default settings; the local engine **tuned**: "End of turn" = "silence + Smart Turn model", "End-of-turn silence" = 2000, "Talk over it this long to interrupt (ms)" = 600.
3. Score from 1 to 5. 1 = it breaks the conversation, 3 = it works but feels mechanical, 5 = it feels like talking with a person.

| axis | what to try | Gemini (1–5) | local, default (1–5) | local, tuned (1–5) | notes |
|---|---|---|---|---|---|
| **pause handling** | a sentence with a one- or two-second pause in the middle: "I'd like to… um… go and see room 2." Does it wait for the end? | | | | |
| **backchannels** | during a long reply, say "mm-hm", then "yeah". Does it carry on? While you talk, does it (or its interface) show that it is listening? | | | | |
| **smooth turn-taking** | five complete questions. Does it take the turn quickly and naturally? Note `Wait (ms)` | | | | |
| **user interruption** | during a long reply: "Actually, tell me about the gardens instead." Does it stop quickly and answer the new request? | | | | |
| **total (out of 20)** | | | | | |

**Expected:** the grid shows where each engine stands, and what the tuned settings change. Note the gaps you want the workshop to make visible.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## S. The studio and the decision model (R13 to R17)

### S1 ★ The studio, at first sight (R13, R14)
1. Open VIK on a student's computer. Look at the window before touching anything, then visit each view (Talk, Persona, Knowledge, Interactions, Voice & timing, Settings), in light and dark mode (the system's setting).

**Expected:** everything is called VIK (window, installer, menus). The interface is calm and readable: one accent colour, the state's colour on the presence, nothing cluttered; a student finds Start, the agent's name and the views without help.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S2 ★ An agent built in the app (R15, R17)
1. **Manage → New agent…** "Bike shop". **Persona**: a short persona in markdown (a heading, a list).
2. **Knowledge → New table** "Bikes": two columns (`name`, `price`), three rows.
3. **Interactions → New pattern** "A bike": When "the person mentions an entry of" Bikes; Then **Say** "The {name} costs {price}."
4. **Start**, and ask "How much is the racing bike?"
5. **Files → Open agents folder**: open `bike-shop/persona.md`, `knowledge/bikes.csv` and `interactions.json`.

**Expected:** 4. the agent says the line, filled from the row, at once (no language model); "Why it answered" shows "A bike", the entry and the score. 5. the files hold what you typed: markdown with its settings at the top, a CSV that a spreadsheet opens with its accents, readable JSON. "Saved" showed at the top as you typed.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S3 ★ The decision model with the real model (R16)
1. On a computer where **Settings → Hearing and deciding** says "EmbeddingGemma 300M", open the museum guide. In **Interactions → Try a sentence**, try: "what time do you open?", "how much does it cost to get in?", "tell me about the water lilies", "the painting with the pond", "who painted it?" (in the Tour stage), "vous ouvrez à quelle heure ?", "parlez-moi des nymphéas", "what is the capital of Peru?".
2. Do the same with the station kiosk: "when is the train to Lyon", "I need a taxi", "where can I get a coffee", "what's the weather like".

**Expected:** each sentence lands on the pattern you would expect (opening hours, tickets, an artwork, a free answer for "who painted it?", the kiosk's "Anything else" for the weather), the French ones too, with the runners-up well below. Decisions take tens of milliseconds ("Decided by EmbeddingGemma 300M in … ms").

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S4 Editing a decision pattern (R16)
1. In the museum guide, find a sentence that lands on the wrong pattern, or on none (ask a student for ten questions).
2. Fix it in the studio: add an example, another name in a table (`|`), a fallback, or move the confidence. Try the sentence again.

**Expected:** the change shows at once in "Try a sentence", and in the conversation. A student can explain why the agent answered what it answered, from the scores.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S5 Stages (R16)
1. Open the chef. Start, say "yes, I have everything", then "next" four times, "repeat" once, and "how many eggs?" in the middle.

**Expected:** each "next" gives the next step (the stage changes: "Now in the stage …" in the trace), "repeat" repeats, the ingredient question is answered from the table without losing the step.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S6 ★ Signals between the agent and a scene (R16, R9)
1. Open the station kiosk, and the HTML example (or the cables op). Start.
2. On the example, click "Someone comes near" (cables: `Send signal` with `visitor-near`).
3. Ask "when is the train to Lyon?"

**Expected:** 2. the agent says "Hello! Where are you going?" (its signal pattern). 3. the reply, and on the example "signal show-departure: Lyon" (cables: `Agent signal`, `On agent signal`). The stage shows on the example (`Stage` on the op).

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S7 A table from a spreadsheet (R15)
1. In Excel (or Numbers, LibreOffice, Google Sheets), make a small table with accents and commas inside cells; save it as CSV (with semicolons if your Excel does so).
2. **Knowledge → Import a CSV**. Then **Export as CSV** and open the export in the spreadsheet.
3. With the app open, edit `knowledge/<table>.csv` in the spreadsheet, save, and go back to **Knowledge**.

**Expected:** 2. the table imports with its accents and cells intact, whatever the separator; the export reopens cleanly. 3. back in the studio's window, the change shows, and the agent uses it at once.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S8 Links and other names (R15)
1. In the museum guide, ask about an artwork, then "and who was the artist?"
2. Add a French name to an artwork (`… | Le Penseur`), and ask in French.

**Expected:** 1. the reply uses the artist's row (the link). 2. the French name finds the entry.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S9 ★ Any language model (R17)
1. **Settings → Language model**: try each local model you have; then an LLM farm (S9 needs one on the network, see LlmOnLan); then a service (Ollama on this computer, or an online one with a key).
2. With each, ask the museum guide a free question ("what should I look at first?").
3. Export the agent and open the file.

**Expected:** 1–2. the reply comes from the chosen model; the felt wait changes accordingly; a wrong key, a full farm or a stopped Ollama gives a clear message. Hearing and the voice stay local. 3. the file holds no address, model or key.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### S10 The studio with students (R14, R12)
1. Give a student 20 minutes, no explanation, with this task: "make the museum guide say the opening hours of your favourite museum, and greet visitors who come near".

**Expected:** they find Interactions, change the line (or a pattern), and use a signal pattern, without help, or with one hint at most. Note where they hesitated.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## T. The Guide and the tutorial (R18)

### T1 ★ The tutorial, with a newcomer (R18, R12)
1. On a computer where VIK was never opened (or after **View → Developer tools → Application → Local storage → Clear**), give a student who has never seen VIK the installed app, and say only: "follow what it suggests".
2. Watch without helping. Time it.

**Expected:** the navigation offers "Start the tutorial"; the student reaches "That's an agent" in 15 minutes or less, and the café agent answers "A Cappuccino? That's espresso with milk foam…" (or their own line). Note each step where they hesitated, and each time they used **Do it for me** or **Skip**: these are the steps to rewrite.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### T2 The tutorial with the real models (R18)
1. On a first launch with QVAC (the models still downloading), start the tutorial at once.
2. Reach the **Start** step while the banner still shows the download.

**Expected:** every step before **Start** works during the download (the try field decides with the words matcher until EmbeddingGemma is loaded); at **Start**, the banner shows the progress, and the tutorial waits for the conversation. With the models ready, the café agent's line is spoken.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### T3 Leaving and coming back (R18)
1. In the middle of the tutorial, click **×**. Quit the app, open it again.
2. Click **Pick it up** in the navigation (or in **Guide**).
3. During the tutorial, open another agent from the list at the top.

**Expected:** 1. the tutorial stays closed, the navigation says at which step it was. 2. it goes on at that step. 3. the card says the step is about Café, and **Open Café** brings it back. The example agents are never changed.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### T4 The Guide (R18)
1. Open **Guide**. Read **Getting started** and **How it decides**; follow three links (a page, a view, a website).
2. In each view, click the help link at the end of its intro.
3. Unplug the network, open the Guide again.

**Expected:** 1. the pages read well in light and dark, the views' names match the studio's, a website opens in the browser (not in the studio). 2. each opens the right page. 3. the Guide works offline (only the website links need the network). Note any sentence a student would not understand.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## Summary

| requirement | overall verdict | what needs to change |
|---|---|---|
| R1 cables.gl node for Gemini Live, without modifying cables | | |
| R2 QVAC Electron app, Windows and Mac M1 | | |
| R3 set up the voice | | |
| R4 personality | | |
| R5 end of turn | | |
| R6 interruption | | |
| R7 thinking and analysis | | |
| R8 voice and graphic feedback | | |
| R9 calls to action | | |
| R10 UX/UI vocabulary, edge cases | | |
| R11 cloud / local switch | | |
| R12 teaching use | | |
| N1 features borrowed from open source (Smart Turn, backchannels, fillers, away, voice engines) | | |
| N2 installers from a GitHub Release | | |
| R13 the name VIK | | |
| R14 a minimal, elegant interface | | |
| R15 personas in markdown, knowledge as CSV, interactions | | |
| R16 a local decision model, editable patterns | | |
| R17 everything editable in the app, any language model | | |
| R18 the built-in Guide and the tutorial | | |

Four-axis grid (L1), totals out of 20: Gemini ……… local, default ……… local, tuned ………

## What to send back to me

For each "needs work" or "fail" test:

- its number (e.g. E1), the engine (Gemini or local) and the machine (Windows or Mac, model);
- what you expected, and what happened;
- the text of `Error` or `Status`, or of the studio's message, if there is one;
- for the VIK: **Files → Server log** (copy the text);
- if possible: a screenshot, or the contents of the `Conversation` output.

With this, I can fix things precisely.
