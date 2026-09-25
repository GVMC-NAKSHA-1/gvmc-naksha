import os, re, json
import numpy as np, cv2, pytesseract
from pdf2image import convert_from_path
from db import get_data_source, set_status, update_source_metadata, cursor
from r2 import download
from queue_client import enqueue


# OCR words of a page are joined into one line, so a free-text value (the owner name) must stop
# at the next field label instead of running on into it.
_NEXT_LABEL = r"(?=\s+(?:khata|khatha|owner|name|survey|s\.?y\.?|area|extent|village|mandal|district)\b|\s*$)"
FIELD_PATTERNS = {
    "khata_no":   r"(?:khata|khatha)\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9/\-]+)",
    "owner_name": r"(?:owner|name)\s*[:\-]?\s*([A-Z][A-Za-z .]{2,}?)" + _NEXT_LABEL,
    "survey_no":  r"(?:survey|s\.?y\.?)\s*(?:no\.?)?\s*[:\-]?\s*([0-9/\-A-Z]+)",
    "area":       r"(?:area|extent)\s*[:\-]?\s*([0-9,.]+)\s*(sq\.?\s?m|acres?|cents?)",
}


def extract_fields(text, skip=()):
    """Regex field extraction from one page of OCR text → {field: value}."""
    out = {}
    for field, pat in FIELD_PATTERNS.items():
        if field in skip:
            continue
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            out[field] = m.group(1).strip()
    return out

def _preprocess(pil_img):
    g = cv2.cvtColor(np.array(pil_img), cv2.COLOR_BGR2GRAY)
    g = cv2.fastNlMeansDenoising(g, h=10)
    return cv2.threshold(g, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

def digitize(job):
    src = get_data_source(job["sourceId"])
    path = download(src["r2_key"])
    pages = convert_from_path(path) if path.lower().endswith(".pdf") else [cv2.imread(path)]

    extracted, confidences = {}, {}
    for page_no, img in enumerate(pages, 1):
        data = pytesseract.image_to_data(_preprocess(img),
                                         output_type=pytesseract.Output.DICT, config="--psm 6")
        text = " ".join(w for w in data["text"] if w.strip())
        confs = [int(c) for c in data["conf"] if c not in ("-1", -1)]
        for field, value in extract_fields(text, skip=extracted).items():
            extracted[field] = value
            confidences[field] = round(sum(confs) / len(confs), 1) if confs else 0.0
            with cursor() as cur:
                cur.execute(
                    """INSERT INTO ocr_results (source_id, field, value, confidence, page)
                       VALUES (%s,%s,%s,%s,%s)""",
                    (src["id"], field, extracted[field], confidences[field], page_no))

    update_source_metadata(src["id"], {"ocr": extracted, "ocr_confidence": confidences})
    set_status(src["id"], "ready")

    # feed B.5: schema-map the freshly OCR'd fields against the newest structured
    # (cadastral / municipal_gis / revenue) source for the same ward.
    with cursor() as cur:
        cur.execute(
            """SELECT id FROM data_sources
               WHERE ward_id = %s AND status = 'ready' AND id <> %s
                 AND type IN ('cadastral','municipal_gis','revenue','building_footprint')
               ORDER BY created_at DESC LIMIT 1""",
            (src["ward_id"], src["id"]))
        row = cur.fetchone()
    if row:
        enqueue("SCHEMA_MAP", sourceAId=str(src["id"]), sourceBId=str(row["id"]), wardId=src["ward_id"])
        print(f"[digitize] {src['id']} -> enqueued SCHEMA_MAP against {row['id']}")
    else:
        print(f"[digitize] {src['id']} ready; no structured source in ward {src['ward_id']} to map against yet")
    return {"fields_extracted": len(extracted)}
