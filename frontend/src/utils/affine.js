// Ground-control-point fitting (same maths as backend/src/georef/affine.ts) — used by the
// in-browser mock API so geo-referencing previews work offline.

export const MIN_GCPS = { affine: 3, poly2: 6 };

const terms = (px, py, kind) => (kind === 'affine' ? [1, px, py] : [1, px, py, px * px, px * py, py * py]);

function leastSquares(A, b) {
  const n = A[0].length;
  const M = Array.from({ length: n }, (_, i) => [
    ...Array.from({ length: n }, (_, j) => A.reduce((s, row) => s + row[i] * row[j], 0)),
    A.reduce((s, row, k) => s + row[i] * b[k], 0),
  ]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('control points are collinear or duplicated');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function solveTransform(gcps, kind = 'affine') {
  if (gcps.length < MIN_GCPS[kind]) throw new Error(`${kind} needs at least ${MIN_GCPS[kind]} control points (got ${gcps.length})`);
  const mx = gcps.reduce((s, g) => s + g.px, 0) / gcps.length;
  const my = gcps.reduce((s, g) => s + g.py, 0) / gcps.length;
  const sc = Math.max(1, ...gcps.map((g) => Math.max(Math.abs(g.px - mx), Math.abs(g.py - my))));
  const norm = (px, py) => terms((px - mx) / sc, (py - my) / sc, kind);
  const A = gcps.map((g) => norm(g.px, g.py));
  const cx = leastSquares(A, gcps.map((g) => g.x));
  const cy = leastSquares(A, gcps.map((g) => g.y));
  const apply = (px, py) => {
    const t = norm(px, py);
    return [t.reduce((s, v, i) => s + v * cx[i], 0), t.reduce((s, v, i) => s + v * cy[i], 0)];
  };
  const residuals = gcps.map((g) => { const [x, y] = apply(g.px, g.py); return Math.hypot(x - g.x, y - g.y); });
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  return { kind, residuals, rmse, apply };
}

/** WGS84 ↔ UTM (northern hemisphere), for the mock CRS engine. */
const A_ = 6378137; const F_ = 1 / 298.257223563; const K0 = 0.9996;
const E2 = F_ * (2 - F_); const EP2 = E2 / (1 - E2);
export function toUtm(lon, lat, zone) {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const φ = lat * Math.PI / 180; const λ = lon * Math.PI / 180;
  const N = A_ / Math.sqrt(1 - E2 * Math.sin(φ) ** 2);
  const T = Math.tan(φ) ** 2; const C = EP2 * Math.cos(φ) ** 2; const A = Math.cos(φ) * (λ - lon0);
  const M = A_ * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * φ - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * φ)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * φ) - (35 * E2 ** 3 / 3072) * Math.sin(6 * φ));
  const x = K0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * A ** 5 / 120) + 500000;
  const y = K0 * (M + N * Math.tan(φ) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * A ** 6 / 720));
  return [x, y];
}
export function fromUtm(x, y, zone) {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const M = y / K0; const mu = M / (A_ * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const φ1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
  const N1 = A_ / Math.sqrt(1 - E2 * Math.sin(φ1) ** 2); const T1 = Math.tan(φ1) ** 2; const C1 = EP2 * Math.cos(φ1) ** 2;
  const R1 = A_ * (1 - E2) / (1 - E2 * Math.sin(φ1) ** 2) ** 1.5; const D = (x - 500000) / (N1 * K0);
  const lat = φ1 - (N1 * Math.tan(φ1) / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4 / 24);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6) / Math.cos(φ1);
  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}
