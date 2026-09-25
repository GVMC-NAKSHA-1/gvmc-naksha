import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiDatabase, FiDownload, FiFileText, FiRefreshCw, FiUpload, FiX } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import {
  Badge, Button, Card, Meter, Notice, PageHeader, SectionTitle, Skeleton, cx, inputCls, labelCls, selectCls, td, th,
} from '../components/ui';
import { selectSelectedWardId, selectWards } from '../Redux/slices/wardsSlice';
import {
  clearDetail, digitizeSource, fetchSourceDetail, fetchSourceFeatures, fetchSources, resetUploadStatus,
  selectDigitizeError, selectDigitizeStatus, selectSourceDetail, selectSourceDetailStatus, selectSourceFeatures,
  selectSourceUploadError, selectSourceUploadStatus, selectSources, selectSourcesStatus, uploadSource,
} from '../Redux/slices/sourcesSlice';
import { Link } from 'react-router-dom';
import { SOURCE_META, SOURCE_STATUS, SOURCE_TYPES, UPLOAD_TYPES, fmtDate, fmtNum, humanize, signalColor } from '../utils/format';
import { propsTable } from '../components/mapPopup';

const GeoMap = lazy(() => import('../components/GeoMap'));

const CRS_PRESETS = ['', 'EPSG:4326', 'EPSG:32644', 'EPSG:32645', 'EPSG:3857', 'EPSG:24344'];
const GROUPS = [...new Set(UPLOAD_TYPES.map((t) => SOURCE_META[t].group))];

function TypeDot({ type }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="size-2.5 rounded-sm" style={{ background: SOURCE_META[type]?.color ?? '#6c757d' }} />
      {SOURCE_META[type]?.label ?? humanize(type)}
    </span>
  );
}

