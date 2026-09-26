import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiActivity, FiCheckCircle, FiRefreshCw, FiServer, FiSliders, FiXCircle, FiShare2 } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, cx, inputCls, labelCls } from '../components/ui';
import {
  fetchAdminConfig, fetchHealth, resetSaveStatus, saveConfig, selectDataMode, selectHealth, selectHealthStatus,
  selectLastRefresh, selectNdbiThreshold, selectPipelineStatus, selectSaveStatus, triggerRefresh,
} from '../Redux/slices/adminSlice';
import { API_URL, MOCK_MODE } from '../api/env';
import { PIPELINE_STATUS, fmtDateTime, fmtRelative } from '../utils/format';

const SERVICES = [
  { key: 'db', label: 'Spatial database', hint: 'PostgreSQL + PostGIS' },
  { key: 'redis', label: 'Job queue', hint: 'ETL worker queue (Redis)' },
  { key: 'r2', label: 'Object storage', hint: 'Source files & exports (S3-compatible)' },
];

const ENDPOINTS = [
  ['GET', '/api/sources', 'Registered datasets and processing status'],
  ['GET', '/api/sources/{id}/features', 'Normalised features (GeoJSON, EPSG:4326)'],
  ['GET', '/api/harmonization/matches', 'Scored cross-source matches'],
  ['GET', '/api/conflicts', 'Conflicts with severity and suggested resolution'],
  ['GET', '/api/harmonized?wardId=', 'Golden records with confidence'],
  ['GET', '/api/harmonized/export?format=geojson|gpkg', 'Harmonized cadastre export'],
];

