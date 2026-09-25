"""Pure scoring helpers for spatial matching (no DB / network) — unit-tested in tests/."""
from datetime import datetime, timezone
from difflib import SequenceMatcher

SOURCE_RELIABILITY = {
    "gnss_cors": 1.0, "cadastral": 0.95, "ground_truth": 0.9, "building_footprint": 0.8,
    "municipal_gis": 0.8, "utility": 0.75, "ai_extracted": 0.7, "ori": 0.7, "dsm_dtm": 0.7,
    "revenue": 0.65, "drone_imagery": 0.6,
}

WEIGHTS = {"geometric": 0.4, "attribute": 0.3, "reliability": 0.2, "recency": 0.1}

# Fields that describe the capture itself, not the land parcel — never compared.
_IGNORED = {"id", "fid", "confidence", "method", "source_model"}


def _num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def value_similarity(a, b) -> float:
    """1.0 = identical. Numbers: relative difference; strings: normalised edit similarity."""
    if a is None or b is None or a == "" or b == "":
        return 0.5
    na, nb = _num(a), _num(b)
    if na is not None and nb is not None:
        if na == nb:
            return 1.0
        return max(0.0, 1 - abs(na - nb) / max(abs(na), abs(nb)))
    sa, sb = str(a).strip().lower(), str(b).strip().lower()
    if sa == sb:
        return 1.0
    return SequenceMatcher(None, sa, sb).ratio()


def attribute_score(a_props: dict, b_props: dict, rename: dict | None = None) -> tuple[float, list]:
    """Mean similarity over fields both features carry (after applying `rename` = B field → A field).
    Returns (score, compared_field_names). No shared field → neutral 0.5."""
    rename = rename or {}
    b_norm = {rename.get(k, k): v for k, v in (b_props or {}).items()}
    keys = [k for k in (a_props or {}) if k in b_norm and not k.startswith("_") and k not in _IGNORED]
    if not keys:
        return 0.5, []
    sims = [value_similarity(a_props[k], b_norm[k]) for k in keys]
    return sum(sims) / len(sims), keys


def recency_score(*captured, now: datetime | None = None) -> float:
    """1.0 when the older capture is < 1 year old, then halves every 5 years. Unknown date → 0.8."""
    dates = [d for d in captured if d]
    if not dates:
        return 0.8
    now = now or datetime.now(timezone.utc)
    oldest = min(d if d.tzinfo else d.replace(tzinfo=timezone.utc) for d in dates)
    age_years = max(0.0, (now - oldest).days / 365.25)
    if age_years <= 1:
        return 1.0
    return round(0.5 ** ((age_years - 1) / 5), 4)


def confidence(match_score: float, a_type: str, b_type: str, attribute: float, recency: float):
    geometric = match_score / 100
    reliability = (SOURCE_RELIABILITY.get(a_type, 0.5) + SOURCE_RELIABILITY.get(b_type, 0.5)) / 2
    score = round(100 * (WEIGHTS["geometric"] * geometric + WEIGHTS["attribute"] * attribute
                         + WEIGHTS["reliability"] * reliability + WEIGHTS["recency"] * recency))
    return score, {
        "geometric_match_score": round(geometric, 4),
        "attribute_match_score": round(attribute, 4),
        "source_reliability_weight": round(reliability, 4),
        "recency_score": round(recency, 4),
    }
