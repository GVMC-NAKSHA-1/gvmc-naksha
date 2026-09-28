"""Synthetic labelled match pairs — cold-start training data for the spatial-matching model.

Each "block" is a row of land parcels with the records other departments keep about them,
degraded the way the open-data pack (data/naksha_data/build.py) degrades them: re-digitised
municipal outlines 0.5–1.5 m off, owner-name initials variants and substitutions, wrong survey
numbers, revenue points with GPS jitter, handheld ground-truth fixes. Candidate pairs are then
generated with the same pruning and rules as match_ward.sql (candidates.py), and labelled true when both records
describe the same parcel. Officer labels (match_labels) replace this data over time.
"""
from datetime import datetime, timezone

import numpy as np
from shapely import affinity
from shapely.geometry import Point, box

from harmonize.candidates import Record, candidate_pairs

GIVEN = ["Venkata Ramana", "Lakshmi", "Srinivasa Rao", "Padmavathi", "Satyanarayana", "Durga Prasad",
         "Anjali", "Ravi Kumar", "Suresh", "Kalyani", "Appala Naidu", "Sridevi", "Nageswara Rao", "Madhavi"]
FAMILY = ["Pilla", "Reddy", "Naidu", "Varma", "Raju", "Chowdary", "Rao", "Sastry", "Patnaik", "Murthy"]


def _person(r):
    return f"{r.choice(GIVEN)} {r.choice(FAMILY)}"


def _initials_variant(name, r):
    parts = name.split()
    family, given = parts[-1], " ".join(parts[:-1])
    return f"{family[0]}. {given}" if r.random() < 0.5 else f"{given} {family[0]}."


def _wrong_survey(r):
    return f"{int(r.integers(90, 400))}/{int(r.integers(1, 12))}"


def _date(r, y0, y1):
    return datetime(int(r.integers(y0, y1 + 1)), int(r.integers(1, 13)), 1, tzinfo=timezone.utc)


def _block(r, block_no):
    """Parcels of one city block: 2 rows × k plots, rotated as a whole."""
    k = int(r.integers(3, 9))
    depth = r.uniform(15, 30)
    parcels, x = [], 0.0
    widths = r.uniform(8, 20, size=k)
    for row in range(2):
        x = 0.0
        for w in widths if row == 0 else r.permutation(widths):
            parcels.append(box(x, row * depth, x + w, (row + 1) * depth))
            x += w
    ang = r.uniform(0, 180)
    origin = parcels[0].centroid
    return [affinity.rotate(p, ang, origin=origin) for p in parcels]


def _records(r, block_no, parcels):
    """[(feature id, parcel index, source type, geometry, props)] (Record fields) for one block."""
    cap = {"cadastral": _date(r, 2008, 2020), "municipal_gis": _date(r, 2018, 2024),
           "revenue": _date(r, 2020, 2025), "building_footprint": _date(r, 2023, 2024),
           "ground_truth": _date(r, 2025, 2025)}
    recs, owner = [], None
    for i, parcel in enumerate(parcels):
        # ~15 % of plots are owned by the same family as the plot next door: the name alone
        # cannot tell those neighbours apart.
        owner = owner if owner and r.random() < 0.15 else _person(r)
        survey = f"{block_no}/{i + 1}"
        built = r.random() > 0.15
        recs.append((f"c{block_no}-{i}", i, "cadastral", parcel,
                     {"parcel_id": f"B{block_no}-P{i:03d}", "owner_name": owner, "survey_no": survey,
                      "area_sqm": round(parcel.area * r.uniform(0.98, 1.02), 1)}))
        bldg = None
        if built:
            bldg = affinity.scale(parcel.buffer(-r.uniform(0.8, 2.5), join_style=2),
                                  r.uniform(0.65, 1.0), r.uniform(0.65, 1.0))
            if bldg.is_empty:
                bldg = None
        if bldg is not None:
            recs.append((f"b{block_no}-{i}", i, "building_footprint",
                         affinity.translate(bldg, *r.normal(0, 0.4, 2)),
                         {"floors": int(r.integers(1, 5)), "height_m": round(r.uniform(3, 14), 1)}))
            if r.random() < 0.92:                                        # ~8 % not yet assessed
                ang, d = r.uniform(0, 2 * np.pi), r.uniform(0.5, 1.5)
                g = affinity.translate(parcel, d * np.cos(ang), d * np.sin(ang)).simplify(0.3)
                u = r.random()
                m_owner = _person(r) if u < 0.03 else _initials_variant(owner, r) if u < 0.11 else owner
                recs.append((f"m{block_no}-{i}", i, "municipal_gis", g,
                             {"assess_no": f"GVMC/{block_no:03d}/{i:06d}", "owner": m_owner,
                              "survey_no": survey if r.random() > 0.03 else _wrong_survey(r),
                              "plinth_sy": round(bldg.area * 1.196, 1)}))
            if r.random() < 0.2:
                c = bldg.centroid
                recs.append((f"g{block_no}-{i}", i, "ground_truth",
                             Point(c.x + r.normal(0, 1.5), c.y + r.normal(0, 1.5)), {"observed": "building"}))
        if r.random() < 0.95:
            rp = parcel.representative_point()
            recs.append((f"r{block_no}-{i}", i, "revenue",
                         Point(rp.x + r.normal(0, 2.0), rp.y + r.normal(0, 2.0)),
                         {"khata_no": f"{int(r.integers(1000, 99999))}/A",
                          "owner_name": owner if r.random() > 0.05 else _person(r) if r.random() < 0.5 else "",
                          "survey_no": survey if r.random() > 0.02 else _wrong_survey(r),
                          "extent_sqyd": round(parcel.area * 1.196 * r.uniform(0.99, 1.01), 1)}))
    return recs, cap


def generate(n_blocks=400, seed=0):
    """→ (pairs, rename maps keyed like match.py's, group id per pair)."""
    r = np.random.default_rng(seed)
    pairs, groups = [], []
    for block_no in range(1, n_blocks + 1):
        recs, cap = _records(r, block_no, _block(r, block_no))
        block_pairs = candidate_pairs([Record(*rec) for rec in recs], cap)
        pairs += block_pairs
        groups += [block_no] * len(block_pairs)
    # Approved schema mapping municipal "owner" ↔ "owner_name", keyed like match._rename_maps:
    # (a_source, b_source) → {field_b: field_a}.
    rename = {}
    for other in ("cadastral", "revenue"):
        rename[("municipal_gis", other)] = {"owner_name": "owner"}
        rename[(other, "municipal_gis")] = {"owner": "owner_name"}
    return pairs, rename, groups
