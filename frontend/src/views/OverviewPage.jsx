import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiActivity, FiAlertTriangle, FiArrowRight, FiCheckCircle, FiChevronRight, FiPlay, FiPlus, FiSend, FiServer,
} from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import { Badge, Button, Card, ErrorPanel, Notice, PageHeader, SectionTitle, Skeleton, cx } from '../components/ui';
import { FLOW } from '../components/nav';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { fetchSources, selectSources, selectSourcesError, selectSourcesStatus } from '../Redux/slices/sourcesSlice';
import {
  fetchMappings, fetchMatches, resetRunStatus, runMatching, selectMatches, selectRunError, selectRunStatus,
} from '../Redux/slices/harmonizationSlice';
import { selectConflicts } from '../Redux/slices/conflictsSlice';
import { fetchHarmonized, selectHarmonized } from '../Redux/slices/harmonizedSlice';
import { fetchExtractionRuns, fetchTopologyIssues, selectIssues, selectRuns } from '../Redux/slices/processingSlice';
import {
  fetchChangeRuns, fetchCollections, fetchReadiness, fetchReports, selectReadiness, selectReports,
} from '../Redux/slices/qualitySlice';
import { selectActiveJobs, selectJobs } from '../Redux/slices/jobsSlice';
import { selectDataMode, selectHealth } from '../Redux/slices/adminSlice';
import { JOB_LABEL, JOB_STATUS, SOURCE_META, UPLOAD_TYPES, fmtNum, fmtRelative, humanize } from '../utils/format';
import { friendlyError } from '../utils/errors';

