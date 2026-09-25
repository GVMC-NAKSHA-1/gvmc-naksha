import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom has no WebGL — stub MapLibre so map pages render in tests.
vi.mock('maplibre-gl', () => {
  class Map {
    constructor() { this.handlers = {}; }
    on() { return this; }
    off() { return this; }
    addControl() { return this; }
    remove() {}
    resize() {}
    fitBounds() {}
    easeTo() {}
    getSource() { return { setData() {} }; }
    addSource() {}
    addLayer() {}
    setLayoutProperty() {}
    setPaintProperty() {}
    moveLayer() {}
    removeLayer() {}
    removeSource() {}
    getLayer() { return undefined; }
    setFilter() {}
    setFeatureState() {}
    removeFeatureState() {}
    queryRenderedFeatures() { return []; }
    getCanvas() { return { style: {} }; }
  }
  class Popup { setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } remove() {} }
  class NavigationControl {}
  class ScaleControl {}
  class LngLatBounds { extend() { return this; } }
  return { Map, Popup, NavigationControl, ScaleControl, LngLatBounds, setWorkerUrl() {} };
});

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '' }));

if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
window.scrollTo = () => {};
Element.prototype.scrollIntoView = function scrollIntoView() {};
