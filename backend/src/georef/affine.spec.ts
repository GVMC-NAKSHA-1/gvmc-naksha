import { solveTransform, Gcp } from './affine';

const gcps = (fn: (px: number, py: number) => [number, number], pts: [number, number][]): Gcp[] =>
  pts.map(([px, py]) => { const [x, y] = fn(px, py); return { px, py, x, y }; });

describe('solveTransform', () => {
  it('fits an exact affine transform with zero residual', () => {
    const f = (px: number, py: number): [number, number] => [83.2 + 1e-5 * px + 2e-7 * py, 17.7 - 1e-5 * py];
    const sol = solveTransform(gcps(f, [[0, 0], [1000, 0], [0, 800], [1000, 800]]), 'affine');
    expect(sol.rmse).toBeLessThan(1e-9);
    const [x, y] = sol.apply(500, 400);
    expect(x).toBeCloseTo(f(500, 400)[0], 9);
    expect(y).toBeCloseTo(f(500, 400)[1], 9);
  });

  it('needs 6 points for poly2 and models curvature affine cannot', () => {
    const f = (px: number, py: number): [number, number] => [10 + px + 1e-4 * px * px, 20 + py + 1e-4 * px * py];
    const pts: [number, number][] = [[0, 0], [100, 0], [0, 100], [100, 100], [50, 20], [20, 70], [80, 60]];
    expect(() => solveTransform(gcps(f, pts.slice(0, 5)), 'poly2')).toThrow(/at least 6/);
    expect(solveTransform(gcps(f, pts), 'poly2').rmse).toBeLessThan(1e-6);
    expect(solveTransform(gcps(f, pts), 'affine').rmse).toBeGreaterThan(1e-3);
  });

  it('points at the bad control point via its residual', () => {
    const g = gcps((px, py) => [px * 2, py * 2], [[0, 0], [10, 0], [0, 10], [10, 10], [5, 5], [5, 0], [0, 5]]);
    g[3].x += 5;
    const { residuals } = solveTransform(g, 'affine');
    expect(residuals.indexOf(Math.max(...residuals))).toBe(3);
  });

  it('rejects collinear points', () => {
    expect(() => solveTransform(gcps((px, py) => [px, py], [[0, 0], [1, 1], [2, 2]]), 'affine')).toThrow(/collinear/);
  });
});
