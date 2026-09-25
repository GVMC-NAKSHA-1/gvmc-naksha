import numpy as np
from rasterio.transform import from_origin
from shapely.geometry import Polygon

from extract.footprints import estimate_dtm, feature_confidence, ndsm_mask, polygonize, regularize


def _scene():
    dsm = np.full((200, 200), 10.0, np.float32)
    dsm[20:60, 30:90] = 16.0      # 6 m building
    dsm[120:170, 100:140] = 19.0  # 9 m building
    dsm[5:7, 5:7] = 14.0          # 4 px noise spike
    return dsm


def test_ndsm_with_given_dtm():
    dsm = _scene()
    mask, ndsm = ndsm_mask(dsm, np.full_like(dsm, 10.0), 2.5)
    assert mask.sum() == 40 * 60 + 50 * 40 + 4
    assert ndsm.max() == 9.0


def test_dtm_estimated_by_morphological_opening():
    dsm = _scene()
    dtm = estimate_dtm(dsm, pixel_m=0.5, window_m=40)   # 81 px window, larger than any building
    assert abs(float(np.median(dtm)) - 10.0) < 1e-6
    mask, _ = ndsm_mask(dsm, dtm, 2.5)
    assert mask[40, 60] and mask[140, 120] and not mask[100, 10]


def test_polygonize_two_buildings_with_heights():
    dsm = _scene()
    mask, ndsm = ndsm_mask(dsm, np.full_like(dsm, 10.0), 2.5)
    transform = from_origin(500000, 1960000, 0.5, 0.5)          # 0.5 m UTM pixels
    polys = polygonize(mask, transform, ndsm, min_area_px=50)
    assert len(polys) == 2                                        # spike filtered by min area
    heights = sorted(round(s["mean"], 1) for _, s in polys)
    assert heights == [6.0, 9.0]
    areas = sorted(round(p.area) for p, _ in polys)
    assert areas == [500, 600]                                    # 40×50 px and 40×60 px at 0.25 m²


def test_regularize_snaps_near_rectangles_only():
    jagged = Polygon([(0, 0), (10, 0), (10, 5), (9.8, 5.2), (10, 5.4), (10, 8), (0, 8)])
    assert len(regularize(jagged).exterior.coords) == 5
    ell = Polygon([(0, 0), (10, 0), (10, 3), (3, 3), (3, 10), (0, 10)])
    assert regularize(ell).equals(ell)


def test_confidence_grows_with_height():
    assert feature_confidence("ndsm", {"mean": 3}) < feature_confidence("ndsm", {"mean": 9}) <= 0.98
