import pytest

from georef.gcp import apply_transform, solve_transform


def _gcps(fn, pts):
    return [{"px": px, "py": py, "x": fn(px, py)[0], "y": fn(px, py)[1]} for px, py in pts]


def test_affine_exact_fit():
    f = lambda px, py: (83.2 + 1e-5 * px + 2e-7 * py, 17.7 - 1e-5 * py)  # noqa: E731
    sol = solve_transform(_gcps(f, [(0, 0), (1000, 0), (0, 800), (1000, 800)]), "affine")
    assert sol["rmse"] < 1e-9
    x, y = apply_transform(sol, 500, 400)
    assert abs(x - f(500, 400)[0]) < 1e-9 and abs(y - f(500, 400)[1]) < 1e-9


def test_poly2_needs_six_points_and_fits_curvature():
    f = lambda px, py: (10 + px + 1e-4 * px * px, 20 + py + 1e-4 * px * py)  # noqa: E731
    pts = [(0, 0), (100, 0), (0, 100), (100, 100), (50, 20), (20, 70), (80, 60)]
    with pytest.raises(ValueError):
        solve_transform(_gcps(f, pts[:5]), "poly2")
    assert solve_transform(_gcps(f, pts), "poly2")["rmse"] < 1e-6
    assert solve_transform(_gcps(f, pts), "affine")["rmse"] > 1e-3   # affine can't model it


def test_residuals_flag_bad_point():
    f = lambda px, py: (px * 2.0, py * 2.0)  # noqa: E731
    g = _gcps(f, [(0, 0), (10, 0), (0, 10), (10, 10), (5, 5), (5, 0), (0, 5)])
    g[3]["x"] += 5
    sol = solve_transform(g, "affine")
    assert sol["residuals"].index(max(sol["residuals"])) == 3
