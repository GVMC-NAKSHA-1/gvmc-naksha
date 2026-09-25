import { transformPoints } from './crs';

describe('transformPoints', () => {
  it('projects Visakhapatnam into UTM 44N and back', () => {
    const [[e, n]] = transformPoints('EPSG:4326', 'EPSG:32644', [[83.2185, 17.6869]]);
    expect(e).toBeGreaterThan(700000);
    expect(e).toBeLessThan(800000);
    expect(n).toBeGreaterThan(1950000);
    const [[lon, lat]] = transformPoints('EPSG:32644', 'EPSG:4326', [[e, n]]);
    expect(lon).toBeCloseTo(83.2185, 6);
    expect(lat).toBeCloseTo(17.6869, 6);
  });

  it('shifts legacy Kalianpur coordinates by the datum offset (tens to hundreds of metres)', () => {
    const [[wgs]] = [transformPoints('EPSG:4326', 'EPSG:32644', [[83.2185, 17.6869]])];
    const [[kal]] = [transformPoints('EPSG:4326', 'EPSG:24344', [[83.2185, 17.6869]])];
    const d = Math.hypot(wgs[0] - kal[0], wgs[1] - kal[1]);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(1500);
  });

  it('rejects unknown systems', () => {
    expect(() => transformPoints('EPSG:9999', 'EPSG:4326', [[0, 0]])).toThrow(/unsupported/);
  });
});
