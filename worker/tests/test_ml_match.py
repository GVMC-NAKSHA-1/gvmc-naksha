import math

import pytest

from harmonize import ml_match, synth_pairs
from harmonize.features import FEATURES, pair_features, to_json, to_row
from harmonize.match import apply_model


def poly_pair(**kw):
    p = {"a_id": "a1", "b_id": "b1", "a_source": "s1", "b_source": "s2", "a_type": "cadastral",
         "b_type": "municipal_gis", "a_props": {"owner_name": "Ravi Kumar Reddy", "survey_no": "101/3"},
         "b_props": {"owner": "R. Kumar Reddy", "survey_no": "101/3"}, "a_captured": None, "b_captured": None,
         "iou": 0.8, "dist_m": None, "area_a": 200.0, "area_b": 190.0, "perim_a": 60.0, "perim_b": 58.0,
         "hausdorff_m": 1.2, "match_score": 80.0}
    p.update(kw)
    return p


def test_features_cover_every_name_in_order():
    f = pair_features(poly_pair())
    assert set(f) == set(FEATURES)
    assert len(to_row(f)) == len(FEATURES)
    assert f["is_point_pair"] == 0.0 and f["src_cadastral"] == 1.0 and f["src_revenue"] == 0.0
    assert f["area_ratio"] == pytest.approx(0.95)


def test_owner_is_compared_across_department_field_names():
    # cadastral "owner_name" vs municipal "owner": no schema mapping needed for the owner signal
    assert pair_features(poly_pair())["owner_sim"] > 0.6
    assert pair_features(poly_pair(b_props={"owner": "Lakshmi Varma"}))["owner_sim"] < 0.5


def test_point_pair_has_missing_polygon_features_as_nan():
    f = pair_features(poly_pair(iou=None, dist_m=4.0, area_b=None, perim_b=None, hausdorff_m=None, b_type="revenue"))
    assert f["is_point_pair"] == 1.0
    assert math.isnan(f["iou"]) and math.isnan(f["area_ratio"]) and math.isnan(f["hausdorff_m"])


def test_json_snapshot_has_no_nan_and_round_trips():
    f = pair_features(poly_pair(iou=None, dist_m=4.0, area_b=None))
    snap = to_json(f)
    assert None in snap.values() and not any(isinstance(v, float) and math.isnan(v) for v in snap.values())
    row = to_row(snap)
    assert math.isnan(row[FEATURES.index("area_ratio")])


def test_synthetic_pairs_follow_the_sql_rules():
    pairs, rename, groups = synth_pairs.generate(5, seed=1)
    assert pairs and len(pairs) == len(groups)
    for p in pairs:
        assert p["a_type"] != p["b_type"]
        assert (p["iou"] or 0) >= 0.30 or (p["dist_m"] if p["dist_m"] is not None else 999) <= 25
    assert {True, False} <= {p["label"] for p in pairs}


@pytest.fixture(scope="module")
def bundle():
    pairs, rename, groups = synth_pairs.generate(40, seed=2)
    X = ml_match.dataset(pairs, rename)
    return ml_match.train(X, [p["label"] for p in pairs], groups,
                          baseline=[ml_match.rule_probability(p) for p in pairs], seed=0)


def test_trained_model_is_calibrated_and_beats_the_rules(bundle):
    m = bundle["metrics"]
    assert bundle["features"] == FEATURES
    assert m["test"]["roc_auc"] > 0.9
    assert m["test"]["f1"] > m["rule_baseline_test"]["f1"]


def test_save_and_reload(bundle, tmp_path):
    path = ml_match.save(bundle, str(tmp_path / "m.joblib"))
    loaded = ml_match.load(path)
    assert loaded["version"] == bundle["version"] and "held_out" not in loaded
    assert (tmp_path / "m.meta.json").exists()
    assert ml_match.load(str(tmp_path / "missing.joblib")) is None


def test_apply_model_rescores_and_drops_unlikely_pairs(bundle):
    good = poly_pair()
    bad = poly_pair(b_id="b2", iou=None, dist_m=22.0, area_b=None, perim_b=None, hausdorff_m=None, b_type="revenue",
                    b_props={"owner_name": "Lakshmi Varma", "survey_no": "250/9"}, match_score=12.0)
    out = apply_model([good, bad], {}, bundle)
    assert [p["b_id"] for p in out] == ["b1"]
    assert out[0]["match_score"] == pytest.approx(100 * out[0]["ml_probability"], abs=0.01)
    assert out[0]["geo_score"] == 80.0 and "features" in out[0]
    # an officer-confirmed pair is kept whatever the model says
    kept = apply_model([bad], {}, bundle, locked=[("a1", "b2")])
    assert [p["b_id"] for p in kept] == ["b2"]


def test_without_a_model_scores_are_untouched():
    out = apply_model([poly_pair()], {}, None)
    assert out[0]["match_score"] == 80.0 and "ml_probability" not in out[0] and "features" in out[0]
