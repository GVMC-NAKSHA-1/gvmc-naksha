"""best.pt → ONNX in exactly the form the worker expects, then verify it.

Contract (worker/src/extract/footprints.py · model_probability):
  input  "image": float32 1×3×512×512, RGB scaled to [0, 1]   (normalisation is inside the graph)
  output "prob":  float32 1×1×512×512, building probability in [0, 1]

  python export_onnx.py --ckpt runs/r34_gvmc/best.pt --out ../../models/footprint_unet_r34.onnx
Then set FOOTPRINT_MODEL_PATH=/models/footprint_unet_r34.onnx for the worker.
"""
import argparse
import json
import os

import numpy as np
import torch

from common import TILE, load_checkpoint


def main(a):
    model, ck = load_checkpoint(a.ckpt, sigmoid=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    dummy = torch.rand(1, 3, TILE, TILE)
    torch.onnx.export(model, dummy, a.out, opset_version=17, input_names=["image"], output_names=["prob"],
                      dynamo=False)

    import onnxruntime as ort
    sess = ort.InferenceSession(a.out, providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    assert inp.name == "image" and list(inp.shape) == [1, 3, TILE, TILE], inp
    x = np.random.default_rng(0).random((1, 3, TILE, TILE), dtype=np.float32)
    got = sess.run(None, {"image": x})[0]
    with torch.no_grad():
        want = model(torch.from_numpy(x)).numpy()
    assert got.shape == (1, 1, TILE, TILE), got.shape
    assert 0.0 <= got.min() and got.max() <= 1.0, "output must be a probability"
    diff = float(np.abs(got - want).max())
    assert diff < 1e-4, f"ONNX differs from PyTorch by {diff}"

    meta = {"model": os.path.basename(a.out), "encoder": ck.get("encoder"), "epoch": ck.get("epoch"),
            "val_iou": ck.get("val_iou"), "input": "1x3x512x512 float32 RGB in [0,1]",
            "output": "1x1x512x512 building probability", "max_abs_diff_vs_torch": diff}
    with open(os.path.splitext(a.out)[0] + ".meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"exported {a.out} ({os.path.getsize(a.out) / 1e6:.1f} MB), max |ONNX - torch| = {diff:.2e}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", default="footprint_unet_r34.onnx")
    main(ap.parse_args())
