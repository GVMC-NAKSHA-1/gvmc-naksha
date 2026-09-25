from harmonize.match import select_one_to_one

PARCELS, REVENUE, BUILDINGS = "src-parcels", "src-revenue", "src-buildings"


def pair(a, b, score, sa=PARCELS, sb=REVENUE):
    return {"a_id": a, "b_id": b, "a_source": sa, "b_source": sb, "match_score": score}


def ids(chosen):
    return {(p["a_id"], p["b_id"]) for p in chosen}


def test_best_score_wins_and_each_feature_is_used_once():
    # Revenue point r1 lies within 25 m of three parcels; each parcel also sees r1 and r2.
    pairs = [pair("p1", "r1", 90), pair("p2", "r1", 70), pair("p3", "r1", 60),
             pair("p2", "r2", 65), pair("p3", "r2", 80)]
    assert ids(select_one_to_one(pairs)) == {("p1", "r1"), ("p3", "r2")}


def test_one_partner_per_other_source_not_per_feature():
    # p1 may keep its best revenue record AND its best building: different source pairs.
    pairs = [pair("p1", "r1", 90), pair("p1", "b1", 55, sb=BUILDINGS), pair("p1", "b2", 45, sb=BUILDINGS)]
    assert ids(select_one_to_one(pairs)) == {("p1", "r1"), ("p1", "b1")}


def test_order_of_ids_does_not_matter():
    # b_id < a_id orientation from the SQL (b.id > a.id) is not assumed.
    pairs = [pair("r1", "p1", 90, sa=REVENUE, sb=PARCELS), pair("p2", "r1", 80)]
    assert ids(select_one_to_one(pairs)) == {("r1", "p1")}


def test_locked_pairs_win_over_higher_scores():
    # An officer already decided the p2–r1 conflict; that pair stays even though p1–r1 scores higher.
    pairs = [pair("p1", "r1", 95), pair("p2", "r1", 60)]
    assert ids(select_one_to_one(pairs, locked=[("p2", "r1")])) == {("p2", "r1")}


def test_no_chaining_across_a_neighbourhood():
    # Without one-to-one selection r1 and r2 would join p1..p4 into one cluster.
    pairs = [pair(f"p{i}", r, 90 - i * 5) for i in range(1, 5) for r in ("r1", "r2")]
    chosen = select_one_to_one(pairs)
    assert len(chosen) == 2
    assert len({p["a_id"] for p in chosen}) == 2 and len({p["b_id"] for p in chosen}) == 2
