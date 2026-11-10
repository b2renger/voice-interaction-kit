The voice models VIK uses, for networks that block QVAC's peer-to-peer network (many school and company networks do). VIK 3.0.1 and later download them from here over HTTPS when they are missing; you never need to open this page.

**By hand** (a classroom without internet, a USB key): download the files below and put them in VIK's models folder (in VIK: **Files → Open models folder**; on Windows `C:\Users\<you>\.qvac\models`, on a Mac `~/.qvac/models`). VIK finds them at its next launch. Copying that whole folder from a computer that has the models works too.

| File | Voice | Size | Licence |
|---|---|---|---|
| `supertonic3-q8_0.gguf` | Supertonic 3, the default voice | 127 MB | BigScience OpenRAIL-M (`LICENSE-supertonic-3.txt`, with its use restrictions) |
| `parler-mini-v1-q8_0.gguf` | Parler-TTS mini v1 | 1.16 GB | Apache 2.0 (`LICENSE-parler-tts.txt`) |
| `chatterbox-t3-mtl-q4_0.gguf` | Chatterbox multilingual | 345 MB | MIT (`LICENSE-chatterbox.txt`) |
| `chatterbox-s3gen-mtl-q4_0.gguf` | Chatterbox multilingual, part 2 | 788 MB | MIT (`LICENSE-chatterbox.txt`) |

These are unmodified copies of the GGUF files in QVAC's model registry (by Tether), converted by QVAC from [Supertone/supertonic-3](https://huggingface.co/Supertone/supertonic-3), [parler-tts/parler-tts-mini-v1](https://huggingface.co/parler-tts/parler-tts-mini-v1) and [ResembleAI/chatterbox](https://huggingface.co/ResembleAI/chatterbox). Each one matches the size and SHA-256 in QVAC's catalogue (`SHA256SUMS.txt`), and VIK checks both before using a file. Every Chatterbox output carries Resemble's Perth watermark.

The **Models mirror** workflow (`.github/workflows/models.yml`) builds this release.
