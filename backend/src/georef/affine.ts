// Ground-control-point fitting — the same maths as worker/src/georef/gcp.py, used by the API to
// preview residuals instantly while an officer places points.

export type Gcp = { px: number; py: number; x: number; y: number };
export type TransformKind = 'affine' | 'poly2';
export const MIN_GCPS: Record<TransformKind, number> = { affine: 3, poly2: 6 };

const terms = (px: number, py: number, kind: TransformKind) =>
  kind === 'affine' ? [1, px, py] : [1, px, py, px * px, px * py, py * py];

/** Solves the normal equations (AᵀA)c = Aᵀb with Gaussian elimination + partial pivoting. */
function leastSquares(A: number[][], b: number[]): number[] {
  const n = A[0].length;
  const M = Array.from({ length: n }, (_, i) =>
    [...Array.from({ length: n }, (_, j) => A.reduce((s, row) => s + row[i] * row[j], 0)),
     A.reduce((s, row, k) => s + row[i] * b[k], 0)]);
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

export function solveTransform(gcps: Gcp[], kind: TransformKind = 'affine') {
  if (gcps.length < MIN_GCPS[kind])
    throw new Error(`${kind} needs at least ${MIN_GCPS[kind]} control points (got ${gcps.length})`);
  // Centre + scale pixel coordinates so poly2's squared terms stay well conditioned.
  const mx = gcps.reduce((s, g) => s + g.px, 0) / gcps.length;
  const my = gcps.reduce((s, g) => s + g.py, 0) / gcps.length;
  const sc = Math.max(1, ...gcps.map((g) => Math.max(Math.abs(g.px - mx), Math.abs(g.py - my))));
  const norm = (px: number, py: number) => terms((px - mx) / sc, (py - my) / sc, kind);
  const A = gcps.map((g) => norm(g.px, g.py));
  const cx = leastSquares(A, gcps.map((g) => g.x));
  const cy = leastSquares(A, gcps.map((g) => g.y));
  const apply = (px: number, py: number) => {
    const t = norm(px, py);
    return [t.reduce((s, v, i) => s + v * cx[i], 0), t.reduce((s, v, i) => s + v * cy[i], 0)] as [number, number];
  };
  const residuals = gcps.map((g) => {
    const [x, y] = apply(g.px, g.py);
    return Math.hypot(x - g.x, y - g.y);
  });
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  return { kind, residuals, rmse, apply };
}

/** Residuals in metres when the target CRS is geographic (degrees). */
export function toMetres(value: number, geographic: boolean, lat = 17.7) {
  return geographic ? value * 111320 * Math.cos((lat * Math.PI) / 180) : value;
}
