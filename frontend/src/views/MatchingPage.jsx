import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiGitMerge, FiInfo, FiPlay, FiX } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import Legend from '../components/MapLegend';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import ConfidenceBreakdown from '../components/ConfidenceBreakdown';
import {
  Badge, Button, Card, Notice, PageHeader, SectionTitle, Skeleton, StatCard, cx, selectCls, td, th,
} from '../components/ui';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import {
  clearMatchDetail, fetchMatchDetail, fetchMatches, runMatching, selectLastRunResult, selectMatchDetail,
  selectMatchDetailStatus, selectMatches, selectMatchesStatus, selectRunError, selectRunStatus,
} from '../Redux/slices/harmonizationSlice';
import { BAND, SOURCE_META, fmtNum, humanize, scoreColor, sourceLabel } from '../utils/format';

function ScoreBar({ score }) {
  return (
    <div className="relative h-4 min-w-24 overflow-hidden rounded-full bg-neutral-light" title={score.toFixed(1)}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, score)}%`, background: scoreColor(score) }} />
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-ink">{score.toFixed(1)}</span>
    </div>
  );
}

const A_COLOR = '#0d6efd';
const B_COLOR = '#f39c12';

function MatchDetail({ id, onClose }) {
  const dispatch = useDispatch();
  const d = useSelector(selectMatchDetail);
  const status = useSelector(selectMatchDetailStatus);

  useEffect(() => {
    dispatch(fetchMatchDetail(id));
    return () => { dispatch(clearMatchDetail()); };
  }, [id, dispatch]);

  const layers = useMemo(() => {
    if (!d || d.id !== id) return [];
    const out = [];
    if (d.featureAGeom) out.push({ id: 'a', data: featureCollection([{ type: 'Feature', geometry: d.featureAGeom, properties: d.featureAProps }]), color: A_COLOR, fillOpacity: 0.25, lineWidth: 2.5, circleRadius: 7 });
    if (d.featureBGeom) out.push({ id: 'b', data: featureCollection([{ type: 'Feature', geometry: d.featureBGeom, properties: d.featureBProps }]), color: B_COLOR, fillOpacity: 0.25, lineWidth: 2.5, dashed: true, circleRadius: 7 });
    return out;
  }, [d, id]);

  const fields = useMemo(() => {
    if (!d) return [];
    const keys = [...new Set([...Object.keys(d.featureAProps), ...Object.keys(d.featureBProps)])].filter((k) => !k.startsWith('_'));
    return keys.map((k) => {
      const a = d.featureAProps[k]; const b = d.featureBProps[k];
      const both = a != null && b != null;
      return { k, a, b, same: both && String(a).trim().toLowerCase() === String(b).trim().toLowerCase(), both };
    });
  }, [d]);

  return (
    <motion.aside
      initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
      className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-sm"
      aria-label="Match detail"
    >
      <header className="flex items-center gap-2">
        <h2 className="flex-1 text-base font-semibold">Match comparison</h2>
        <button type="button" aria-label="Close" title="Close" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover"><FiX /></button>
      </header>
      {status === 'loading' || !d || d.id !== id ? (
        <div className="flex justify-center py-10"><Loader /></div>
      ) : (
        <>
          <div className="h-60 overflow-hidden rounded-lg border border-line-light">
            <GeoMap
              layers={layers}
              fitTo={featureCollection(layers.flatMap((l) => l.data.features))}
              fitKey={id}
              legend={<Legend items={[
                { color: A_COLOR, label: `A · ${sourceLabel(d.sourceAType)}` },
                { color: B_COLOR, label: `B · ${sourceLabel(d.sourceBType)}` },
              ]} />}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md bg-canvas p-2"><div className="text-subtle">IoU</div><strong className="text-base tabular-nums">{d.geometryIou?.toFixed(2) ?? '—'}</strong></div>
            <div className="rounded-md bg-canvas p-2"><div className="text-subtle">Distance</div><strong className="text-base tabular-nums">{d.centroidDistanceM != null ? `${d.centroidDistanceM.toFixed(1)} m` : '—'}</strong></div>
            <div className="rounded-md bg-canvas p-2"><div className="text-subtle">Band</div><Badge tone={BAND[d.band].tone}>{BAND[d.band].label}</Badge></div>
          </div>
          <div>
            <SectionTitle className="mb-2">Confidence scoring</SectionTitle>
            <ConfidenceBreakdown breakdown={d.confidenceBreakdown} score={d.confidenceScore} />
          </div>
          <div>
            <SectionTitle className="mb-2">Attribute comparison</SectionTitle>
            {fields.length === 0 ? <p className="text-xs text-subtle">No attributes on either feature.</p> : (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-subtle"><th className="py-1">Field</th><th className="py-1" style={{ color: A_COLOR }}>A</th><th className="py-1" style={{ color: B_COLOR }}>B</th></tr></thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.k} className={cx('border-t border-line-light', f.both && !f.same && 'bg-danger-light/50')}>
                      <td className="py-1 pr-2 text-subtle">{humanize(f.k)}</td>
                      <td className="py-1 pr-2 font-medium">{f.a != null ? String(f.a) : '—'}</td>
                      <td className="py-1 font-medium">{f.b != null ? String(f.b) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </motion.aside>
  );
}

export default function MatchingPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const matches = useSelector(selectMatches);
  const status = useSelector(selectMatchesStatus);
  const runStatus = useSelector(selectRunStatus);
  const runError = useSelector(selectRunError);
  const lastRun = useSelector(selectLastRunResult);
  const [minScore, setMinScore] = useState(0);
  const [band, setBand] = useState('');
  const [pair, setPair] = useState('');
  const [selected, setSelected] = useState(null);
  const timer = useRef(null);
  const detailRef = useRef(null);

  const load = () => dispatch(fetchMatches({ wardId: wardId ?? undefined }));
  useEffect(() => { load(); setSelected(null); return () => clearTimeout(timer.current); }, [wardId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return undefined;
    const t = setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
    return () => clearTimeout(t);
  }, [selected]);

  const pairKey = (m) => [m.sourceAType, m.sourceBType].sort().join('|');
  const pairs = useMemo(() => [...new Set(matches.map(pairKey))].sort(), [matches]);
  const rows = useMemo(() => matches.filter((m) => m.matchScore >= minScore && (!band || m.band === band) && (!pair || pairKey(m) === pair)), [matches, minScore, band, pair]);

  const stats = useMemo(() => {
    const ious = matches.filter((m) => m.geometryIou != null).map((m) => m.geometryIou);
    const dists = matches.filter((m) => m.centroidDistanceM != null).map((m) => m.centroidDistanceM);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      auto: matches.filter((m) => m.band === 'auto_accept').length,
      avgIou: mean(ious),
      avgDist: mean(dists),
      avgConf: mean(matches.map((m) => m.confidenceScore)),
    };
  }, [matches]);

  const run = async () => {
    const res = await dispatch(runMatching(wardId ?? undefined));
    if (res.meta.requestStatus === 'fulfilled') {
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 5000);
    }
  };

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        title="Match parcels"
        description="Features from different sources are paired by geometry: candidate pairs within 50 m (spatial index), polygon overlap (IoU) or point-to-centroid distance, then scored with a weighted confidence model."
        actions={<Button onClick={run} disabled={runStatus === 'loading'} title="Pair up parcels from different sources and score how well they match"><FiPlay /> {runStatus === 'loading' ? 'Queuing…' : `Run matching${wardId ? '' : ' (all wards)'}`}</Button>}
      />
      {runStatus === 'succeeded' && (
        <div className="mb-4"><Notice tone="info">
          {lastRun?.matches_created != null
            ? `${lastRun.matches_created} matches, ${lastRun.conflicts_created} conflicts from ${lastRun.sources_evaluated} sources.`
            : `Matching queued for ${lastRun?.jobs?.length ?? 1} ward(s). Results refresh automatically.`}
        </Notice></div>
      )}
      {runStatus === 'failed' && <div className="mb-4"><Notice tone="danger">{runError}</Notice></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FiGitMerge} label="Matched pairs" value={fmtNum(matches.length)} />
        <StatCard icon={FiGitMerge} accent="#198754" label="Auto-accepted" value={matches.length ? `${Math.round((stats.auto / matches.length) * 100)}%` : '—'} hint="no manual review needed" />
        <StatCard icon={FiGitMerge} accent="#6f42c1" label="Mean IoU" value={stats.avgIou != null ? stats.avgIou.toFixed(2) : '—'} hint="polygon ↔ polygon" />
        <StatCard icon={FiGitMerge} accent="#fd7e14" label="Mean offset" value={stats.avgDist != null ? `${stats.avgDist.toFixed(1)} m` : '—'} hint="point ↔ centroid" />
      </div>

      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="min-w-0 p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-light p-3">
            <select className={selectCls} value={pair} onChange={(e) => setPair(e.target.value)} aria-label="Source pair">
              <option value="">All source pairs</option>
              {pairs.map((p) => <option key={p} value={p}>{p.split('|').map(sourceLabel).join(' ↔ ')}</option>)}
            </select>
            <div className="flex gap-1">
              {['', 'auto_accept', 'review', 'conflict'].map((b) => (
                <button key={b || 'all'} type="button" onClick={() => setBand(b)}
                  className={cx('rounded-full border px-2.5 py-1 text-xs', band === b ? 'border-primary bg-primary-light font-semibold text-primary' : 'border-line text-subtle hover:text-ink')}>
                  {b ? BAND[b].label : 'All'}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-2 text-xs text-subtle">
              Min score
              <input type="range" min="0" max="100" step="5" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="w-24 accent-primary" aria-label="Minimum match score" />
              <span className="w-6 tabular-nums text-ink">{minScore}</span>
            </label>
          </div>
          <div className="max-h-[65vh] overflow-auto">
            {status === 'loading' && !matches.length ? (
              <div className="flex flex-col gap-2 p-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : rows.length === 0 ? (
              <EmptyState icon={FiGitMerge} message={matches.length ? 'No matches for these filters.' : 'No matches yet — upload at least two sources for a ward and run matching.'} />
            ) : (
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>Source A</th><th className={th}>Source B</th>
                    <th className={cx(th, 'text-right')}>IoU</th><th className={cx(th, 'whitespace-nowrap text-right')}>Dist (m)</th>
                    <th className={th}>Match score</th><th className={cx(th, 'text-right')}>Confidence</th><th className={th}>Band</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} onClick={() => setSelected(m.id)} aria-selected={selected === m.id}
                      className={cx('cursor-pointer border-t border-line-light', selected === m.id ? 'bg-primary-light' : 'hover:bg-hover')}>
                      <td className={td}><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="size-2.5 rounded-sm" style={{ background: SOURCE_META[m.sourceAType]?.color }} />{sourceLabel(m.sourceAType)}</span></td>
                      <td className={td}><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="size-2.5 rounded-sm" style={{ background: SOURCE_META[m.sourceBType]?.color }} />{sourceLabel(m.sourceBType)}</span></td>
                      <td className={cx(td, 'text-right tabular-nums')}>{m.geometryIou?.toFixed(2) ?? '—'}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{m.centroidDistanceM?.toFixed(1) ?? '—'}</td>
                      <td className={td}><ScoreBar score={m.matchScore} /></td>
                      <td className={cx(td, 'text-right font-semibold tabular-nums')}>{m.confidenceScore}</td>
                      <td className={td}><Badge tone={BAND[m.band].tone}>{BAND[m.band].label}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <div ref={detailRef} className="min-w-0">
        <AnimatePresence mode="wait">
          {selected ? <MatchDetail key={selected} id={selected} onClose={() => setSelected(null)} /> : (
            <motion.div key="help" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card>
                <SectionTitle className="mb-2 flex items-center gap-1.5"><FiInfo /> How matching works</SectionTitle>
                <ol className="list-decimal space-y-1.5 pl-4 text-xs text-subtle">
                  <li>Candidate pairs: features of <em>different</em> source types within 50 m (GiST index prune).</li>
                  <li>Polygon pairs → Intersection-over-Union; point pairs → distance to centroid (25 m = 0).</li>
                  <li>Kept when IoU ≥ 0.30 or distance ≤ 25 m.</li>
                  <li>Confidence = 0.4 geometric + 0.3 attribute + 0.2 source reliability + 0.1 recency.</li>
                  <li>Bands by match score: ≥ 85 auto-accept, ≥ 60 review, otherwise conflict.</li>
                </ol>
                <p className="mt-3 text-xs text-subtle">Select a row to compare both features on the map and field by field.</p>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>
    </PageMotion>
  );
}
