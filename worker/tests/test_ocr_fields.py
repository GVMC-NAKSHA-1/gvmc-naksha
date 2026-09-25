from ocr.digitize import extract_fields

# Words of one OCR'd page arrive joined into a single line (see digitize()).
PAGE = ("REVENUE RECORD - WARD 4 ASILMETTA Khata No: 4521/B Owner: Venkatesh Rao "
        "Survey No: 210/1 Extent: 750 sq m Village: Visakhapatnam Urban")


def test_fields_from_joined_page():
    f = extract_fields(PAGE)
    assert f["khata_no"] == "4521/B"
    assert f["survey_no"] == "210/1"
    assert f["area"] == "750"


def test_owner_name_stops_at_next_label():
    assert extract_fields(PAGE)["owner_name"] == "Venkatesh Rao"


def test_owner_name_at_end_of_page():
    assert extract_fields("Khata No: 12 Owner: K. Swathi")["owner_name"] == "K. Swathi"


def test_skip_keeps_first_page_values():
    assert "khata_no" not in extract_fields(PAGE, skip={"khata_no": "1"})
