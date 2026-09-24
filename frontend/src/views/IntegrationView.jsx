import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  FiAlertOctagon, FiAlertTriangle, FiCheckCircle, FiDownload, FiInfo, FiPlay, FiUpload,
} from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import WardSelector from '../components/WardSelector';
import Loader from '../components/Loader';
import { Badge, Button, Kicker, cx } from '../components/ui';
import { EXPORT_LAYERS, downloadGeoJSON, exportCsv } from '../api/exportLayer';
import { errorMessage } from '../api/client';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import {
  SOURCE_TYPES, fetchSources, resetUploadStatus, selectSourceUploadError, selectSourceUploadStatus,
  selectSources, selectSourcesStatus, uploadSource,
} from '../Redux/slices/sourcesSlice';
import {
  fetchMatches, runMatching, selectLastRunResult, selectMatches, selectMatchesStatus, selectRunError, selectRunStatus,
} from '../Redux/slices/harmonizationSlice';
import { fetchConflicts, resolveConflict, selectConflicts, selectConflictsStatus } from '../Redux/slices/conflictsSlice';
import { SOURCE_STATUS, humanize } from '../utils/format';

const panelCls = 'glass flex min-w-0 flex-col gap-3 rounded-lg! p-3';
const titleCls = 'text-sm font-bold uppercase tracking-wider text-subtle';
const th = 'px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-subtle';
const td = 'px-2 py-1.5';

const BAND = {
  auto_accept: { tone: 'success', label: 'auto-accept' },
  review: { tone: 'warning', label: 'review' },
  conflict: { tone: 'danger', label: 'conflict' },
};

const SEVERITY = {
  critical: { icon: FiAlertOctagon, bar: 'border-l-danger bg-danger-light/60', text: 'text-danger-dark', tone: 'danger' },
  high: { icon: FiAlertTriangle, bar: 'border-l-warning bg-warning-light/60', text: 'text-warning-dark', tone: 'warning' },
  medium: { icon: FiAlertTriangle, bar: 'border-l-orange bg-[#fff3e0]', text: 'text-orange-dark', tone: 'orange' },
  low: { icon: FiInfo, bar: 'border-l-info bg-info-light/60', text: 'text-info-dark', tone: 'info' },
};

const scoreColor = (s) => (s >= 90 ? '#198754' : s >= 70 ? '#ffc107' : s >= 40 ? '#fd7e14' : '#dc3545');

function TypeTag({ type }) {
  return (
    <span className="inline-block rounded bg-primary-light px-1.5 py-0.5 text-[10px] font-medium capitalize text-primary-dark">
      {humanize(type)}
    </span>
  );
}

function MatchScoreBar({ score }) {
  return (
    <div className="relative h-4 min-w-20 overflow-hidden rounded-lg bg-neutral-light" title={`${score.toFixed(1)}`}>
      <div className="h-full rounded-lg transition-[width] duration-500" style={{ width: `${Math.min(100, score)}%`, background: scoreColor(score) }} />
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-ink">{score.toFixed(1)}</span>
    </div>
  );
}

