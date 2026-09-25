import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiActivity, FiCheck, FiCrosshair, FiPlay, FiX } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import Legend from '../components/MapLegend';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, StatCard, cx, inputCls, labelCls, td, th } from '../components/ui';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { fetchSources, selectSources } from '../Redux/slices/sourcesSlice';
import {
  fetchChangeRuns, fetchChanges, resetValidate, runChangeDetection, selectChangeRunError, selectChangeRunStatus,
  selectChangeRuns, selectChanges, selectChangesStatus, verifyChange,
} from '../Redux/slices/qualitySlice';
import { CHANGE_STATUS, CHANGE_TYPES, JOB_STATUS, POLYGON_TYPES, fmtDate, fmtNum, humanize, sourceLabel } from '../utils/format';
import NdbiAlerts from './NdbiAlerts';

const year = (d) => (d ? new Date(d).getFullYear() : '—');

function EpochComparison() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const sources = useSelector(selectSources);
  const runs = useSelector(selectChangeRuns);
  const changes = useSelector(selectChanges);
  const changesStatus = useSelector(selectChangesStatus);
  const runStatus = useSelector(selectChangeRunStatus);
  const runError = useSelector(selectChangeRunError);
  const [baseline, setBaseline] = useState('');
  const [current, setCurrent] = useState('');
  const [areaPct, setAreaPct] = useState(15);
  const [heightM, setHeightM] = useState(2.5);
  const [runId, setRunId] = useState(null);
  const [type, setType] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const poll = useRef(null);

  useEffect(() => {
    dispatch(resetValidate()); setRunId(null); setBaseline(''); setCurrent('');
    if (!wardId) return undefined;
    dispatch(fetchSources({ wardId }));
    dispatch(fetchChangeRuns(wardId));
    return () => clearInterval(poll.current);
  }, [wardId, dispatch]);

  // Epoch candidates sorted by capture date; default = oldest footprint layer vs newest AI layer.
  const layersByDate = useMemo(() => sources
    .filter((s) => POLYGON_TYPES.includes(s.type) && s.status === 'ready' && s.wardId === wardId)
    .sort((a, b) => new Date(a.capturedAt ?? a.createdAt) - new Date(b.capturedAt ?? b.createdAt)), [sources, wardId]);
  useEffect(() => {
    if (!layersByDate.length || (layersByDate.some((s) => s.id === baseline) && layersByDate.some((s) => s.id === current))) return;
    const structures = layersByDate.filter((s) => s.type === 'building_footprint' || s.type === 'ai_extracted');
    const b = structures[0] ?? layersByDate[0];
    const c = [...structures].reverse().find((s) => s.id !== b.id) ?? layersByDate.find((s) => s.id !== b.id);
    setBaseline(b?.id ?? ''); setCurrent(c?.id ?? '');
  }, [layersByDate, baseline, current]);

  const wardRuns = runs.filter((r) => r.wardId === wardId);
  const activeRun = wardRuns.find((r) => r.id === runId) ?? wardRuns[0];
  useEffect(() => { if (activeRun?.id && activeRun.status === 'done') dispatch(fetchChanges({ runId: activeRun.id })); }, [activeRun?.id, activeRun?.status, dispatch]);
  const pending = runs.some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!pending || !wardId) return undefined;
    poll.current = setInterval(() => dispatch(fetchChangeRuns(wardId)), 3000);
    return () => clearInterval(poll.current);
  }, [pending, wardId, dispatch]);

  const rows = changes.filter((c) => c.runId === activeRun?.id && (!type || c.changeType === type));
  const selected = rows.find((c) => c.id === selectedId);
  const layers = useMemo(() => {
    const before = rows.filter((c) => c.geometryBefore && c.changeType !== 'demolished');
    return [
      { id: 'before', data: featureCollection(before.map((c) => ({ type: 'Feature', geometry: c.geometryBefore, properties: {} }))), color: '#6c757d', fillOpacity: 0, lineWidth: 1.5, dashed: true, interactive: false },
      {
        id: 'changes',
        data: featureCollection(rows.map((c) => ({ type: 'Feature', geometry: c.geometry, properties: { id: c.id, _color: c.id === selectedId ? '#0d6efd' : CHANGE_TYPES[c.changeType]?.color } }))),
        color: '#dc3545', fillOpacity: 0.45, lineWidth: 2,
      },
    ];
  }, [rows, selectedId]);

  const start = async () => {
    const res = await dispatch(runChangeDetection({ wardId, baselineSourceId: baseline, currentSourceId: current, params: { areaChangePct: Number(areaPct), heightChangeM: Number(heightM) } }));
    if (res.meta.requestStatus === 'fulfilled') setRunId(res.payload.run.id);
  };
  const name = (id) => { const s = sources.find((x) => x.id === id); return s ? `${sourceLabel(s.type)} ${year(s.capturedAt)} — ${s.filename ?? ''}` : id?.slice(0, 8); };

  if (!wardId) return <Card><EmptyState icon={FiCrosshair} message="Select a ward to compare survey epochs." /></Card>;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <SectionTitle className="mb-3">Compare two epochs</SectionTitle>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1"><span className={labelCls}>Baseline (earlier)</span>
              <select className={inputCls} value={baseline} onChange={(e) => setBaseline(e.target.value)}>
                {layersByDate.map((s) => <option key={s.id} value={s.id}>{`${year(s.capturedAt)} · ${sourceLabel(s.type)} — ${s.filename ?? s.id.slice(0, 8)}`}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className={labelCls}>Current (later)</span>
              <select className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)}>
                {layersByDate.map((s) => <option key={s.id} value={s.id}>{`${year(s.capturedAt)} · ${sourceLabel(s.type)} — ${s.filename ?? s.id.slice(0, 8)}`}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1"><span className={labelCls}>Area change ≥ (%)</span>
                <input type="number" min="1" className={inputCls} value={areaPct} onChange={(e) => setAreaPct(e.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>Height change ≥ (m)</span>
                <input type="number" step="0.5" min="0.5" className={inputCls} value={heightM} onChange={(e) => setHeightM(e.target.value)} /></label>
            </div>
            <Button onClick={start} disabled={!baseline || !current || baseline === current || runStatus === 'loading'}><FiPlay /> Detect changes</Button>
            {runError && <Notice tone="danger">{runError}</Notice>}
          </div>
        </Card>
        <Card className="p-0">
          <div className="border-b border-line-light p-3"><SectionTitle>Runs</SectionTitle></div>
          {wardRuns.length === 0 ? <p className="p-3 text-xs text-subtle">No comparisons yet.</p> : (
            <ul>
              {wardRuns.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setRunId(r.id)} className={cx('flex w-full flex-col gap-1 border-b border-line-light px-3 py-2 text-left text-xs', activeRun?.id === r.id ? 'bg-primary-light' : 'hover:bg-hover')}>
                    <span className="flex items-center gap-2">
                      <strong>{year(r.baselineCaptured)} → {year(r.currentCaptured)}</strong>
                      {r.status === 'running' || r.status === 'queued' ? <Loader size="sm" /> : <Badge tone={JOB_STATUS[r.status]}>{r.status}</Badge>}
                      <span className="ml-auto text-faint">{fmtDate(r.createdAt)}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {Object.entries(r.summary).map(([k, v]) => <Badge key={k} tone={CHANGE_TYPES[k]?.tone}>{v} {CHANGE_TYPES[k]?.label ?? k}</Badge>)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {activeRun && (
          <p className="text-xs text-subtle">
            Comparing <strong className="text-ink">{activeRun.baselineName ?? name(activeRun.baselineSourceId)}</strong> ({fmtDate(activeRun.baselineCaptured)}) with{' '}
            <strong className="text-ink">{activeRun.currentName ?? name(activeRun.currentSourceId)}</strong> ({fmtDate(activeRun.currentCaptured)})
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Object.entries(CHANGE_TYPES).map(([k, v]) => (
            <StatCard key={k} icon={FiActivity} accent={v.color} label={v.label} value={activeRun?.summary?.[k] ?? 0} onClick={() => setType(type === k ? '' : k)} />
          ))}
        </div>
        <div className="h-[420px] overflow-hidden rounded-xl border border-line">
          <GeoMap
            layers={layers}
            fitTo={selected?.geometry ?? (rows.length ? featureCollection(rows.map((c) => ({ type: 'Feature', geometry: c.geometry, properties: {} }))) : ward?.bbox ? [ward.bbox.west, ward.bbox.south, ward.bbox.east, ward.bbox.north] : null)}
            fitKey={`${activeRun?.id}-${selectedId ?? ''}-${rows.length > 0}`}
            loading={changesStatus === 'loading'}
            onFeatureClick={(id, f) => id === 'changes' && setSelectedId(String(f.properties.id))}
            legend={<Legend items={[...Object.values(CHANGE_TYPES).map((v) => ({ color: v.color, label: v.label })), { color: '#6c757d', label: 'Footprint before', shape: 'line' }]} />}
          />
        </div>
        <Card className="p-0">
          <div className="max-h-[360px] overflow-auto">
            {rows.length === 0 ? <EmptyState icon={FiActivity} message={activeRun ? 'No changes of this type.' : 'Run a comparison to detect changes.'} /> : (
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead><tr><th className={th}>Change</th><th className={cx(th, 'text-right')}>Area before → after (m²)</th><th className={cx(th, 'text-right')}>Height (m)</th><th className={cx(th, 'text-right')}>Conf.</th><th className={th}>Status</th><th className={th} /></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} onClick={() => setSelectedId(c.id)} aria-selected={selectedId === c.id} className={cx('cursor-pointer border-t border-line-light', selectedId === c.id ? 'bg-primary-light' : 'hover:bg-hover')}>
                      <td className={td}><Badge tone={CHANGE_TYPES[c.changeType]?.tone}>{CHANGE_TYPES[c.changeType]?.label ?? humanize(c.changeType)}</Badge></td>
                      <td className={cx(td, 'text-right tabular-nums')}>{fmtNum(c.areaBefore, 0)} → {fmtNum(c.areaAfter, 0)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{c.heightBefore ?? '—'} → {c.heightAfter ?? '—'}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{Math.round(c.confidence * 100)}%</td>
                      <td className={td}><Badge tone={CHANGE_STATUS[c.status]}>{humanize(c.status)}</Badge></td>
                      <td className={td}>
                        <span className="flex gap-1">
                          <Button size="sm" variant="secondary" aria-label="Confirm change" onClick={(e) => { e.stopPropagation(); dispatch(verifyChange({ id: c.id, status: 'confirmed' })); }} disabled={c.status === 'confirmed'}><FiCheck /></Button>
                          <Button size="sm" variant="secondary" aria-label="Mark false positive" onClick={(e) => { e.stopPropagation(); dispatch(verifyChange({ id: c.id, status: 'false_positive' })); }} disabled={c.status === 'false_positive'}><FiX /></Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function ChangeDetectionPage() {
  const [tab, setTab] = useState('epochs');
  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        step="Validate · Change detection"
        title="Change detection"
        description="Compare structure layers from two survey epochs (e.g. a 2023 footprint survey against 2025 AI extraction) to classify new, demolished, extended and vertically extended structures; satellite NDBI alerts flag change between surveys."
      />
      <div className="mb-4 flex gap-1" role="tablist">
        {[['epochs', 'Multi-epoch comparison'], ['ndbi', 'Satellite NDBI alerts']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx('rounded-full border px-3 py-1.5 text-sm', tab === k ? 'border-ink bg-ink text-white' : 'border-line text-subtle hover:text-ink')}>{l}</button>
        ))}
      </div>
      {tab === 'epochs' ? <EpochComparison /> : <NdbiAlerts />}
    </PageMotion>
  );
}
