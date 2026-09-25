import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { BASE_STYLE, EMPTY_FC, bboxOf, overlaySpecs } from '../components/mapStyle';

describe('map style', () => {
  it('base style plus overlay layers pass the MapLibre style spec', () => {
    const overlays = [
      { id: 'cadastral', color: '#0d6efd' },
      { id: 'imagery', color: '#8e44ad', dashed: true, fillOpacity: 0.04, visible: false },
      { id: 'points', color: '#e67e22', circleRadius: 7, circleOpacity: 0.9 },
    ];
    const style = {
      ...BASE_STYLE,
      sources: { ...BASE_STYLE.sources, ...Object.fromEntries(overlays.map((o) => [o.id, { type: 'geojson', data: EMPTY_FC }])) },
      layers: [...BASE_STYLE.layers, ...overlays.flatMap(overlaySpecs)],
    };
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
  });

  it('computes the bbox of nested GeoJSON', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [83.2, 17.7] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[83.1, 17.6], [83.3, 17.6], [83.3, 17.8], [83.1, 17.6]]] }, properties: {} },
      ],
    };
    expect(bboxOf(fc)).toEqual([83.1, 17.6, 83.3, 17.8]);
    expect(bboxOf(EMPTY_FC)).toBeNull();
  });
});
