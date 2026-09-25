import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiCheck, FiCheckCircle, FiEyeOff, FiPlay, FiRotateCcw, FiTool } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import Legend from '../components/MapLegend';
import EmptyState from '../components/EmptyState';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, StatCard, cx, inputCls, labelCls } from '../components/ui';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { fetchSourceFeatures, fetchSources, invalidateFeatures, selectSourceFeatures, selectSources } from '../Redux/slices/sourcesSlice';
import {
  acceptAllIssues, fetchTopologyIssues, resetRun, resolveIssue, runTopology, selectIssues, selectResolveIssueError,
  selectTopoError, selectTopoRunStatus,
} from '../Redux/slices/processingSlice';
import { POLYGON_TYPES, TOPOLOGY_STATUS, TOPOLOGY_TYPES, fmtNum, humanize, sourceLabel } from '../utils/format';

export default function TopologyPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const sources = useSelector(selectSources);
  const allIssues = useSelector(selectIssues);
  const featuresById = useSelector(selectSourceFeatures);
  const runStatus = useSelector(selectTopoRunStatus);
  const runError = useSelector(selectTopoError);
  const resolveError = useSelector(selectResolveIssueError);
  const [sourceId, setSourceId] = useState('');
  const [p, setP] = useState({ toleranceM: 0.05, gapMaxWidthM: 1.0, sliverMaxWidthM: 0.5, autoFix: false });
  const [filter, setFilter] = useState('open');
  const [selectedId, setSelectedId] = useState(null);
  const poll = useRef(null);

  useEffect(() => { dispatch(fetchSources({ wardId: wardId ?? undefined })); setSourceId(''); dispatch(resetRun()); }, [wardId, dispatch]);
  const polys = useMemo(() => sources.filter((s) => POLYGON_TYPES.includes(s.type) && s.status === 'ready' && (!wardId || s.wardId === wardId)), [sources, wardId]);
  useEffect(() => {
    if (polys.length && !polys.some((s) => s.id === sourceId)) setSourceId((polys.find((s) => s.type === 'cadastral') ?? polys[0]).id);
  }, [polys, sourceId]);

  const load = () => { if (sourceId) dispatch(fetchTopologyIssues({ sourceId })); };
  useEffect(() => { load(); setSelectedId(null); if (sourceId) dispatch(fetchSourceFeatures(sourceId)); return () => clearInterval(poll.current); }, [sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = allIssues.filter((i) => i.sourceId === sourceId);
  const shown = issues.filter((i) => filter === 'all' || (filter === 'open' ? i.status === 'open' : i.status !== 'open'));
  const selected = issues.find((i) => i.id === selectedId);
  const counts = useMemo(() => {
    const c = { open: 0, fixed: 0 };
    issues.forEach((i) => { c[i.issueType] = (c[i.issueType] ?? 0) + 1; if (i.status === 'open') c.open += 1; if (i.status === 'accepted' || i.status === 'auto_fixed') c.fixed += 1; });
    return c;
  }, [issues]);

  const run = async () => {
    const res = await dispatch(runTopology({ sourceId, ...p }));
    if (res.meta.requestStatus !== 'fulfilled') return;
    let n = 0;
    clearInterval(poll.current);
    poll.current = setInterval(() => { load(); n += 1; if (n > 6) clearInterval(poll.current); }, 2500);
  };
  const refreshGeometry = () => { dispatch(invalidateFeatures()); dispatch(fetchSourceFeatures(sourceId)); load(); };

  const layers = useMemo(() => {
    const out = [];
    const fc = featuresById[sourceId]?.fc;
    if (fc) out.push({ id: 'fabric', data: fc, color: '#0d6efd', fillOpacity: 0.08, lineWidth: 1, interactive: false });
    out.push({
      id: 'issues',
      data: featureCollection(issues.filter((i) => i.geometry).map((i) => ({
        type: 'Feature', geometry: i.geometry,
        properties: { id: i.id, _color: i.id === selectedId ? '#0d6efd' : (TOPOLOGY_TYPES[i.issueType]?.color ?? '#dc3545'), _radius: 6 },
      }))),
      color: '#dc3545', fillOpacity: 0.65, lineWidth: 2,
    });
    if (selected?.fixedGeometry) {
      out.push({ id: 'fixed', data: featureCollection([{ type: 'Feature', geometry: selected.fixedGeometry, properties: {} }]), color: '#198754', fillOpacity: 0.1, lineWidth: 2.5, dashed: true, interactive: false });
    }
    return out;
  }, [featuresById, sourceId, issues, selected, selectedId]);

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        step="Process · Automated topology correction"
        title="Topology QA"
        description="Parcel fabrics from different departments rarely fit together cleanly. The engine finds overlapping parcels, gaps and slivers between neighbours and duplicate vertices, proposes a geometric fix for each, and can apply them automatically."
      />

      <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle className="mb-3">Check a layer</SectionTitle>
            {polys.length === 0 ? <EmptyState icon={FiTool} message="No polygon layers (cadastral, municipal, footprints) in this ward." /> : (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1"><span className={labelCls}>Polygon layer</span>
                  <select className={inputCls} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                    {polys.map((s) => <option key={s.id} value={s.id}>{`${sourceLabel(s.type)} — ${s.filename ?? s.id.slice(0, 8)}`}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1"><span className={labelCls}>Snap tolerance (m)</span>
                    <input type="number" step="0.01" min="0" className={inputCls} value={p.toleranceM} onChange={(e) => setP({ ...p, toleranceM: Number(e.target.value) })} /></label>
                  <label className="flex flex-col gap-1"><span className={labelCls}>Max gap width (m)</span>
                    <input type="number" step="0.1" min="0.1" className={inputCls} value={p.gapMaxWidthM} onChange={(e) => setP({ ...p, gapMaxWidthM: Number(e.target.value) })} /></label>
                  <label className="flex flex-col gap-1"><span className={labelCls}>Sliver width (m)</span>
                    <input type="number" step="0.05" min="0.05" className={inputCls} value={p.sliverMaxWidthM} onChange={(e) => setP({ ...p, sliverMaxWidthM: Number(e.target.value) })} /></label>
                  <label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" className="accent-primary" checked={p.autoFix} onChange={(e) => setP({ ...p, autoFix: e.target.checked })} /> Auto-fix</label>
                </div>
                <Button onClick={run} disabled={!sourceId || runStatus === 'loading'}><FiPlay /> {runStatus === 'loading' ? 'Queuing…' : 'Run topology check'}</Button>
                <Button variant="secondary" onClick={async () => { await dispatch(acceptAllIssues(sourceId)); refreshGeometry(); }} disabled={!counts.open}>
                  <FiCheckCircle /> Accept all proposed fixes ({counts.open})
                </Button>
                {runStatus === 'succeeded' && <Notice tone="info">Topology check queued — issues appear below.</Notice>}
                {runError && <Notice tone="danger">{runError}</Notice>}
              </div>
            )}
          </Card>
          <Card>
            <SectionTitle className="mb-2">Rules</SectionTitle>
            <ul className="flex flex-col gap-2 text-xs">
              {Object.entries(TOPOLOGY_TYPES).map(([k, v]) => (
                <li key={k} className="flex gap-2"><span className="mt-1 size-2.5 shrink-0 rounded-sm" style={{ background: v.color }} /><span><strong>{v.label}:</strong> <span className="text-subtle">{v.fix}</span></span></li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={FiTool} accent="#fd7e14" label="Open issues" value={counts.open} />
            <StatCard icon={FiTool} accent="#198754" label="Fixed" value={counts.fixed} hint="auto-fixed or accepted" />
            <StatCard icon={FiTool} accent="#dc3545" label="Overlaps" value={counts.overlap ?? 0} />
            <StatCard icon={FiTool} accent="#ffc107" label="Gaps & slivers" value={(counts.gap ?? 0) + (counts.sliver ?? 0)} />
          </div>
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="h-[460px] overflow-hidden rounded-xl border border-line">
              <GeoMap
                layers={layers}
                fitTo={selected?.geometry ?? featuresById[sourceId]?.fc}
                fitKey={`${sourceId}-${selectedId ?? ''}-${Boolean(featuresById[sourceId]?.fc)}`}
                onFeatureClick={(id, f) => id === 'issues' && setSelectedId(String(f.properties.id))}
                legend={<Legend items={[...Object.entries(TOPOLOGY_TYPES).slice(0, 3).map(([, v]) => ({ color: v.color, label: v.label })), { color: '#198754', label: 'Proposed / applied fix', shape: 'line' }]} />}
              />
            </div>
            <Card className="flex min-w-0 flex-col p-0">
              <div className="flex gap-1 border-b border-line-light p-3">
                {['open', 'resolved', 'all'].map((f) => (
                  <button key={f} type="button" onClick={() => setFilter(f)} className={cx('rounded-full border px-2.5 py-1 text-xs capitalize', filter === f ? 'border-primary bg-primary-light font-semibold text-primary' : 'border-line text-subtle')}>{f}</button>
                ))}
              </div>
              {resolveError && <div className="px-3 pt-2"><Notice tone="danger">{resolveError}</Notice></div>}
              <ul className="flex max-h-[400px] flex-col gap-2 overflow-y-auto p-3">
                {shown.length === 0 && <EmptyState icon={FiCheckCircle} message={issues.length ? 'Nothing in this view.' : 'No topology issues found — run a check.'} />}
                {shown.map((i) => {
                  const meta = TOPOLOGY_TYPES[i.issueType] ?? { label: humanize(i.issueType), tone: 'secondary' };
                  return (
                    <li key={i.id}>
                      <div role="button" tabIndex={0} onClick={() => setSelectedId(i.id)} onKeyDown={(e) => e.key === 'Enter' && setSelectedId(i.id)}
                        className={cx('rounded-lg border p-2.5 text-xs', selectedId === i.id ? 'border-primary ring-2 ring-primary/20' : 'border-line-light hover:bg-hover')}>
                        <div className="flex items-center gap-2">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          {i.areaSqm ? <span className="tabular-nums text-subtle">{fmtNum(i.areaSqm, 2)} m²</span> : null}
                          <Badge tone={TOPOLOGY_STATUS[i.status]} className="ml-auto">{humanize(i.status)}</Badge>
                        </div>
                        <p className="mt-1 text-subtle">{meta.fix}</p>
                        {i.status === 'open' && (
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" onClick={async (e) => { e.stopPropagation(); await dispatch(resolveIssue({ id: i.id, action: 'accept_fix' })); refreshGeometry(); }}><FiCheck /> Accept fix</Button>
                            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); dispatch(resolveIssue({ id: i.id, action: 'ignore' })); }}><FiEyeOff /> Ignore</Button>
                          </div>
                        )}
                        {i.status === 'ignored' && (
                          <Button size="sm" variant="ghost" className="mt-1" onClick={(e) => { e.stopPropagation(); dispatch(resolveIssue({ id: i.id, action: 'reopen' })); }}><FiRotateCcw /> Reopen</Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </PageMotion>
  );
}
