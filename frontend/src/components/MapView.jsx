import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as maplibregl from './maplibre';
import { FiGlobe, FiMap } from 'react-icons/fi';
import {
  selectGeoJSONStatus, selectSelectedWard, selectWardGeoJSON, selectWards,
} from '../Redux/slices/wardsSlice';
import {
  fetchPropertyById, fetchPropertyExplanation, selectProperties, selectSelectedProperty, setSelectedProperty,
} from '../Redux/slices/propertiesSlice';
import { NDBI_LEGEND, humanize } from '../utils/format';
import Loader from './Loader';
import { BASE_STYLE, EMPTY_FC, OVERLAY_LAYERS, OVERLAY_SOURCES, VIZAG } from './mapStyle';
import { cx } from './ui';

const REVIEW_COLORS = { underassessed: '#fd7e14', already_assessed: '#28a745', false_positive: '#6c757d' };
const POLYGON_LEGEND = [
  { color: '#dc3545', label: 'New build — unreviewed' },
  { color: '#ffc107', label: 'Other change — unreviewed' },
  { color: '#fd7e14', label: 'Underassessed' },
  { color: '#28a745', label: 'Already assessed' },
  { color: '#6c757d', label: 'False positive' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt3 = (v) => (v == null ? '—' : Number(v).toFixed(3));
const bboxOk = (b) => b && [b.north, b.south, b.east, b.west].every(Number.isFinite) && b.north !== b.south && b.east !== b.west;
const bboxPolygon = (b) => ({
  type: 'Polygon',
  coordinates: [[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]],
});

function readBasemap() {
  try { return localStorage.getItem('gvmc.basemap') === 'satellite' ? 'satellite' : 'streets'; } catch { return 'streets'; }
}

function Legend({ title, items }) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 min-w-[140px] rounded-md bg-white p-3 text-xs shadow-md ring-1 ring-line/60">
      <div className="mb-1.5 font-semibold uppercase tracking-wider text-subtle">{title}</div>
      <ul className="flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2 text-ink">
            <span className="size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/10" style={{ background: it.color }} />
            {it.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MapView({ choropleth = false, allWardsData = null, heatmap = false, showPolygons = false }) {
  const dispatch = useDispatch();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const selectedIdRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState(readBasemap);

  const wards = useSelector(selectWards);
  const selectedWard = useSelector(selectSelectedWard);
  const properties = useSelector(selectProperties);
  const selectedProperty = useSelector(selectSelectedProperty);
  const wardGeoJSON = useSelector(selectWardGeoJSON);
  const geoJSONStatus = useSelector(selectGeoJSONStatus);

  // ── Create the map once ────────────────────────────────────────────────────
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: VIZAG,
      zoom: 12,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    const selectProperty = (id) => {
      dispatch(setSelectedProperty(id));
      dispatch(fetchPropertyById(id));
      dispatch(fetchPropertyExplanation(id));
    };
    const showPopup = (lngLat, html) => {
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat(lngLat).setHTML(html).addTo(map);
    };

    map.on('load', () => {
      Object.entries(OVERLAY_SOURCES).forEach(([id, src]) => map.addSource(id, src));
      OVERLAY_LAYERS.forEach((layer) => map.addLayer(layer));

      map.on('click', 'properties-circle', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties;
        showPopup(e.lngLat, `
          <div style="display:grid;gap:2px">
            <strong style="font-family:monospace">${esc(String(p.id).slice(0, 8))}…</strong>
            <span>NDBI Δ: <b>${fmt3(p.ndbiDelta)}</b></span>
            <span>Type: ${esc(humanize(p.detectionType))}</span>
            <span>Area: ${p.areaSqm != null && p.areaSqm !== 'null' ? Math.round(p.areaSqm).toLocaleString() : '—'} m²</span>
            ${p.years ? `<span>Years: ${esc(p.years)}</span>` : ''}
          </div>`);
        selectProperty(String(p.id));
      });
      map.on('click', 'changes-fill', (e) => {
        const f = e.features?.[0];
        if (f?.properties?.propertyId) selectProperty(String(f.properties.propertyId));
      });
      map.on('click', 'wards-fill', (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ['properties-circle'] }).length) return;
        const p = e.features?.[0]?.properties;
        if (!p) return;
        showPopup(e.lngLat, `
          <div style="display:grid;gap:2px">
            <strong>${esc(p.name)}</strong>
            <span>Avg NDBI Δ: <b>${fmt3(p.avgNdbiDelta === 'null' ? null : p.avgNdbiDelta)}</b></span>
            <span>Max NDBI Δ: <b>${fmt3(p.maxNdbiDelta === 'null' ? null : p.maxNdbiDelta)}</b></span>
            <span>Detections: <b>${Number(p.totalDetections ?? 0).toLocaleString()}</b></span>
            <span>Unassessed: <b>${Number(p.unassessedCount ?? 0).toLocaleString()}</b></span>
          </div>`);
      });
      for (const layer of ['properties-circle', 'changes-fill', 'wards-fill']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }
      setReady(true);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [dispatch]);

  // ── Basemap toggle ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const sat = basemap === 'satellite';
    map.setLayoutProperty('streets', 'visibility', sat ? 'none' : 'visible');
    map.setLayoutProperty('satellite', 'visibility', sat ? 'visible' : 'none');
    map.setLayoutProperty('labels', 'visibility', sat ? 'visible' : 'none');
    try { localStorage.setItem('gvmc.basemap', basemap); } catch { /* storage unavailable */ }
  }, [basemap, ready]);

  // ── Fit to the selected ward ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource('selected-ward');
    if (selectedWard && bboxOk(selectedWard.bbox)) {
      const b = selectedWard.bbox;
      src?.setData({ type: 'Feature', properties: {}, geometry: bboxPolygon(b) });
      map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, duration: 800 });
    } else {
      src?.setData(EMPTY_FC);
    }
  }, [selectedWard, ready]);

  // ── Choropleth (ward bboxes coloured by avg NDBI Δ) ────────────────────────
  const wardsFC = useMemo(() => {
    if (!choropleth || !allWardsData || !wards.length) return EMPTY_FC;
    const byId = new Map(allWardsData.map((w) => [String(w.wardId), w]));
    const maxUnassessed = Math.max(1, ...allWardsData.map((w) => w.unassessedCount || 0));
    const features = wards.filter((w) => bboxOk(w.bbox)).map((w) => {
      const s = byId.get(w.id) ?? {};
      // When the backend has no NDBI aggregate, fall back to relative unassessed activity.
      const activity = s.avgNdbiDelta ?? (s.unassessedCount ? (0.35 * s.unassessedCount) / maxUnassessed : null);
      return {
        type: 'Feature',
        geometry: bboxPolygon(w.bbox),
        properties: {
          wardId: w.id,
          name: s.wardName ?? w.name,
          color: activity == null ? '#ecf0f1' : activity >= 0.3 ? '#c0392b' : activity >= 0.2 ? '#e67e22' : activity >= 0.1 ? '#f1c40f' : activity > 0 ? '#f9e79f' : '#ecf0f1',
          avgNdbiDelta: s.avgNdbiDelta ?? null,
          maxNdbiDelta: s.maxNdbiDelta ?? null,
          totalDetections: s.totalDetections ?? w.detectionCount ?? 0,
          unassessedCount: s.unassessedCount ?? 0,
        },
      };
    });
    return { type: 'FeatureCollection', features };
  }, [choropleth, allWardsData, wards]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource('wards')?.setData(wardsFC);
    if (choropleth && wardsFC.features.length && !selectedWard) {
      const bounds = new maplibregl.LngLatBounds();
      wardsFC.features.forEach((f) => f.geometry.coordinates[0].forEach((c) => bounds.extend(c)));
      map.fitBounds(bounds, { padding: 40, duration: 0 });
    }
  }, [wardsFC, ready, choropleth, selectedWard]);

  // ── Heatmap circles (one per property) ─────────────────────────────────────
  const propertiesFC = useMemo(() => {
    if (!heatmap) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: properties.filter((p) => p.lat && p.lng).map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          ndbiDelta: p.ndbiDelta,
          detectionType: p.detectionType,
          areaSqm: p.areaSqm,
          radiusM: Math.max(18, Math.sqrt(p.areaSqm ?? 100) * 2.5),
          years: p.baselineYear && p.comparisonYear ? `${p.baselineYear}–${p.comparisonYear}` : '',
        },
      })),
    };
  }, [heatmap, properties]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource('properties')?.setData(propertiesFC);
  }, [propertiesFC, ready]);

  // ── Detection polygons from the ward GeoJSON ───────────────────────────────
  const changesFC = useMemo(() => {
    if (!showPolygons || !wardGeoJSON?.features) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: wardGeoJSON.features.filter((f) => f.geometry).map((f, i) => {
        const pr = f.properties ?? {};
        const conf = Number(pr.confidence ?? 0);
        return {
          ...f,
          properties: {
            ...pr,
            fid: String(f.id ?? i),
            propertyId: pr.property_id ?? f.id ?? null,
            color: REVIEW_COLORS[pr.status] ?? (pr.detection_type === 'new_build' ? '#dc3545' : '#ffc107'),
            opacity: conf >= 0.8 ? 0.6 : conf >= 0.5 ? 0.4 : 0.2,
          },
        };
      }),
    };
  }, [showPolygons, wardGeoJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource('changes')?.setData(changesFC);
    const vis = showPolygons ? 'visible' : 'none';
    map.setLayoutProperty('changes-fill', 'visibility', vis);
    map.setLayoutProperty('changes-line', 'visibility', vis);
  }, [changesFC, showPolygons, ready]);

  // ── Selection highlight ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const id = selectedProperty?.id ?? null;
    const prev = selectedIdRef.current;
    if (prev) {
      map.removeFeatureState({ source: 'properties', id: prev });
    }
    map.setFilter('properties-selected', ['==', ['get', 'id'], id ?? '']);
    if (id) {
      map.setFeatureState({ source: 'properties', id }, { selected: true });
      const p = properties.find((x) => x.id === id);
      if (p?.lat && p?.lng && heatmap) map.easeTo({ center: [p.lng, p.lat], duration: 500 });
    }
    selectedIdRef.current = id;
  }, [selectedProperty, ready, properties, heatmap]);

  const legend = choropleth
    ? { title: 'NDBI Activity', items: NDBI_LEGEND }
    : heatmap
      ? { title: 'NDBI Delta', items: NDBI_LEGEND }
      : showPolygons ? { title: 'Review status', items: POLYGON_LEGEND } : null;

  return (
    <div className="relative h-full w-full bg-[#e8eef3]">
      <div ref={containerRef} className="h-full w-full" aria-label="Map" role="region" />

      <div className="absolute left-3 top-3 z-10 inline-flex overflow-hidden rounded-full bg-white p-0.5 text-xs font-medium shadow-md ring-1 ring-line/60">
        {[
          { key: 'streets', label: 'Streets', icon: FiMap },
          { key: 'satellite', label: 'Satellite', icon: FiGlobe },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setBasemap(key)}
            aria-pressed={basemap === key}
            className={cx(
              'inline-flex items-center gap-1 rounded-full px-3 py-1.5 transition-colors',
              basemap === key ? 'bg-ink text-white' : 'text-subtle hover:text-ink',
            )}
          >
            <Icon /> {label}
          </button>
        ))}
      </div>

      {legend && <Legend {...legend} />}

      {geoJSONStatus === 'loading' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/70 backdrop-blur-sm">
          <Loader size="lg" />
          <span className="text-sm text-subtle">Loading ward data…</span>
        </div>
      )}
    </div>
  );
}