export default function SettingsPage() {
  const dispatch = useDispatch();
  const health = useSelector(selectHealth);
  const healthStatus = useSelector(selectHealthStatus);
  const pipelineStatus = useSelector(selectPipelineStatus);
  const lastRefresh = useSelector(selectLastRefresh);
  const threshold = useSelector(selectNdbiThreshold);
  const dataMode = useSelector(selectDataMode);
  const saveStatus = useSelector(selectSaveStatus);
  const [cfg, setCfg] = useState({ ndbi_threshold: threshold, min_area_sqm: 25, cloud_cover_max: 20 });

  useEffect(() => { setCfg((c) => ({ ...c, ndbi_threshold: threshold })); }, [threshold]);
  useEffect(() => { dispatch(fetchHealth()); }, [dispatch]);
  useEffect(() => {
    if (saveStatus !== 'succeeded' && saveStatus !== 'failed') return undefined;
    const t = setTimeout(() => dispatch(resetSaveStatus()), 3000);
    return () => clearTimeout(t);
  }, [saveStatus, dispatch]);
  useEffect(() => {
    if (pipelineStatus !== 'running') return undefined;
    const t = setInterval(() => dispatch(fetchAdminConfig()), 10000);
    return () => clearInterval(t);
  }, [pipelineStatus, dispatch]);

  const running = pipelineStatus === 'running';

  return (
    <PageMotion className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
      <PageHeader
        step="Administration"
        title="Settings & health"
        description="Service health, pipeline control, detection thresholds and the integration API."
        actions={<Badge tone={dataMode === 'live' ? 'success' : 'warning'}>{dataMode === 'live' ? 'Live data' : 'Demo data'}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle className="flex items-center gap-1.5"><FiServer /> Service health</SectionTitle>
            <Button variant="ghost" size="sm" onClick={() => dispatch(fetchHealth())} title="Ask each backend service whether it is working"><FiRefreshCw className={healthStatus === 'loading' ? 'animate-spin' : ''} /> Check now</Button>
          </div>
          <ul className="flex flex-col gap-2">
            {SERVICES.map((s) => {
              const v = health?.[s.key];
              const ok = v === 'ok';
              return (
                <li key={s.key} className="flex items-center gap-3 rounded-lg border border-line-light px-3 py-2">
                  {ok ? <FiCheckCircle className="text-success" /> : <FiXCircle className={v ? 'text-danger' : 'text-faint'} />}
                  <span className="flex-1"><span className="block text-sm font-medium">{s.label}</span><span className="block text-xs text-subtle">{s.hint}</span></span>
                  <Badge tone={ok ? 'success' : v ? 'danger' : 'secondary'}>{v ?? 'unknown'}</Badge>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-subtle">
            API: <code className="rounded bg-canvas px-1">{MOCK_MODE ? 'in-browser mock' : (API_URL || window.location.origin)}</code>
            {health?.ts && <> · checked {fmtRelative(health.ts)}</>}
          </p>
        </Card>

        <Card>
          <SectionTitle className="mb-3 flex items-center gap-1.5"><FiActivity /> Pipeline</SectionTitle>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5">Status <Badge tone={PIPELINE_STATUS[pipelineStatus] ?? 'secondary'}>{pipelineStatus}</Badge></span>
            <span className="text-subtle">Last refresh <strong className="text-ink">{fmtDateTime(lastRefresh)}</strong></span>
          </div>
          <p className="mb-3 text-xs text-subtle">Re-runs spatial matching, conflict detection and golden-record assembly for every ward.</p>
          <Button onClick={() => dispatch(triggerRefresh())} disabled={running} title="Re-run matching, conflict detection and record building for every ward">
            <FiRefreshCw className={running ? 'animate-spin' : ''} /> {running ? 'Running…' : 'Re-harmonize all wards'}
          </Button>
        </Card>

        <Card>
          <SectionTitle className="mb-3 flex items-center gap-1.5"><FiSliders /> Detection thresholds</SectionTitle>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => { e.preventDefault(); dispatch(saveConfig({ ndbi_threshold: Number(cfg.ndbi_threshold), min_area_sqm: Number(cfg.min_area_sqm), cloud_cover_max: Number(cfg.cloud_cover_max) })); }}
          >
            <label className="flex flex-col gap-1">
              <span className={cx(labelCls, 'flex justify-between')}>NDBI change threshold <strong className="tabular-nums text-ink">{Number(cfg.ndbi_threshold).toFixed(2)}</strong></span>
              <input type="range" min="0.05" max="0.30" step="0.01" value={cfg.ndbi_threshold} onChange={(e) => setCfg({ ...cfg, ndbi_threshold: e.target.value })} className="accent-primary" aria-label="NDBI threshold" />
              <span className="flex justify-between text-[11px] text-faint"><span>0.05 sensitive</span><span>0.30 strict</span></span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Minimum change area (m²)</span>
                <input type="number" min="0" className={inputCls} value={cfg.min_area_sqm} onChange={(e) => setCfg({ ...cfg, min_area_sqm: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Max cloud cover (%)</span>
                <input type="number" min="0" max="100" className={inputCls} value={cfg.cloud_cover_max} onChange={(e) => setCfg({ ...cfg, cloud_cover_max: e.target.value })} />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saveStatus === 'loading'} title="Save these detection thresholds; they apply to the next run">Save thresholds</Button>
              {saveStatus === 'succeeded' && <span className="text-xs text-success">Saved.</span>}
              {saveStatus === 'failed' && <span className="text-xs text-danger">Failed to save.</span>}
            </div>
          </form>
        </Card>

        <Card>
          <SectionTitle className="mb-3 flex items-center gap-1.5"><FiShare2 /> Interoperability</SectionTitle>
          <p className="mb-3 text-xs text-subtle">
            All layers are served in WGS84 (EPSG:4326) as GeoJSON over REST; harmonized cadastres also export to OGC GeoPackage. Other departments can consume these directly.
          </p>
          <ul className="flex flex-col gap-1.5">
            {ENDPOINTS.map(([m, path, desc]) => (
              <li key={path} className="text-xs">
                <code className="mr-1.5 rounded bg-success-light px-1 font-semibold text-success-dark">{m}</code>
                <code className="text-ink">{path}</code>
                <span className="block pl-10 text-subtle">{desc}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {health?.status === 'down' && <div className="mt-4"><Notice tone="danger">Backend unreachable: {health.error}</Notice></div>}
    </PageMotion>
  );
}
