from shapely.geometry import box

from change.epochs import classify_changes


def test_classifies_every_change_type():
    baseline = [
        ("b1", box(0, 0, 10, 10), {"height_m": 3}),       # unchanged
        ("b2", box(20, 0, 30, 10), {"height_m": 3}),      # extended
        ("b3", box(40, 0, 50, 10), {"height_m": 3}),      # demolished
        ("b4", box(60, 0, 70, 10), {"height_m": 3}),      # raised
    ]
    current = [
        ("c1", box(0.2, 0, 10.2, 10), {"height_m": 3.2, "confidence": 0.9}),
        ("c2", box(20, 0, 35, 10), {"height_m": 3, "confidence": 0.9}),
        ("c4", box(60, 0, 70, 10), {"height_m": 9.5, "confidence": 0.9}),
        ("c5", box(100, 0, 108, 8), {"height_m": 3, "confidence": 0.8}),   # new
    ]
    got = {(c["change_type"], c["current_id"] or c["baseline_id"]) for c in classify_changes(baseline, current)}
    assert got == {("extension", "c2"), ("demolished", "b3"), ("vertical_extension", "c4"), ("new_structure", "c5")}


def test_small_changes_below_thresholds_are_ignored():
    got = classify_changes([("b", box(0, 0, 10, 10), {})], [("c", box(0, 0, 10.5, 10), {})])
    assert got == []
