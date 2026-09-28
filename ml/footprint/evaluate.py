"""Score the exported ONNX model (the file the worker will run) on held-out test tiles.

Reports pixel IoU / precision / recall and building-level F1 (a predicted building counts when it
overlaps a labelled one with IoU ≥ 0.5), next to the worker's `classical` RGB fallback on the same
tiles, so the gain from deep learning is measured rather than assumed.

  python evaluate.py --onnx ../../models/footprint_unet_r34.onnx --data tiles_gvmc --split test
Targets for GVMC: pixel IoU ≥ 0.70, building F1 ≥ 0.75.
"""
import argparse
import glob
import json
import os
import sys
import types

import numpy as np

WORKER_SRC = os.path.join(os.path.dirname(__file__), "..", "..", "worker", "src")


def worker_footprints():
    """Import worker/src/extract/footprints.py for its classical_mask / clean_mask, without its DB,
    queue and storage clients (only needed by the job wrapper, not by the pure mask functions)."""
    class _Stub(types.ModuleType):
        def __getattr__(self, name):
            return None
    for m in ("db", "queue_client", "r2"):
        sys.modules.setdefault(m, _Stub(m))
    sys.path.insert(0, os.path.abspath(WORKER_SRC))
    from extract import footprints
    return footprints


def building_f1(pred, gt, min_px=40, iou_thr=0.5):
    """Greedy one-to-one component matching by IoU → (tp, fp, fn)."""
    import cv2
    npred, lp = cv2.connectedComponents(pred.astype(np.uint8), connectivity=8)
    ngt, lg = cv2.connectedComponents(gt.astype(np.uint8), connectivity=8)
    area_p = np.bincount(lp.ravel(), minlength=npred)
    area_g = np.bincount(lg.ravel(), minlength=ngt)
    keep_p = {i for i in range(1, npred) if area_p[i] >= min_px}
    keep_g = {i for i in range(1, ngt) if area_g[i] >= min_px}
    both = (lp > 0) & (lg > 0)
    inter = np.bincount(lp[both] * ngt + lg[both], minlength=npred * ngt).reshape(npred, ngt)
    cand = []
    for i, j in zip(*np.nonzero(inter)):
        if i in keep_p and j in keep_g:
            iou = inter[i, j] / (area_p[i] + area_g[j] - inter[i, j])
            if iou >= iou_thr:
                cand.append((iou, i, j))
    used_p, used_g = set(), set()
    for _, i, j in sorted(cand, reverse=True):
        if i not in used_p and j not in used_g:
            used_p.add(i); used_g.add(j)
    tp = len(used_p)
    return tp, len(keep_p) - tp, len(keep_g) - tp


def summarise(c):
    iou = c["inter"] / max(c["union"], 1)
    prec = c["inter"] / max(c["pred"], 1)
    rec = c["inter"] / max(c["gt"], 1)
    f1 = 2 * c["tp"] / max(2 * c["tp"] + c["fp"] + c["fn"], 1)
    return {"pixel_iou": round(iou, 4), "pixel_precision": round(prec, 4), "pixel_recall": round(rec, 4),
            "building_f1": round(f1, 4), "buildings_tp": c["tp"], "buildings_fp": c["fp"], "buildings_fn": c["fn"]}


def main(a):
    import cv2
    import onnxruntime as ort
    fp = worker_footprints()
    sess = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"])
    images = sorted(glob.glob(os.path.join(a.data, a.split, "images", "*.png")))[: a.limit or None]
    if not images:
        sys.exit(f"no tiles in {os.path.join(a.data, a.split, 'images')}")
    counts = {k: {"inter": 0, "union": 0, "pred": 0, "gt": 0, "tp": 0, "fp": 0, "fn": 0} for k in ("model", "classical")}
    for path in images:
        rgb = cv2.cvtColor(cv2.imread(path), cv2.COLOR_BGR2RGB)
        gt = cv2.imread(path.replace(f"{os.sep}images{os.sep}", f"{os.sep}masks{os.sep}"), cv2.IMREAD_GRAYSCALE) > 127
        x = (rgb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        prob = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
        preds = {"model": fp.clean_mask(prob >= a.threshold, a.pixel_m),
                 "classical": fp.clean_mask(fp.classical_mask(rgb), a.pixel_m)}
        for k, pred in preds.items():
            c = counts[k]
            c["inter"] += int((pred & gt).sum()); c["union"] += int((pred | gt).sum())
            c["pred"] += int(pred.sum()); c["gt"] += int(gt.sum())
            tp, fpos, fneg = building_f1(pred, gt, min_px=max(1, int(a.min_area_sqm / a.pixel_m ** 2)))
            c["tp"] += tp; c["fp"] += fpos; c["fn"] += fneg
    report = {"tiles": len(images), "split": a.split, "threshold": a.threshold,
              "deep_learning": summarise(counts["model"]), "classical_baseline": summarise(counts["classical"])}
    print(json.dumps(report, indent=2))
    if a.report:
        with open(a.report, "w") as f:
            json.dump(report, f, indent=2)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--split", default="test")
    ap.add_argument("--threshold", type=float, default=0.5, help="worker default prob_threshold")
    ap.add_argument("--pixel-m", type=float, default=0.3, help="tile GSD, for clean-up kernel and min area")
    ap.add_argument("--min-area-sqm", type=float, default=20.0, help="worker default min_area_sqm")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--report", help="also write the JSON report here")
    main(ap.parse_args())
