import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiDownload, FiLayers, FiPackage, FiRefreshCw, FiX } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import Legend from '../components/MapLegend';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import { Badge, Button, Card, Meter, Notice, PageHeader, SectionTitle, Skeleton, StatCard, cx, td, th } from '../components/ui';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import {
  assembleWard, exportHarmonized, fetchExports, fetchHarmonized, fetchHarmonizedGeoJSON, resetAssembleStatus, resetExportStatus,
  selectAssembleError, selectAssembleStatus, selectExportError, selectExportStatus, selectExports, selectHarmonized,
  selectHarmonizedGeoJSON, selectHarmonizedStatus,
} from '../Redux/slices/harmonizedSlice';
import { Link } from 'react-router-dom';
import { READINESS, fmtDateTime, fmtNum, humanize, signalColor, sourceColor, sourceLabel } from '../utils/format';
import { fetchReadiness, selectReadiness } from '../Redux/slices/qualitySlice';

const confColor = (c) => (c >= 0.85 ? '#198754' : c >= 0.6 ? '#ffc107' : '#dc3545');
const KEY_FIELDS = ['parcel_id', 'survey_no', 'khata_no', 'owner_name', 'land_use', 'area_sqm'];

function download(obj, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/geo+json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RecordDetail({ record, onClose }) {
  const attrs = Object.entries(record.attributes);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-sm" aria-label="Golden record detail">
      <header className="flex items-center gap-2">
        <h2 className="flex-1 truncate font-mono text-sm font-semibold" title={record.id}>{record.id}</h2>
        <button type="button" aria-label="Close" title="Close" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover"><FiX /></button>
      </header>
      <Meter label="Record confidence" value={record.confidence} color={signalColor(record.confidence ?? 0)} />
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md bg-canvas p-2"><div className="text-subtle">Geometry from</div><strong>{sourceLabel(record.geomSourceType)}</strong></div>
        <div className="rounded-md bg-canvas p-2"><div className="text-subtle">Merged features</div><strong className="tabular-nums">{record.memberCount}</strong></div>
        <div className="rounded-md bg-canvas p-2"><div className="text-subtle">Open conflicts</div><strong className={cx('tabular-nums', record.conflictCount > 0 && 'text-danger')}>{record.conflictCount}</strong></div>
      </div>
      <div>
        <SectionTitle className="mb-1.5">Attributes & provenance</SectionTitle>
        {attrs.length === 0 ? <p className="text-xs text-subtle">No attributes.</p> : (
          <table className="w-full text-xs">
            <tbody>
              {attrs.map(([k, v]) => {
                const src = record.provenance[k];
                return (
                  <tr key={k} className="border-t border-line-light">
                    <td className="py-1 pr-2 text-subtle">{humanize(k)}</td>
                    <td className="py-1 pr-2 font-medium">{String(v)}</td>
                    <td className="py-1 text-right">
                      {src && <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-subtle"><span className="size-2 rounded-sm" style={{ background: sourceColor(src) }} />{sourceLabel(src)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-faint">Each attribute is taken from the most reliable source that has it (GNSS › cadastral › ground truth › footprints / municipal › …).</p>
      </div>
    </div>
  );
}

export default function RecordsPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const records = useSelector(selectHarmonized);
  const status = useSelector(selectHarmonizedStatus);
  const geojson = useSelector(selectHarmonizedGeoJSON);
  const assembleStatus = useSelector(selectAssembleStatus);
  const assembleError = useSelector(selectAssembleError);
  const exportStatus = useSelector(selectExportStatus);
  const exportError = useSelector(selectExportError);
  const exports = useSelector(selectExports);
  const readiness = useSelector(selectReadiness);
  const [minConf, setMinConf] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [exportMsg, setExportMsg] = useState(null);

  const load = () => {
    dispatch(fetchHarmonized({ wardId: wardId ?? undefined }));
    dispatch(fetchReadiness(wardId ?? undefined));
    if (wardId) { dispatch(fetchHarmonizedGeoJSON(wardId)); dispatch(fetchExports(wardId)); }
  };
  useEffect(() => { load(); setSelectedId(null); dispatch(resetAssembleStatus()); dispatch(resetExportStatus()); setExportMsg(null); }, [wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A queued GeoPackage export shows up in the list once the worker finishes.
  const pendingExport = exports.some((e) => e.status === 'processing');
  useEffect(() => {
    if (!pendingExport || !wardId) return undefined;
    const t = setInterval(() => dispatch(fetchExports(wardId)), 5000);
    return () => clearInterval(t);
  }, [pendingExport, wardId, dispatch]);

  const rows = useMemo(() => records.filter((r) => (r.confidence ?? 0) * 100 >= minConf), [records, minConf]);
  const selected = records.find((r) => r.id === selectedId) ?? null;

  const layers = useMemo(() => {
    if (!geojson?.features?.length) return [];
    const feats = geojson.features.map((f) => ({
      ...f,
      properties: { ...f.properties, _id: String(f.id), _color: String(f.id) === selectedId ? '#0d6efd' : confColor(f.properties?._confidence ?? 0) },
    }));
    return [{ id: 'golden', data: featureCollection(feats), color: '#198754', fillOpacity: 0.3, lineWidth: 1.8 }];
  }, [geojson, selectedId]);
  const selectedFeature = geojson?.features?.find((f) => String(f.id) === selectedId);

  const stats = useMemo(() => {
    const confs = records.filter((r) => r.confidence != null).map((r) => r.confidence);
    return {
      avg: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
      high: confs.filter((c) => c >= 0.85).length,
      withConflicts: records.filter((r) => r.conflictCount > 0).length,
      members: records.reduce((s, r) => s + r.memberCount, 0),
    };
  }, [records]);

  const assemble = async () => {
    const res = await dispatch(assembleWard(wardId ?? undefined));
    if (res.meta.requestStatus === 'fulfilled') setTimeout(load, 3000);
  };

  const doExport = async (format) => {
    setExportMsg(null);
    const res = await dispatch(exportHarmonized({ wardId, format }));
    if (res.meta.requestStatus !== 'fulfilled') return;
    const d = res.payload;
    if (format === 'geojson') {
      if (d.presigned_url) window.open(d.presigned_url, '_blank', 'noopener');
      else if (d.geojson) download(d.geojson, `naksha_ward${wardId}_golden_records.geojson`);
      setExportMsg(`Exported ${d.feature_count ?? d.geojson?.features?.length ?? 0} golden records as GeoJSON.`);
    } else {
      setExportMsg('GeoPackage export queued — it appears below when ready.');
      dispatch(fetchExports(wardId));
    }
  };

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        title="Final records"
        description="Each cluster of matched features becomes one harmonized parcel: geometry from the most reliable polygon source, attributes merged with provenance, and a confidence score. Export for inter-departmental exchange."
        actions={(
          <>
            <Button variant="secondary" onClick={assemble} disabled={assembleStatus === 'loading'} title="Rebuild the final records from the latest matches and conflict decisions">
              <FiRefreshCw className={assembleStatus === 'loading' ? 'animate-spin' : ''} /> {wardId ? 'Rebuild records' : 'Rebuild records (all wards)'}
            </Button>
            <Button onClick={() => doExport('geojson')} disabled={!wardId || exportStatus === 'loading'} title={wardId ? 'Download this ward’s final records as a GeoJSON file' : 'Choose a ward at the top first'}><FiDownload /> Download GeoJSON</Button>
            <Button variant="secondary" onClick={() => doExport('gpkg')} disabled={!wardId || exportStatus === 'loading'} title={wardId ? 'Prepare a GeoPackage file (for QGIS / ArcGIS); it appears under Exports when ready' : 'Choose a ward at the top first'}><FiPackage /> Export GeoPackage</Button>
          </>
        )}
      />
      <div className="mb-4 flex flex-col gap-2">
        {assembleStatus === 'succeeded' && <Notice tone="info">Rebuilding records — the list refreshes shortly.</Notice>}
        {assembleStatus === 'failed' && <Notice tone="danger">{assembleError}</Notice>}
        {exportMsg && <Notice>{exportMsg}</Notice>}
        {exportStatus === 'failed' && <Notice tone="danger">{exportError}</Notice>}
        {!wardId && <Notice tone="warning">Choose a ward at the top of the page to see its records on the map and to download them.</Notice>}
      </div>

      {readiness?.total > 0 && (
        <Card className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SectionTitle>Ready to finalise?</SectionTitle>
            <span className="ml-auto text-sm"><strong className="text-success">{readiness.ready_pct}%</strong> ready ({readiness.ready} of {readiness.total})</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-line-light">
            {Object.entries(READINESS).map(([k, v]) => readiness[k] > 0 && <div key={k} title={`${v.label}: ${readiness[k]}`} style={{ width: `${(readiness[k] / readiness.total) * 100}%`, background: v.color }} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-subtle">
            {Object.entries(READINESS).map(([k, v]) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: v.color }} />{v.label} <strong className="text-ink">{readiness[k]}</strong>
                {k === 'blocked_conflict' && readiness[k] > 0 && <Link to="/conflicts" className="font-medium">resolve →</Link>}
                {k === 'blocked_topology' && readiness[k] > 0 && <Link to="/topology" className="font-medium">fix →</Link>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-faint">A golden record is ready when it has no open conflicts, no open topology issues on its member features and confidence ≥ 85%.</p>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FiLayers} label="Final records" value={fmtNum(records.length)} hint={`${fmtNum(stats.members)} source features merged`} />
        <StatCard icon={FiLayers} accent="#198754" label="Mean confidence" value={stats.avg != null ? `${Math.round(stats.avg * 100)}%` : '—'} />
        <StatCard icon={FiLayers} accent="#20c997" label="High confidence (≥ 85%)" value={fmtNum(stats.high)} />
        <StatCard icon={FiLayers} accent="#dc3545" label="With open conflicts" value={fmtNum(stats.withConflicts)} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {wardId && (
            <div className="h-[420px] overflow-hidden rounded-xl border border-line">
              <GeoMap
                layers={layers}
                fitTo={selectedFeature ?? (ward?.bbox ? [ward.bbox.west, ward.bbox.south, ward.bbox.east, ward.bbox.north] : geojson)}
                fitKey={`${wardId}-${selectedId ?? ''}`}
                onFeatureClick={(_, f) => setSelectedId(String(f.properties?._id ?? f.id))}
                legend={<Legend title="Confidence" items={[{ color: '#198754', label: '≥ 85%' }, { color: '#ffc107', label: '60–85%' }, { color: '#dc3545', label: '< 60%' }, { color: '#0d6efd', label: 'Selected' }]} />}
              >
                {layers.length === 0 && (
                  <div className="absolute inset-x-0 bottom-10 z-10 mx-auto w-fit rounded-md bg-white px-3 py-2 text-xs text-subtle shadow">No assembled records in this ward yet.</div>
                )}
              </GeoMap>
            </div>
          )}

          <Card className="min-w-0 p-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-line-light p-3">
              <SectionTitle>Records</SectionTitle>
              <label className="ml-auto flex items-center gap-2 text-xs text-subtle">
                Min confidence
                <input type="range" min="0" max="100" step="5" value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} className="w-24 accent-primary" aria-label="Minimum confidence" />
                <span className="w-8 tabular-nums text-ink">{minConf}%</span>
              </label>
            </div>
            <div className="max-h-[50vh] overflow-auto">
              {status === 'loading' && !records.length ? (
                <div className="flex flex-col gap-2 p-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : rows.length === 0 ? (
                <EmptyState icon={FiLayers} message={records.length ? 'No records above this confidence.' : 'No final records yet — match parcels (step 3), then rebuild records.'} />
              ) : (
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead><tr><th className={th}>Key attributes</th><th className={th}>Geometry</th><th className={cx(th, 'text-right')}>Members</th><th className={cx(th, 'w-40')}>Confidence</th><th className={cx(th, 'text-right')}>Conflicts</th></tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const keys = KEY_FIELDS.filter((k) => r.attributes[k] != null).slice(0, 3);
                      return (
                        <tr key={r.id} onClick={() => setSelectedId(r.id)} aria-selected={selectedId === r.id}
                          className={cx('cursor-pointer border-t border-line-light', selectedId === r.id ? 'bg-primary-light' : 'hover:bg-hover')}>
                          <td className={cx(td, 'text-xs')}>
                            {keys.length ? keys.map((k) => <span key={k} className="mr-2 whitespace-nowrap"><span className="text-subtle">{humanize(k)}:</span> <strong>{String(r.attributes[k])}</strong></span>) : <span className="font-mono text-subtle">{r.id.slice(0, 8)}…</span>}
                          </td>
                          <td className={td}><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs"><span className="size-2 rounded-sm" style={{ background: sourceColor(r.geomSourceType) }} />{sourceLabel(r.geomSourceType)}</span></td>
                          <td className={cx(td, 'text-right tabular-nums')}>{r.memberCount}</td>
                          <td className={td}><Meter label="" value={r.confidence} color={signalColor(r.confidence ?? 0)} /></td>
                          <td className={cx(td, 'text-right')}>{r.conflictCount > 0 ? <Badge tone="danger">{r.conflictCount}</Badge> : <span className="text-faint">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {selected ? <RecordDetail record={selected} onClose={() => setSelectedId(null)} /> : (
            <Card><EmptyState icon={FiLayers} message="Select a record on the map or in the table to see merged attributes and their source." /></Card>
          )}
          {wardId && (
            <Card>
              <SectionTitle className="mb-2">Exports</SectionTitle>
              {exports.length === 0 ? <p className="text-xs text-subtle">No stored exports for this ward.</p> : (
                <ul className="flex flex-col gap-2">
                  {exports.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 rounded-md border border-line-light px-3 py-2 text-xs">
                      <FiPackage className="text-subtle" />
                      <span className="font-semibold uppercase">{e.format}</span>
                      <span className="text-subtle">{fmtDateTime(e.createdAt)}</span>
                      {e.featureCount != null && <span className="text-subtle">· {e.featureCount} parcels</span>}
                      <span className="ml-auto">
                        {e.status === 'ready' && e.downloadUrl ? (
                          <a href={e.downloadUrl} className="inline-flex items-center gap-1 font-medium" target="_blank" rel="noopener noreferrer"><FiDownload /> Download</a>
                        ) : e.status === 'processing' ? <Loader size="sm" /> : <Badge tone={e.status === 'failed' ? 'danger' : 'secondary'} title={e.error ?? ''}>{e.status}</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </PageMotion>
  );
}
