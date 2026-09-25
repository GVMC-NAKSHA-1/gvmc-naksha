import os, json, re
from db import cursor


def _fields(meta: dict) -> list:
    """OCR'd docs expose their fields under metadata.ocr; structured sources under
    metadata.fields (written by adapters.normalize_source)."""
    meta = meta or {}
    if isinstance(meta.get("ocr"), dict) and meta["ocr"]:
        return list(meta["ocr"].keys())
    if isinstance(meta.get("fields"), list):
        return list(meta["fields"])
    return [k for k in meta.keys() if k not in ("ocr", "ocr_confidence", "feature_count")]


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _fallback_map(a_fields, b_fields):
    bn = {_norm(f): f for f in b_fields}
    out = []
    for fa in a_fields:
        fb = bn.get(_norm(fa))
        if fb:
            out.append({
                "field_a": fa, "field_b": fb, "confidence": 0.5,
                "rationale": "normalized column-name match (LLM unavailable)",
            })
    return out


def _llm_map(a_fields, b_fields):
    from groq import Groq
    groq = Groq(api_key=os.environ["GROQ_API_KEY"])
    prompt = (
        "You are a data-integration assistant for the NAKSHA land-records programme.\n"
        "Given two datasets' field names, propose field-to-field mappings as a JSON array of "
        '{"field_a","field_b","confidence"(0-1),"rationale"}.\n'
        f"Dataset A fields: {a_fields}\n"
        f"Dataset B fields: {b_fields}\n"
        "Return a JSON array only, no prose."
    )
    # Groq retires models; override with GROQ_MODEL. gpt-oss reasons first (tokens count against
    # max_tokens), so it runs at low effort with headroom.
    model = os.environ.get("GROQ_MODEL") or "openai/gpt-oss-120b"
    reasoning = model.startswith("openai/gpt-oss")
    raw = groq.chat.completions.create(
        model=model, temperature=0.2, max_tokens=700 + (1500 if reasoning else 0),
        messages=[{"role": "user", "content": prompt}],
        extra_body={"reasoning_effort": "low"} if reasoning else None,
    ).choices[0].message.content
    return json.loads(raw[raw.index("["): raw.rindex("]") + 1])


def run_schema_map(job):
    a_id, b_id = job["sourceAId"], job["sourceBId"]
    with cursor() as cur:
        cur.execute("SELECT metadata FROM data_sources WHERE id = %s", (a_id,))
        a_fields = _fields(cur.fetchone()["metadata"])
        cur.execute("SELECT metadata FROM data_sources WHERE id = %s", (b_id,))
        b_fields = _fields(cur.fetchone()["metadata"])

    try:
        mappings = (
            _llm_map(a_fields, b_fields)
            if os.environ.get("GROQ_API_KEY")
            else _fallback_map(a_fields, b_fields)
        )
    except Exception as e:  # noqa: BLE001
        print(f"[schema_map] LLM failed ({e}); using name-match fallback")
        mappings = _fallback_map(a_fields, b_fields)

    with cursor() as cur:
        for m in mappings:
            cur.execute(
                """INSERT INTO schema_mappings
                       (source_a_id, source_b_id, field_a, field_b, confidence, rationale)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (a_id, b_id, m["field_a"], m["field_b"], m["confidence"], m.get("rationale")),
            )
    print(f"[schema_map] {a_id} <-> {b_id}: {len(mappings)} mappings")