export default function IntegrationView() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const sources = useSelector(selectSources);
  const sourcesStatus = useSelector(selectSourcesStatus);
  const uploadStatus = useSelector(selectSourceUploadStatus);
  const uploadError = useSelector(selectSourceUploadError);
  const matches = useSelector(selectMatches);
  const matchesStatus = useSelector(selectMatchesStatus);
  const runStatus = useSelector(selectRunStatus);
  const runError = useSelector(selectRunError);
  const lastRun = useSelector(selectLastRunResult);
  const conflicts = useSelector(selectConflicts);
  const conflictsStatus = useSelector(selectConflictsStatus);

  const [layer, setLayer] = useState(EXPORT_LAYERS[0].value);
  const [exportMsg, setExportMsg] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [srcType, setSrcType] = useState(SOURCE_TYPES[0]);
  const [file, setFile] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [minScore, setMinScore] = useState(0);
  const fileRef = useRef(null);
  const refetchTimer = useRef(null);

  const wid = wardId ?? undefined;
  const refetchAll = () => {
    dispatch(fetchSources({ wardId: wid }));
    dispatch(fetchMatches({ wardId: wid }));
    dispatch(fetchConflicts({ wardId: wid }));
  };

  useEffect(() => {
    refetchAll();
    return () => clearTimeout(refetchTimer.current);
  }, [wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleSources = useMemo(() => (typeFilter ? sources.filter((s) => s.type === typeFilter) : sources), [sources, typeFilter]);
  const visibleMatches = useMemo(() => matches.filter((m) => m.matchScore >= minScore), [matches, minScore]);
  const unresolved = conflicts.filter((c) => c.status !== 'resolved').length;

  const doExport = async (kind) => {
    setExporting(kind);
    setExportMsg(null);
    try {
      if (kind === 'geojson') {
        const { count, truncated } = await downloadGeoJSON(layer, wid);
        setExportMsg({ ok: true, text: `Exported ${count} features${truncated ? ' (truncated — narrow by ward)' : ''}` });
      } else {
        const { count } = await exportCsv(layer, wid);
        setExportMsg({ ok: true, text: `Exported ${count} rows` });
      }
    } catch (err) {
      setExportMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setExporting(null);
    }
  };

  const doUpload = async () => {
    if (!file) return;
    const res = await dispatch(uploadSource({ file, type: srcType, wardId: wid }));
    if (res.meta.requestStatus === 'fulfilled') {
      dispatch(resetUploadStatus());
      dispatch(fetchSources({ wardId: wid }));
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doRun = async () => {
    const res = await dispatch(runMatching(wid));
    if (res.meta.requestStatus === 'fulfilled') {
      // Matching runs in the background worker — refresh now and again shortly after.
      dispatch(fetchMatches({ wardId: wid }));
      dispatch(fetchConflicts({ wardId: wid }));
      clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        dispatch(fetchMatches({ wardId: wid }));
        dispatch(fetchConflicts({ wardId: wid }));
      }, 5000);
    }
  };

  const runSummary = lastRun && (
    lastRun.matches_created != null
      ? `${lastRun.matches_created} matches, ${lastRun.conflicts_created} conflicts from ${lastRun.sources_evaluated} sources`
      : `Matching queued for ${lastRun.jobs?.length ?? 0} ward(s) — results refresh automatically.`
  );

  return (
    <PageMotion className="min-h-[calc(100vh-92px)]">
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Kicker>PS 26013 NAKSHA</Kicker>
            <h1 className="text-2xl font-bold">Multi-Source Integration</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-line bg-white px-2 py-2 text-sm focus:border-primary focus:shadow-focus focus:outline-none"
              value={layer}
              onChange={(e) => setLayer(e.target.value)}
              aria-label="Export layer"
            >
              {EXPORT_LAYERS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <Button variant="secondary" onClick={() => doExport('geojson')} disabled={!!exporting}>
              <FiDownload className="text-[13px]" /> {exporting === 'geojson' ? 'Exporting…' : 'GeoJSON'}
            </Button>
            <Button variant="secondary" onClick={() => doExport('csv')} disabled={!!exporting}>
              <FiDownload className="text-[13px]" /> {exporting === 'csv' ? 'Exporting…' : 'CSV'}
            </Button>
            <WardSelector />
          </div>
        </header>

        {exportMsg && (
          <p className={cx('mb-3 rounded-md px-3 py-2 text-xs', exportMsg.ok ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger-dark')} role="status">
            {exportMsg.text}
          </p>
        )}

        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr]">
          {/* ── Data Sources ── */}
          <section className={panelCls} aria-label="Data sources">
            <h2 className={titleCls}>Data Sources</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-1.5 text-xs capitalize focus:border-primary focus:outline-none"
                value={srcType}
                onChange={(e) => setSrcType(e.target.value)}
                aria-label="Source type"
              >
                {SOURCE_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-line bg-canvas px-2 py-1.5 text-xs hover:border-primary hover:text-primary">
                <FiUpload /> Choose file
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".geojson,.json,.pdf,.jpg,.jpeg,.png,.tiff,.tif,.csv,.shp,.gpx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Button size="sm" onClick={doUpload} disabled={!file || uploadStatus === 'loading'}>
                {uploadStatus === 'loading' ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
            {file && <p className="truncate text-xs text-subtle">{file.name}</p>}
            {uploadStatus === 'failed' && <p className="text-xs text-danger">{uploadError}</p>}

            <div className="flex flex-wrap gap-1.5">
              {[null, ...SOURCE_TYPES.slice(0, 6)].map((t) => {
                const active = typeFilter === t;
                return (
                  <button
                    key={t ?? 'all'}
                    type="button"
                    onClick={() => setTypeFilter(active && t ? null : t)}
                    className={cx(
                      'rounded-full border px-2.5 py-0.5 text-[11px] capitalize transition-colors',
                      active ? 'border-primary bg-primary-light font-semibold text-primary' : 'border-line bg-canvas text-subtle hover:text-ink',
                    )}
                  >
                    {t ? humanize(t) : 'All'}
                  </button>
                );
              })}
            </div>

            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">
              {sourcesStatus === 'loading' ? (
                <div className="py-4 text-center"><Loader /></div>
              ) : visibleSources.length === 0 ? (
                <p className="py-4 text-center text-xs text-subtle">No sources found</p>
              ) : (
                visibleSources.map((s) => (
                  <div key={s.id} className="rounded-md border border-line bg-canvas px-2.5 py-2">
                    <div className="truncate text-xs font-semibold" title={s.filename ?? s.s3Key ?? s.id}>
                      {s.filename ?? s.s3Key?.split('/').pop() ?? s.id.slice(0, 8)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <TypeTag type={s.type} />
                      <Badge tone={SOURCE_STATUS[s.status] ?? 'secondary'}>{humanize(s.status)}</Badge>
                      {s.crs && <span className="text-[10px] text-faint">{s.crs}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── Spatial Matches ── */}
          <section className={panelCls} aria-label="Spatial matches">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={titleCls}>Spatial Matches</h2>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-subtle">
                Min score
                <input
                  type="range" min="0" max="100" step="5" value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-[60px] accent-primary"
                  aria-label="Minimum match score"
                />
                <span className="w-6 tabular-nums text-ink">{minScore}</span>
              </label>
              <Button size="sm" onClick={doRun} disabled={runStatus === 'loading'}>
                <FiPlay /> {runStatus === 'loading' ? 'Running…' : 'Run Matching'}
              </Button>
            </div>
            {runSummary && runStatus === 'succeeded' && (
              <p className="rounded-md bg-primary-light px-3 py-1.5 text-xs text-primary-dark">{runSummary}</p>
            )}
            {runStatus === 'failed' && <p className="text-xs text-danger">{runError}</p>}

            <div className="overflow-x-auto">
              {matchesStatus === 'loading' ? (
                <div className="py-4 text-center"><Loader /></div>
              ) : visibleMatches.length === 0 ? (
                <p className="py-4 text-center text-xs text-subtle">No matches</p>
              ) : (
                <table className="w-full min-w-[520px] border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className={th}>Source A</th><th className={th}>Source B</th>
                      <th className={cx(th, 'text-right')}>IoU</th><th className={cx(th, 'text-right')}>Dist (m)</th>
                      <th className={th}>Score</th><th className={th}>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMatches.map((m) => {
                      const band = BAND[m.band] ?? BAND.review;
                      return (
                        <tr key={m.id} className="border-t border-line-light hover:bg-white/60">
                          <td className={td}><TypeTag type={m.sourceAType} /></td>
                          <td className={td}><TypeTag type={m.sourceBType} /></td>
                          <td className={cx(td, 'text-right tabular-nums')}>{m.geometryIou?.toFixed(2) ?? '—'}</td>
                          <td className={cx(td, 'text-right tabular-nums')}>{m.centroidDistanceM?.toFixed(1) ?? '—'}</td>
                          <td className={td}><MatchScoreBar score={m.matchScore} /></td>
                          <td className={td}>
                            <span className="mr-1 tabular-nums">{m.confidenceScore.toFixed(0)}</span>
                            <Badge tone={band.tone}>{band.label}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* ── Conflicts ── */}
          <section className={panelCls} aria-label="Conflicts">
            <h2 className={cx(titleCls, 'flex items-center gap-2')}>
              Conflicts
              {unresolved > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                  {unresolved}
                </span>
              )}
            </h2>
            <div className="flex max-h-[500px] flex-col gap-2 overflow-y-auto">
              {conflictsStatus === 'loading' ? (
                <div className="py-4 text-center"><Loader /></div>
              ) : conflicts.length === 0 ? (
                <p className="py-4 text-center text-xs text-subtle">No conflicts</p>
              ) : (
                conflicts.map((c) => {
                  const sev = SEVERITY[c.severity] ?? SEVERITY.low;
                  const Icon = sev.icon;
                  const resolved = c.status === 'resolved';
                  return (
                    <article key={c.id} className={cx('rounded-md border-l-[3px] px-3 py-2.5', sev.bar)}>
                      <header className="flex items-center gap-1.5">
                        <Icon className={sev.text} />
                        <span className="text-xs font-semibold capitalize">{humanize(c.conflictType)}</span>
                        <Badge tone={sev.tone} className="ml-auto">{c.severity}</Badge>
                      </header>
                      {c.suggestedResolution && <p className="mt-1 text-[11px] text-subtle">{c.suggestedResolution}</p>}
                      <footer className="mt-2 flex items-center gap-2">
                        <Badge tone={resolved ? 'success' : 'secondary'}>{humanize(c.status)}</Badge>
                        {!resolved && (
                          <button
                            type="button"
                            onClick={() => dispatch(resolveConflict({ id: c.id, status: 'resolved', resolvedBy: 'officer' }))}
                            className="ml-auto inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-0.5 text-[11px] hover:border-success hover:text-success"
                          >
                            <FiCheckCircle /> Mark resolved
                          </button>
                        )}
                      </footer>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </PageMotion>
  );
}
