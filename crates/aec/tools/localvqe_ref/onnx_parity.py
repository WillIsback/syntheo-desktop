"""Fidélité de l'export ONNX tiers (soniqo) seul : on lui donne les sorties e / ŷ du frontal
officiel (pilote `lvqe_ref daf`), on refait l'analyse STFT, le masque ONNX et la synthèse, et on
compare à la sortie officielle 200K. `matrix` : analyse et synthèse par les matrices du GGUF
(`encoder.conv.weight`, `decoder.linear.weight`) au lieu de la FFT.

    python3 onnx_parity.py $WORK [fft|matrix]

Prérequis : numpy, onnxruntime, et gguf pour le mode matrix.
"""
import json, sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

WORK = Path(sys.argv[1])
MODE = sys.argv[2] if len(sys.argv) > 2 else "fft"
MODELS = Path(__file__).resolve().parents[2] / "data" / "models"
window = np.array(json.loads((MODELS / "LocalVQEAECFrontend.json").read_text())["analysis_window"], np.float32)

if MODE == "matrix":
    import gguf
    tensors = {t.name: np.array(t.data, np.float32) for t in gguf.GGUFReader(WORK / "models/localvqe-v1.4-aec-200K-f32.gguf").tensors}
    W_ENC = tensors["encoder.conv.weight"].reshape(512, 512)
    W_DEC = tensors["decoder.linear.weight"].reshape(512, 512)


def analysis(frame):
    if MODE == "matrix":
        z = W_ENC @ frame
        return np.stack([z[0::2], z[1::2]])
    X = np.fft.rfft((window * frame).astype(np.float64))[1:257]
    return np.stack([X.real, X.imag]).astype(np.float32)


def synthesis(spec):
    if MODE == "matrix":
        z = np.empty(512, np.float32); z[0::2] = spec[0]; z[1::2] = spec[1]
        return W_DEC @ z
    X = np.zeros(257, complex); X[1:] = spec[0] + 1j * spec[1]; X[256] *= 2.0
    return (np.fft.irfft(X, 512) * window).astype(np.float32)


opts = ort.SessionOptions(); opts.intra_op_num_threads = 1; opts.inter_op_num_threads = 1
session = ort.InferenceSession(str(MODELS / "LocalVQEAECResidualMask.onnx"), opts, providers=["CPUExecutionProvider"])
state_inputs = [i for i in session.get_inputs() if i.name.endswith("_state")]

for name in ["doubletalk", "syntheo", "theo"]:
    e = np.fromfile(WORK / f"out/{name}_daf_e.f32", "<f4")
    y = np.fromfile(WORK / f"out/{name}_daf_y.f32", "<f4")
    expected = np.fromfile(WORK / f"out/{name}_200K.f32", "<f4")
    states = {i.name: np.zeros([d if isinstance(d, int) and d > 0 else 1 for d in i.shape], np.float32) for i in state_inputs}
    prev_e = np.zeros(256, np.float32); prev_y = np.zeros(256, np.float32); ola = np.zeros(512, np.float32)
    out = np.zeros_like(expected)
    for t in range(0, len(expected), 256):
        feeds = {
            "mic_spectrum": analysis(np.concatenate([prev_e, e[t:t + 256]]))[None, :, None, :],
            "reference_spectrum": analysis(np.concatenate([prev_y, y[t:t + 256]]))[None, :, None, :],
            **states,
        }
        prev_e, prev_y = e[t:t + 256].copy(), y[t:t + 256].copy()
        results = dict(zip([o.name for o in session.get_outputs()], session.run(None, feeds)))
        for key in states:
            states[key] = results[f"next_{key}"]
        ola += synthesis(results["enhanced_spectrum"].reshape(2, 256))
        out[t:t + 256] = ola[:256]
        ola = np.concatenate([ola[256:], np.zeros(256, np.float32)])
    diff = out - expected
    snr = 10 * np.log10((expected ** 2).sum() / (diff ** 2).sum())
    print(f"{name} ({MODE}) : erreur max {np.abs(diff).max():.2e}, SNR {snr:.1f} dB")
