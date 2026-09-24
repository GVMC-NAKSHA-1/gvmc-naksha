import { useSelector } from 'react-redux';
import { selectStatsStatus, selectWardStats } from '../Redux/slices/statsSlice';
import { Skeleton } from './ui';

const ITEMS = [
  { key: 'totalDetections', label: 'Total Detections', accent: '#0d6efd' },
  { key: 'newBuilds', label: 'New Builds', accent: '#dc3545' },
  { key: 'changeOfUse', label: 'Change of Use', accent: '#ffc107' },
  { key: 'pendingVerification', label: 'Pending Verification', accent: '#0dcaf0' },
];

const Dot = ({ color }) => <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: color }} />;

export default function StatsBar({ variant = 'card' }) {
  const stats = useSelector(selectWardStats);
  const loading = useSelector(selectStatsStatus) === 'loading';

  if (variant === 'badge') {
    return (
      <div className="flex flex-wrap gap-2">
        {ITEMS.map((it, i) => (
          <span
            key={it.key}
            className="inline-flex animate-fade-up items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-xs text-subtle"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <Dot color={it.accent} />
            {it.label}
            <span className="font-bold tabular-nums text-ink">
              {loading ? <Skeleton className="h-3 w-5 align-middle" /> : (stats?.[it.key] ?? '—')}
            </span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
      {ITEMS.map((it, i) => (
        <div
          key={it.key}
          className="animate-fade-up rounded-lg border border-line bg-white p-4 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-(--accent)/45 hover:shadow-md"
          style={{ animationDelay: `${i * 50}ms`, '--accent': it.accent }}
        >
          <div className="min-h-[1.3em] text-2xl font-bold tabular-nums text-ink">
            {loading ? <Skeleton className="h-6 w-12" /> : (stats?.[it.key]?.toLocaleString() ?? '—')}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-subtle">
            <Dot color={it.accent} />{it.label}
          </div>
        </div>
      ))}
    </div>
  );
}
