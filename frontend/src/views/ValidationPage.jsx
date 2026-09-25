import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiCheck, FiCheckSquare, FiCrosshair, FiPlay, FiX } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import Legend from '../components/MapLegend';
import EmptyState from '../components/EmptyState';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, cx } from '../components/ui';
import { propsTable } from '../components/mapPopup';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import {
  fetchFindings, fetchReports, resetValidate, runValidation, selectFindings, selectReports, selectValidateError, selectValidateStatus,
} from '../Redux/slices/qualitySlice';
import { FINDING_TYPES, fmtRelative, sourceColor, sourceLabel } from '../utils/format';

const scoreColor = (s) => (s >= 85 ? '#198754' : s >= 60 ? '#ffc107' : '#dc3545');

function ScoreRing({ score, size = 96 }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Score ${Math.round(score)}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e9ecef" strokeWidth="8" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(score)} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fontSize={size / 4} fontWeight="700" fill="#212529">{Math.round(score)}</text>
    </svg>
  );
}

function Checks({ checks }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-xs">
          {c.passed ? <FiCheck className="mt-0.5 shrink-0 text-success" /> : <FiX className="mt-0.5 shrink-0 text-danger" />}
          <span className="min-w-0 flex-1"><span className="text-ink">{c.label}</span>{c.detail && <span className="block text-faint">{c.detail}</span>}</span>
          <span className="tabular-nums text-subtle">{Math.round(c.value * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

export default function ValidationPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const reports = useSelector(selectReports);
  const findings = useSelector(selectFindings);
  const status = useSelector(selectValidateStatus);
  const error = useSelector(selectValidateError);
  const [type, setType] = useState('');
  const poll = useRef(null);

  const load = () => { if (wardId) { dispatch(fetchReports(wardId)); dispatch(fetchFindings(wardId)); } };
  useEffect(() => { load(); dispatch(resetValidate()); return () => clearInterval(poll.current); }, [wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const wardReport = reports.find((r) => r.wardId === wardId && !r.sourceId);
  const sourceReports = reports.filter((r) => r.wardId === wardId && r.sourceId).sort((a, b) => a.score - b.score);
  const feats = findings?.features ?? [];
  const counts = useMemo(() => {
    const c = {};
    feats.forEach((f) => { c[f.properties.finding_type] = (c[f.properties.finding_type] ?? 0) + 1; });
    return c;
  }, [feats]);
  const shown = feats.filter((f) => !type || f.properties.finding_type === type);

  const run = async () => {
    const res = await dispatch(runValidation(wardId));
    if (res.meta.requestStatus !== 'fulfilled') return;
    let n = 0;
    clearInterval(poll.current);
    poll.current = setInterval(() => { load(); n += 1; if (n > 5) clearInterval(poll.current); }, 2500);
  };

  const layers = useMemo(() => [{
    id: 'findings',
    data: featureCollection(shown.map((f) => ({ ...f, properties: { ...f.properties, _color: FINDING_TYPES[f.properties.finding_type]?.color } }))),
    color: '#dc3545', fillOpacity: 0.45, lineWidth: 2,
  }], [shown]);

  if (!wardId) {
    return (
      <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
        <PageHeader step="Validate · Quality & synchronisation" title="Validation & sync" />
        <Card><EmptyState icon={FiCrosshair} message="Select a ward to validate its datasets." /></Card>
      </PageMotion>
    );
  }

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        step="Validate · Quality & synchronisation"
        title="Validation & sync"
        description="Every dataset is scored against data-quality rules, and the AI-extracted / surveyed structures are synchronised against the cadastral fabric to surface unregistered structures, encroachments, vacant parcels and inter-departmental attribute drift."
        actions={<Button onClick={run} disabled={status === 'loading'}><FiPlay /> {status === 'loading' ? 'Queuing…' : 'Run validation'}</Button>}
      />
      {status === 'succeeded' && <div className="mb-4"><Notice tone="info">Validation queued — results refresh automatically.</Notice></div>}
      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}

      <div className="grid items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle className="mb-3">Ward data-quality score</SectionTitle>
            {wardReport ? (
              <>
                <div className="mb-3 flex items-center gap-4">
                  <ScoreRing score={wardReport.score} />
                  <p className="text-xs text-subtle">Ward {ward?.id} — {ward?.name}<br />validated {fmtRelative(wardReport.createdAt)}</p>
                </div>
                <Checks checks={wardReport.checks} />
              </>
            ) : <EmptyState icon={FiCheckSquare} message="Not validated yet — run validation." />}
          </Card>
          <Card>
            <SectionTitle className="mb-3">Synchronisation findings</SectionTitle>
            <ul className="flex flex-col gap-1">
              <li>
                <button type="button" onClick={() => setType('')} className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm', !type ? 'bg-primary-light' : 'hover:bg-hover')}>
                  <span className="flex-1 text-left">All findings</span><strong className="tabular-nums">{feats.length}</strong>
                </button>
              </li>
              {Object.entries(FINDING_TYPES).map(([k, v]) => (
                <li key={k}>
                  <button type="button" onClick={() => setType(k)} title={v.hint} className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm', type === k ? 'bg-primary-light' : 'hover:bg-hover')}>
                    <span className="size-2.5 rounded-sm" style={{ background: v.color }} />
                    <span className="flex-1 text-left">{v.label}</span><strong className="tabular-nums">{counts[k] ?? 0}</strong>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="h-[420px] overflow-hidden rounded-xl border border-line">
            <GeoMap
              layers={layers}
              fitTo={shown.length ? featureCollection(shown) : ward?.bbox ? [ward.bbox.west, ward.bbox.south, ward.bbox.east, ward.bbox.north] : null}
              fitKey={`${wardId}-${type}-${shown.length}`}
              popup={(_, p) => propsTable(FINDING_TYPES[p.finding_type]?.label ?? 'Finding', p)}
              legend={<Legend items={Object.values(FINDING_TYPES).map((v) => ({ color: v.color, label: v.label }))} />}
            />
          </div>

          <SectionTitle>Source scorecards ({sourceReports.length})</SectionTitle>
          {sourceReports.length === 0 ? <Card><EmptyState icon={FiCheckSquare} message="No source reports yet." /></Card> : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {sourceReports.map((r) => (
                <Card key={r.id} className="flex flex-col gap-3">
                  <header className="flex items-center gap-3">
                    <ScoreRing score={r.score} size={56} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-subtle"><span className="size-2 rounded-sm" style={{ background: sourceColor(r.sourceType) }} />{sourceLabel(r.sourceType)}</div>
                      <div className="truncate text-sm font-semibold" title={r.sourceName}>{r.sourceName ?? r.sourceId}</div>
                      <Badge tone={r.score >= 85 ? 'success' : r.score >= 60 ? 'warning' : 'danger'}>{r.checks.filter((c) => c.passed).length}/{r.checks.length} checks passed</Badge>
                    </div>
                  </header>
                  <Checks checks={r.checks} />
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageMotion>
  );
}
