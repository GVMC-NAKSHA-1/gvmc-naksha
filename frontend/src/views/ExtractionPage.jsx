import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiCpu, FiPlay } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import Legend from '../components/MapLegend';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, StatCard, cx, inputCls, labelCls, td, th } from '../components/ui';
import { propsTable } from '../components/mapPopup';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { fetchSourceFeatures, fetchSources, selectSourceFeatures, selectSources } from '../Redux/slices/sourcesSlice';
import {
  fetchExtractionRuns, resetRun, runExtraction, selectExtractError, selectExtractStatus, selectRuns,
} from '../Redux/slices/processingSlice';
import { EXTRACTION_METHODS, JOB_STATUS, RASTER_TYPES, fmtDateTime, fmtNum, sourceLabel } from '../utils/format';

const confColor = (c) => (c >= 0.85 ? '#2d6a4f' : c >= 0.6 ? '#c08a1e' : '#b42318');
const BINS = ['< 50', '50–100', '100–200', '200–400', '> 400'];

export default function ExtractionPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const sources = useSelector(selectSources);
  const runs = useSelector(selectRuns);
  const featuresById = useSelector(selectSourceFeatures);
  const status = useSelector(selectExtractStatus);
  const error = useSelector(selectExtractError);
  const [sourceId, setSourceId] = useState('');
  const [method, setMethod] = useState('auto');
  const [minHeight, setMinHeight] = useState(2.5);
  const [minArea, setMinArea] = useState(20);
  const [selectedRun, setSelectedRun] = useState(null);

  const load = () => {
    dispatch(fetchSources({ wardId: wardId ?? undefined }));
    dispatch(fetchExtractionRuns(wardId ?? undefined));
  };
  useEffect(() => { load(); dispatch(resetRun()); setSelectedRun(null); }, [wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const inWard = (s) => !wardId || s.wardId === wardId;
  const rasters = useMemo(() => sources.filter((s) => RASTER_TYPES.includes(s.type) && inWard(s)), [sources, wardId]); // eslint-disable-line react-hooks/exhaustive-deps
  const aiSources = useMemo(() => sources.filter((s) => s.type === 'ai_extracted' && inWard(s)), [sources, wardId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (rasters.length && !rasters.some((r) => r.id === sourceId)) setSourceId(rasters.find((r) => r.status === 'ready')?.id ?? rasters[0].id);
  }, [rasters, sourceId]);

  const busy = runs.some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [busy, wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the chosen run's output — or the latest AI layer in the ward.
  const wardRuns = runs.filter((r) => !wardId || r.wardId === wardId);
  const run = wardRuns.find((r) => r.id === selectedRun) ?? wardRuns.find((r) => r.status === 'done');
  const resultId = run?.resultSourceId ?? aiSources[0]?.id;
  useEffect(() => { if (resultId) dispatch(fetchSourceFeatures(resultId)); }, [resultId, dispatch]);
  const fc = featuresById[resultId]?.fc;
  const resultSource = sources.find((s) => s.id === resultId);

  const layers = useMemo(() => {
    const out = [];
    const parent = run && featuresById[run.sourceId]?.fc;
    if (parent) out.push({ id: 'raster', data: parent, color: '#6c5ce7', fillOpacity: 0.03, dashed: true, interactive: false });
    if (fc) {
      out.push({
        id: 'ai',
        data: featureCollection(fc.features.map((f) => ({ ...f, properties: { ...f.properties, _color: confColor(Number(f.properties?.confidence ?? 0.5)) } }))),
        color: '#c2571a', fillOpacity: 0.35, lineWidth: 1.5,
      });
    }
    return out;
  }, [fc, run, featuresById]);
  useEffect(() => { if (run?.sourceId) dispatch(fetchSourceFeatures(run.sourceId)); }, [run?.sourceId, dispatch]);

  const m = run?.metrics ?? {};
  const hist = m.area_histogram ?? [];
  const maxBin = Math.max(1, ...hist);
  const selectedRaster = rasters.find((r) => r.id === sourceId);

  const start = async () => {
    const res = await dispatch(runExtraction({ sourceId, method, params: { min_height_m: Number(minHeight), min_area_sqm: Number(minArea) } }));
    if (res.meta.requestStatus === 'fulfilled') setSelectedRun(res.payload.run.id);
  };

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        title="Building extraction"
        description="Building footprints are extracted automatically from drone imagery, orthorectified imagery (ORI) and DSM/DTM rasters. The extracted footprints become their own layer that is matched, validated and synchronised against cadastral and municipal records."
      />

      <div className="grid items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle className="mb-3">Run extraction</SectionTitle>
            {rasters.length === 0 ? (
              <EmptyState icon={FiCpu} message="Upload drone imagery, ORI or a DSM/DTM for this ward first — extraction then runs automatically." />
            ) : (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Raster source</span>
                  <select className={inputCls} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                    {rasters.map((r) => <option key={r.id} value={r.id} disabled={r.status !== 'ready'}>{`${sourceLabel(r.type)} — ${r.filename ?? r.id.slice(0, 8)}${r.status !== 'ready' ? ` (${r.status})` : ''}`}</option>)}
                  </select>
                </label>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className={cx(labelCls, 'mb-1')}>Method</legend>
                  {Object.entries(EXTRACTION_METHODS).map(([k, v]) => (
                    <label key={k} className={cx('flex cursor-pointer gap-2 rounded-md border px-2.5 py-2 text-xs', method === k ? 'border-primary bg-primary-light' : 'border-line hover:bg-hover')}>
                      <input type="radio" name="method" value={k} checked={method === k} onChange={() => setMethod(k)} className="mt-0.5 accent-primary" />
                      <span><strong className="block text-sm text-ink">{v.label}</strong><span className="text-subtle">{v.hint}</span></span>
                    </label>
                  ))}
                </fieldset>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1"><span className={labelCls}>Min height (m)</span>
                    <input type="number" step="0.5" min="0.5" className={inputCls} value={minHeight} onChange={(e) => setMinHeight(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1"><span className={labelCls}>Min area (m²)</span>
                    <input type="number" min="1" className={inputCls} value={minArea} onChange={(e) => setMinArea(e.target.value)} />
                  </label>
                </div>
                <Button onClick={start} disabled={!sourceId || selectedRaster?.status !== 'ready' || status === 'loading'} title="Detect building outlines in the chosen image; they become a new layer">
                  <FiPlay /> {status === 'loading' ? 'Queuing…' : 'Extract footprints'}
                </Button>
                {status === 'succeeded' && <Notice tone="info">Extraction queued — the result is matched and validated automatically.</Notice>}
                {error && <Notice tone="danger">{error}</Notice>}
              </div>
            )}
          </Card>
          <Card>
            <SectionTitle className="mb-2">Pipeline</SectionTitle>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-subtle">
              <li>Detector → building mask (nDSM height, ONNX segmentation model, or classical vision).</li>
              <li>Morphological open/close removes noise and fills roof gaps.</li>
              <li>Connected components → polygons; Douglas–Peucker simplification.</li>
              <li>Regularisation: near-rectangular roofs snapped to the minimum rotated rectangle.</li>
              <li>Reprojected to WGS84; geodesic area, mean height and a confidence per footprint.</li>
              <li>Stored as an “Extracted footprints” layer → topology check → spatial matching → validation.</li>
            </ol>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={FiCpu} accent="#c2571a" label="Footprints" value={fmtNum(run?.featureCount ?? fc?.features?.length)} hint={run ? `method: ${run.methodUsed ?? run.method}` : resultSource?.method && `method: ${resultSource.method}`} />
            <StatCard icon={FiCpu} accent="#2d6a4f" label="Mean confidence" value={m.mean_confidence != null ? `${Math.round(m.mean_confidence * 100)}%` : '—'} />
            <StatCard icon={FiCpu} accent="#5b4a8a" label="Mean height" value={m.mean_height_m != null ? `${m.mean_height_m} m` : '—'} />
            <StatCard icon={FiCpu} accent="#1d4f7c" label="Built-up area" value={m.total_area_sqm != null ? `${fmtNum(m.total_area_sqm, 0)} m²` : '—'} />
          </div>

          <div className="h-[440px] overflow-hidden rounded-xl border border-line">
            <GeoMap
              layers={layers}
              fitTo={fc?.features?.length ? fc : ward?.bbox ? [ward.bbox.west, ward.bbox.south, ward.bbox.east, ward.bbox.north] : null}
              fitKey={`${wardId}-${resultId}-${Boolean(fc)}`}
              popup={(_, p) => propsTable('Extracted footprint', p)}
              loading={featuresById[resultId]?.status === 'loading'}
              legend={<Legend title="Footprint confidence" items={[{ color: '#2d6a4f', label: '≥ 85%' }, { color: '#c08a1e', label: '60–85%' }, { color: '#b42318', label: '< 60%' }, { color: '#6c5ce7', label: 'Raster extent', shape: 'line' }]} />}
            >
              {!resultId && <div className="absolute inset-x-0 bottom-10 z-10 mx-auto w-fit rounded-md bg-white px-3 py-2 text-xs text-subtle shadow">No extraction output in this ward yet.</div>}
            </GeoMap>
          </div>

          {hist.length > 0 && (
            <Card>
              <SectionTitle className="mb-2">Footprint size distribution (m²)</SectionTitle>
              <div className="flex h-24 items-end gap-2">
                {hist.map((n, i) => (
                  <div key={BINS[i]} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-subtle">{n}</span>
                    <div className="w-full rounded-t bg-orange/70" style={{ height: `${(n / maxBin) * 64}px` }} />
                    <span className="text-[10px] text-faint">{BINS[i]}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-0">
            <div className="border-b border-line-light p-3"><SectionTitle>Extraction runs</SectionTitle></div>
            {runs.length === 0 ? <EmptyState icon={FiCpu} message="No runs yet." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead><tr><th className={th}>Source</th><th className={th}>Method</th><th className={th}>Status</th><th className={cx(th, 'text-right')}>Footprints</th><th className={th}>Started</th></tr></thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} onClick={() => setSelectedRun(r.id)} aria-selected={run?.id === r.id}
                        className={cx('cursor-pointer border-t border-line-light', run?.id === r.id ? 'bg-primary-light' : 'hover:bg-hover')}>
                        <td className={cx(td, 'max-w-[220px] truncate')}>{r.sourceName ?? r.sourceId.slice(0, 8)}</td>
                        <td className={td}>{EXTRACTION_METHODS[r.methodUsed ?? r.method]?.label ?? r.method}{r.method === 'auto' && r.methodUsed && <span className="text-faint"> (auto)</span>}</td>
                        <td className={td}>{r.status === 'running' || r.status === 'queued' ? <span className="inline-flex items-center gap-1.5"><Loader size="sm" />{r.status}</span> : <Badge tone={JOB_STATUS[r.status]} title={r.error ?? ''}>{r.status}</Badge>}</td>
                        <td className={cx(td, 'text-right tabular-nums')}>{fmtNum(r.featureCount)}</td>
                        <td className={cx(td, 'whitespace-nowrap text-subtle')}>{fmtDateTime(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </PageMotion>
  );
}
