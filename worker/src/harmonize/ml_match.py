"""ML spatial matching: a gradient-boosted classifier, isotonic-calibrated, that turns a candidate
pair's features (harmonize/features.py) into P(same land record).

The calibrated probability replaces the hand-weighted geometric score in match.py when a model file
exists at MATCH_MODEL_PATH; without one the rule-based path runs unchanged. Train with
`python src/train_matcher.py` (synthetic cold start, then officer labels from match_labels) or the
RETRAIN_MATCHER queue job.
"""
import json
import os
import tempfile
from datetime import datetime, timezone

import numpy as np

from harmonize.features import FEATURES, pair_features, to_row

DEFAULT_PATH = "/models/match_model.joblib"
THRESHOLD = float(os.environ.get("MATCH_ML_THRESHOLD", "0.5"))
_cache = {"path": None, "mtime": None, "bundle": None}


def model_path():
    return os.environ.get("MATCH_MODEL_PATH") or DEFAULT_PATH


def load(path=None):
    """The model bundle, or None. Re-reads the file when a retrain replaced it (mtime changed)."""
    path = path or model_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    if _cache["path"] == path and _cache["mtime"] == mtime:
        return _cache["bundle"]
    import joblib
    bundle = joblib.load(path)
    if bundle.get("features") != FEATURES:
        print(f"[ml_match] {path} was trained on other features - ignoring it, retrain the matcher")
        bundle = None
    _cache.update(path=path, mtime=mtime, bundle=bundle)
    return bundle


def predict(bundle, feature_dicts):
    if not feature_dicts:
        return np.zeros(0)
    X = np.array([to_row(f) for f in feature_dicts], dtype=float)
    return bundle["model"].predict_proba(X)[:, 1]


def rule_probability(pair):
    """What the rule-based matcher says, on the same 0–1 scale — the baseline the model must beat."""
    return float(pair["match_score"]) / 100


def dataset(pairs, rename):
    feats = [pair_features(p, rename.get((str(p["a_source"]), str(p["b_source"])), {})) for p in pairs]
    return np.array([to_row(f) for f in feats], dtype=float)


def _metrics(y, prob, threshold=0.5):
    from sklearn.metrics import brier_score_loss, f1_score, precision_score, recall_score, roc_auc_score
    pred = prob >= threshold
    return {"roc_auc": round(float(roc_auc_score(y, prob)), 4),
            "f1": round(float(f1_score(y, pred)), 4),
            "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y, pred)), 4),
            "brier": round(float(brier_score_loss(y, prob)), 4)}


def _classifier(seed):
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.ensemble import HistGradientBoostingClassifier
    gbm = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=31,
                                         l2_regularization=1.0, random_state=seed)
    return CalibratedClassifierCV(gbm, method="isotonic", cv=3)


def _split_by_group(groups, seed, test_share=0.2):
    """Hold out whole groups, 20 % of each family separately: wards ("ward-…") and synthetic blocks.
    A few wards among hundreds of blocks would otherwise often all land in training, leaving no
    held-out ward to report on."""
    rng = np.random.default_rng(seed)
    groups = np.asarray([str(g) for g in groups])
    test_groups = set()
    for is_ward in (True, False):
        fam = sorted({g for g in groups if g.startswith("ward-") == is_ward})
        if len(fam) > 1:
            k = max(1, round(test_share * len(fam)))
            test_groups.update(rng.choice(fam, size=k, replace=False).tolist())
    te_mask = np.isin(groups, list(test_groups))
    return np.nonzero(~te_mask)[0], np.nonzero(te_mask)[0]


def train(X, y, groups, weights=None, baseline=None, seed=0, sources=None):
    """Hold out 20 % of groups (blocks / wards — never random rows, neighbours would leak), report
    metrics on them, then refit on everything. → bundle ready for joblib.dump."""
    import sklearn
    y = np.asarray(y, dtype=int)
    w = np.ones(len(y)) if weights is None else np.asarray(weights, dtype=float)
    tr, te = _split_by_group(groups, seed)
    held = _classifier(seed).fit(X[tr], y[tr], sample_weight=w[tr])
    prob = held.predict_proba(X[te])[:, 1]
    metrics = {"test": _metrics(y[te], prob),
               "n_train": int(len(tr)), "n_test": int(len(te)), "positive_rate": round(float(y.mean()), 4)}
    if baseline is not None:
        # Rule score vs model on the held-out rows that have one (officer label snapshots do not).
        base = np.asarray(baseline, dtype=float)[te]
        known = ~np.isnan(base)
        if known.any() and len(set(y[te][known])) > 1:
            metrics["rule_baseline_test"] = _metrics(y[te][known], base[known])
            metrics["model_on_same_rows"] = _metrics(y[te][known], prob[known])
    g_te = np.asarray(groups)[te]
    wards = sorted({g for g in g_te if str(g).startswith("ward-")})
    metrics["test_by_ward"] = {
        g: {"pairs": int((g_te == g).sum()), **_metrics(y[te][g_te == g], prob[g_te == g])}
        for g in wards if len(set(y[te][g_te == g])) > 1}
    model = _classifier(seed).fit(X, y, sample_weight=w)
    return {"model": model, "features": FEATURES, "metrics": metrics, "sources": sources or {},
            "version": datetime.now(timezone.utc).strftime("match-%Y%m%d-%H%M%S"),
            "trained_at": datetime.now(timezone.utc).isoformat(), "sklearn": sklearn.__version__,
            "held_out": (X[te], y[te])}


def save(bundle, path=None):
    """Atomic write (a worker may be loading the old file) + a readable .meta.json next to it."""
    import joblib
    path = path or model_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", suffix=".tmp")
    os.close(fd)
    joblib.dump({k: v for k, v in bundle.items() if k != "held_out"}, tmp)
    os.replace(tmp, path)
    meta = {k: bundle[k] for k in ("version", "trained_at", "sklearn", "features", "metrics", "sources")}
    with open(os.path.splitext(path)[0] + ".meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    return path
