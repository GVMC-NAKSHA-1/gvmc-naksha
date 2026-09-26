import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiAlertOctagon, FiAlertTriangle, FiCheckCircle, FiInfo, FiRefreshCw, FiSlash, FiEye } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import Legend from '../components/MapLegend';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, Skeleton, StatCard, cx, inputCls, selectCls } from '../components/ui';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import {
  fetchConflicts, resetResolveStatus, resolveConflict, selectConflicts, selectConflictsStatus, selectResolveError, selectResolveStatus,
} from '../Redux/slices/conflictsSlice';
import { clearMatchDetail, fetchMatchDetail, selectMatchDetail, selectMatchDetailStatus } from '../Redux/slices/harmonizationSlice';
import { CONFLICT_STATUS, SEVERITY, fmtRelative, humanize, sourceLabel } from '../utils/format';

const SEV_ICON = { critical: FiAlertOctagon, high: FiAlertTriangle, medium: FiAlertTriangle, low: FiInfo };
const SEV_BAR = { critical: 'border-l-danger', high: 'border-l-orange', medium: 'border-l-warning', low: 'border-l-info' };
const isOpen = (c) => c.status === 'pending' || c.status === 'needs_review';
const A_COLOR = '#0d6efd';
const B_COLOR = '#f39c12';

