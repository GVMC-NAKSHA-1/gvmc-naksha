import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiCheckCircle, FiCrosshair, FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import EmptyState from '../components/EmptyState';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, cx, inputCls, labelCls, selectCls, td, th } from '../components/ui';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { fetchSourceDetail, fetchSources, selectSourceDetail, selectSources } from '../Redux/slices/sourcesSlice';
import {
  applyGeoref, fetchCrsList, previewGeoref, resetGeoref, selectApplyStatus, selectCrsList, selectGeorefError,
  selectGeorefPreview, selectTransformError, selectTransformed, selectTransformStatus, transformCoordinates,
} from '../Redux/slices/processingSlice';
import { SOURCE_STATUS, humanize, sourceLabel } from '../utils/format';

const MIN = { affine: 3, poly2: 6 };
const residualColor = (m) => (m == null ? '#6c757d' : m <= 1 ? '#198754' : m <= 3 ? '#ffc107' : '#dc3545');

/** Click-to-place control points on the scan preview. Coordinates are reported in ORIGINAL image pixels. */
function ScanPane({ src, gcps, pending, onPick }) {
  const imgRef = useRef(null);
  const [natural, setNatural] = useState(null);
  const scale = natural && src.imageSize ? src.imageSize.width / natural.w : 1;

  const click = (e) => {
    const img = imgRef.current;
    if (!img || !natural) return;
    const r = img.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * natural.w * scale;
    const py = ((e.clientY - r.top) / r.height) * natural.h * scale;
    onPick({ px: Math.round(px * 10) / 10, py: Math.round(py * 10) / 10 });
  };
  const pos = (g) => ({ left: `${(g.px / scale / natural.w) * 100}%`, top: `${(g.py / scale / natural.h) * 100}%` });

  if (!src.previewUrl) return <EmptyState icon={FiCrosshair} message="Preview not available yet — the worker creates it during ingestion." />;
  return (
    <div className="relative h-full overflow-auto bg-[#2b2f33]">
      <div className="relative mx-auto w-fit">
        <img
          ref={imgRef}
          src={src.previewUrl}
          alt="Scanned map sheet"
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onClick={click}
          className="block max-w-full cursor-crosshair select-none"
          draggable={false}
        />
        {natural && gcps.map((g, i) => (
          <span key={i} className="pointer-events-none absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-primary text-[10px] font-bold text-white shadow" style={pos(g)}>
            {i + 1}
          </span>
        ))}
        {natural && pending && (
          <span className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 animate-pulse-fade rounded-full border-2 border-warning bg-warning/60" style={pos(pending)} />
        )}
      </div>
    </div>
  );
}

function CrsTool() {
  const dispatch = useDispatch();
  const list = useSelector(selectCrsList);
  const out = useSelector(selectTransformed);
  const status = useSelector(selectTransformStatus);
  const error = useSelector(selectTransformError);
  const [from, setFrom] = useState('EPSG:4326');
  const [to, setTo] = useState('EPSG:32644');
  const [text, setText] = useState('83.2185, 17.6869\n83.3050, 17.7310');

  const points = text.split('\n').map((l) => l.split(/[,\s]+/).filter(Boolean).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite));
  const fmt = (v) => (Math.abs(v) < 1000 ? v.toFixed(7) : v.toFixed(3));

  return (
    <Card>
      <SectionTitle className="mb-3">Coordinate transformation engine</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1"><span className={labelCls}>From</span>
          <select className={selectCls} value={from} onChange={(e) => setFrom(e.target.value)}>{list.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className={labelCls}>To</span>
          <select className={selectCls} value={to} onChange={(e) => setTo(e.target.value)}>{list.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</select>
        </label>
      </div>
      <label className="mt-2 flex flex-col gap-1">
        <span className={labelCls}>Coordinates (one “x, y” per line)</span>
        <textarea className={cx(inputCls, 'font-mono text-xs')} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={() => dispatch(transformCoordinates({ from, to, points }))} disabled={!points.length || status === 'loading'}>
          <FiRefreshCw /> Transform {points.length} point{points.length === 1 ? '' : 's'}
        </Button>
        <span className="text-[11px] text-faint">Supports WGS84, UTM 43–45N, Kalianpur 1975 (legacy Survey of India), India LCC, Web Mercator.</span>
      </div>
      {error && <div className="mt-2"><Notice tone="danger">{error}</Notice></div>}
      {out && status === 'succeeded' && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-canvas p-2 text-xs" aria-label="Transformed coordinates">{out.map((p) => p.map(fmt).join(', ')).join('\n')}</pre>
      )}
    </Card>
  );
}