const hintFor = (to) => FLOW.find((f) => f.to === to)?.hint;
const count = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const plural = (n, one, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;

const STAGE_DOT = { done: 'bg-success', attention: 'bg-warning', active: 'bg-info', todo: 'bg-line' };
const STAGE_TEXT = { done: 'Done', attention: 'Needs attention', active: 'In progress', todo: 'Not started' };

/** Compact horizontal pipeline: one small tile per stage, arrows in between. */
function Pipeline({ stages, loading }) {
  return (
    <ol className="flex items-stretch gap-1 overflow-x-auto pb-1" aria-label="Pipeline">
      {stages.map((st, i) => (
        <li key={st.key} className="flex min-w-[112px] flex-1 items-center gap-1">
          <Link
            to={st.to}
            title={`${st.label}: ${STAGE_TEXT[st.state]} — ${hintFor(st.to) ?? ''}`}
            className={cx(
              'relative flex h-full w-full flex-col gap-1 rounded-lg border bg-white px-3 py-2.5 transition hover:border-primary hover:no-underline',
              st.state === 'attention' ? 'border-warning/70' : 'border-line',
            )}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <span className={cx('size-2 shrink-0 rounded-full', STAGE_DOT[st.state])} aria-hidden="true" />
              {st.label}
              <span className="sr-only">({STAGE_TEXT[st.state]})</span>
            </span>
            {loading ? <Skeleton className="h-4 w-16" /> : <span className="text-[11px] leading-snug text-subtle">{st.metric}</span>}
          </Link>
          {i < stages.length - 1 && <FiChevronRight className="shrink-0 text-faint" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

/** The one primary action for the current state of the ward. */
function NextStep({ step, secondary }) {
  const Icon = step.icon;
  return (
    <section aria-label="Next step" className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:p-6">
      <span className={cx('inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl', step.tone === 'warning' ? 'bg-warning-light text-warning-dark' : 'bg-primary-light text-primary')}>
        <Icon aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Next step</span>
        <h2 className="text-lg font-bold text-ink">{step.title}</h2>
        <p className="mt-0.5 text-sm text-subtle">{step.text}</p>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:items-end">
        <Button onClick={step.onClick} disabled={step.disabled} title={step.hint} className="px-5 py-2.5 text-base">
          {step.cta} <FiArrowRight />
        </Button>
        {secondary}
      </div>
    </section>
  );
}

function StatusRow({ label, value, detail, tone }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', { ok: 'bg-success', warn: 'bg-warning', bad: 'bg-danger', idle: 'bg-line' }[tone])} aria-hidden="true" />
      <dt className="w-32 shrink-0 text-subtle">{label}</dt>
      <dd className="min-w-0 flex-1">
        <span className="font-medium text-ink">{value}</span>
        {detail && <span className="block text-xs text-subtle">{detail}</span>}
      </dd>
    </div>
  );
}

export default function OverviewPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const sources = useSelector(selectSources);
  const sourcesStatus = useSelector(selectSourcesStatus);
  const sourcesError = useSelector(selectSourcesError);
  const matches = useSelector(selectMatches);
  const conflicts = useSelector(selectConflicts);
  const records = useSelector(selectHarmonized);
  const runs = useSelector(selectRuns);
  const issues = useSelector(selectIssues);
  const reports = useSelector(selectReports);
  const readiness = useSelector(selectReadiness);
  const jobs = useSelector(selectJobs);
  const activeJobs = useSelector(selectActiveJobs);
  const health = useSelector(selectHealth);
  const dataMode = useSelector(selectDataMode);
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

  const run = async () => {
    const res = await dispatch(runMatching(wardId ?? undefined));
    if (res.meta.requestStatus === 'fulfilled') setTimeout(load, 4000);
  };

  const s = useMemo(() => {
    const wardReports = reports.filter((r) => !r.sourceId && Number.isFinite(Number(r.score)));
    return {
      total: sources.length,
      ready: sources.filter((x) => x.status === 'ready').length,
      failed: sources.filter((x) => x.status === 'failed').length,
      processing: sources.filter((x) => x.status === 'processing').length,
      needsGeoref: sources.filter((x) => x.status === 'needs_georef').length,
      pendingOcr: sources.filter((x) => x.status === 'pending_ocr').length,
      typesCovered: UPLOAD_TYPES.filter((t) => sources.some((x) => x.type === t)).length,
      aiLayers: sources.filter((x) => x.type === 'ai_extracted').length,
      aiFeatures: sources.filter((x) => x.type === 'ai_extracted').reduce((sum, x) => sum + count(x.featureCount), 0),
      openConflicts: conflicts.filter((c) => c.status === 'pending' || c.status === 'needs_review').length,
      topoOpen: issues.filter((i) => i.status === 'open').length,
      validation: wardReports.length ? wardReports.reduce((a, r) => a + Number(r.score), 0) / wardReports.length : null,
      readyToPublish: count(readiness?.ready),
      recordTotal: count(readiness?.total) || records.length,
    };
  }, [sources, conflicts, issues, reports, readiness, records]);

  const wardJobs = jobs.filter((j) => !wardId || !j.wardId || j.wardId === wardId);
  const wardActive = activeJobs.filter((j) => !wardId || !j.wardId || j.wardId === wardId);
  const loading = (sourcesStatus === 'idle' || sourcesStatus === 'loading') && !sources.length;
  const loadFailed = sourcesStatus === 'failed' && !sources.length;

  const stages = [
    { key: 'sources', label: 'Sources', to: '/sources',
      metric: s.total ? `${s.ready} of ${s.total} ready` : 'No data yet',
      state: !s.total ? 'todo' : s.failed ? 'attention' : s.ready === s.total ? 'done' : 'active' },
    { key: 'geo', label: 'Geo', to: '/georef',
      metric: s.needsGeoref ? `${s.needsGeoref} to align` : s.total ? 'All aligned' : 'Nothing to align',
      state: s.needsGeoref ? 'attention' : s.total ? 'done' : 'todo' },
    { key: 'extract', label: 'Extract', to: '/extraction',
      metric: s.aiLayers ? plural(s.aiFeatures, 'building') : runs.length ? 'Running' : 'Not run',
      state: s.aiLayers ? 'done' : runs.length ? 'active' : 'todo' },
    { key: 'qa', label: 'QA', to: '/topology',
      metric: s.topoOpen ? `${plural(s.topoOpen, 'error')} to fix` : issues.length ? 'No open errors' : 'Not run',
      state: s.topoOpen ? 'attention' : issues.length ? 'done' : 'todo' },
    { key: 'match', label: 'Match', to: s.openConflicts ? '/conflicts' : '/matching',
      metric: !matches.length ? 'Not run' : s.openConflicts ? `${plural(s.openConflicts, 'conflict')} open` : plural(matches.length, 'pair'),
      state: !matches.length ? 'todo' : s.openConflicts ? 'attention' : 'done' },
    { key: 'validate', label: 'Validate', to: '/validation',
      metric: s.validation != null ? `Score ${Math.round(s.validation)}/100` : 'Not run',
      state: s.validation == null ? 'todo' : s.validation >= 85 ? 'done' : 'attention' },
    { key: 'publish', label: 'Publish', to: '/records',
      metric: s.recordTotal ? `${s.readyToPublish} of ${fmtNum(s.recordTotal)} ready` : 'Nothing yet',
      state: !s.recordTotal ? 'todo' : s.readyToPublish === s.recordTotal ? 'done' : s.readyToPublish ? 'active' : 'todo' },
  ];

  // One primary action, chosen by priority.
  let next;
  if (!s.total) {
    next = { icon: FiPlus, title: 'Add your first data source', text: 'Upload a cadastral map, survey or imagery file to start the pipeline.', cta: 'Add data source', hint: 'Open Data sources to upload a file', onClick: () => navigate('/sources') };
  } else if (runStatus === 'loading' || wardActive.length || s.processing) {
    const n = wardActive.length;
    next = { icon: FiActivity, title: n ? `${plural(n, 'job')} processing` : 'Processing your data', text: 'The system is working in the background. Results appear here when it finishes.', cta: n === 1 ? 'View job' : 'View jobs', hint: 'Open the activity log to follow progress', onClick: () => navigate('/activity') };
  } else if (s.openConflicts) {
    next = { icon: FiAlertTriangle, tone: 'warning', title: `${plural(s.openConflicts, 'conflict')} need a decision`, text: 'Two sources disagree about the same parcel. Decide which one is right before publishing.', cta: 'Review conflicts', hint: 'Open Resolve conflicts', onClick: () => navigate('/conflicts') };
  } else if (s.readyToPublish) {
    next = { icon: FiSend, title: `${plural(s.readyToPublish, 'record')} ready to publish`, text: 'Review the final records and download or share them with other departments.', cta: 'Publish', hint: 'Open Final records to review and export', onClick: () => navigate('/records') };
  } else {
    next = { icon: FiPlay, title: 'Ready to harmonize', text: 'Match parcels across sources, detect conflicts and build the final records.', cta: 'Run harmonization', hint: 'Match parcels → find conflicts → build final records → quality check', onClick: run, disabled: runStatus === 'loading' };
  }
  const runIsPrimary = next.cta === 'Run harmonization';

  const coverage = UPLOAD_TYPES.map((t) => ({ type: t, meta: SOURCE_META[t], list: sources.filter((x) => x.type === t) }));
  const missing = coverage.filter((c) => !c.list.length);

  const healthRow = !health
    ? { value: 'Checking…', tone: 'idle' }
    : health.status === 'ok' ? { value: 'Connected', tone: 'ok', detail: 'Database, job queue and storage are working' }
      : health.status === 'down' ? { value: 'Unreachable', tone: 'bad', detail: friendlyError(health.error)?.message ?? 'The backend is not responding.' }
        : { value: 'Partly working', tone: 'warn', detail: [['Database', health.db], ['Job queue', health.redis], ['Storage', health.r2]].filter(([, v]) => v && v !== 'ok').map(([k]) => `${k} has a problem`).join(' · ') };
  const lastJob = wardJobs[0];

  return (
    <PageMotion className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pb-24 pt-6 sm:px-6">
      <PageHeader
        step="PS 26013 · Land-record integration"
        title="Command centre"
        summary={ward ? `Ward ${ward.id} — ${ward.name}` : 'All wards'}
        description="Automated integration, harmonization, validation and synchronisation of multi-source land data with AI-generated feature extraction outputs. Data moves through the pipeline below from left to right."
      />

      {runError && (
        <ErrorPanel
          title="Couldn’t start harmonization"
          error={friendlyError(runError)}
          actions={(
            <>
              <Button size="sm" variant="secondary" onClick={run}>Try again</Button>
              <Button size="sm" variant="ghost" onClick={() => dispatch(resetRunStatus())}>Dismiss</Button>
            </>
          )}
        />
      )}
      {runStatus === 'succeeded' && <Notice tone="info">Harmonization started. Follow it under “Jobs” in the top bar.</Notice>}

      {loadFailed ? (
        <ErrorPanel title="Couldn’t load your data" error={friendlyError(sourcesError)} actions={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>} />
      ) : loading ? (
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-6"><Skeleton className="size-12" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-72" /></div></div>
      ) : (
        <NextStep
          step={next}
          secondary={!runIsPrimary && s.total > 0 && (
            <button type="button" onClick={run} disabled={runStatus === 'loading'} title="Match parcels → find conflicts → build final records → quality check" className="text-xs font-medium text-primary hover:underline disabled:opacity-60">
              {runStatus === 'loading' ? 'Starting…' : 'or run harmonization again'}
            </button>
          )}
        />
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>Pipeline</SectionTitle>
          <span className="flex flex-wrap gap-3 text-[11px] text-subtle">
            {Object.entries(STAGE_TEXT).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className={cx('size-2 rounded-full', STAGE_DOT[k])} />{v}</span>)}
          </span>
        </div>
        <Pipeline stages={stages} loading={loading} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <SectionTitle className="flex items-center gap-1.5"><FiServer /> System status</SectionTitle>
            <Link to="/settings" className="text-xs font-medium" title="Open Settings & health">Details</Link>
          </div>
          <dl className="divide-y divide-line-light text-sm">
            <StatusRow label="Backend" {...healthRow} />
            <StatusRow label="Data" value={dataMode === 'live' ? 'Live records' : 'Demo — sample data'} tone={dataMode === 'live' ? 'ok' : 'warn'} />
            <StatusRow label="Background jobs" value={wardActive.length ? `${plural(wardActive.length, 'job')} running` : 'Idle'} tone={wardActive.length ? 'warn' : 'ok'} />
            <StatusRow
              label="Last activity"
              value={lastJob ? (JOB_LABEL[lastJob.jobType] ?? humanize(lastJob.jobType)) : 'No activity yet'}
              detail={lastJob ? `${lastJob.status} · ${fmtRelative(lastJob.createdAt)}` : undefined}
              tone={!lastJob ? 'idle' : lastJob.status === 'failed' ? 'bad' : 'ok'}
            />
          </dl>
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <SectionTitle>Recent activity</SectionTitle>
            <Link to="/activity" className="text-xs font-medium" title="Open the full activity log">View all</Link>
          </div>
          {wardJobs.length === 0 ? <p className="py-2 text-sm text-subtle">No activity yet.</p> : (
            <ul className="flex flex-col gap-2">
              {wardJobs.slice(0, 5).map((j) => (
                <li key={j.id} className="flex items-center gap-2 text-xs">
                  <Badge tone={JOB_STATUS[j.status]} className="w-[70px] justify-center">{j.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink">{JOB_LABEL[j.jobType] ?? humanize(j.jobType)}{j.wardId && <span className="text-faint"> · ward {j.wardId}</span>}</span>
                  <span className="whitespace-nowrap text-faint">{fmtRelative(j.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>Source coverage</SectionTitle>
          <Link to="/sources" className="text-xs font-medium" title="Open Data sources">Manage sources</Link>
        </div>
        {loading ? <Skeleton className="h-4 w-64" /> : (
          <>
            <p className="text-sm text-ink">
              <strong>{s.typesCovered} of {UPLOAD_TYPES.length}</strong> data types · <strong>{s.ready} of {s.total}</strong> datasets ready
              {s.failed > 0 && <span className="text-danger"> · {s.failed} failed</span>}
              {s.needsGeoref > 0 && <span className="text-warning-dark"> · {s.needsGeoref} to align</span>}
              {s.pendingOcr > 0 && <span className="text-warning-dark"> · {s.pendingOcr} awaiting OCR</span>}
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Datasets per type">
              {coverage.map(({ type, meta, list }) => (
                <li key={type} title={`${meta.label}: ${plural(list.length, 'dataset')}`}
                  className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs', list.length ? 'border-line text-ink' : 'border-dashed border-line text-faint')}>
                  <span className="size-2 rounded-sm" style={{ background: list.length ? meta.color : 'transparent', outline: list.length ? 'none' : `1px solid ${meta.color}` }} />
                  {meta.label}<span className="tabular-nums text-subtle">{list.length}</span>
                </li>
              ))}
            </ul>
            {missing.length === 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-success-dark"><FiCheckCircle /> Every data type is represented.</p>}
          </>
        )}
      </Card>
    </PageMotion>
  );
}
