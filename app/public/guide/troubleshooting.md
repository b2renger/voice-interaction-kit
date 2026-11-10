# If something goes wrong

Most problems show in the banner of [Talk](view:talk), in plain words. The menu **Files → Server log** shows the studio's latest messages, to understand an error.

## Starting up

| what you see | what to do |
|---|---|
| the loading stays at 0 %, "waiting for data" | the network blocks the download. Put the model files in the models folder by hand (see [On a school network](models.md#on-a-school-network)), or do the first launch on another network, a home Wi-Fi or a phone hotspot |
| "3 models could not be downloaded" | the reason is in **Files → Server log**. The dialog's **Open the download page** shows the voice files: put them in the models folder (**Open models folder**), then restart VIK |
| a Vulkan error (Windows) | update the graphics driver |
| the first reply is slow | the models load at startup: wait for **The models are ready** |
| after choosing Parler or Chatterbox, nothing is said for a long time | the first use downloads the voice (over 1 GB): watch the banner. On Windows, Chatterbox runs on the processor and takes long for each sentence: Supertonic is the fastest voice |

## Talking

| what you see | what to do |
|---|---|
| no sound from the microphone (Mac) | System Settings → Privacy & Security → Microphone: allow VIK |
| the agent cuts itself off | it hears itself through the speakers: use headphones, or untick **Listens while speaking** in [Voice & timing](view:voice) |
| it cuts you off while you hesitate | raise **End-of-turn silence**, or use the Smart Turn model (see [Voice and timing](voice.md#turn-taking-when-have-you-finished)) |
| it stops for a "mm-hm" | set **Talk over it this long to interrupt** to 600 ms |
| "Click Start first" | the conversation isn't running: click **Start** at the top |

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
