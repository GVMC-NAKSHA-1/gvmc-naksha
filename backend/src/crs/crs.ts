import proj4 from 'proj4';

/** Coordinate systems used across Indian land records, with proj4 definitions. */
export const CRS_LIST = [
  { code: 'EPSG:4326', name: 'WGS 84 (GPS lon/lat)', units: 'degrees', proj: '+proj=longlat +datum=WGS84 +no_defs' },
  { code: 'EPSG:3857', name: 'Web Mercator', units: 'metres', proj: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs' },
  { code: 'EPSG:32643', name: 'WGS 84 / UTM 43N (west India)', units: 'metres', proj: '+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:32644', name: 'WGS 84 / UTM 44N (central/AP)', units: 'metres', proj: '+proj=utm +zone=44 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:32645', name: 'WGS 84 / UTM 45N (east India)', units: 'metres', proj: '+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:24344', name: 'Kalianpur 1975 / UTM 44N (legacy SOI)', units: 'metres', proj: '+proj=utm +zone=44 +a=6377299.151 +rf=300.8017255 +towgs84=295,736,257,0,0,0,0 +units=m +no_defs' },
  { code: 'EPSG:24345', name: 'Kalianpur 1975 / UTM 45N (legacy SOI)', units: 'metres', proj: '+proj=utm +zone=45 +a=6377299.151 +rf=300.8017255 +towgs84=295,736,257,0,0,0,0 +units=m +no_defs' },
  { code: 'EPSG:7755', name: 'WGS 84 / India NSF LCC', units: 'metres', proj: '+proj=lcc +lat_0=24 +lon_0=80 +lat_1=12.472955 +lat_2=35.1728044444444 +x_0=4000000 +y_0=4000000 +datum=WGS84 +units=m +no_defs' },
];

for (const c of CRS_LIST) proj4.defs(c.code, c.proj);

export const isGeographic = (code: string) => CRS_LIST.find((c) => c.code === code)?.units === 'degrees';

export function transformPoints(from: string, to: string, points: [number, number][]) {
  for (const code of [from, to])
    if (!CRS_LIST.some((c) => c.code === code)) throw new Error(`unsupported CRS ${code}`);
  const t = proj4(from, to);
  return points.map(([x, y]) => t.forward([x, y]) as [number, number]);
}
