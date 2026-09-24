import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiFileText } from 'react-icons/fi';
import { fetchTickets, selectTickets, selectTicketsError, selectTicketsStatus } from '../Redux/slices/ticketsSlice';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { TICKET_STATUS, fmtInr } from '../utils/format';
import EmptyState from './EmptyState';
import TicketReviewModal from './TicketReviewModal';
import { Badge, Button, Card, Skeleton, cx } from './ui';

const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle';
const td = 'px-3 py-2 align-middle';
const truncate = (s, n = 60) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '—');

export default function TicketsList() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const tickets = useSelector(selectTickets);
  const status = useSelector(selectTicketsStatus);
  const error = useSelector(selectTicketsError);
  const [filter, setFilter] = useState('');
  const [reviewing, setReviewing] = useState(null);

  useEffect(() => {
    dispatch(fetchTickets({ wardId: wardId ?? undefined, status: filter || undefined }));
  }, [wardId, filter, dispatch]);

  const openCount = tickets.filter((t) => t.status !== 'resolved').length;
  const resolvedCount = tickets.filter((t) => t.status === 'resolved').length;

  return (
    <Card className="flex flex-col gap-3 p-0">
      <header className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <h2 className="text-base font-semibold">Field Tickets</h2>
        <Badge tone="danger">{openCount} open</Badge>
        <Badge tone="success">{resolvedCount} resolved</Badge>
        <select
          className="ml-auto rounded-md border border-line bg-canvas px-2 py-1.5 text-xs focus:border-primary focus:shadow-focus focus:outline-none"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter tickets by status"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="under_review">Under Review</option>
          <option value="resolved">Resolved</option>
        </select>
      </header>

      {status === 'failed' && <p className="px-4 text-xs text-danger">{error}</p>}

      <div className="overflow-x-auto pb-2">
        {status === 'loading' ? (
          <div className="flex flex-col gap-2 px-4 pb-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState icon={FiFileText} message="No tickets found for this ward." />
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="bg-canvas">
              <tr>
                <th className={th}>Ward</th>
                <th className={th}>House No.</th>
                <th className={th}>Description</th>
                <th className={cx(th, 'text-right')}>Tax Pending</th>
                <th className={th}>Status</th>
                <th className={th}>Date</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => {
                const s = TICKET_STATUS[t.status] ?? TICKET_STATUS.open;
                return (
                  <tr key={t.id} className="animate-fade-up border-t border-line-light hover:bg-hover" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                    <td className={td}>{t.wardName ?? `Ward ${t.wardId}`}</td>
                    <td className={cx(td, 'font-mono text-xs')}>{t.houseNumber}</td>
                    <td className={cx(td, 'text-subtle')} title={t.description}>{truncate(t.description)}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{fmtInr(t.taxPending)}</td>
                    <td className={td}><Badge tone={s.tone}>{s.label}</Badge></td>
                    <td className={cx(td, 'whitespace-nowrap text-subtle')}>{t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                    <td className={td}><Button variant="secondary" size="sm" onClick={() => setReviewing(t)}>Review</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {reviewing && <TicketReviewModal ticket={reviewing} onClose={() => setReviewing(null)} />}
    </Card>
  );
}
