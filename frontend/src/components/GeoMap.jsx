import { useEffect, useRef, useState } from 'react';
import { FiGlobe, FiMap } from 'react-icons/fi';
import * as maplibregl from './maplibre';
import { BASE_STYLE, VIZAG, bboxOf, overlaySpecs } from './mapStyle';
import Loader from './Loader';
import { cx } from './ui';

export { propsTable } from './mapPopup';
export { default as Legend } from './MapLegend';

function readBasemap() {
  try { return localStorage.getItem('gvmc.basemap') === 'satellite' ? 'satellite' : 'streets'; } catch { return 'streets'; }
}

/**
 * Declarative MapLibre map.
 *   layers:  [{ id, data: FeatureCollection, color, visible, fillOpacity, lineWidth, circleRadius, dashed, title }]
 *            later layers draw on top; a feature's `_color` / `_radius` properties override the layer's.
 *   fitTo:   GeoJSON or [w, s, e, n]; the map re-fits whenever `fitKey` changes.
 *   onFeatureClick(layerId, feature, lngLat); popup(layerId, props) → HTML string | null.
 */
export default function GeoMap({
  layers = [], fitTo = null, fitKey, onFeatureClick, onMapClick, popup, legend, loading = false, className, children,
  cursor,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const dataRef = useRef(new Map());      // layer id -> last data object pushed to the source
  const boundRef = useRef(new Set());     // style layer ids with click handlers attached
  const cbRef = useRef({ onFeatureClick, onMapClick, popup, layers });
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState(readBasemap);

  cbRef.current = { onFeatureClick, onMapClick, popup, layers };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: VIZAG,
      zoom: 12,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    map.on('load', () => setReady(true));
    map.on('click', (e) => {
      if (!cbRef.current.onMapClick) return;
      // Clicks on an interactive feature belong to onFeatureClick.
      const ids = [...boundRef.current].filter((id) => map.getLayer(id));
      if (ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length) return;
      cbRef.current.onMapClick(e.lngLat);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      dataRef.current = new Map();
      boundRef.current = new Set();
    };
  }, []);

  // Basemap toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const sat = basemap === 'satellite';
    map.setLayoutProperty('streets', 'visibility', sat ? 'none' : 'visible');
    map.setLayoutProperty('satellite', 'visibility', sat ? 'visible' : 'none');
    map.setLayoutProperty('labels', 'visibility', sat ? 'visible' : 'none');
    try { localStorage.setItem('gvmc.basemap', basemap); } catch { /* storage unavailable */ }
  }, [basemap, ready]);

  // Sync declarative layers → sources + style layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const wanted = new Set(layers.map((l) => l.id));

    // Remove overlays that are gone.
    for (const id of [...dataRef.current.keys()]) {
      if (wanted.has(id)) continue;
      for (const suffix of ['fill', 'line', 'circle']) {
        if (map.getLayer(`${id}-${suffix}`)) map.removeLayer(`${id}-${suffix}`);
        boundRef.current.delete(`${id}-${suffix}`);
      }
      if (map.getSource(id)) map.removeSource(id);
      dataRef.current.delete(id);
    }

    for (const layer of layers) {
      const data = layer.data ?? { type: 'FeatureCollection', features: [] };
      const src = map.getSource(layer.id);
      if (!src) {
        map.addSource(layer.id, { type: 'geojson', data });
        dataRef.current.set(layer.id, data);
      } else if (dataRef.current.get(layer.id) !== data) {
        src.setData(data);
        dataRef.current.set(layer.id, data);
      }
      for (const spec of overlaySpecs(layer)) {
        if (!map.getLayer(spec.id)) {
          map.addLayer(spec);
        } else {
          map.setLayoutProperty(spec.id, 'visibility', spec.layout.visibility);
          for (const [k, v] of Object.entries(spec.paint)) map.setPaintProperty(spec.id, k, v);
        }
        map.moveLayer(spec.id); // keep declaration order (last = top)
        if (!boundRef.current.has(spec.id) && layer.interactive !== false) {
          boundRef.current.add(spec.id);
          map.on('click', spec.id, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const { onFeatureClick: cb, popup: pop } = cbRef.current;
            const html = pop?.(layer.id, f.properties, f);
            if (html) {
              popupRef.current?.remove();
              popupRef.current = new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
            }
            cb?.(layer.id, f, e.lngLat);
          });
          map.on('mouseenter', spec.id, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', spec.id, () => { map.getCanvas().style.cursor = ''; });
        }
      }
    }
  }, [layers, ready]);

  // Crosshair cursor while a page expects map clicks (e.g. placing control points).
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) map.getCanvas().style.cursor = cursor ?? '';
  }, [cursor, ready]);

  // Fit when asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !fitTo) return;
    const b = Array.isArray(fitTo) ? fitTo : bboxOf(fitTo);
    if (!b) return;
    const [w, s, e, n] = b;
    if (w === e && s === n) map.easeTo({ center: [w, s], zoom: 17, duration: 600 });
    else map.fitBounds([[w, s], [e, n]], { padding: 48, duration: 700, maxZoom: 18 });
  }, [fitKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cx('relative h-full w-full overflow-hidden bg-[#e8eef3]', className)}>
      <div ref={containerRef} className="h-full w-full" aria-label="Map" role="region" />

      <div className="absolute left-3 top-3 z-10 inline-flex rounded-full bg-white p-0.5 text-xs font-medium shadow-md ring-1 ring-line/60">
        {[{ key: 'streets', label: 'Streets', icon: FiMap }, { key: 'satellite', label: 'Satellite', icon: FiGlobe }].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setBasemap(key)}
            aria-pressed={basemap === key}
            className={cx('inline-flex items-center gap-1 rounded-full px-3 py-1.5 transition-colors', basemap === key ? 'bg-ink text-white' : 'text-subtle hover:text-ink')}
          >
            <Icon /> {label}
          </button>
        ))}
      </div>

      {legend && (
        <div className="absolute bottom-8 left-3 z-10 max-w-[220px] rounded-md bg-white/95 p-3 text-xs shadow-md ring-1 ring-line/60">
          {legend}
        </div>
      )}

      {children}

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/50 backdrop-blur-[2px]">
          <Loader size="lg" label="Loading map data" />
        </div>
      )}
    </div>
  );
}