function ConflictDetail({ conflict }) {
  const dispatch = useDispatch();
  const match = useSelector(selectMatchDetail);
  const matchStatus = useSelector(selectMatchDetailStatus);
  const resolveStatus = useSelector(selectResolveStatus);
  const resolveError = useSelector(selectResolveError);
  const [notes, setNotes] = useState(conflict.notes ?? '');

  useEffect(() => {
    dispatch(resetResolveStatus());
    setNotes(conflict.notes ?? '');
    if (conflict.matchId) dispatch(fetchMatchDetail(conflict.matchId));
    return () => { dispatch(clearMatchDetail()); };
  }, [conflict.id, conflict.matchId, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = match && String(match.id) === String(conflict.matchId) ? match : null;
  const layers = useMemo(() => {
    if (!m) return [];
    return [
      m.featureAGeom && { id: 'a', data: featureCollection([{ type: 'Feature', geometry: m.featureAGeom, properties: {} }]), color: A_COLOR, fillOpacity: 0.25, lineWidth: 2.5, circleRadius: 7 },
      m.featureBGeom && { id: 'b', data: featureCollection([{ type: 'Feature', geometry: m.featureBGeom, properties: {} }]), color: B_COLOR, fillOpacity: 0.25, lineWidth: 2.5, dashed: true, circleRadius: 7 },
    ].filter(Boolean);
  }, [m]);

  const disagree = new Set(conflict.disagreeingFields);
  const fields = m ? [...new Set([...Object.keys(m.featureAProps), ...Object.keys(m.featureBProps)])].filter((k) => !k.startsWith('_')) : [];
  fields.sort((x, y) => Number(disagree.has(y)) - Number(disagree.has(x)));
  const act = (status) => dispatch(resolveConflict({ id: conflict.id, status, notes: notes || undefined }));
  const busy = resolveStatus === 'loading';

  return (
    <motion.aside
      key={conflict.id}
      initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
      className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-sm"
      aria-label="Conflict detail"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-base font-semibold capitalize">{humanize(conflict.conflictType)}</h2>
        <Badge tone={SEVERITY[conflict.severity]?.tone}>{conflict.severity}</Badge>
        <Badge tone={CONFLICT_STATUS[conflict.status]}>{humanize(conflict.status)}</Badge>
      </header>

      <div className="h-56 overflow-hidden rounded-lg border border-line-light">
        {!conflict.matchId ? <EmptyState icon={FiInfo} message="No linked match." /> : matchStatus === 'loading' || !m ? (
          <div className="flex h-full items-center justify-center"><Loader /></div>
        ) : (
          <GeoMap
            layers={layers}
            fitTo={featureCollection(layers.flatMap((l) => l.data.features))}
            fitKey={conflict.id}
            legend={<Legend items={[{ color: A_COLOR, label: `A · ${sourceLabel(m.sourceAType)}` }, { color: B_COLOR, label: `B · ${sourceLabel(m.sourceBType)}` }]} />}
          />
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md bg-canvas p-2"><div className="text-subtle">IoU</div><strong className="tabular-nums">{conflict.iou != null ? Number(conflict.iou).toFixed(2) : '—'}</strong></div>
        <div className="rounded-md bg-canvas p-2"><div className="text-subtle">Match score</div><strong className="tabular-nums">{m ? m.matchScore.toFixed(1) : '—'}</strong></div>
        <div className="rounded-md bg-canvas p-2"><div className="text-subtle">Fields in dispute</div><strong className="tabular-nums">{conflict.disagreeingFields.length}</strong></div>
      </div>

      {m && fields.length > 0 && (
        <div className="overflow-x-auto">
          <SectionTitle className="mb-1.5">Attributes</SectionTitle>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-subtle"><th className="py-1">Field</th><th className="py-1" style={{ color: A_COLOR }}>{sourceLabel(m.sourceAType)}</th><th className="py-1" style={{ color: B_COLOR }}>{sourceLabel(m.sourceBType)}</th></tr></thead>
            <tbody>
              {fields.map((k) => (
                <tr key={k} className={cx('border-t border-line-light', disagree.has(k) && 'bg-danger-light/60')}>
                  <td className="py-1 pr-2 text-subtle">{humanize(k)}{disagree.has(k) && ' ⚠'}</td>
                  <td className="py-1 pr-2 font-medium">{m.featureAProps[k] != null ? String(m.featureAProps[k]) : '—'}</td>
                  <td className="py-1 font-medium">{m.featureBProps[k] != null ? String(m.featureBProps[k]) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg bg-primary-light px-3 py-2 text-xs text-primary-dark">
        <strong className="block">Suggested resolution</strong>{conflict.suggestedResolution || '—'}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-subtle">Resolution notes</span>
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this decision (kept cadastral geometry, owner confirmed from khata…)" />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <Button size="sm" className="bg-success! hover:brightness-95" onClick={() => act('resolved')} disabled={busy || conflict.status === 'resolved'} title="Accept the suggested resolution and close this conflict"><FiCheckCircle /> Resolve</Button>
        <Button size="sm" variant="secondary" onClick={() => act('needs_review')} disabled={busy || conflict.status === 'needs_review'} title="Flag for a field check before deciding"><FiEye /> Needs review</Button>
        <Button size="sm" variant="secondary" onClick={() => act('rejected')} disabled={busy || conflict.status === 'rejected'} title="Dismiss — this is not a real conflict"><FiSlash /> Reject</Button>
      </div>
      {resolveStatus === 'succeeded' && <Notice>Saved. Re-assemble the final records to apply it (Final records → Rebuild records).</Notice>}
      {resolveStatus === 'failed' && <Notice tone="danger">{resolveError}</Notice>}
    </motion.aside>
  );
}

export default function ConflictsPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const conflicts = useSelector(selectConflicts);
  const status = useSelector(selectConflictsStatus);
  const [view, setView] = useState('open');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const load = () => dispatch(fetchConflicts({ wardId: wardId ?? undefined }));
  useEffect(() => { setSelectedId(null); }, [wardId]);

  const rows = useMemo(() => conflicts
    .filter((c) => (view === 'all' || (view === 'open' ? isOpen(c) : c.status === view)) && (!severity || c.severity === severity) && (!type || c.conflictType === type))
    .sort((a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9)), [conflicts, view, severity, type]);
  const selected = conflicts.find((c) => c.id === selectedId) ?? null;

  const counts = useMemo(() => ({
    open: conflicts.filter(isOpen).length,
    critical: conflicts.filter((c) => isOpen(c) && c.severity === 'critical').length,
    resolved: conflicts.filter((c) => c.status === 'resolved').length,
    rejected: conflicts.filter((c) => c.status === 'rejected').length,
  }), [conflicts]);

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        title="Resolve conflicts"
        description="Where matched sources disagree on geometry (low overlap) or attributes, a conflict is raised with a severity and a suggested resolution. Resolve, send for field review, or reject — decisions feed the golden record."
        actions={<Button variant="secondary" onClick={load} title="Reload the list of conflicts"><FiRefreshCw className={status === 'loading' ? 'animate-spin' : ''} /> Refresh</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FiAlertTriangle} accent="#fd7e14" label="Open" value={counts.open} onClick={() => setView('open')} />
        <StatCard icon={FiAlertOctagon} accent="#dc3545" label="Critical open" value={counts.critical} onClick={() => { setView('open'); setSeverity('critical'); }} />
        <StatCard icon={FiCheckCircle} accent="#198754" label="Resolved" value={counts.resolved} onClick={() => setView('resolved')} />
        <StatCard icon={FiSlash} accent="#6c757d" label="Rejected" value={counts.rejected} onClick={() => setView('rejected')} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card className="min-w-0 p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-light p-3">
            <div className="flex gap-1">
              {['open', 'needs_review', 'resolved', 'rejected', 'all'].map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={cx('rounded-full border px-2.5 py-1 text-xs capitalize', view === v ? 'border-primary bg-primary-light font-semibold text-primary' : 'border-line text-subtle hover:text-ink')}>
                  {humanize(v)}
                </button>
              ))}
            </div>
            <select className={selectCls} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
              <option value="">Any severity</option>
              {Object.keys(SEVERITY).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={selectCls} value={type} onChange={(e) => setType(e.target.value)} aria-label="Conflict type">
              <option value="">Any type</option>
              {['geometry_mismatch', 'attribute_mismatch', 'both'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
            <span className="ml-auto text-xs text-subtle">{rows.length} shown</span>
          </div>
          <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto p-3">
            {status === 'loading' && !conflicts.length ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />) : rows.length === 0 ? (
              <EmptyState icon={FiCheckCircle} message={conflicts.length ? 'Nothing in this view.' : 'No conflicts — sources agree.'} />
            ) : rows.map((c) => {
              const Icon = SEV_ICON[c.severity] ?? FiInfo;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  aria-pressed={selectedId === c.id}
                  className={cx('rounded-lg border border-l-4 bg-white p-3 text-left transition', SEV_BAR[c.severity], selectedId === c.id ? 'border-primary shadow-md ring-2 ring-primary/20' : 'border-line-light hover:shadow-sm')}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className={{ critical: 'text-danger', high: 'text-orange', medium: 'text-warning-dark', low: 'text-info-dark' }[c.severity]} />
                    <strong className="text-sm capitalize">{humanize(c.conflictType)}</strong>
                    {c.disagreeingFields.length > 0 && <span className="text-xs text-subtle">· {c.disagreeingFields.join(', ')}</span>}
                    <span className="ml-auto flex gap-1.5">
                      <Badge tone={SEVERITY[c.severity]?.tone}>{c.severity}</Badge>
                      <Badge tone={CONFLICT_STATUS[c.status]}>{humanize(c.status)}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-subtle">{c.suggestedResolution}</p>
                  <p className="mt-1 text-[11px] text-faint">Ward {c.wardId ?? '—'}{c.createdAt && ` · ${fmtRelative(c.createdAt)}`}</p>
                </button>
              );
            })}
          </div>
        </Card>

        <AnimatePresence mode="wait">
          {selected ? <ConflictDetail key={selected.id} conflict={selected} /> : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card><EmptyState icon={FiAlertTriangle} message="Select a conflict to compare both sources and record a decision." /></Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PageMotion>
  );
}
