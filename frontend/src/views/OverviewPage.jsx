import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiAlertTriangle, FiArrowRight, FiCheckCircle, FiChevronDown, FiPlay } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, cx } from '../components/ui';
import { FLOW, STEPS } from '../components/nav';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { fetchSources, selectSources } from '../Redux/slices/sourcesSlice';
import {
  fetchMappings, fetchMatches, runMatching, selectMappings, selectMatches, selectRunError, selectRunStatus,
} from '../Redux/slices/harmonizationSlice';
import { selectConflicts } from '../Redux/slices/conflictsSlice';
import { fetchHarmonized, selectHarmonized } from '../Redux/slices/harmonizedSlice';
import { fetchExtractionRuns, fetchTopologyIssues, selectIssues, selectRuns } from '../Redux/slices/processingSlice';
import {
  fetchChangeRuns, fetchCollections, fetchReadiness, fetchReports, selectChangeRuns, selectCollections, selectReadiness, selectReports,
} from '../Redux/slices/qualitySlice';
import { selectJobs } from '../Redux/slices/jobsSlice';
import { BAND, JOB_LABEL, JOB_STATUS, READINESS, SOURCE_META, SOURCE_STATUS, UPLOAD_TYPES, fmtNum, fmtRelative, humanize } from '../utils/format';

const navItem = (to) => FLOW.find((f) => f.to === to);
const STATE_DOT = { done: 'bg-success', active: 'bg-warning', empty: 'bg-line' };
const STATE_TEXT = { done: 'Done', active: 'In progress', empty: 'Not started' };

/** One page inside a workflow step: name, headline number and a short status line. Clicking opens the page. */
function StageRow({ to, metric, detail, state }) {
  const navigate = useNavigate();
  const item = navItem(to);
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      title={`Open ${item.label} — ${item.hint}`}
      className="group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-hover"
    >
      <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', STATE_DOT[state])} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-ink">{item.label}<span className="sr-only"> ({STATE_TEXT[state]})</span></span>
        <span className="block text-[11px] leading-snug text-subtle">
          <strong className="mr-1 text-base font-bold tabular-nums text-ink">{metric}</strong>{detail}
        </span>
      </span>
      <FiArrowRight className="mt-1 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

function Outcome({ label, value, hint, color }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3 shadow-sm" title={hint}>
      <div className="text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</div>
    </div>
  );
}

