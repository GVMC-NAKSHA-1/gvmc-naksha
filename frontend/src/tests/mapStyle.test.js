import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { BASE_STYLE, OVERLAY_LAYERS, OVERLAY_SOURCES } from '../components/mapStyle';

describe('map style', () => {
  it('base style plus all overlay layers pass the MapLibre style spec', () => {
    const style = {
      ...BASE_STYLE,
      sources: { ...BASE_STYLE.sources, ...OVERLAY_SOURCES },
      layers: [...BASE_STYLE.layers, ...OVERLAY_LAYERS],
    };
    const errors = validateStyleMin(style).map((e) => e.message);
    expect(errors).toEqual([]);
  });
});
