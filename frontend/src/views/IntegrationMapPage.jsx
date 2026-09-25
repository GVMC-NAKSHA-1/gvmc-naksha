import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiCrosshair, FiEye, FiEyeOff, FiLayers, FiX } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import EmptyState from '../components/EmptyState';
import { Badge, SectionTitle, cx } from '../components/ui';
import { bboxPolygon, featureCollection } from '../components/mapStyle';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { fetchSourceFeatures, fetchSources, selectSourceFeatures, selectSources } from '../Redux/slices/sourcesSlice';
import { fetchHarmonizedGeoJSON, selectHarmonizedGeoJSON } from '../Redux/slices/harmonizedSlice';
import { FINDING_TYPES, SOURCE_META, SOURCE_TYPES, TOPOLOGY_TYPES, humanize } from '../utils/format';
import { fetchTopologyIssues, selectIssues } from '../Redux/slices/processingSlice';
import { fetchFindings, selectFindings } from '../Redux/slices/qualitySlice';

const GOLDEN = 'golden';
const TOPO = 'topology';
const SYNC = 'sync';
const confColor = (c) => (c >= 0.85 ? '#198754' : c >= 0.6 ? '#ffc107' : '#dc3545');

function FeatureCard({ picked, onClose }) {
  const props = Object.entries(picked.props).filter(([k, v]) => !k.startsWith('_') && v !== null && v !== '' && typeof v !== 'object');
  const meta = picked.layer === 'topology' ? { label: 'Topology issue', color: '#dc3545' }
    : picked.layer === 'sync' ? { label: FINDING_TYPES[picked.props.finding_type]?.label ?? 'Sync finding', color: '#fd7e14' }
      : picked.layer === GOLDEN ? null : SOURCE_META[picked.layer];
  return (
    <div className="absolute right-3 top-14 z-10 w-72 rounded-lg bg-white p-3 text-xs shadow-lg ring-1 ring-line/60">
      <div className="mb-2 flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ background: meta?.color ?? '#198754' }} />
        <strong className="flex-1 text-sm">{meta?.label ?? 'Golden record'}</strong>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-hover"><FiX /></button>
      </div>
      {picked.props._was_invalid && <Badge tone="warning" className="mb-2">geometry repaired</Badge>}
      {picked.props._confidence != null && <p className="mb-2">Confidence <strong>{Math.round(picked.props._confidence * 100)}%</strong> · {picked.props._conflict_count ?? 0} open conflicts</p>}
      <table className="w-full">
        <tbody>
          {props.slice(0, 14).map(([k, v]) => (
            <tr key={k} className="border-t border-line-light"><td className="py-1 pr-2 text-subtle">{humanize(k)}</td><td className="py-1 font-medium">{String(v)}</td></tr>
          ))}
        </tbody>
      </table>
      {!props.length && <p className="text-subtle">No attributes.</p>}
    </div>
  );
}

