"""Train the spatial-matching model (harmonize/ml_match.py).

Data = the built open-data pack (harmonize/pack_pairs.py: every ward, labelled by its answer key)
+ synthetic labelled pairs (harmonize/synth_pairs.py) + officer decisions
from match_labels (each row carries the feature snapshot taken when the match was shown), with
officer labels weighted up. The new model replaces the current one only if it is at least as good
on the same held-out pairs.

  python src/train_matcher.py --pack ../data/out --no-db --out models/match_model.joblib   # all 98 wards
  python src/train_matcher.py                    # synthetic + officer labels (if DATABASE_URL is set)
Queue job: RETRAIN_MATCHER {minNewLabels?: 200, force?: false}
"""
import argparse
import json
import os

import numpy as np

from harmonize import ml_match, synth_pairs
from harmonize.features import to_row

OFFICER_WEIGHT = 3.0


def officer_labels(since=None):
    """[(feature row, label, ward)] from match_labels; [] when the table or DB is not there."""
    if not os.environ.get("DATABASE_URL"):
        return []
    from db import cursor
    with cursor() as cur:
        cur.execute("SELECT to_regclass('public.match_labels') AS t")
        if not cur.fetchone()["t"]:
            return []
        cur.execute("""SELECT features, label, ward_id FROM match_labels
                       WHERE features <> '{}'::jsonb AND (%s::timestamptz IS NULL OR labelled_at > %s)""",
                    (since, since))
        return [(to_row(r["features"]), bool(r["label"]), r["ward_id"] or "?") for r in cur.fetchall()]


def build_and_train(n_blocks=400, seed=0, use_db=True, pack_dir=None, wards=None):
    """Training rows from up to three sources, grouped (for the held-out split) by block or ward:
    synthetic blocks, the built open-data pack (all its wards, answer-keyed), officer labels."""
    X_parts, y, groups, weights, baseline, sources = [], [], [], [], [], {}
    if n_blocks:
        pairs, rename, g = synth_pairs.generate(n_blocks, seed)
        X_parts.append(ml_match.dataset(pairs, rename))
        y += [p["label"] for p in pairs]
        groups += [f"synth-{b}" for b in g]
        baseline += [ml_match.rule_probability(p) for p in pairs]
        sources.update(synthetic_pairs=len(pairs), synthetic_blocks=n_blocks)
    if pack_dir:
        from harmonize.pack_pairs import pack_pairs
        pairs, rename, g = pack_pairs(pack_dir, wards)
        if pairs:
            X_parts.append(ml_match.dataset(pairs, rename))
            y += [p["label"] for p in pairs]
            groups += g
            baseline += [ml_match.rule_probability(p) for p in pairs]
        sources.update(pack_pairs=len(pairs), pack_wards=len(set(g)))
    weights = [1.0] * len(y)
    officer = officer_labels() if use_db else []
    if officer:
        X_parts.append(np.array([row for row, _, _ in officer], dtype=float))
        y += [lab for _, lab, _ in officer]
        groups += [f"ward-{w}" for _, _, w in officer]
        weights += [OFFICER_WEIGHT] * len(officer)
        baseline += [np.nan] * len(officer)          # label snapshots carry no rule score
    sources["officer_labels"] = len(officer)
    if not y:
        raise ValueError("no training data: give --blocks, --pack or officer labels")
    return ml_match.train(np.vstack(X_parts), y, groups, weights, baseline, seed, sources=sources)


def train_and_maybe_promote(path=None, n_blocks=400, seed=0, use_db=True, force=False, pack_dir=None, wards=None):
    path = path or ml_match.model_path()
    new = build_and_train(n_blocks, seed, use_db, pack_dir, wards)
    X_te, y_te = new["held_out"]
    current = ml_match.load(path)
    result = {"version": new["version"], "metrics": new["metrics"], "sources": new["sources"], "path": path}
    if current is not None and not force:
        cur_f1 = ml_match._metrics(y_te, current["model"].predict_proba(X_te)[:, 1])["f1"]
        result["current_version"], result["current_f1_on_same_test"] = current["version"], cur_f1
        if new["metrics"]["test"]["f1"] < cur_f1:
            result["promoted"] = False
            return result
    ml_match.save(new, path)
    result["promoted"] = True
    return result


def retrain_matcher(job):
    """Queue handler. Skips unless enough new officer labels arrived since the current model."""
    current = ml_match.load()
    since = current["trained_at"] if current else None
    new_labels = len(officer_labels(since))
    need = int(job.get("minNewLabels", 200))
    if current is not None and not job.get("force") and new_labels < need:
        return {"skipped": f"{new_labels} new officer labels since {current['version']} (need {need})"}
    result = train_and_maybe_promote(force=bool(job.get("force")), pack_dir=os.environ.get("MATCH_TRAIN_PACK"))
    print(f"[retrain] {json.dumps(result)}")
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help=f"model path (default MATCH_MODEL_PATH or {ml_match.DEFAULT_PATH})")
    ap.add_argument("--pack", help="built open-data pack (data/out): every ward-*/ with match_truth is used")
    ap.add_argument("--wards", help="comma-separated ward ids to use from --pack (default: all)")
    ap.add_argument("--blocks", type=int, default=400, help="synthetic city blocks to add (0 = none)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--no-db", "--synthetic-only", dest="no_db", action="store_true",
                    help="ignore officer labels in the DB")
    ap.add_argument("--force", action="store_true", help="replace the current model even if it scores better")
    a = ap.parse_args()
    wards = [w.strip() for w in a.wards.split(",")] if a.wards else None
    print(json.dumps(train_and_maybe_promote(a.out, a.blocks, a.seed, not a.no_db, a.force, a.pack, wards), indent=2))
