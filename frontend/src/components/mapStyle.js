// MapLibre style: free raster basemaps + the app's overlay sources and layers.

export const VIZAG = [83.2185, 17.6869];
export const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Free basemaps — no API key.
export const BASE_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    streets: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    // Place names / boundaries drawn over the satellite imagery.
    labels: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'streets', type: 'raster', source: 'streets' },
    { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
    { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: 'none' } },
  ],
};

// NDBI Δ → colour as a MapLibre expression (mirrors utils/format.ndbiColor).
const ndbiExpr = (prop) => [
  'case',
  ['==', ['get', prop], null], '#ecf0f1',
  ['>=', ['get', prop], 0.3], '#c0392b',
  ['>=', ['get', prop], 0.2], '#e67e22',
  ['>=', ['get', prop], 0.1], '#f1c40f',
  ['>', ['get', prop], 0], '#f9e79f',
  '#ecf0f1',
];

// Metres → pixels at Visakhapatnam's latitude, exact at every zoom (Web Mercator).
const MPP_Z0 = 156543.03392 * Math.cos((VIZAG[1] * Math.PI) / 180);
// `zoom` must be the top-level input, so the minimum pixel size is applied per stop.
const metresToPx = (prop, minPx) => [
  'interpolate', ['exponential', 2], ['zoom'],
  0, ['max', minPx, ['/', ['get', prop], MPP_Z0]],
  22, ['max', minPx, ['/', ['get', prop], MPP_Z0 / 2 ** 22]],
];

export const OVERLAY_SOURCES = {
  'wards': { type: 'geojson', data: EMPTY_FC, promoteId: 'wardId' },
  'selected-ward': { type: 'geojson', data: EMPTY_FC },
  'changes': { type: 'geojson', data: EMPTY_FC, promoteId: 'fid' },
  'properties': { type: 'geojson', data: EMPTY_FC, promoteId: 'id' },
};

export const OVERLAY_LAYERS = [
  { id: 'wards-fill', type: 'fill', source: 'wards', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 } },
  { id: 'wards-line', type: 'line', source: 'wards', paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.6, 'line-width': 1 } },
  {
    id: 'wards-label', type: 'symbol', source: 'wards',
    layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Open Sans Semibold'] },
    paint: { 'text-color': '#212529', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
  },
  {
    id: 'selected-ward-line', type: 'line', source: 'selected-ward',
    paint: { 'line-color': '#0d6efd', 'line-width': 2, 'line-dasharray': [2, 1.5] },
  },
  {
    id: 'changes-fill', type: 'fill', source: 'changes', layout: { visibility: 'none' },
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.85, ['get', 'opacity']],
    },
  },
  {
    id: 'changes-line', type: 'line', source: 'changes', layout: { visibility: 'none' },
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffffff', ['get', 'color']],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 2],
    },
  },
  {
    id: 'properties-circle', type: 'circle', source: 'properties',
    paint: {
      'circle-radius': metresToPx('radiusM', 4),
      'circle-color': ndbiExpr('ndbiDelta'),
      'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.9, 0.65],
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#0d6efd', '#ffffff'],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 1],
    },
  },
  {
    id: 'properties-selected', type: 'circle', source: 'properties',
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': metresToPx('radiusM', 6),
      'circle-color': ndbiExpr('ndbiDelta'),
      'circle-opacity': 0.9,
      'circle-stroke-color': '#0d6efd',
      'circle-stroke-width': 2.5,
    },
  },
];