export default function GeorefPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const sources = useSelector(selectSources);
  const detail = useSelector(selectSourceDetail);
  const preview = useSelector(selectGeorefPreview);
  const applyStatus = useSelector(selectApplyStatus);
  const error = useSelector(selectGeorefError);
  const [selectedId, setSelectedId] = useState(null);
  const [gcps, setGcps] = useState([]);
  const [pending, setPending] = useState(null);
  const [kind, setKind] = useState('affine');

  useEffect(() => { dispatch(fetchCrsList()); }, [dispatch]);
  useEffect(() => { dispatch(fetchSources({ wardId: wardId ?? undefined })); }, [wardId, dispatch]);

  const candidates = useMemo(() => sources.filter((s) => (s.status === 'needs_georef' || s.georef) && (!wardId || s.wardId === wardId)), [sources, wardId]);
  useEffect(() => {
    if (candidates.length && !candidates.some((s) => s.id === selectedId)) setSelectedId(candidates.find((s) => s.status === 'needs_georef')?.id ?? candidates[0].id);
  }, [candidates, selectedId]);
  useEffect(() => {
    setGcps([]); setPending(null); dispatch(resetGeoref());
    if (selectedId) dispatch(fetchSourceDetail(selectedId));
  }, [selectedId, dispatch]);

  // Live fit quality.
  useEffect(() => {
    if (!selectedId || !gcps.length) return undefined;
    const t = setTimeout(() => dispatch(previewGeoref({ sourceId: selectedId, gcps, kind, crs: 'EPSG:4326' })), 250);
    return () => clearTimeout(t);
  }, [gcps, kind, selectedId, dispatch]);

  const src = detail?.id === selectedId ? detail : sources.find((s) => s.id === selectedId);
  const pickMap = (ll) => {
    if (!pending) return;
    setGcps((g) => [...g, { ...pending, x: Math.round(ll.lng * 1e7) / 1e7, y: Math.round(ll.lat * 1e7) / 1e7 }]);
    setPending(null);
  };

  const layers = useMemo(() => [{
    id: 'gcps',
    data: featureCollection(gcps.map((g, i) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [g.x, g.y] },
      properties: { n: i + 1, _color: residualColor(preview?.residuals_m?.[i]), _radius: 7 },
    }))),
    color: '#0d6efd',
  }], [gcps, preview]);

  const ready = gcps.length >= MIN[kind];

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        step="Ingest · Geo-referencing & coordinate transformation"
        title="Geo-referencing & CRS"
        description="Scanned cadastral sheets and rasters without a coordinate system wait here. Pair points on the scan with the same points on the map; the engine fits an affine or 2nd-order polynomial transform, reports residuals and RMSE, and writes a GeoTIFF that re-enters the pipeline."
      />

      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="p-0">
          <div className="border-b border-line-light p-3"><SectionTitle>Sources to geo-reference</SectionTitle></div>
          {candidates.length === 0 ? (
            <EmptyState icon={FiCrosshair} message="Nothing waiting. Upload a scanned map (PNG/JPG/PDF) or a raster without a CRS." />
          ) : (
            <ul className="flex flex-col">
              {candidates.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setSelectedId(s.id)} aria-pressed={selectedId === s.id}
                    className={cx('flex w-full flex-col gap-1 border-b border-line-light px-3 py-2 text-left', selectedId === s.id ? 'bg-primary-light' : 'hover:bg-hover')}>
                    <span className="truncate text-sm font-medium">{s.filename ?? s.id.slice(0, 8)}</span>
                    <span className="flex items-center gap-2 text-xs text-subtle">{sourceLabel(s.type)}<Badge tone={SOURCE_STATUS[s.status] ?? 'secondary'}>{humanize(s.status)}</Badge></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {src ? (
          <div className="flex min-w-0 flex-col gap-4">
            <Notice tone="info">
              {pending ? `Point ${gcps.length + 1}: now click the same location on the map.` : 'Click a recognisable feature on the scan (road junction, corner stone, building corner), then the same spot on the map.'}
            </Notice>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="h-[420px] overflow-hidden rounded-xl border border-line"><ScanPane src={src} gcps={gcps} pending={pending} onPick={setPending} /></div>
              <div className="h-[420px] overflow-hidden rounded-xl border border-line">
                <GeoMap
                  layers={layers}
                  fitTo={ward?.bbox ? [ward.bbox.west, ward.bbox.south, ward.bbox.east, ward.bbox.north] : null}
                  fitKey={`${wardId}-${selectedId}`}
                  onMapClick={pickMap}
                  cursor={pending ? 'crosshair' : ''}
                />
              </div>
            </div>

            <Card className="p-0">
              <div className="flex flex-wrap items-center gap-3 border-b border-line-light p-3">
                <SectionTitle>Ground control points ({gcps.length})</SectionTitle>
                <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Transform">
                  <option value="affine">Affine (≥ 3 points)</option>
                  <option value="poly2">2nd-order polynomial (≥ 6 points)</option>
                </select>
                <span className="ml-auto text-sm">
                  RMSE {preview?.rmse_m != null ? <strong style={{ color: residualColor(preview.rmse_m) }}>{preview.rmse_m.toFixed(2)} m</strong> : <span className="text-faint">needs {MIN[kind]} points</span>}
                </span>
                <Button variant="secondary" size="sm" onClick={() => { setGcps([]); setPending(null); }} disabled={!gcps.length}>Clear</Button>
                <Button size="sm" onClick={() => dispatch(applyGeoref({ sourceId: src.id, gcps, kind, crs: 'EPSG:4326' }))} disabled={!ready || applyStatus === 'loading' || src.status !== 'needs_georef'}>
                  <FiCheckCircle /> Apply & re-ingest
                </Button>
              </div>
              {gcps.length === 0 ? <p className="p-3 text-xs text-subtle">No control points yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead><tr><th className={th}>#</th><th className={th}>Pixel (x, y)</th><th className={th}>Map (lon, lat)</th><th className={th}>Residual</th><th className={th} /></tr></thead>
                    <tbody>
                      {gcps.map((g, i) => {
                        const r = preview?.residuals_m?.[i];
                        return (
                          <tr key={i} className="border-t border-line-light">
                            <td className={td}>{i + 1}</td>
                            <td className={cx(td, 'font-mono text-xs')}>{g.px}, {g.py}</td>
                            <td className={cx(td, 'font-mono text-xs')}>{g.x.toFixed(6)}, {g.y.toFixed(6)}</td>
                            <td className={td}>{r != null ? <span style={{ color: residualColor(r) }} className="font-semibold tabular-nums">{r.toFixed(2)} m</span> : '—'}</td>
                            <td className={td}><button type="button" aria-label={`Remove point ${i + 1}`} onClick={() => setGcps((x) => x.filter((_, j) => j !== i))} className="text-subtle hover:text-danger"><FiTrash2 /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-col gap-2 p-3">
                {applyStatus === 'succeeded' && <Notice>Geo-referencing queued. The GeoTIFF is written and the source re-ingested automatically.</Notice>}
                {error && <Notice tone="danger">{error}</Notice>}
                {src.georef && <Notice tone="info">Last applied: {src.georef.kind} with {src.georef.gcp_count} points, RMSE {Number(src.georef.rmse).toExponential(2)} (CRS units).</Notice>}
              </div>
            </Card>
          </div>
        ) : <Card><EmptyState icon={FiCrosshair} message="Select a source." /></Card>}
      </div>

      <div className="mt-4"><CrsTool /></div>
    </PageMotion>
  );
}
