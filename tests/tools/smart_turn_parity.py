#!/usr/bin/env python3
"""Model parity for tests/test-smart-turn.mjs: runs the REAL Smart Turn ONNX model (onnxruntime, Python)
on the features computed in JavaScript and on the reference features (Pipecat's numpy implementation)
of the same signals, and prints the two probabilities. This validates the whole JavaScript pipeline
without onnxruntime-node.

    python3 tests/tools/smart_turn_parity.py MODEL.onnx DIR

DIR holds manifest.json, a list of {"name", "signal", "features"}: "signal" is a raw float32 file
(16 kHz audio, as given to the Smart Turn pipeline), "features" the raw float32 80×800 features
computed by 2_qvac_local/src/turn/whisper-features.mjs. Prints one JSON object on stdout.
Needs numpy and onnxruntime.
"""
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repository
import json
import os

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _whisper_features import compute_whisper_log_mel_features  # noqa: E402  (vendored, BSD-2)
from make_smart_turn_fixtures import smart_turn_input  # noqa: E402


def main():
    model, folder = sys.argv[1], sys.argv[2]
    with open(os.path.join(folder, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    so = ort.SessionOptions()
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.inter_op_num_threads = 1
    so.intra_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(model, sess_options=so)
    results = []
    for item in manifest:
        signal = np.fromfile(os.path.join(folder, item["signal"]), dtype=np.float32)
        js = np.fromfile(os.path.join(folder, item["features"]), dtype=np.float32).reshape(1, 80, 800)
        ref = compute_whisper_log_mel_features(smart_turn_input(signal), do_normalize=True)[None, :, :]
        p_js = float(session.run(None, {"input_features": js})[0][0][0])
        p_ref = float(session.run(None, {"input_features": ref})[0][0][0])
        results.append({"name": item["name"], "js": p_js, "ref": p_ref,
                        "featureDiff": float(np.abs(js - ref).max())})
    print(json.dumps({"onnxruntime": ort.__version__, "results": results}))


if __name__ == "__main__":
    main()
