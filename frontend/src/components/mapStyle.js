// MapLibre style: free raster basemaps + a builder for the app's GeoJSON overlay layers.

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

const POLYGONS = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
const LINES = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]];
const POINTS = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];

/** A feature may override its layer colour with a `_color` property. */
const colorOf = (color) => ['coalesce', ['get', '_color'], color];

/**
 * Style layers for one overlay: polygon fill, outline/line, and circles for points — all fed by a
 * single GeoJSON source named `layer.id`.
 */
export function overlaySpecs(layer) {
  const color = layer.color ?? '#0d6efd';
  const visibility = layer.visible === false ? 'none' : 'visible';
  const line = {
    id: `${layer.id}-line`, type: 'line', source: layer.id, filter: LINES,
    layout: { visibility, 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': colorOf(color),
      'line-width': layer.lineWidth ?? 1.5,
      'line-opacity': layer.lineOpacity ?? 0.9,
    },
  };
  if (layer.dashed) line.paint['line-dasharray'] = [2, 1.5];
  return [
    {
      id: `${layer.id}-fill`, type: 'fill', source: layer.id, filter: POLYGONS,
      layout: { visibility },
      paint: { 'fill-color': colorOf(color), 'fill-opacity': layer.fillOpacity ?? 0.22 },
    },
    line,
    {
      id: `${layer.id}-circle`, type: 'circle', source: layer.id, filter: POINTS,
      layout: { visibility },
      paint: {
        'circle-color': colorOf(color),
        'circle-radius': ['coalesce', ['get', '_radius'], layer.circleRadius ?? 5],
        'circle-opacity': layer.circleOpacity ?? 0.85,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
      },
    },
  ];
}

/** [west, south, east, north] of any GeoJSON object, or null when it has no coordinates. */
export function bboxOf(geojson) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  const walk = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
    } else c.forEach(walk);
  };
  const visit = (g) => {
    if (!g) return;
    if (g.type === 'FeatureCollection') g.features.forEach(visit);
    else if (g.type === 'Feature') visit(g.geometry);
    else if (g.type === 'GeometryCollection') g.geometries.forEach(visit);
    else walk(g.coordinates);
  };
  visit(geojson);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export const bboxPolygon = ({ north, south, east, west }) => ({
  type: 'Polygon',
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

export const featureCollection = (features) => ({ type: 'FeatureCollection', features });
