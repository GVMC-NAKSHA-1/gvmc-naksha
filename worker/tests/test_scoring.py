from datetime import datetime, timedelta, timezone

from harmonize.scoring import attribute_score, confidence, recency_score, value_similarity


def test_value_similarity_numbers_and_strings():
    assert value_similarity(100, 100) == 1.0
    assert abs(value_similarity(100, 80) - 0.8) < 1e-9
    assert value_similarity("K. Srinivasa Rao", "k. srinivasa rao") == 1.0
    assert value_similarity("Ramesh", "Suresh") < 0.8
    assert value_similarity(None, "x") == 0.5


def test_attribute_score_uses_schema_mapping():
    a = {"khata_no": "1041", "owner_name": "P. Lakshmi", "area_sqm": 1000}
    b = {"khata_number": "1041", "owner": "P. LAKSHMI", "area_sqm": 1000}
    score, keys = attribute_score(a, b, {"khata_number": "khata_no", "owner": "owner_name"})
    assert set(keys) == {"khata_no", "owner_name", "area_sqm"}
    assert score == 1.0
    assert attribute_score({"x": 1}, {"y": 2}) == (0.5, [])


def test_recency_decay():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert recency_score(now - timedelta(days=100), now=now) == 1.0
    assert abs(recency_score(now - timedelta(days=int(6 * 365.25)), now=now) - 0.5) < 0.01
    assert recency_score(None, None) == 0.8


def test_confidence_weights():
    score, b = confidence(90, "cadastral", "municipal_gis", attribute=1.0, recency=1.0)
    # 0.4*0.9 + 0.3*1 + 0.2*0.875 + 0.1*1 = 0.935
    assert score == 94 and b["source_reliability_weight"] == 0.875
