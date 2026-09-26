import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { FiArrowRight, FiMap, FiUpload } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import Loader from '../components/Loader';
import Legend from '../components/MapLegend';
import { propsTable } from '../components/mapPopup';
import { bboxPolygon, featureCollection } from '../components/mapStyle';
import { Badge, Button, ErrorPanel, Notice, PageHeader, Panel, Skeleton, cx, selectCls, td, th } from '../components/ui';
import { FLOW } from '../components/nav';
import { selectSelectedWard, selectSelectedWardId, selectWards, setSelectedWard } from '../Redux/slices/wardsSlice';
import { fetchSources, selectSources, selectSourcesError, selectSourcesStatus } from '../Redux/slices/sourcesSlice';
import {
  fetchMappings, fetchMatches, resetRunStatus, runMatching, selectMatches, selectRunError, selectRunStatus,
} from '../Redux/slices/harmonizationSlice';
import { selectConflicts } from '../Redux/slices/conflictsSlice';
import { fetchHarmonized, fetchHarmonizedGeoJSON, selectHarmonized, selectHarmonizedGeoJSON } from '../Redux/slices/harmonizedSlice';
import { fetchExtractionRuns, fetchTopologyIssues, selectIssues, selectRuns } from '../Redux/slices/processingSlice';
import {
  fetchChangeRuns, fetchCollections, fetchReadiness, fetchReports, selectReadiness, selectReports,
} from '../Redux/slices/qualitySlice';
import { selectActiveJobs, selectJobs } from '../Redux/slices/jobsSlice';
import { selectDataMode, selectHealth } from '../Redux/slices/adminSlice';
import {
  JOB_LABEL, JOB_STATUS, SOURCE_META, SOURCE_STATUS, SOURCE_TYPES, UPLOAD_TYPES, dayjs, fmtNum, fmtRelative, humanize,
} from '../utils/format';
import { friendlyError } from '../utils/errors';

const GeoMap = lazy(() => import('../components/GeoMap'));

