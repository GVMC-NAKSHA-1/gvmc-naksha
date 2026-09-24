import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Markdown from '../components/Markdown';
import { FiBarChart2, FiRefreshCw } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import MapView from '../components/MapView';
import EmptyState from '../components/EmptyState';
import { Badge, Kicker, Skeleton, cx } from '../components/ui';
import {
  fetchAllWardsStats, fetchCommissionerBrief, selectAiBrief, selectAllWardsStats, selectAllWardsStatus,
  selectBriefError, selectBriefStatus, selectCityTotals,
} from '../Redux/slices/statsSlice';
import { fetchWards, selectWardsStatus } from '../Redux/slices/wardsSlice';
import { fmtInr } from '../utils/format';

const th = 'px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle';
const td = 'px-2 py-2';

function CardTitle({ children, action }) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-line-light pb-2">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export default function CommissionerView() {
  const dispatch = useDispatch();
  const allWards = useSelector(selectAllWardsStats);
  const allStatus = useSelector(selectAllWardsStatus);
  const totals = useSelector(selectCityTotals);
  const brief = useSelector(selectAiBrief);
  const briefStatus = useSelector(selectBriefStatus);
  const briefError = useSelector(selectBriefError);
  const wardsStatus = useSelector(selectWardsStatus);

  useEffect(() => {
    if (allStatus === 'idle') dispatch(fetchAllWardsStats());
    if (briefStatus === 'idle') dispatch(fetchCommissionerBrief());
    if (wardsStatus === 'idle') dispatch(fetchWards());
  }, [allStatus, briefStatus, wardsStatus, dispatch]);

  const top10 = useMemo(
    () => [...allWards].sort((a, b) => b.unassessedCount - a.unassessedCount).slice(0, 10),
    [allWards],
  );

  const kpis = totals ? [
    { label: 'Detections', value: totals.totalDetections.toLocaleString() },
    { label: 'Pending', value: totals.pendingVerification.toLocaleString() },
    { label: 'Est. revenue', value: fmtInr(Math.round(totals.revenueEstimate)) },
  ] : null;

  return (
    <PageMotion className="flex flex-col gap-4 p-3 lg:h-[calc(100vh-92px)] lg:flex-row lg:overflow-hidden lg:p-4">
      <div className="h-[clamp(280px,45vh,420px)] shrink-0 overflow-hidden rounded-xl border border-line lg:h-auto lg:flex-1">
        <MapView choropleth allWardsData={allWards} />
      </div>

      <aside className="glass flex min-h-0 flex-col lg:flex-[0_0_clamp(380px,30vw,450px)]">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="lg:hidden">
            <Kicker>City-Wide View</Kicker>
            <h1 className="text-xl font-bold">Commissioner Overview</h1>
          </div>

          {kpis && (
            <div className="grid grid-cols-3 gap-2">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-lg border border-line bg-white px-3 py-2 shadow-sm">
                  <div className="text-base font-bold tabular-nums">{k.value}</div>
                  <div className="text-[11px] uppercase tracking-wider text-subtle">{k.label}</div>
                </div>
              ))}
            </div>
          )}

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm">
            <CardTitle>Top 10 Wards by Unassessed</CardTitle>
            <div className="overflow-x-auto">
              {allStatus === 'loading' ? (
                <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
              ) : top10.length === 0 ? (
                <EmptyState icon={FiBarChart2} message="No data. Ward stats will appear after pipeline runs." />
              ) : (
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={th}>#</th><th className={th}>Ward</th>
                      <th className={cx(th, 'text-right')}>Unassessed</th>
                      <th className={cx(th, 'text-right')}>Detections</th>
                      <th className={cx(th, 'text-right')}>Open Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top10.map((w, i) => (
                      <tr key={w.wardId} className="animate-fade-up border-t border-line-light hover:bg-hover" style={{ animationDelay: `${i * 40}ms` }}>
                        <td className={cx(td, 'text-faint tabular-nums')}>{i + 1}</td>
                        <td className={td}>{w.wardName ?? `Ward ${w.wardId}`}</td>
                        <td className={cx(td, 'text-right font-semibold tabular-nums')}>{w.unassessedCount.toLocaleString()}</td>
                        <td className={cx(td, 'text-right tabular-nums')}>{w.totalDetections.toLocaleString()}</td>
                        <td className={cx(td, 'text-right')}>
                          {w.openTickets > 0 ? <Badge tone="danger">{w.openTickets}</Badge> : <span className="text-faint">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm">
            <CardTitle
              action={(
                <button
                  type="button"
                  onClick={() => dispatch(fetchCommissionerBrief())}
                  disabled={briefStatus === 'loading'}
                  className="inline-flex size-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink disabled:opacity-50"
                  aria-label="Refresh brief"
                >
                  <FiRefreshCw className={briefStatus === 'loading' ? 'animate-spin' : ''} />
                </button>
              )}
            >
              AI Daily Brief
            </CardTitle>
            {briefStatus === 'loading' ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-[55%]" />
              </div>
            ) : briefStatus === 'failed' ? (
              <p className="text-sm italic text-subtle">{briefError || 'AI brief unavailable. Try refreshing.'}</p>
            ) : brief ? (
              <div className="markdown"><Markdown>{brief}</Markdown></div>
            ) : (
              <p className="text-sm text-subtle">AI brief will appear here once the pipeline has run.</p>
            )}
          </section>
        </div>
      </aside>
    </PageMotion>
  );
}