export default function IntegrationMapPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const sources = useSelector(selectSources);
  const featuresById = useSelector(selectSourceFeatures);
  const golden = useSelector(selectHarmonizedGeoJSON);
  const issues = useSelector(selectIssues);
  const findings = useSelector(selectFindings);
  const [hidden, setHidden] = useState({});
  const [showRepaired, setShowRepaired] = useState(false);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    setPicked(null);
    if (!wardId) return;
    dispatch(fetchSources({ wardId }));
    dispatch(fetchHarmonizedGeoJSON(wardId));
    dispatch(fetchTopologyIssues({ wardId, status: 'open' }));
    dispatch(fetchFindings(wardId));
  }, [wardId, dispatch]);

  const wardSources = useMemo(() => sources.filter((s) => s.wardId === wardId && s.status === 'ready'), [sources, wardId]);
  useEffect(() => { wardSources.forEach((s) => dispatch(fetchSourceFeatures(s.id))); }, [wardSources, dispatch]);

  // Merge all sources of one type into a single layer.
  const byType = useMemo(() => {
    const out = {};
    for (const s of wardSources) {
      const fc = featuresById[s.id]?.fc;
      if (!fc) continue;
      (out[s.type] ??= []).push(...fc.features);
    }
    return out;
  }, [wardSources, featuresById]);

  const loading = wardSources.some((s) => featuresById[s.id]?.status === 'loading');
  const repairedCount = Object.values(byType).flat().filter((f) => f.properties?._was_invalid).length;

  const layers = useMemo(() => {
    const out = [];
    if (ward?.bbox) out.push({ id: 'ward', data: featureCollection([{ type: 'Feature', properties: {}, geometry: bboxPolygon(ward.bbox) }]), color: '#0d6efd', fillOpacity: 0, dashed: true, interactive: false });
    // Imagery footprints first (bottom), then polygons, lines, points.
    const order = [...SOURCE_TYPES].sort((a, b) => ['footprint', 'polygon', 'line', 'point'].indexOf(SOURCE_META[a].geom) - ['footprint', 'polygon', 'line', 'point'].indexOf(SOURCE_META[b].geom));
    for (const t of order) {
      if (!byType[t]) continue;
      const imagery = SOURCE_META[t].geom === 'footprint';
      const features = showRepaired
        ? byType[t].map((f) => (f.properties?._was_invalid ? { ...f, properties: { ...f.properties, _color: '#dc3545', _radius: 8 } } : f))
        : byType[t];
      out.push({
        id: t, data: featureCollection(features), color: SOURCE_META[t].color, visible: !hidden[t],
        fillOpacity: imagery ? 0.04 : 0.18, dashed: imagery, lineWidth: imagery ? 1.5 : 1.2, circleRadius: 5,
      });
    }
    const openIssues = issues.filter((i) => i.wardId === wardId && i.status === 'open' && i.geometry);
    if (openIssues.length) {
      out.push({
        id: TOPO, visible: !hidden[TOPO], color: '#dc3545', fillOpacity: 0.6, lineWidth: 2,
        data: featureCollection(openIssues.map((i) => ({ type: 'Feature', geometry: i.geometry, properties: { issue: TOPOLOGY_TYPES[i.issueType]?.label ?? i.issueType, area_sqm: i.areaSqm, _color: TOPOLOGY_TYPES[i.issueType]?.color } }))),
      });
    }
    if (findings?.features?.length) {
      out.push({
        id: SYNC, visible: !hidden[SYNC], color: '#fd7e14', fillOpacity: 0.35, lineWidth: 2, dashed: true,
        data: featureCollection(findings.features.map((f) => ({ ...f, properties: { ...f.properties, _color: FINDING_TYPES[f.properties.finding_type]?.color } }))),
      });
    }
    if (golden?.features?.length) {
      out.push({
        id: GOLDEN,
        data: featureCollection(golden.features.map((f) => ({ ...f, properties: { ...f.properties, _color: confColor(f.properties?._confidence ?? 0) } }))),
        color: '#198754', visible: !hidden[GOLDEN], fillOpacity: 0.12, lineWidth: 2.5,
      });
    }
    return out;
  }, [ward, byType, golden, hidden, showRepaired, issues, findings, wardId]);

  // Fit to the vector data (imagery footprints span the whole ward and would zoom out too far).
  const vectorFC = useMemo(() => featureCollection(
    SOURCE_TYPES.filter((t) => SOURCE_META[t].geom !== 'footprint').flatMap((t) => byType[t] ?? []),
  ), [byType]);
  const hasVectors = vectorFC.features.length > 0;

  const toggle = (k) => setHidden((h) => ({ ...h, [k]: !h[k] }));
  const layerRows = [
    ...SOURCE_TYPES.filter((t) => byType[t]).map((t) => ({ key: t, label: SOURCE_META[t].label, color: SOURCE_META[t].color, count: byType[t].length, geom: SOURCE_META[t].geom })),
    ...(golden?.features?.length ? [{ key: GOLDEN, label: 'Golden records', color: '#198754', count: golden.features.length, geom: 'polygon' }] : []),
    ...(issues.some((i) => i.wardId === wardId && i.status === 'open') ? [{ key: TOPO, label: 'Open topology issues', color: '#dc3545', count: issues.filter((i) => i.wardId === wardId && i.status === 'open').length, geom: 'polygon' }] : []),
    ...(findings?.features?.length ? [{ key: SYNC, label: 'Sync findings', color: '#fd7e14', count: findings.features.length, geom: 'polygon' }] : []),
  ];

  return (
    <PageMotion className="flex flex-col gap-3 p-3 lg:h-[calc(100vh-56px)] lg:flex-row lg:p-4">
      <div className="relative h-[60vh] min-h-[360px] overflow-hidden rounded-xl border border-line lg:h-auto lg:flex-1">
        <GeoMap
          layers={layers}
          fitTo={hasVectors ? vectorFC : ward?.bbox ? [ward.bbox.west, ward.bbox.south, ward.bbox.east, ward.bbox.north] : null}
          fitKey={`${wardId}-${hasVectors}`}
          loading={loading}
          onFeatureClick={(layerId, f) => setPicked({ layer: layerId, props: f.properties ?? {} })}
        >
          {picked && <FeatureCard picked={picked} onClose={() => setPicked(null)} />}
          {!wardId && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
              <EmptyState icon={FiCrosshair} message="Select a ward in the top bar to load its integrated layers." />
            </div>
          )}
        </GeoMap>
      </div>

      <aside className="glass flex min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:w-80">
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-primary">Step 2 · Web-GIS</span>
          <h1 className="text-lg font-bold">Integration map</h1>
          <p className="mt-1 text-xs text-subtle">All sources reprojected to a common CRS (EPSG:4326) and overlaid. Click a feature to inspect its attributes.</p>
        </div>

        <section>
          <SectionTitle className="mb-2 flex items-center gap-1.5"><FiLayers /> Layers</SectionTitle>
          {layerRows.length === 0 ? (
            <p className="text-xs text-subtle">{wardId ? 'No processed sources in this ward yet.' : '—'}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {layerRows.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => toggle(r.key)}
                    aria-pressed={!hidden[r.key]}
                    className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover', hidden[r.key] && 'opacity-50')}
                  >
                    <span className={cx('size-3 shrink-0', r.geom === 'point' ? 'rounded-full' : 'rounded-sm', r.geom === 'footprint' && 'border-2 border-dashed bg-transparent!')} style={{ background: r.color, borderColor: r.color }} />
                    <span className="flex-1 truncate">{r.label}</span>
                    <span className="text-xs tabular-nums text-subtle">{r.count}</span>
                    {hidden[r.key] ? <FiEyeOff className="text-faint" /> : <FiEye className="text-subtle" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-line-light bg-white p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-danger" checked={showRepaired} onChange={(e) => setShowRepaired(e.target.checked)} />
            Highlight topology-repaired geometry
          </label>
          <p className="mt-1 text-xs text-subtle">
            <strong className="text-ink">{repairedCount}</strong> invalid geometries (self-intersections, bow-ties, unclosed rings) were auto-corrected during ingestion.
          </p>
        </section>

        {golden?.features?.length > 0 && (
          <section>
            <SectionTitle className="mb-2">Golden-record confidence</SectionTitle>
            <ul className="flex flex-col gap-1 text-xs">
              {[['#198754', '≥ 85% — high'], ['#ffc107', '60–85% — review'], ['#dc3545', '< 60% — low']].map(([c, l]) => (
                <li key={l} className="flex items-center gap-2"><span className="size-3 rounded-sm border-2" style={{ borderColor: c }} />{l}</li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </PageMotion>
  );
}
