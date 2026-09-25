import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  FiActivity, FiAlertTriangle, FiArrowRight, FiCheckSquare, FiCpu, FiCrosshair, FiDatabase, FiGitMerge, FiLayers,
  FiPlay, FiShare2, FiShuffle, FiTool,
} from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, cx } from '../components/ui';
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

function Stage({ group, icon: Icon, title, metric, detail, state, to }) {
  const navigate = useNavigate();
  const ring = { done: 'border-success/50', active: 'border-warning/60', empty: 'border-line' }[state];
  const dot = { done: 'bg-success', active: 'bg-warning', empty: 'bg-line' }[state];
  return (
    <button type="button" onClick={() => navigate(to)}
      className={cx('group flex animate-fade-up flex-col gap-1.5 rounded-xl border-2 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md', ring)}>
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
        <span className={cx('size-2 rounded-full', dot)} />{group}
        <FiArrowRight className="ml-auto opacity-0 transition group-hover:opacity-100" />
      </span>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Icon className="shrink-0 text-primary" />{title}</span>
      <span className="text-xl font-bold tabular-nums text-ink">{metric}</span>
      <span className="text-[11px] leading-snug text-subtle">{detail}</span>
    </button>
  );
}

function Outcome({ label, value, hint, color }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-xs font-semibold uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-1 text-[11px] text-faint">{hint}</div>
    </div>
  );
}

const pct = (v) => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`);

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
      features: sources.reduce((sum, x) => sum + (Number(x.featureCount) || 0), 0),
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
  const recent = jobs.filter((j) => !wardId || !j.wardId || j.wardId === wardId).slice(0, 8);

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        step="PS 26013 · AI-enabled geospatial integration platform"
        title={ward ? `Command centre — Ward ${ward.id}, ${ward.name}` : 'Command centre — all wards'}
        description="Automated integration, harmonization, validation and synchronisation of multi-source land data with AI-generated feature extraction outputs."
        actions={(
          <Button onClick={async () => { await dispatch(runMatching(wardId ?? undefined)); setTimeout(load, 4000); }} disabled={runStatus === 'loading'}>
            <FiPlay /> {runStatus === 'loading' ? 'Queuing…' : 'Run harmonization'}
          </Button>
        )}
      />
      {runStatus === 'succeeded' && <div className="mb-4"><Notice tone="info">Queued: matching → conflict detection → golden-record assembly → validation.</Notice></div>}
      {runStatus === 'failed' && <div className="mb-4"><Notice tone="danger">{runError}</Notice></div>}

      <SectionTitle className="mb-2">Expected outcomes</SectionTitle>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Outcome label="Manual GIS effort avoided" color="#198754"
          value={fmtNum(s.autoAccepted + s.topoFixed)} hint={`${s.autoAccepted} matches auto-accepted + ${s.topoFixed} topology fixes applied automatically`} />
        <Outcome label="Record accuracy" color="#0d6efd" value={s.validation != null ? `${Math.round(s.validation)}/100` : '—'} hint="validation score (quality rules + AI↔cadastre sync)" />
        <Outcome label="Consistency" color="#6f42c1" value={pct(s.resolvedRate)} hint="share of inter-source conflicts resolved" />
        <Outcome label="Ready for finalisation" color="#e8590c" value={readiness ? `${readiness.ready_pct}%` : '—'} hint={readiness ? `${readiness.ready} of ${readiness.total} golden records` : 'assemble golden records first'} />
      </div>

      <SectionTitle className="mb-2">Pipeline</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stage group="Ingest" icon={FiDatabase} title="Data sources" to="/sources" metric={`${s.ready}/${sources.length}`}
          detail={`${s.typesCovered} of 10 source types`} state={st(s.ready > 0, sources.length > 0)} />
        <Stage group="Ingest" icon={FiCrosshair} title="Geo-referencing" to="/georef" metric={s.needsGeoref}
          detail="scans awaiting control points" state={st(sources.length > 0 && s.needsGeoref === 0, s.needsGeoref > 0)} />
        <Stage group="Process" icon={FiCpu} title="AI extraction" to="/extraction" metric={fmtNum(s.aiFeatures)}
          detail={`footprints in ${s.aiLayers} AI layer(s) · ${runs.length} runs`} state={st(s.aiLayers > 0, runs.length > 0)} />
        <Stage group="Process" icon={FiTool} title="Topology QA" to="/topology" metric={s.topoOpen}
          detail={`open issues · ${s.topoFixed} fixed`} state={st(issues.length > 0 && s.topoOpen === 0, s.topoOpen > 0)} />
        <Stage group="Harmonize" icon={FiGitMerge} title="Spatial matching" to="/matching" metric={fmtNum(matches.length)}
          detail={matches.length ? `${pct(s.autoAccepted / matches.length)} auto-accepted` : 'not run yet'} state={st(matches.length > 0, s.ready > 1)} />
        <Stage group="Harmonize" icon={FiShuffle} title="Attribute mapping" to="/attributes" metric={fmtNum(mappings.length)}
          detail="field correspondences (AI + rules)" state={st(mappings.length > 0, matches.length > 0)} />
        <Stage group="Harmonize" icon={FiAlertTriangle} title="Conflicts" to="/conflicts" metric={s.open}
          detail={`open · ${pct(s.resolvedRate)} resolved`} state={st(matches.length > 0 && s.open === 0, s.open > 0)} />
        <Stage group="Validate" icon={FiCheckSquare} title="Validation & sync" to="/validation" metric={s.validation != null ? Math.round(s.validation) : '—'}
          detail="ward data-quality score" state={st(s.validation != null && s.validation >= 85, s.validation != null)} />
        <Stage group="Validate" icon={FiActivity} title="Change detection" to="/changes" metric={s.changes ?? '—'}
          detail={s.changes != null ? 'changes in the latest epoch comparison' : 'compare two survey epochs'} state={st(s.changes != null, changeRuns.length > 0)} />
        <Stage group="Publish" icon={FiLayers} title="Golden records" to="/records" metric={fmtNum(records.length)}
          detail={readiness ? `${readiness.ready} ready to finalise` : 'assemble after matching'} state={st(readiness?.ready > 0, records.length > 0)} />
        <Stage group="Publish" icon={FiShare2} title="Data exchange" to="/exchange" metric={collections.length}
          detail="OGC API – Features collections" state={st(collections.length > 0, false)} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>Source coverage — 10 NAKSHA data types</SectionTitle>
            <Button variant="secondary" size="sm" onClick={() => navigate('/sources')}>Manage sources</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
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
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle className="mb-3">Finalisation readiness</SectionTitle>
            {readiness?.total ? (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-line-light">
                  {Object.entries(READINESS).map(([k, v]) => readiness[k] > 0 && <div key={k} title={`${v.label}: ${readiness[k]}`} style={{ width: `${(readiness[k] / readiness.total) * 100}%`, background: v.color }} />)}
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                  {Object.entries(READINESS).map(([k, v]) => <li key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: v.color }} />{v.label}<strong className="text-ink">{readiness[k]}</strong></li>)}
                </ul>
              </>
            ) : <p className="text-xs text-subtle">No golden records yet.</p>}
            <p className="mt-3 text-xs text-subtle">Match bands: {Object.entries(s.byBand).map(([k, v]) => `${BAND[k].label} ${v}`).join(' · ')}</p>
          </Card>
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle>Recent pipeline activity</SectionTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/activity')}>All</Button>
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
      </div>
    </PageMotion>
  );
}