function UploadPanel({ wardId, wards, onUploaded }) {
  const dispatch = useDispatch();
  const status = useSelector(selectSourceUploadStatus);
  const error = useSelector(selectSourceUploadError);
  const [type, setType] = useState('cadastral');
  const [file, setFile] = useState(null);
  const [crs, setCrs] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [targetWard, setTargetWard] = useState(wardId ?? '');
  const fileRef = useRef(null);
  const meta = SOURCE_META[type];

  useEffect(() => { setTargetWard(wardId ?? ''); }, [wardId]);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    const res = await dispatch(uploadSource({ file, type, wardId: targetWard || undefined, crs, capturedAt }));
    if (res.meta.requestStatus === 'fulfilled') {
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onUploaded();
      setTimeout(() => dispatch(resetUploadStatus()), 4000);
    }
  };

  const scanned = type === 'revenue' && /\.pdf$/i.test(file?.name ?? '');

  return (
    <Card>
      <SectionTitle className="mb-3">Ingest a dataset</SectionTitle>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Source type</span>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {UPLOAD_TYPES.filter((t) => SOURCE_META[t].group === g).map((t) => <option key={t} value={t}>{SOURCE_META[t].label}</option>)}
              </optgroup>
            ))}
          </select>
          <span className="text-[11px] text-faint">Accepted: {meta.formats} · stored as {meta.geom}</span>
        </label>
        <div className="flex flex-col gap-1">
          <span className={labelCls}>File</span>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line bg-canvas px-3 py-3 text-sm text-subtle hover:border-primary hover:text-primary">
            <FiUpload /> <span className="truncate">{file ? file.name : 'Choose a file…'}</span>
            <input ref={fileRef} type="file" hidden accept=".geojson,.json,.zip,.tif,.tiff,.csv,.gpx,.pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {scanned && <span className="text-[11px] text-warning-dark">Scanned record — will be digitised with OCR.</span>}
          {/\.(png|jpe?g)$/i.test(file?.name ?? '') && <span className="text-[11px] text-purple">Scanned map — geo-reference it with control points after upload.</span>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Ward</span>
            <select className={inputCls} value={targetWard} onChange={(e) => setTargetWard(e.target.value)}>
              <option value="">City-wide</option>
              {wards.map((w) => <option key={w.id} value={w.id}>{`${w.id} — ${w.name}`}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Source CRS</span>
            <input className={inputCls} list="crs-presets" placeholder="auto-detect" value={crs} onChange={(e) => setCrs(e.target.value.toUpperCase())} pattern="^(EPSG:\d{4,6})?$" title="EPSG:xxxx" />
            <datalist id="crs-presets">{CRS_PRESETS.filter(Boolean).map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Captured on <em className="font-normal text-faint">optional</em></span>
          <input type="date" className={inputCls} value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
        </label>
        <Button type="submit" disabled={!file || status === 'loading'} className="w-full">
          {status === 'loading' ? 'Uploading…' : 'Upload & process'}
        </Button>
        {status === 'succeeded' && <Notice>Uploaded. The worker is reprojecting to WGS84, repairing topology and extracting fields.</Notice>}
        {status === 'failed' && <Notice tone="danger">{error}</Notice>}
        <p className="text-[11px] leading-snug text-faint">
          Leave CRS blank to use the file&apos;s embedded CRS (GeoJSON defaults to EPSG:4326). Shapefiles and GeoTIFFs without one need it declared.
        </p>
      </form>
    </Card>
  );
}

function SourceDetail({ id, onClose }) {
  const dispatch = useDispatch();
  const detail = useSelector(selectSourceDetail);
  const detailStatus = useSelector(selectSourceDetailStatus);
  const featuresById = useSelector(selectSourceFeatures);
  const digitizeStatus = useSelector(selectDigitizeStatus);
  const digitizeError = useSelector(selectDigitizeError);
  const listItem = useSelector(selectSources).find((s) => s.id === id);
  const src = detail?.id === id ? detail : listItem;
  const feats = featuresById[id];

  useEffect(() => {
    dispatch(fetchSourceDetail(id));
    dispatch(fetchSourceFeatures(id));
    return () => { dispatch(clearDetail()); };
  }, [id, dispatch]);

  const layers = useMemo(() => (feats?.fc ? [{
    id: 'preview', data: feats.fc, color: SOURCE_META[src?.type]?.color, fillOpacity: 0.3, circleRadius: 6,
  }] : []), [feats, src?.type]);

  if (!src) return null;
  const invalid = feats?.fc?.features?.filter((f) => f.properties?._was_invalid).length ?? 0;
  const canOcr = src.type === 'revenue' && (src.status === 'pending_ocr' || src.scanned);

  return (
    <motion.aside
      initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2 }}
      className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-sm"
      aria-label="Source detail"
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold" title={src.filename ?? src.id}>{src.filename ?? src.id}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-subtle">
            <TypeDot type={src.type} /><Badge tone={SOURCE_STATUS[src.status] ?? 'secondary'}>{humanize(src.status)}</Badge>
            {src.synthetic && <Badge tone="purple" title="Generated test data (open-data pack), not an official record">Synthetic</Badge>}
          </div>
          {src.description && <p className="mt-1 text-xs text-subtle">{src.description}</p>}
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover"><FiX /></button>
      </header>

      <div className="h-56 overflow-hidden rounded-lg border border-line-light">
        {feats?.status === 'loading' ? (
          <div className="flex h-full items-center justify-center"><Loader /></div>
        ) : feats?.fc?.features?.length ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader /></div>}>
            <GeoMap layers={layers} fitTo={feats.fc} fitKey={id} popup={(_, p) => propsTable(SOURCE_META[src.type]?.label, p)} />
          </Suspense>
        ) : (
          <EmptyState icon={FiDatabase} message={src.status === 'ready' ? 'No features in this source.' : 'Features appear once processing finishes.'} />
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div><dt className="text-subtle">Ward</dt><dd className="font-medium">{src.wardId ?? 'City-wide'}</dd></div>
        <div><dt className="text-subtle">Declared CRS</dt><dd className="font-medium">{src.crs ?? 'auto'} → EPSG:4326</dd></div>
        <div><dt className="text-subtle">Features</dt><dd className="font-medium tabular-nums">{fmtNum(src.featureCount ?? feats?.fc?.features?.length)}</dd></div>
        <div><dt className="text-subtle">Topology repaired</dt><dd className="font-medium tabular-nums">{feats?.fc ? invalid : '—'}</dd></div>
        <div><dt className="text-subtle">Captured</dt><dd className="font-medium">{fmtDate(src.capturedAt)}</dd></div>
        <div><dt className="text-subtle">Registered</dt><dd className="font-medium">{fmtDate(src.createdAt)}</dd></div>
      </dl>

      {src.error && <Notice tone="danger">{src.error}</Notice>}
      {src.status === 'needs_georef' && (
        <Notice tone="warning">
          No coordinate system — <Link to="/georef" className="font-semibold">geo-reference it with control points</Link> to bring it into the pipeline.
        </Notice>
      )}

      {src.fields.length > 0 && (
        <div>
          <SectionTitle className="mb-1.5">Attribute schema ({src.fields.length})</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {src.fields.map((f) => <code key={f} className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-ink">{f}</code>)}
          </div>
        </div>
      )}

      {src.ocr && Object.keys(src.ocr).length > 0 && (
        <div>
          <SectionTitle className="mb-1.5">OCR-extracted fields</SectionTitle>
          <div className="flex flex-col gap-2">
            {Object.entries(src.ocr).map(([k, v]) => {
              const value = typeof v === 'object' ? v?.value : v;
              const conf = typeof v === 'object' ? v?.confidence : src.ocrConfidence?.[k];
              return (
                <div key={k} className="rounded-md bg-canvas px-2.5 py-1.5">
                  <div className="flex justify-between text-xs"><span className="text-subtle">{humanize(k)}</span><strong>{String(value)}</strong></div>
                  {conf != null && <Meter label="OCR confidence" value={conf / 100} color={signalColor(conf / 100)} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canOcr && (
          <Button size="sm" onClick={() => dispatch(digitizeSource(src.id))} disabled={digitizeStatus === 'loading' || src.status === 'processing'}>
            <FiFileText /> {digitizeStatus === 'loading' ? 'Queuing…' : 'Run OCR'}
          </Button>
        )}
        {detail?.downloadUrl && (
          <a href={detail.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink hover:border-primary hover:text-primary hover:no-underline">
            <FiDownload /> Original file
          </a>
        )}
        {detailStatus === 'loading' && <Loader size="sm" />}
      </div>
      {digitizeStatus === 'succeeded' && <Notice tone="info">OCR queued. Extracted fields are then auto-mapped to the ward&apos;s cadastral schema.</Notice>}
      {digitizeStatus === 'failed' && <Notice tone="danger">{digitizeError}</Notice>}
    </motion.aside>
  );
}

export default function SourcesPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const wards = useSelector(selectWards);
  const sources = useSelector(selectSources);
  const status = useSelector(selectSourcesStatus);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);

  const load = () => dispatch(fetchSources({ wardId: wardId ?? undefined }));
  useEffect(() => { load(); setSelected(null); }, [wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while anything is still being processed by the worker.
  const busy = sources.some((s) => s.status === 'processing');
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(
    () => sources.filter((s) => (!typeFilter || s.type === typeFilter) && (!statusFilter || s.status === statusFilter)),
    [sources, typeFilter, statusFilter],
  );

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        step="Step 1 · Ingestion & ETL"
        title="Data sources"
        description="Drone imagery, ORI, DSM/DTM, cadastral maps, revenue records, municipal GIS, utility networks, ground truth, GNSS/CORS and building footprints. Each upload is reprojected to WGS84, repaired and schema-profiled, then flows automatically into AI extraction, topology QA, matching and validation."
        actions={<Button variant="secondary" onClick={load}><FiRefreshCw className={status === 'loading' ? 'animate-spin' : ''} /> Refresh</Button>}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <UploadPanel wardId={wardId} wards={wards} onUploaded={load} />

        <Card className="min-w-0 p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-light p-3">
            <select className={selectCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
              <option value="">All types</option>
              {SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_META[t].label}</option>)}
            </select>
            <select className={selectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {Object.keys(SOURCE_STATUS).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
            <span className="ml-auto text-xs text-subtle">{rows.length} sources{busy && ' · processing…'}</span>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            {status === 'loading' && !sources.length ? (
              <div className="flex flex-col gap-2 p-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : rows.length === 0 ? (
              <EmptyState icon={FiDatabase} message="No sources yet. Upload a dataset to start the pipeline." />
            ) : (
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>Dataset</th><th className={th}>Type</th><th className={th}>Ward</th><th className={th}>CRS</th>
                    <th className={cx(th, 'text-right')}>Features</th><th className={th}>Status</th><th className={th}>Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(s.id)}
                      aria-selected={selected === s.id}
                      className={cx('cursor-pointer border-t border-line-light transition-colors', selected === s.id ? 'bg-primary-light' : 'hover:bg-hover')}
                    >
                      <td className={cx(td, 'max-w-[240px] truncate font-medium')} title={s.description ?? s.filename ?? s.id}>
                        {s.filename ?? s.s3Key?.split('/').pop() ?? s.id.slice(0, 8)}
                        {s.synthetic && <Badge tone="purple" className="ml-1.5 !px-1.5 !text-[10px]">Synthetic</Badge>}
                      </td>
                      <td className={td}><TypeDot type={s.type} /></td>
                      <td className={cx(td, 'text-subtle')}>{s.wardId ?? 'City'}</td>
                      <td className={cx(td, 'font-mono text-xs text-subtle')}>{s.crs ?? 'auto'}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{fmtNum(s.featureCount)}</td>
                      <td className={td}>
                        <Badge tone={SOURCE_STATUS[s.status] ?? 'secondary'}>{humanize(s.status)}</Badge>
                        {s.status === 'needs_georef' && <Link to="/georef" onClick={(e) => e.stopPropagation()} className="ml-1.5 text-[11px] font-medium">Georeference →</Link>}
                      </td>
                      <td className={cx(td, 'whitespace-nowrap text-subtle')}>{fmtDate(s.capturedAt ?? s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <AnimatePresence>
          {selected && <div className="lg:col-span-2 2xl:col-span-1"><SourceDetail key={selected} id={selected} onClose={() => setSelected(null)} /></div>}
        </AnimatePresence>
      </div>
    </PageMotion>
  );
}