const pct = (v) => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function OverviewPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const sources = useSelector(selectSources);
  const matches = useSelector(selectMatches);
  const conflicts = useSelector(selectConflicts);
  const records = useSelector(selectHarmonized);
  const mappings = useSelector(selectMappings);
  const runs = useSelector(selectRuns);
  const issues = useSelector(selectIssues);
  const reports = useSelector(selectReports);
  const changeRuns = useSelector(selectChangeRuns);
  const readiness = useSelector(selectReadiness);
  const collections = useSelector(selectCollections);
  const jobs = useSelector(selectJobs);
  const runStatus = useSelector(selectRunStatus);
  const runError = useSelector(selectRunError);

  const load = () => {
    const w = wardId ?? undefined;
    dispatch(fetchSources({ wardId: w }));
    dispatch(fetchMatches({ wardId: w }));
    dispatch(fetchHarmonized({ wardId: w }));
    dispatch(fetchMappings());
    dispatch(fetchExtractionRuns(w));
    dispatch(fetchTopologyIssues({ wardId: w }));
    dispatch(fetchReports(w));
    dispatch(fetchChangeRuns(w));
    dispatch(fetchReadiness(w));
    dispatch(fetchCollections());
  };
  useEffect(load, [wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => {
    const ready = sources.filter((x) => x.status === 'ready');
    const open = conflicts.filter((c) => c.status === 'pending' || c.status === 'needs_review');
    const byBand = { auto_accept: 0, review: 0, conflict: 0 };
    matches.forEach((m) => { byBand[m.band] = (byBand[m.band] ?? 0) + 1; });
    const topoFixed = issues.filter((i) => i.status === 'auto_fixed' || i.status === 'accepted').length;
    const wardReports = reports.filter((r) => !r.sourceId);
    const validation = wardReports.length ? wardReports.reduce((a, r) => a + r.score, 0) / wardReports.length : null;
    const lastChange = changeRuns.find((r) => r.status === 'done');
    return {
      ready: ready.length,
      needsGeoref: sources.filter((x) => x.status === 'needs_georef').length,
      failed: sources.filter((x) => x.status === 'failed').length,
      pendingOcr: sources.filter((x) => x.status === 'pending_ocr').length,
      typesCovered: UPLOAD_TYPES.filter((t) => sources.some((x) => x.type === t)).length,
      aiLayers: sources.filter((x) => x.type === 'ai_extracted').length,
      aiFeatures: sources.filter((x) => x.type === 'ai_extracted').reduce((sum, x) => sum + (Number(x.featureCount) || 0), 0),
      open: open.length,
      resolvedRate: conflicts.length ? conflicts.filter((c) => c.status === 'resolved').length / conflicts.length : null,
      byBand,
      autoAccepted: byBand.auto_accept,
      topoOpen: issues.filter((i) => i.status === 'open').length,
      topoFixed,
      validation,
      changes: lastChange ? Object.values(lastChange.summary).reduce((a, b) => a + b, 0) : null,
      coverage: Object.fromEntries(UPLOAD_TYPES.map((t) => [t, sources.filter((x) => x.type === t)])),
    };
  }, [sources, matches, conflicts, issues, reports, changeRuns]);

  const st = (done, active) => (done ? 'done' : active ? 'active' : 'empty');

  // Stages grouped under the five workflow steps (same order as the sidebar).
  const stages = {
    '/sources': { metric: `${s.ready}/${sources.length}`, detail: `datasets ready · ${s.typesCovered} of 10 data types`, state: st(s.ready > 0, sources.length > 0) },
    '/georef': { metric: s.needsGeoref, detail: 'scanned maps waiting to be aligned', state: st(sources.length > 0 && s.needsGeoref === 0, s.needsGeoref > 0) },
    '/extraction': { metric: fmtNum(s.aiFeatures), detail: `buildings found in ${plural(s.aiLayers, 'AI layer')} · ${plural(runs.length, 'run')}`, state: st(s.aiLayers > 0, runs.length > 0) },
    '/topology': { metric: s.topoOpen, detail: `errors open · ${s.topoFixed} fixed`, state: st(issues.length > 0 && s.topoOpen === 0, s.topoOpen > 0) },
    '/matching': { metric: fmtNum(matches.length), detail: matches.length ? `matched pairs · ${pct(s.autoAccepted / matches.length)} accepted automatically` : 'not run yet', state: st(matches.length > 0, s.ready > 1) },
    '/attributes': { metric: fmtNum(mappings.length), detail: 'field pairs linked (AI + rules)', state: st(mappings.length > 0, matches.length > 0) },
    '/conflicts': { metric: s.open, detail: `waiting for a decision · ${pct(s.resolvedRate)} resolved`, state: st(matches.length > 0 && s.open === 0, s.open > 0) },
    '/validation': { metric: s.validation != null ? `${Math.round(s.validation)}/100` : '—', detail: 'data-quality score', state: st(s.validation != null && s.validation >= 85, s.validation != null) },
    '/changes': { metric: s.changes ?? '—', detail: s.changes != null ? 'changes in the latest survey comparison' : 'compare two surveys', state: st(s.changes != null, changeRuns.length > 0) },
    '/records': { metric: fmtNum(records.length), detail: readiness ? `final records · ${readiness.ready} ready to finalise` : 'built after matching', state: st(readiness?.ready > 0, records.length > 0) },
    '/exchange': { metric: collections.length, detail: 'datasets published for other departments', state: st(collections.length > 0, false) },
  };
  const stepState = (step) => {
    const states = step.items.map((i) => stages[i.to].state);
    if (states.every((x) => x === 'done')) return 'done';
    return states.some((x) => x !== 'empty') ? 'active' : 'empty';
  };

  // Concrete to-dos, most urgent first, each with a button to the page that fixes it.
  const todo = [
    s.failed > 0 && { tone: 'danger', text: `${plural(s.failed, 'upload')} failed to process`, to: '/sources' },
    s.open > 0 && { tone: 'danger', text: `${plural(s.open, 'conflict')} between sources need a decision`, to: '/conflicts' },
    s.needsGeoref > 0 && { tone: 'warning', text: `${plural(s.needsGeoref, 'scanned map')} must be aligned before use`, to: '/georef' },
    s.pendingOcr > 0 && { tone: 'warning', text: `${plural(s.pendingOcr, 'scanned record')} waiting for text reading (OCR)`, to: '/sources' },
    s.topoOpen > 0 && { tone: 'warning', text: `${plural(s.topoOpen, 'geometry error')} to review`, to: '/topology' },
    s.byBand.review > 0 && { tone: 'warning', text: `${plural(s.byBand.review, 'parcel match', 'parcel matches')} need a manual check`, to: '/matching' },
    !matches.length && s.ready > 1 && { tone: 'info', text: 'Parcels have not been matched yet', to: '/matching' },
    s.validation == null && records.length > 0 && { tone: 'info', text: 'No quality check has been run yet', to: '/validation' },
  ].filter(Boolean);

  const recent = jobs.filter((j) => !wardId || !j.wardId || j.wardId === wardId).slice(0, 6);

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
      <PageHeader
        step="PS 26013 · Land-record integration"
        title={ward ? `Home — Ward ${ward.id}, ${ward.name}` : 'Home — all wards'}
        summary="Where each step stands and what needs doing next. Click any row to open that page."
        description="Automated integration, harmonization, validation and synchronisation of multi-source land data with AI-generated feature extraction outputs. Data flows through five steps: bring in data → clean & detect → match & resolve → check quality → publish."
        actions={(
          <Button
            onClick={async () => { await dispatch(runMatching(wardId ?? undefined)); setTimeout(load, 4000); }}
            disabled={runStatus === 'loading'}
            title="Re-run steps 3–5 in one go: match parcels → find conflicts → rebuild final records → quality check"
          >
            <FiPlay /> {runStatus === 'loading' ? 'Queuing…' : `Run full harmonization${wardId ? '' : ' (all wards)'}`}
          </Button>
        )}
      />
      {runStatus === 'succeeded' && <div className="mb-4"><Notice tone="info">Started: matching → conflict detection → final-record assembly → validation. Follow it under “Jobs” in the top bar.</Notice></div>}
      {runStatus === 'failed' && <div className="mb-4"><Notice tone="danger">{runError}</Notice></div>}

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle className="mb-3">Needs your attention</SectionTitle>
          {todo.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-success-dark"><FiCheckCircle /> Nothing is waiting on you right now.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {todo.map((t) => {
                const item = navItem(t.to);
                const Icon = t.tone === 'danger' ? FiAlertCircle : FiAlertTriangle;
                return (
                  <li key={t.text} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line-light px-3 py-2">
                    <Icon className={cx('shrink-0', t.tone === 'danger' ? 'text-danger' : t.tone === 'warning' ? 'text-warning-dark' : 'text-primary')} />
                    <span className="min-w-0 flex-1 text-sm text-ink">{t.text}</span>
                    <Link to={t.to} title={item.hint} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold hover:no-underline">
                      Go to {item.label} <FiArrowRight />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div>
          <SectionTitle className="mb-2">Results so far</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Outcome label="Manual GIS effort avoided" color="#198754"
              value={fmtNum(s.autoAccepted + s.topoFixed)} hint={`${s.autoAccepted} matches auto-accepted + ${s.topoFixed} topology fixes applied automatically`} />
            <Outcome label="Record accuracy" color="#0d6efd" value={s.validation != null ? `${Math.round(s.validation)}/100` : '—'} hint="Validation score (quality rules + AI↔cadastre sync)" />
            <Outcome label="Consistency" color="#6f42c1" value={pct(s.resolvedRate)} hint="Share of inter-source conflicts resolved" />
            <Outcome label="Ready for finalisation" color="#e8590c" value={readiness ? `${readiness.ready_pct}%` : '—'} hint={readiness ? `${readiness.ready} of ${readiness.total} final records` : 'Build final records first'} />
          </div>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <SectionTitle>Workflow</SectionTitle>
        <span className="flex items-center gap-3 text-[11px] text-subtle">
          {Object.entries(STATE_TEXT).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className={cx('size-2 rounded-full', STATE_DOT[k])} />{v}</span>)}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {STEPS.map((step) => {
          const state = stepState(step);
          return (
            <Card key={step.n} className={cx('flex flex-col gap-1 p-2', state === 'active' && 'border-warning/60', state === 'done' && 'border-success/50')}>
              <div className="flex items-center gap-2 px-2 pb-1 pt-1">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{step.n}</span>
                <span className="text-sm font-bold text-ink">{step.title}</span>
              </div>
              {step.items.map((i) => <StageRow key={i.to} to={i.to} {...stages[i.to]} />)}
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle>Finalisation readiness</SectionTitle>
            <Button variant="secondary" size="sm" onClick={() => navigate('/records')} title="Open the final (golden) records">View final records</Button>
          </div>
          {readiness?.total ? (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-line-light">
                {Object.entries(READINESS).map(([k, v]) => readiness[k] > 0 && <div key={k} title={`${v.label}: ${readiness[k]}`} style={{ width: `${(readiness[k] / readiness.total) * 100}%`, background: v.color }} />)}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                {Object.entries(READINESS).map(([k, v]) => <li key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: v.color }} />{v.label}<strong className="text-ink">{readiness[k]}</strong></li>)}
              </ul>
            </>
          ) : <p className="text-xs text-subtle">No final records yet.</p>}
          <p className="mt-3 text-xs text-subtle">Match bands: {Object.entries(s.byBand).map(([k, v]) => `${BAND[k].label} ${v}`).join(' · ')}</p>
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <SectionTitle>Recent background jobs</SectionTitle>
            <Button variant="secondary" size="sm" onClick={() => navigate('/activity')} title="Open the full activity log">View all activity</Button>
          </div>
          {recent.length === 0 ? <p className="text-xs text-subtle">No jobs yet.</p> : (
            <ul className="flex flex-col gap-1.5">
              {recent.map((j) => (
                <li key={j.id} className="flex items-center gap-2 text-xs">
                  <Badge tone={JOB_STATUS[j.status]}>{j.status}</Badge>
                  <span className="flex-1 truncate">{JOB_LABEL[j.jobType] ?? humanize(j.jobType)}{j.wardId && <span className="text-faint"> · ward {j.wardId}</span>}</span>
                  <span className="text-faint">{fmtRelative(j.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <details className="group mt-4 rounded-xl border border-line bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 [&::-webkit-details-marker]:hidden" title="Show or hide how many datasets of each type have been uploaded">
          <SectionTitle>Source coverage — 10 NAKSHA data types</SectionTitle>
          <span className="text-xs text-subtle">{s.typesCovered} of 10 types present</span>
          <FiChevronDown className="ml-auto text-faint transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
          {UPLOAD_TYPES.map((t) => {
            const list = s.coverage[t];
            const meta = SOURCE_META[t];
            const worst = list.find((x) => x.status === 'failed') ?? list.find((x) => x.status !== 'ready') ?? list[0];
            return (
              <div key={t} className="flex items-center gap-3 rounded-lg border border-line-light px-3 py-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: meta.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{meta.label}</span>
                  <span className="block text-[11px] text-faint">{meta.group} · {meta.formats}</span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{list.length}</span>
                {list.length ? <Badge tone={SOURCE_STATUS[worst.status] ?? 'secondary'}>{humanize(worst.status)}</Badge> : <Badge tone="secondary">none</Badge>}
              </div>
            );
          })}
        </div>
      </details>
    </PageMotion>
  );
}