const hintFor = (to) => FLOW.find((f) => f.to === to)?.hint;
const shortDate = (d) => (d && dayjs(d).isValid() ? dayjs(d).format('DD MMM YY') : '—');
const count = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const plural = (n, one, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;

const STAGE_DOT = { done: 'bg-success', attention: 'bg-warning', active: 'bg-info', todo: 'bg-line' };
const STAGE_TEXT = { done: 'Done', attention: 'Needs attention', active: 'In progress', todo: 'Not started' };

const RECORD_COLORS = { ready: '#2d6a4f', review: '#c08a1e', conflict: '#b42318' };
const recordColor = (p) => (count(p?._conflict_count) > 0 ? RECORD_COLORS.conflict : count(p?._confidence) >= 0.85 ? RECORD_COLORS.ready : RECORD_COLORS.review);
const validBox = (b) => b && [b.north, b.south, b.east, b.west].every(Number.isFinite) && b.north !== b.south && b.east !== b.west;

/** Processing pipeline as one segmented bar: each cell is a stage, its state and one fact. */
function Pipeline({ stages, loading }) {
  return (
    <ol className="flex overflow-x-auto rounded-md border border-line bg-white" aria-label="Pipeline">
      {stages.map((st) => (
        <li key={st.key} className="min-w-[118px] flex-1 border-r border-line last:border-r-0">
          <Link
            to={st.to}
            title={`${st.label}: ${STAGE_TEXT[st.state]} — ${hintFor(st.to) ?? ''}`}
            className={cx('relative flex h-full flex-col gap-0.5 px-3 py-2 text-ink hover:bg-hover hover:no-underline', st.state === 'attention' && 'shadow-[inset_0_-2px_0_var(--color-warning)]')}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <span className={cx('size-1.5 shrink-0 rounded-full', STAGE_DOT[st.state])} aria-hidden="true" />
              {st.label}
              <span className="sr-only">({STAGE_TEXT[st.state]})</span>
            </span>
            {loading ? <Skeleton className="h-3.5 w-16" /> : <span className="text-xs text-subtle">{st.metric}</span>}
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** The one primary action for the current state of the ward, as a slim bar under the title. */
function NextStep({ step, secondary }) {
  return (
    <section aria-label="Next step" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line border-l-4 border-l-primary bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-ink"><span className="font-normal text-subtle">Next step: </span>{step.title}</h2>
        <p className="text-xs text-subtle">{step.text}</p>
      </div>
      {secondary}
      <Button onClick={step.onClick} disabled={step.disabled} title={step.hint}>
        {step.cta} <FiArrowRight />
      </Button>
    </section>
  );
}

function StatusRow({ label, value, detail, tone }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <dt className="w-32 shrink-0 text-subtle">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-start gap-2">
        <span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', { ok: 'bg-success', warn: 'bg-warning', bad: 'bg-danger', idle: 'bg-faint' }[tone])} aria-hidden="true" />
        <span className="min-w-0">
          <span className="text-ink">{value}</span>
          {detail && <span className="block text-xs text-subtle">{detail}</span>}
        </span>
      </dd>
    </div>
  );
}

export default function OverviewPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const wards = useSelector(selectWards);
  const sources = useSelector(selectSources);
  const sourcesStatus = useSelector(selectSourcesStatus);
  const sourcesError = useSelector(selectSourcesError);
  const matches = useSelector(selectMatches);
  const conflicts = useSelector(selectConflicts);
  const records = useSelector(selectHarmonized);
  const recordsGeo = useSelector(selectHarmonizedGeoJSON);
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
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

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
    if (wardId) dispatch(fetchHarmonizedGeoJSON(wardId));
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
      extractedLayers: sources.filter((x) => x.type === 'ai_extracted').length,
      extractedFeatures: sources.filter((x) => x.type === 'ai_extracted').reduce((sum, x) => sum + count(x.featureCount), 0),
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
      metric: s.extractedLayers ? plural(s.extractedFeatures, 'footprint') : runs.length ? 'Running' : 'Not run',
      state: s.extractedLayers ? 'done' : runs.length ? 'active' : 'todo' },
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
    next = { title: 'Add your first data source', text: 'Upload a cadastral map, survey or imagery file to start the pipeline.', cta: 'Add data source', hint: 'Open Data sources to upload a file', onClick: () => navigate('/sources') };
  } else if (runStatus === 'loading' || wardActive.length || s.processing) {
    const n = wardActive.length;
    next = { title: n ? `${plural(n, 'job')} processing` : 'Datasets are being processed', text: 'Results update here when processing finishes.', cta: n === 1 ? 'View job' : 'View jobs', hint: 'Open the activity log to follow progress', onClick: () => navigate('/activity') };
  } else if (s.openConflicts) {
    next = { title: `${plural(s.openConflicts, 'conflict')} need a decision`, text: 'Two sources disagree about the same parcel. Decide which is correct before publishing.', cta: 'Review conflicts', hint: 'Open Resolve conflicts', onClick: () => navigate('/conflicts') };
  } else if (s.readyToPublish) {
    next = { title: `${plural(s.readyToPublish, 'record')} ready to publish`, text: 'Review the final records, then download or share them with other departments.', cta: 'Publish', hint: 'Open Final records to review and export', onClick: () => navigate('/records') };
  } else {
    next = { title: 'Ready to harmonize', text: 'Match parcels across sources, detect conflicts and build the final records.', cta: 'Run harmonization', hint: 'Match parcels → find conflicts → build final records → quality check', onClick: run, disabled: runStatus === 'loading' };
  }
  const runIsPrimary = next.cta === 'Run harmonization';

  // Datasets table.
  const typeCounts = Object.fromEntries(SOURCE_TYPES.map((t) => [t, sources.filter((x) => x.type === t).length]));
  const rows = sources
    .filter((x) => (!typeFilter || x.type === typeFilter) && (!statusFilter || x.status === statusFilter))
    .slice()
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const missing = UPLOAD_TYPES.filter((t) => !typeCounts[t]);

  // Map: ward extents (click to open a ward); with a ward selected, its final parcels coloured by readiness.
  const layers = useMemo(() => {
    const extents = featureCollection(wards.filter((w) => validBox(w.bbox)).map((w) => ({
      type: 'Feature', id: w.id, geometry: bboxPolygon(w.bbox),
      properties: { ward: w.id, name: w.name, _color: w.id === wardId ? '#1d4f7c' : '#5b6573' },
    })));
    const out = [{ id: 'wards', data: extents, color: '#5b6573', fillOpacity: wardId ? 0 : 0.06, lineWidth: 1.5, dashed: Boolean(wardId), interactive: !wardId }];
    if (wardId && recordsGeo?.features?.length) {
      out.push({
        id: 'records', color: RECORD_COLORS.ready, fillOpacity: 0.35, lineWidth: 1,
        data: featureCollection(recordsGeo.features.map((f) => ({ ...f, properties: { ...f.properties, _color: recordColor(f.properties) } }))),
      });
    }
    return out;
  }, [wards, wardId, recordsGeo]);
  const parcelCount = wardId ? recordsGeo?.features?.length ?? 0 : 0;
  // Zoom to the ward's parcels when there are any, else to the ward extent, else to all wards.
  const fitTo = parcelCount ? layers[1].data
    : ward && validBox(ward.bbox) ? [ward.bbox.west, ward.bbox.south, ward.bbox.east, ward.bbox.north]
      : layers[0].data.features.length ? layers[0].data : null;

  const healthRow = !health
    ? { value: 'Checking…', tone: 'idle' }
    : health.status === 'ok' ? { value: 'Connected', tone: 'ok', detail: 'Database, job queue and storage are working' }
      : health.status === 'down' ? { value: 'Unreachable', tone: 'bad', detail: friendlyError(health.error)?.message ?? 'The backend is not responding.' }
        : { value: 'Partly working', tone: 'warn', detail: [['Database', health.db], ['Job queue', health.redis], ['Storage', health.r2]].filter(([, v]) => v && v !== 'ok').map(([k]) => `${k} has a problem`).join(' · ') };
  const lastJob = wardJobs[0];

  return (
    <PageMotion className="flex w-full flex-col gap-4 px-4 pt-4 sm:px-6">
      <PageHeader
        step="Overview"
        title="Command centre"
        summary={ward ? `Ward ${ward.id} — ${ward.name}` : 'All wards · select a ward on the map or in the top bar to focus on it'}
        description="Automated integration, harmonization, validation and synchronisation of multi-source land data with extracted building footprints. Datasets move through the pipeline from left to right."
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
        <div className="rounded-md border border-line bg-white px-4 py-3"><Skeleton className="h-4 w-72" /></div>
      ) : (
        <NextStep
          step={next}
          secondary={!runIsPrimary && s.total > 0 && (
            <Button variant="secondary" onClick={run} disabled={runStatus === 'loading'} title="Match parcels → find conflicts → build final records → quality check">
              {runStatus === 'loading' ? 'Starting…' : 'Run harmonization again'}
            </Button>
          )}
        />
      )}

      <Pipeline stages={stages} loading={loading} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          title={`Datasets${s.total ? ` (${rows.length}${rows.length !== s.total ? ` of ${s.total}` : ''})` : ''}`}
          actions={(
            <>
              <select className={selectCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
                <option value="">All types</option>
                {SOURCE_TYPES.filter((t) => t !== 'ai_extracted' || typeCounts[t]).map((t) => <option key={t} value={t}>{`${SOURCE_META[t].label} (${typeCounts[t]})`}</option>)}
              </select>
              <select className={selectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
                <option value="">All statuses</option>
                {Object.keys(SOURCE_STATUS).map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
              </select>
              <Button size="sm" variant="secondary" onClick={() => navigate('/sources')} title="Open Data sources to upload a new file"><FiUpload /> Upload</Button>
            </>
          )}
        >
          {loading ? (
            <div className="flex flex-col gap-2 p-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : !s.total ? (
            <div className="px-4 py-8 text-sm text-subtle">
              <p className="font-medium text-ink">No datasets in {ward ? `ward ${ward.id}` : 'any ward'} yet.</p>
              <p className="mt-1">Upload cadastral maps, revenue records, surveys or imagery in <Link to="/sources">Data sources</Link>. Each file is reprojected, checked and added to this list automatically.</p>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm" aria-label="Datasets">
                <thead>
                  <tr>
                    <th className={th}>Dataset</th><th className={th}>Type</th><th className={th}>Ward</th>
                    <th className={cx(th, 'text-right')}>Features</th><th className={th}>Status</th><th className={th}>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-subtle">No datasets match these filters.</td></tr>
                  ) : rows.map((x) => (
                    <tr key={x.id} className="border-t border-line-light hover:bg-hover">
                      <td className={cx(td, 'max-w-[200px] truncate')} title={x.description ?? x.filename ?? x.id}>
                        <Link to="/sources" title="Open in Data sources">{x.filename ?? x.s3Key?.split('/').pop() ?? x.id.slice(0, 8)}</Link>
                      </td>
                      <td className={cx(td, 'whitespace-nowrap')}>
                        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[1px]" style={{ background: SOURCE_META[x.type]?.color ?? '#5b6573' }} />{SOURCE_META[x.type]?.label ?? humanize(x.type)}</span>
                      </td>
                      <td className={cx(td, 'text-subtle')}>{x.wardId ?? 'City'}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{x.featureCount != null ? fmtNum(x.featureCount) : '—'}</td>
                      <td className={td}><Badge tone={SOURCE_STATUS[x.status] ?? 'secondary'}>{humanize(x.status)}</Badge></td>
                      <td className={cx(td, 'whitespace-nowrap text-subtle')}>{shortDate(x.capturedAt ?? x.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && s.total > 0 && (
            <p className="border-t border-line px-3 py-2 text-xs text-subtle">
              {s.typesCovered} of {UPLOAD_TYPES.length} data types · {s.ready} of {s.total} datasets ready
              {s.failed > 0 && <span className="text-danger"> · {s.failed} failed</span>}
              {s.needsGeoref > 0 && <> · <Link to="/georef">{s.needsGeoref} to align</Link></>}
              {s.pendingOcr > 0 && <> · {s.pendingOcr} awaiting OCR</>}
              {missing.length > 0 && <> · Missing: {missing.map((t) => SOURCE_META[t].label).join(', ')}</>}
            </p>
          )}
        </Panel>

        <Panel
          title={ward ? `Map — ward ${ward.id}` : 'Map — ward extents'}
          actions={<Link to="/map" className="inline-flex items-center gap-1 text-xs" title="Open the full map viewer with every layer"><FiMap /> Open map viewer</Link>}
        >
          <div className="relative h-[420px]">
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader /></div>}>
              <GeoMap
                layers={layers}
                fitTo={fitTo}
                fitKey={`${wardId ?? 'all'}-${layers[0].data.features.length}-${parcelCount}`}
                onFeatureClick={(layerId, f) => { if (layerId === 'wards') dispatch(setSelectedWard(String(f.properties?.ward ?? f.id))); }}
                popup={(layerId, p) => (layerId === 'records' ? propsTable('Final record', p) : null)}
                legend={wardId ? (
                  <Legend title="Final records" items={[
                    { color: RECORD_COLORS.ready, label: 'Ready (≥ 85% confidence)' },
                    { color: RECORD_COLORS.review, label: 'Needs review' },
                    { color: RECORD_COLORS.conflict, label: 'Open conflict' },
                  ]} />
                ) : <Legend items={[{ color: '#5b6573', label: 'Ward extent — click to open' }]} />}
              />
            </Suspense>
            {wardId && !parcelCount && (
              <p className="absolute inset-x-0 bottom-3 z-10 mx-auto w-fit rounded-sm border border-line bg-white px-2 py-1 text-xs text-subtle">
                No final records for this ward yet — they appear after harmonization.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="System status" actions={<Link to="/settings" className="text-xs" title="Open Settings & health">Details</Link>}>
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
        </Panel>

        <Panel title="Recent activity" actions={<Link to="/activity" className="text-xs" title="Open the full activity log">View all</Link>}>
          {wardJobs.length === 0 ? <p className="px-3 py-4 text-sm text-subtle">No processing jobs have run yet. Jobs appear here after an upload or a run.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {wardJobs.slice(0, 5).map((j) => (
                  <tr key={j.id} className="border-t border-line-light first:border-t-0">
                    <td className={cx(td, 'w-24')}><Badge tone={JOB_STATUS[j.status]}>{j.status}</Badge></td>
                    <td className={cx(td, 'truncate')}>{JOB_LABEL[j.jobType] ?? humanize(j.jobType)}</td>
                    <td className={cx(td, 'whitespace-nowrap text-subtle')}>{j.wardId ? `Ward ${j.wardId}` : 'All'}</td>
                    <td className={cx(td, 'whitespace-nowrap text-right text-subtle')}>{fmtRelative(j.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </PageMotion>
  );
}
