# If something goes wrong

Most problems show in the banner of [Talk](view:talk), in plain words. The menu **Files → Server log** shows the studio's latest messages, to understand an error.

## Starting up

| what you see | what to do |
|---|---|
| the loading stays at 0 %, "waiting for data" | the network blocks the download. Put the model files in the models folder by hand (see [On a school network](models.md#on-a-school-network)), or do the first launch on another network, a home Wi-Fi or a phone hotspot |
| "3 models could not be downloaded" | the reason is in **Files → Server log**. The dialog's **Open the download page** shows the voice files: put them in the models folder (**Open models folder**), then restart VIK |
| a Vulkan error (Windows) | update the graphics driver |
| the first reply is slow | the models load at startup: wait for **The models are ready** |
| which version is this? a new version is out? | **Files → Check for updates…**, or **Settings → Version**: the Updates window shows your version and looks for a new one. On Windows, VIK installs it and offers **Restart now**; on a Mac, download the new version from the page it links to. Your agents and settings stay |
| after choosing Parler or Chatterbox, nothing is said for a long time | the first use downloads the voice (over 1 GB): watch the banner. On Windows, Chatterbox runs on the processor and takes long for each sentence: Supertonic is the fastest voice |

## Talking

| what you see | what to do |
|---|---|
| no sound from the microphone (Mac) | System Settings → Privacy & Security → Microphone: allow VIK |
| it reacts to the room (voices far away, music, a fan) | [Talk](view:talk) → **Microphone**: click **Start**, raise the **Gate** until the meter's bar stays grey when nobody speaks and turns blue when you speak. In a noisy room, untick **Automatic level** (it raises the noise when nobody speaks) and set the **Gain** |
| it does not hear a quiet voice | [Talk](view:talk) → **Microphone**: raise the **Gain**, or lower the **Gate** |
| "Loading from this computer…" at each launch | the models are on this computer and are read into memory (the Zonos voice into the graphics card, about 1 GB): nothing is downloaded. VIK loads the open agent's models while you look at the studio, so that **Start** starts at once. "Downloading" only appears the first time a model is used |
| the models take too much room on this drive | [Settings](view:settings) → **VIK folder** → **Move…**: the agents, the people and the models go to another folder or drive, and VIK restarts there |
| the agent cuts itself off | it hears itself through the speakers: use headphones, or untick **Listens while speaking** in [Voice & timing](view:voice) |
| it cuts you off while you hesitate | raise **End-of-turn silence**, or use the Smart Turn model (see [Voice and timing](voice.md#turn-taking-when-have-you-finished)) |
| it stops for a "mm-hm" | set **Talk over it this long to interrupt** to 600 ms |
| "Click Start first" | the conversation isn't running: click **Start** at the top |
| Settings → OSC shows nothing, though a sensor sends | VIK listens only during a conversation: click **Start**. Check that the sensor sends to this computer's address and to the port in **Listen on port**. From another computer or an Arduino: allow VIK in the Windows firewall (Windows Security → Firewall → Allow an app), and give the computer a fixed address on the Arduino's network. Another program already on the port: VIK says so, choose another |
| it answers in the wrong language | the agent hears and speaks its [Persona](view:persona) **Language**: set it to the language its texts are written in, and change the conversation's language in [Talk](view:talk) or with a pattern (see [Another language](persona.md#another-language)). A line said in the wrong language was written in another language than the agent's |

## Deciding

| what you see | what to do |
|---|---|
| a pattern never fires | try the sentence in **Try a sentence**: its score is below the confidence. Add examples closer to what people say, or lower the confidence. Check that the pattern is on, and in the right stage |
| a pattern fires when it shouldn't | its examples are too short: write whole sentences, or raise the confidence |
| "Decided by Words" | EmbeddingGemma isn't loaded: **Files → Download all models**, then look at the server log |
| "No column fills {…}" under a line | the placeholder is not a column of the table the pattern mentions: check the spelling |

## Language models elsewhere

| what you see | what to do |
|---|---|
| no farm in the list | type the farm computer's address and click **Add**. On the farm computer, **Share compute** must be on |
| each reply fails with a message | the farm or the service is off, full, or refuses the key: choose another model, or go back to **On this computer** |
