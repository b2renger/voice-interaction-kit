#!/usr/bin/env python3
"""Makes tests/fixtures/smart-turn-features.json for tests/test-smart-turn.mjs.

The reference Smart Turn features (Pipecat's numpy implementation, compute_whisper_log_mel_features
with do_normalize=True, after keeping the last 8 s and zero-padding at the beginning like
local_smart_turn_v3.py) of deterministic test signals. For each signal it stores the shape, the values
at fixed indices, and the mean / std / min / max, plus a checksum of the input signal.

    python3 tests/tools/make_smart_turn_fixtures.py
    python3 tests/tools/make_smart_turn_fixtures.py --reference /path/to/pipecat/.../_whisper_features.py

Without --reference it uses the vendored copy next to this file (tests/tools/_whisper_features.py).
Needs numpy. The signals are generated the SAME way in tests/test-smart-turn.mjs (smartTurnSignal):
keep the two in sync.
"""
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repository
import argparse
import importlib.util
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SR = 16000
KINDS = ["silence", "tone", "noise", "chirp", "vowels"]
SECONDS = [1, 3, 9]


def load_reference(path):
    spec = importlib.util.spec_from_file_location("_whisper_features_ref", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.compute_whisper_log_mel_features


def smart_turn_signal(kind, seconds):
    """A deterministic float32 test signal (same formulas, same order of operations as the JS test)."""
    n = seconds * SR
    out = [0.0] * n
    if kind == "tone":                       # 180 Hz, slow amplitude wobble, 50 ms fade in/out
        for i in range(n):
            t = i / SR
            env = min(1.0, t / 0.05, (seconds - t) / 0.05)
            out[i] = 0.4 * env * math.sin(2 * math.pi * 180 * t) * (0.6 + 0.4 * math.sin(2 * math.pi * 3 * t))
    elif kind == "noise":                    # white noise from a 32-bit LCG, fixed seed
        seed = 12345
        for i in range(n):
            seed = (seed * 1664525 + 1013904223) % 4294967296
            out[i] = (seed / 4294967296 - 0.5) * 0.2
    elif kind == "chirp":                    # 100 Hz → 3 kHz linear sweep
        f0 = 100.0
        f1 = 3000.0
        for i in range(n):
            t = i / SR
            out[i] = 0.3 * math.sin(2 * math.pi * (f0 * t + (f1 - f0) * t * t / (2 * seconds)))
    elif kind == "vowels":                   # voice-like: a gliding fundamental, harmonics, 4 syllables/s
        for i in range(n):
            t = i / SR
            syll = 0.5 + 0.5 * math.sin(2 * math.pi * 4 * t)
            f0 = 140 + 30 * math.sin(2 * math.pi * 0.7 * t)
            out[i] = 0.3 * syll * (math.sin(2 * math.pi * f0 * t) + 0.6 * math.sin(2 * math.pi * 2 * f0 * t)
                                   + 0.3 * math.sin(2 * math.pi * 3 * f0 * t)) / 1.9
    return np.asarray(out, dtype=np.float64).astype(np.float32)


def smart_turn_input(audio, n_seconds=8):
    """local_smart_turn_v3.py: keep the last 8 s, or zero-pad at the BEGINNING up to 8 s."""
    max_samples = n_seconds * SR
    if len(audio) > max_samples:
        return audio[-max_samples:]
    if len(audio) < max_samples:
        return np.pad(audio, (max_samples - len(audio), 0), mode="constant", constant_values=0)
    return audio


def fixed_indices():
    """400 flat indices into the [80][800] features: 300 spread everywhere, 100 in the last second."""
    idx = [(j * 7919 + 13) % 64000 for j in range(300)]
    idx += [((j * 29) % 80) * 800 + 700 + (j * 37) % 100 for j in range(100)]
    return idx


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reference", default=os.path.join(HERE, "_whisper_features.py"),
                    help="path of Pipecat's _whisper_features.py (default: the vendored copy)")
    ap.add_argument("--out", default=os.path.join(ROOT, "tests", "fixtures", "smart-turn-features.json"))
    a = ap.parse_args()
    features = load_reference(a.reference)
    indices = fixed_indices()
    signals = []
    for kind in KINDS:
        for sec in SECONDS:
            sig = smart_turn_signal(kind, sec)
            f = features(smart_turn_input(sig), do_normalize=True)
            flat = f.reshape(-1)
            s64 = sig.astype(np.float64)
            signals.append({
                "name": f"{kind}-{sec}s",
                "kind": kind,
                "seconds": sec,
                "input": {"n": int(len(sig)), "sum": float(s64.sum()), "sumsq": float((s64 * s64).sum())},
                "shape": list(f.shape),
                "values": [round(float(flat[i]), 6) for i in indices],
                "mean": float(f.astype(np.float64).mean()),
                "std": float(f.astype(np.float64).std()),
                "min": float(f.min()),
                "max": float(f.max()),
            })
            print(f"{kind:8s} {sec}s  mean {signals[-1]['mean']:+.4f}  min {signals[-1]['min']:+.4f}  max {signals[-1]['max']:+.4f}")
    doc = {
        "about": "Reference Smart Turn v3 features (Pipecat _whisper_features.py, do_normalize=True) of the "
                 "test signals of tests/test-smart-turn.mjs. Made by tests/tools/make_smart_turn_fixtures.py.",
        "numpy": np.__version__,
        "indices": indices,
        "signals": signals,
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"→ {os.path.relpath(a.out, ROOT)} ({os.path.getsize(a.out) // 1024} KB)")


if __name__ == "__main__":
    sys.exit(main())
