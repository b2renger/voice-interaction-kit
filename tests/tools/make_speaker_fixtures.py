#!/usr/bin/env python3
"""Makes tests/fixtures/speaker-fbank.json for tests/test-speakers.mjs.

The reference filter banks of the speaker model's input, by kaldi-native-fbank (the Kaldi implementation
sherpa-onnx uses for WeSpeaker's models): 80 bins, 25 ms frames every 10 ms, dither 0, Hamming window, the
waveform scaled to 16-bit values, then each bin's mean over time removed (as WeSpeaker does).
For each signal it stores the number of frames and the values at fixed indices.

    python3 tests/tools/make_speaker_fixtures.py

Needs numpy and kaldi-native-fbank (pip install numpy kaldi-native-fbank). The signals are generated the SAME
way in tests/test-speakers.mjs (signal): keep the two in sync.
"""
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repository
import json
import math
import os

import numpy as np
import kaldi_native_fbank as knf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SR = 16000
SIGNALS = [("tones", 0.6), ("vowel", 1.3)]


def signal(kind, seconds):
    n = int(SR * seconds)
    x = np.zeros(n, dtype=np.float64)
    for i in range(n):
        t = i / SR
        if kind == "tones":
            x[i] = 0.3 * math.sin(2 * math.pi * 220 * t) + 0.2 * math.sin(2 * math.pi * 1730 * t) + 0.05 * math.sin(2 * math.pi * 5100 * t + 0.3)
        else:  # a buzz at 140 Hz shaped by two formants, louder then softer
            env = 0.2 + 0.8 * math.sin(math.pi * i / n)
            x[i] = env * (0.25 * math.sin(2 * math.pi * 140 * t) + 0.12 * math.sin(2 * math.pi * 700 * t) * math.sin(2 * math.pi * 140 * t)
                          + 0.08 * math.sin(2 * math.pi * 1200 * t + 1.0))
    return x.astype(np.float32)


def fbank(x):
    o = knf.FbankOptions()
    o.frame_opts.dither = 0
    o.frame_opts.samp_freq = SR
    o.frame_opts.window_type = "hamming"
    o.mel_opts.num_bins = 80
    f = knf.OnlineFbank(o)
    f.accept_waveform(SR, (x.astype(np.float64) * 32768).tolist())
    f.input_finished()
    m = np.array([f.get_frame(i) for i in range(f.num_frames_ready)], dtype=np.float64)
    return m - m.mean(axis=0)


def main():
    out = {"made_by": "tests/tools/make_speaker_fixtures.py (kaldi-native-fbank " + getattr(knf, "__version__", "?") + ")", "signals": []}
    for kind, seconds in SIGNALS:
        m = fbank(signal(kind, seconds))
        flat = m.reshape(-1)
        idx = list(range(0, flat.size, 7))
        out["signals"].append({"kind": kind, "seconds": seconds, "frames": int(m.shape[0]), "indices": idx, "values": [round(float(flat[i]), 5) for i in idx]})
    path = os.path.join(ROOT, "tests", "fixtures", "speaker-fbank.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print("wrote", path, [(s["kind"], s["frames"]) for s in out["signals"]])


if __name__ == "__main__":
    main()
