import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiX } from 'react-icons/fi';
import {
  fetchTicketById, resetReviewStatus, reviewTicket, selectReviewError, selectReviewStatus, selectTickets,
} from '../Redux/slices/ticketsSlice';
import { TICKET_STATUS, fmtInr } from '../utils/format';
import { Badge, Button, TONE_BG, TONE_TEXT, cx, inputCls, labelCls } from './ui';

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export default function TicketReviewModal({ ticket: initial, onClose }) {
  const dispatch = useDispatch();
  const ticket = useSelector(selectTickets).find((t) => t.id === initial.id) ?? initial;
  const reviewStatus = useSelector(selectReviewStatus);
  const reviewError = useSelector(selectReviewError);
  const [status, setStatus] = useState(initial.status === 'resolved' ? 'resolved' : 'under_review');
  const [notes, setNotes] = useState(initial.supervisorNotes ?? '');

  useEffect(() => {
    dispatch(fetchTicketById(initial.id)); // pulls a presigned photo URL
    return () => { dispatch(resetReviewStatus()); };
  }, [initial.id, dispatch]);

  useEffect(() => {
    if (reviewStatus !== 'succeeded') return undefined;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [reviewStatus, onClose]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = TICKET_STATUS[ticket.status] ?? TICKET_STATUS.open;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <motion.div
        role="dialog" aria-modal="true" aria-label="Review ticket"
        initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}
        className="glass flex max-h-[90vh] w-full max-w-[480px] flex-col gap-4 overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Review Ticket</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover"><FiX /></button>
        </header>

        <div className="rounded-lg bg-canvas px-3 py-2">
          <Row label="Ward">{ticket.wardName ?? `Ward ${ticket.wardId}`}</Row>
          <Row label="House No.">{ticket.houseNumber}</Row>
          <Row label="Status"><Badge tone={s.tone}>{s.label}</Badge></Row>
          <Row label="Tax Pending">{fmtInr(ticket.taxPending)}</Row>
          <Row label="Raised on">{ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('en-IN') : '—'}</Row>
          <Row label="Description"><span className="whitespace-pre-wrap">{ticket.description}</span></Row>
          {ticket.photoUrl && (
            <Row label="Photograph">
              <img src={ticket.photoUrl} alt="Field photograph" className="max-h-[200px] rounded-md object-contain" />
            </Row>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className={labelCls}>Update Status</span>
          <div className="grid grid-cols-2 gap-2">
            {['under_review', 'resolved'].map((k) => {
              const meta = TICKET_STATUS[k];
              const active = status === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatus(k)}
                  className={cx(
                    'rounded-md border px-3 py-2 text-sm font-semibold transition',
                    active ? cx(TONE_BG[meta.tone], TONE_TEXT[meta.tone], 'border-current') : 'border-line bg-white text-subtle hover:bg-hover',
                  )}
                  aria-pressed={active}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className={labelCls}>Supervisor Notes</span>
          <textarea className={inputCls} rows={3} placeholder="Add review notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <AnimatePresence>
          {(reviewStatus === 'succeeded' || reviewStatus === 'failed') && (
            <motion.p initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className={cx('rounded-md px-3 py-1.5 text-xs', reviewStatus === 'succeeded' ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger-dark')}>
              {reviewStatus === 'succeeded' ? 'Review saved.' : reviewError}
            </motion.p>
          )}
        </AnimatePresence>

        <Button
          onClick={() => dispatch(reviewTicket({ ticketId: ticket.id, status, supervisorNotes: notes }))}
          disabled={reviewStatus === 'loading'}
          className="w-full"
        >
          {reviewStatus === 'loading' ? 'Saving…' : 'Save Review'}
        </Button>
      </motion.div>
    </div>
  );
}
