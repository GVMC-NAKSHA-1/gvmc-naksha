import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiMapPin } from 'react-icons/fi';
import {
  fetchPropertyById, fetchPropertyExplanation, selectProperties, selectPropertiesStatus,
  selectSelectedProperty, setSelectedProperty,
} from '../Redux/slices/propertiesSlice';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { DETECTION_TYPE, PROPERTY_STATUS } from '../utils/format';
import EmptyState from './EmptyState';
import { Badge, Skeleton, cx } from './ui';

const selectCls = 'rounded-md border border-line bg-canvas px-2 py-1.5 text-xs text-ink focus:border-primary focus:shadow-focus focus:outline-none';
const th = 'sticky top-0 z-10 bg-canvas px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle';
const td = 'px-3 py-2 align-middle';

export default function PropertyList({ className, height, embedded = false }) {
  const dispatch = useDispatch();
  const items = useSelector(selectProperties);
  const status = useSelector(selectPropertiesStatus);
  const selected = useSelector(selectSelectedProperty);
  const wardId = useSelector(selectSelectedWardId);
  const [type, setType] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const rows = useMemo(
    () => items.filter((p) => (!type || p.detectionType === type) && (!statusFilter || p.status === statusFilter)),
    [items, type, statusFilter],
  );

  const select = (id) => {
    dispatch(setSelectedProperty(id));
    dispatch(fetchPropertyById(id));
    dispatch(fetchPropertyExplanation(id));
  };

  return (
    <div
      className={cx('flex min-h-0 flex-col', !embedded && 'rounded-xl border border-line bg-white shadow-sm', className)}
      style={height ? { height } : undefined}
    >
      <div className={cx('flex flex-wrap items-center gap-2', embedded ? 'pb-2' : 'border-b border-line-light p-3')}>
        <select className={selectCls} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="">All Types</option>
          <option value="new_build">New Build</option>
          <option value="change_of_use">Change of Use</option>
        </select>
        <select className={selectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All Statuses</option>
          {Object.entries(PROPERTY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="ml-auto text-xs tabular-nums text-subtle">{rows.length} properties</span>
      </div>

      <div className={cx('min-h-0 flex-1 overflow-auto', embedded && 'rounded-lg border border-line-light bg-white')}>
        {status === 'loading' ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={FiMapPin} message={wardId ? 'No matching properties.' : 'Select a ward to load properties.'} />
        ) : (
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>ID</th>
                <th className={th}>Type</th>
                <th className={cx(th, 'text-right')}>Area (m²)</th>
                <th className={cx(th, 'text-right')}>Conf.</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const isSel = selected?.id === p.id;
                const t = DETECTION_TYPE[p.detectionType] ?? DETECTION_TYPE.change_of_use;
                const s = PROPERTY_STATUS[p.status] ?? PROPERTY_STATUS.pending;
                return (
                  <tr
                    key={p.id}
                    onClick={() => select(p.id)}
                    className={cx(
                      'animate-fade-up cursor-pointer border-t border-line-light transition-colors',
                      isSel ? 'bg-primary-light shadow-[inset_3px_0_0_var(--color-primary)]' : 'hover:bg-hover',
                    )}
                    style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                    aria-selected={isSel}
                  >
                    <td className={cx(td, 'font-mono text-xs text-subtle')} title={p.id}>{p.id.slice(0, 8)}…</td>
                    <td className={td}><Badge tone={t.tone}>{t.label}</Badge></td>
                    <td className={cx(td, 'text-right tabular-nums')}>{p.areaSqm != null ? Math.round(p.areaSqm).toLocaleString() : '—'}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{Math.round(p.confidence * 100)}%</td>
                    <td className={td}><Badge tone={s.tone}>{s.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
