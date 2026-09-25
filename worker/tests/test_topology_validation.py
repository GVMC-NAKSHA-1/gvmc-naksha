from spatial.topology_fabric import classify_gap, utm_srid
from validate.report import completeness, duplicate_count, weighted_score


def test_gap_vs_sliver_by_mean_width():
    assert classify_gap(0.9 * 25, 2 * (0.9 + 25)) == "gap"       # 0.9 m wide strip
    assert classify_gap(0.35 * 25, 2 * (0.35 + 25)) == "sliver"  # 0.35 m wide strip


def test_utm_zone_for_visakhapatnam():
    assert utm_srid(83.22, 17.70) == 32644


def test_completeness_and_duplicates():
    rows = [{"parcel_id": "A", "owner": "x"}, {"parcel_id": "A", "owner": ""}, {"parcel_id": "B", "owner": "y"}]
    assert abs(completeness(rows, ["parcel_id", "owner"]) - 5 / 6) < 1e-9
    assert duplicate_count(rows) == (1, "parcel_id")


def test_weighted_score():
    assert weighted_score([{"value": 1, "weight": 2}, {"value": 0, "weight": 2}]) == 50.0
    assert weighted_score([]) == 100.0
