# Human test protocol

The automated tests (344 checks) prove that the code does what it says, against imitations of Gemini, QVAC and Electron. They don't tell you whether **what I built matches what you want**. This protocol is for that: scenarios to play yourself, with a real voice, real machines and real students.

For each test: the **requirement** from your request that it checks, the **steps**, the **expected result**, and a **verdict** line to fill in:

- **pass**: it does what it should;
- **needs work**: it works, but not the way you want it to (say how);
- **fail**: it doesn't work, or it isn't what you wanted.

**A rule to keep in mind with Gemini:** an open session does not pick up live changes to persona, voice, language, creativity, short answers, end silence, sensitivities or `Interruptible`. The op then shows "Setting changed: click Start…": you need to click `Start` after each change of this kind. With the local engine, everything applies live. A setting marked **(local)** only works with the local engine: Gemini ignores it.

The tests marked ★ make up the **quick run**, to do first: about 2½ hours for all the ★ tests, Windows and Mac included (plus the 15–25 minutes GitHub takes to build the installers in A12).

---

## Equipment

- a **Windows PC** typical of the students' machines (ideally the least powerful one), and an **Apple Silicon Mac** (M1 or later);
- Chrome, a cables.gl account, a **Gemini key** ([aistudio.google.com/apikey](https://aistudio.google.com/apikey));
- a **headset** with a mic, and **speakers** (for the echo tests);
- the Voice Lab installers: from a GitHub Release (see A12 and [`PUBLISHING.md`](../PUBLISHING.md)), or built with `npm run make`;
- a GitHub account, for A12;
- for B6 (optional): a short WAV recording of a volunteer who has agreed, in writing, to have their voice cloned;
- for the K tests: one or two student volunteers.

## What your request requires, and the tests that check it

| | requirement | tests |
|---|---|---|
| R1 | a **cables.gl node** for Gemini Live, added in a code box, **without modifying cables** | A1, A2, A3, A4 |
| R2 | a **local QVAC backend** as an **Electron app**, installable on **every computer** (Windows and Mac M1) | A5 to A12 |
| R3 | **set up the voice** | B1 to B6 |
| R4 | play with the agent's **personality** | C1 to C6 |
| R5 | handle the **end of turn** through design | D1 to D6, L1 |
| R6 | handle **interruption** through design | E1 to E8, L1 |
| R7 | handle **thinking** and **analysis** through design | F1 to F6 |
| R8 | **voice and/or graphic** user **feedback** | G1 to G5, D6 |
| R9 | **calls to action** | H1 to H7 |
| R10 | the **basic UX/UI vocabulary**, usable by designers, and edge cases that don't break everything | I1 to I8, J2 |
| R11 | **switch between cloud and local** without redoing everything | A10, J1, L1 |
| R12 | a **teaching** tool, usable by design students | K1 to K3 |
| N1 | the features **borrowed from open source** ([landscape](OPEN_SOURCE_LANDSCAPE.md)): Smart Turn, backchannels and stop phrases, spoken fillers, away and the reprompt, the Parler and Chatterbox voices | B5, B6, D5, D6, E6 to E8, F6, I8, L1 |
| N2 | installers published as a **GitHub Release**, built by GitHub Actions | A12 |

N1 and N2 were not in your original request: they cover what was added since.

---

## A. Getting set up

### A1 ★ The op installs in cables without touching cables (R1)
1. Open a patch of your own on cables.gl. Avatar → **Code a new op** → name `VoiceAgent` → **Create Op**.
2. Delete the code, paste all of `1_cables_gemini_live/VoiceAgent.op.js`, save.

**Expected:** the op appears in the patch, with no error. Its ports are sorted into groups (Connection, Persona, Voice, Turn-taking, Feedback, Actions, Advanced). Nothing else has been installed.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A2 ★ First conversation with Gemini (R1)
1. Paste the key into `Gemini API key`, click `Start`, allow the mic (headset on).
2. Say: "Hello, who are you?"

**Expected:** `State` goes through `connecting` → `listening` → `hearing` (during your sentence) → `thinking` → `speaking` → `listening`. The agent replies out loud within one or two seconds. `User text` and `Agent text` show the conversation.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A3 The key is never saved in the patch (R1)
1. After A2, save the patch, then reload the page.

**Expected:** `Gemini API key` is empty. Exception: if `Remember key (this browser)` was ticked, the key comes back, but only in this browser. Another account that opens the patch does not see it.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A4 The token server, for a class (R1)
1. `cd 1_cables_gemini_live/token-server`, copy `.env.example` to `.env`, put the key in it, then `node server.mjs`.
2. In the op: clear the key, `Token server` = `http://localhost:8787/token`, `Start`. Accept if Chrome asks for access to the "local network".
3. Stop the token server (`Ctrl+C`), then `Start` again.

**Expected:** step 2 works like A2. At step 3, `Error` clearly says that the token server isn't responding.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A5 ★ The QVAC self-test and building the installers (R2)
1. In `2_qvac_local`: `npm install`, then `npm run selftest`.
2. `npm run make` (on each platform), or let GitHub build the installers (A12).

**Expected:** the self-test shows ✔ for "loading the three models", "voice: say a sentence", "recognition: listen back to the sentence", "end of turn: Smart Turn", "model: reply", "voice: say the reply", then "✔ QVAC works on this machine." A ⚠ on "end of turn: Smart Turn" means `onnxruntime-node` is missing: the self-test still passes and turns end on silence, but note it. `out/make/` contains `VoiceLab-Setup.exe` (Windows) or `Voice Lab.dmg` (Mac), plus a `.zip`.

Write down the times shown by the self-test, you will need them in F4:

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A6 ★ Installing on a student's Windows PC (R2)
1. Run the installer: `VoiceLab-Setup-<version>-windows-x64.exe` from the Releases page, or `VoiceLab-Setup.exe` if you built it yourself. Get past the warning ("More info → Run anyway").
2. Wait for the model download to finish, then click **Start** and talk.

**Expected:** a "Voice Lab" shortcut appears in the Start menu and on the desktop. The app opens; the window's banner shows the download percentage (and a bar moves along on the icon, in the taskbar), then "Models ready". The conversation works.

Machine (processor, memory, graphics card): ……… Download time: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A7 ★ Installing on an M1 Mac (R2)
1. Open the `.dmg`, drag the app into Applications, launch it.
2. Unblock it: **System Settings → Privacy & Security → Open Anyway** (or `xattr -cr` if macOS says it is "damaged").
3. Allow the mic, wait for "Models ready", **Start**, talk.

**Expected:** the README instructions are enough to unblock the app without help. macOS asks for the mic with the sentence "Voice Lab listens to your voice…". The conversation works.

Machine (chip, memory): ……… Download time: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A8 Uninstalling on Windows (R2)
1. Settings → Apps → "Voice Lab" → Uninstall.

**Expected:** the app and its shortcuts disappear. The models stay in `~/.qvac/models`, so you don't have to download them again.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A9 The simulated engine, without models (R2, R12)
1. In the Voice Lab: menu **Engine → Simulated**.
2. **Start**, talk (say anything), then start a second conversation.

**Expected:** the app restarts with the "simulated engine". The agent "hears" when you talk, replies with pre-written sentences, offers choices and a mood, and speaks with a hum. The second conversation replays the same script. This is useful to design an interface without waiting for the models.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A10 ★ The cables op connected to the Voice Lab (R2, R11)
1. Voice Lab open, showing "Models ready". Menu **Engine → Copy address for cables.gl**.
2. In the op: `Engine` = `Local (QVAC)`, paste the address into `Local server`, `Start`.

**Expected:** the conversation works from cables, with the local voice. The same outputs move as with Gemini. If the Voice Lab window had a conversation open, it stops with the message "Another page opened a conversation, so this one is stopping."

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A11 The first download on the school network (R2)
1. Do the first launch from A6 or A7 on the school Wi-Fi.

**Expected:** the models download (peer to peer or through the HTTP fallback). If not, the README procedure (copy `~/.qvac/models` from one machine to another) can be done in class.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### A12 ★ The installers from a GitHub Release (R2)
1. Put the kit on GitHub as [`PUBLISHING.md`](../PUBLISHING.md) explains (first commit, then push). In the **Actions** tab, check that the **Tests** workflow turns green.
2. Push a version tag: `git tag v1.0.0`, then `git push origin v1.0.0`. (To try without publishing: **Actions → Release → Run workflow**.)
3. When the **Release** workflow has finished, download `VoiceLab-Setup-1.0.0-windows-x64.exe` and `VoiceLab-1.0.0-mac-arm64.dmg` from the release page (or from "Artifacts" on the run page). Install them as in A6 (Windows PC) and A7 (M1 Mac).
4. In each installed app, set "End of turn" to "silence + Smart Turn model" and have a short conversation.

**Expected:** both workflows finish green, the Release one in about 15–25 minutes. The release page lists four files: the `.exe` and a `.zip` for Windows, the `.dmg` and a `.zip` for Mac. Both installers install and run as in A6 and A7. At step 4, the window never says "Smart Turn is unavailable here: using silence only.", and the "Events" log shows `turn.prediction` lines: the model and its runtime made it into the installer.

Time taken by the Release workflow: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## B. The voice (R3)

### B1 ★ Changing the Gemini voice
1. Try three contrasting voices, `Puck`, `Charon` and `Sulafat`, with the same question.

**Expected:** each change shows on the op "Setting changed: click Start to restart the session with this setting." After `Start`, the voice is different and its stated character (upbeat, informative, warm) can be heard.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B2 The speaking style (Gemini)
1. `Speaking style (Gemini)` = "very slow, whispering", then "energetic, like a radio host". `Start` each time.

**Expected:** you can hear the difference. The model interprets the instruction: note how far it follows it.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B3 ★ Local voice and speed
1. Voice Lab: `Local voice` F1, then M3. `Speed` 0.8, then 1.4. Talk between each change, **without** clicking Start.

**Expected:** each change applies live, after one or two seconds of reloading. The conversation carries on.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B4 The volume, and the voice sent to an audio op
1. Move `Volume` while it is speaking.
2. (Optional, cables) Untick `Play through speakers` and connect `Voice (audio)` to a cables audio op (after adding the webaudio library to the op, see the README).

**Expected:** the volume changes live. Without speaker output, the voice only goes through the audio op.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### B5 A voice described in words (Parler)
1. Voice Lab, `Language` = English. "Local voice engine" = "Parler (describe the voice in words, English)". The first time, wait for the download (about 1.16 GB).
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
1. Persona A: "You are a warm, curious museum guide, and you ask questions." Persona B: "You are a hurried, terse station agent, and you answer in one sentence."
2. With each one (Gemini: `Start` after changing the persona), ask: "What can I do here?"

**Expected:** two clearly different behaviors (tone, length, questions asked), with Gemini **and** with the local engine. Note the quality gap between the two engines.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C2 Creativity
1. Ask the same question three times with `Creativity` = 0, then 2 (Gemini: `Start` after the change).

**Expected:** at 0, similar, calm answers. At 2, more varied and more surprising answers.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C3 Short answers
1. Ask "Explain impressionism to me", with and then without `Short answers` (Gemini: `Start` after the change).

**Expected:** with it, one to three sentences and one question at a time. Without it, a longer answer.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C4 ★ The agent speaks first
1. `Greeting` = "Welcome to the garden!", `Start`.
2. Clear the greeting, `Start`.

**Expected:** 1. the agent opens the conversation (Gemini says it in its own words; the local engine says it as written). 2. it waits in silence to be spoken to.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C5 The example personas, and sharing
1. Voice Lab: "Persona preset" → try all four.
2. **Export (JSON)**, edit a persona, **Import…** the file on another computer.

**Expected:** each persona changes the name, the text, the voice and the greeting. An exported file imports back identically.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### C6 Another language
1. `Language` = `fr` in the op ("French" in the Voice Lab window). Persona written in French, `Start`, speak French.

**Expected:** the conversation happens in French. (Gemini picks its language on its own: the persona helps.)

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## D. The end of turn (R5)

### D1 ★ Impatient agent, patient agent
1. `End silence (ms)` = 300 (Gemini: `Start` after the change). Say, with a real one-second hesitation in the middle: "I'd like to… um… go and see room 2."
2. Same sentence with 2,000 ms (Gemini: `Start` again).

**Expected:** at 300 ms, the agent starts replying during the hesitation. At 2,000 ms, it waits for the end of the sentence, but it is slower to reply. The difference is clearly felt, with both engines.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### D2 The sensitivities
1. `Start sensitivity` high, then low (Gemini: `Start` after each change): whisper a sentence, cough, tap on the table.
2. `End sensitivity` high, then low: talk with pauses.

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
1. Voice Lab (local engine). `End silence (ms)` = 2000 ("End-of-turn silence" in the window), "End of turn" = "silence + Smart Turn model".
2. Say a complete question, then stop: "What time does the museum close?"
3. Say, with a real one-second pause in the middle: "I'd like to… um… go and see room 2."
4. Set "End of turn" back to "silence only" (still 2000 ms) and redo step 2.

**Expected:** 2. the agent replies quickly, well before 2 s of silence. The "Events" log shows `turn.prediction · p 0.9… · complete`. 3. at the pause, the log shows "not finished", and the agent waits for the end of your sentence instead of cutting in. 4. with silence only, it always waits the full 2 s. Try it in French too: the model covers French.

Wait after the question (Smart Turn / silence only): ……… / ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### D6 Showing the model's guess (cables)
1. In cables: `Engine` = `Local (QVAC)`, `End of turn (local)` = `silence + Smart Turn`, `End silence (ms)` = 2000. Connect `Turn probability (local)` to the width of a bar.
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
1. Untick `Interruptible` (Gemini: then `Start`), and redo E1.

**Expected:** the agent finishes its reply whatever you say.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E3 ★ Cutting it off with a gesture
1. Connect a keyboard key (or a click) to `Interrupt`. Ask for a long story, press while it is talking.
2. Then ask: "What were you saying?"

**Expected:** the voice stops immediately and the agent goes back to listening. Nothing from the old reply is replayed. On the next question, it knows it was cut off.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E4 Echo, with speakers
1. Without a headset, `Interruptible` ticked: ask it for a long reply.
2. Untick `Listen while speaking` and try again.

**Expected:** 1. it may hear itself and cut itself off (this is the known limit). 2. it no longer cuts itself off; you then interrupt it with a gesture (E3).

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E5 Typing or choosing while it talks
1. During a long reply, send a text (`Text` + `Send text`), or click a choice on screen.

**Expected:** a single interruption, then the agent answers the text or the choice, in full.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### E6 ★ A "mm-hm" doesn't stop it (local)
1. Local engine, headset on. "Talk over it this long to interrupt (ms)" = 600 (`Interrupt after (ms) (local)` in cables; the station persona already has it).
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
1. `Reply delay (ms)` = 2,000 (it applies live). Talk.

**Expected:** the agent "thinks" for at least two seconds before speaking. `Wait (ms)` is over 2,000.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F3 The thinking sound
1. `Thinking sound` = tick, then hum.

**Expected:** the sound is only heard while it is thinking, and stops as soon as the voice starts.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F4 ★ Local engine latency on the students' machines
1. With the Voice Lab, have five turns on the Windows PC, then five on the Mac, writing down the wait for each turn ("Turns" table in the window, in seconds).

**Expected:** it's up to you to set the acceptable threshold for the workshop (for example, under 3 s). Beyond that, lighter models exist (Voice Lab README, "Changing models").

PC: ……… / ……… / ……… / ……… / ……… Mac: ……… / ……… / ……… / ……… / ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F5 A question that needs some analysis
1. Ask: "Compare these three options and tell me which one to choose for a family with two children: the museum, the park, the aquarium."

**Expected:** the wait is longer. The interface stays in the "thinking" state without freezing, then the agent replies. Note what this asks of the design.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### F6 ★ Spoken fillers (local)
1. Voice Lab (local engine). `Reply delay (ms)` = 3000 ("Extra delay before replying" in the window). "Filler lines" = "Hmm, let me see…|Good question…|One moment…", "Say a filler after (ms)" = 1200.
2. Ask three questions, one after the other.
3. Set `Thinking sound` = hum and ask one more.
4. In cables with Gemini: fill in `Filler lines (local)` and ask a question.

**Expected:** 2. about 1.2 s after each question, you hear a filler, then the reply. The filler changes from one turn to the next (never the same twice in a row), and the log shows `bot.filler`. The "Turns" table and `Wait (ms)` show more than 3 s: they measure the reply, not the filler. The very first filler may be skipped while it is being prepared. 3. the hum keeps playing under the filler. 4. no filler with Gemini: it is a local feature.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## G. Voice and graphic feedback (R8)

### G1 ★ Earcons
1. `Earcons` = off, then soft, then clear. Each time: Start, talk, wait for choices, cause an error (wrong key).

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
1. Cause: a wrong key, a refused mic, the Voice Lab closed with `Engine` = Local.

**Expected:** each time, `Error` (and the op's frame) says in plain English what is happening and what to do. For a refused key, the reason given by Google may be added in parentheses.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### G5 The lab window
1. Look around the Voice Lab window during a conversation: animated face, subtitles, choices, "Turns", "Events".

**Expected:** a student understands what they see. The current state is shown in words under the face ("listening", "I hear you"…), and the "Events" log shows the vocabulary's events (`user.start`, `thinking`, `bot.start`…) as the conversation goes on.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## H. Calls to action (R9)

### H1 ★ The agent offers choices on screen
1. Persona: "When it helps, offer two or three choices on screen." (Gemini: `Start`.) Ask: "What do you recommend?"

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
1. Put the README's `change_color` example in `Tools (JSON)`, `Start`, and say "make it red".

**Expected:** `On tool call` fires, and `Tool call.args.color` is `red`. After `Tool result` + `Send tool result`, the agent confirms.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H5 Informing the agent without it replying
1. At rest: `Context` = "The user is looking at room 2", `Send context`. Then ask: "What am I looking at?"
2. During a long reply: send another context.

**Expected:** 1. the agent does not reply to the context, but afterwards it knows you are looking at room 2. 2. its reply is not cut off; the context is taken into account afterwards.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H6 Typing instead of talking
1. `Text` = "Hello!" + `Send text`, mic muted.

**Expected:** the agent replies out loud, as if you had spoken.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### H7 Choices with the small local model
1. Redo H1 five times with the Voice Lab (QVAC engine).

**Expected:** the choices appear most of the time. Note how many times out of five: this is a known limit of small models.

Result: …… / 5

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## I. Edge cases that must not break anything (R10)

### I1 Not understanding (local)
1. Local engine: `Repair line (local)` = "Sorry, can you say that again?" ("Repair line (when nothing was understood)" in the Voice Lab window). Mumble, or make a long noise.

**Expected:** the agent says the repair line, and `On not understood` fires.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I2 A session longer than 15 minutes (Gemini)
1. Leave a conversation open for more than 15 minutes, talking from time to time.

**Expected:** near the end, `Status` announces a reconnection, and the conversation carries on without losing anything.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I3 A network outage
1. During a Gemini conversation, turn off the Wi-Fi for ten seconds.

**Expected:** a clear message (connection lost), then `Start` restarts normally.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I4 Stopping too early
1. `Start`, then `Stop` straight away, before the mic is allowed.

**Expected:** nothing starts behind your back: `State` = `ended`, no voice, and the browser's mic indicator goes off.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I5 Deleting the op
1. During a conversation, delete the op from the patch.

**Expected:** the voice stops and the browser's mic indicator goes off.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I6 Two pages on the local engine
1. Open a conversation in the Voice Lab window, then another one from cables.

**Expected:** cables takes over. The Voice Lab window shows "Another page opened a conversation, so this one is stopping.", and this message stays on screen.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I7 Changing the persona mid-conversation
1. Gemini: edit `Persona` during a conversation. Local: same thing.

**Expected:** with Gemini, the op says to click Start to apply it. With the local engine, the new persona applies from the next reply.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

### I8 ★ Away and the reprompt line, with both engines
1. Voice Lab, local engine: "Away after (ms)" = 8000, "Reprompt line" = "Are you still there?". **Start**, then stay silent for about 30 seconds.
2. Say something, wait for the reply, then stay silent again.
3. In cables with Gemini: `Away after (ms)` = 8000, `Reprompt line` = "Are you still there?", `Greeting` empty. Connect `On away` to a visible change. `Start`, then stay silent.

**Expected:** 1. after 8 s, the agent says "Are you still there?" word for word, and the log shows `user.away · silent 8.0 s · 1×`. After each further 8 s of silence, `user.away` comes again (2×, 3×…), but the agent says nothing more. 2. once you have spoken, the count starts again: the next silence brings the line back, once. 3. with Gemini, `On away` fires after 8 s, and the agent asks whether you are still there **in its own words**.

How Gemini phrased it: ………

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## J. One vocabulary, two engines (R10, R11)

### J1 ★ The same patch, two engines
1. Build a small interface with Gemini: D3, F1, G2, H1 and H2 together.
2. Switch `Engine` to `Local (QVAC)`, without reconnecting anything.

**Expected:** the interface works as is. The differences (latency, quality, choices) are visible, but nothing needs redoing.

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
1. Give a student the guide ([`GUIDE.md`](GUIDE.md)), an empty patch and the brief: "Make it clear, without text, when the agent is listening, hearing, thinking and speaking. Then make it offer two clickable choices."
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
1. Install the Voice Lab on three different student computers, including the weakest one.

**Expected:** it runs on all three. If not, note the machine and the symptom; the simulated engine (A9) remains a fallback for designing.

Verdict: ☐ pass ☐ needs work ☐ fail — Notes:

---

## L. Four-axis conversation grid (R5, R6, R11)

This grid borrows the four axes of **Full-Duplex-Bench**, a benchmark for spoken conversation that has already measured Gemini Live ([arXiv 2503.04721](https://arxiv.org/html/2503.04721v2)): **pause handling**, **backchannels**, **smooth turn-taking** and **user interruption**. It is not the benchmark itself, which uses recorded audio and automatic measures. It is a quick human version, to compare the two engines and place your scores next to published results.

### L1 Scoring both engines on four axes
1. Use the same person, the same headset and the same script for every column. Ideally, two people score separately, then compare.
2. Play each row with: Gemini (default settings); the local engine with default settings; the local engine **tuned**: "End of turn" = "silence + Smart Turn model", `End silence (ms)` = 2000, "Talk over it this long to interrupt (ms)" = 600.
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

Four-axis grid (L1), totals out of 20: Gemini ……… local, default ……… local, tuned ………

## What to send back to me

For each "needs work" or "fail" test:

- its number (e.g. E1), the engine (Gemini or local) and the machine (Windows or Mac, model);
- what you expected, and what happened;
- the text of `Error` or `Status`, if there is one;
- for the Voice Lab: **Files → Server log** (copy the text);
- if possible: a screenshot, or the contents of the `Conversation` output.

With this, I can fix things precisely.
