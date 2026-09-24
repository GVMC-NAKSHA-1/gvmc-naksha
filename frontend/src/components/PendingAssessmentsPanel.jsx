import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiBell } from 'react-icons/fi';
import {
  clearLastSubmitted, selectAssessments, selectLastSubmittedId, selectPendingAssessmentsCount, updateAssessmentStatus,
} from '../Redux/slices/assessmentsSlice';
import { fmtInr, fmtShort } from '../utils/format';
import EmptyState from './EmptyState';
import { Badge, Button, Card, cx } from './ui';

export function PendingAssessmentsBadge({ open, onToggle }) {
  const dispatch = useDispatch();
  const count = useSelector(selectPendingAssessmentsCount);
  const lastSubmittedId = useSelector(selectLastSubmittedId);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    if (!lastSubmittedId) return undefined;
    setToast(true);
    const t = setTimeout(() => { setToast(false); dispatch(clearLastSubmitted()); }, 4000);
    return () => clearTimeout(t);
  }, [lastSubmittedId, dispatch]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={open}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
          open ? 'border-primary bg-primary-light text-primary-dark' : 'border-line bg-white text-subtle hover:border-primary hover:text-primary',
        )}
      >
        <FiBell /> Pending Assessments ({count})
      </button>
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 top-full z-20 mt-2 whitespace-nowrap rounded-md bg-success-light px-3 py-1.5 text-xs font-medium text-success-dark shadow-md"
          >
            🔔 New Assessment Submitted
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle';
const td = 'px-3 py-2';
const STATUS = { pending_review: { tone: 'warning', label: 'Pending Review' }, reviewed: { tone: 'success', label: 'Reviewed' } };

export default function PendingAssessmentsTable() {
  const dispatch = useDispatch();
  const items = useSelector(selectAssessments);

  return (
    <Card className="overflow-x-auto p-0">
      {items.length === 0 ? (
        <EmptyState icon={FiBell} message="No assessments submitted yet." />
      ) : (
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-canvas">
            <tr>
              <th className={th}>Property</th><th className={th}>Ward</th><th className={th}>Officer</th>
              <th className={th}>Submission Time</th><th className={cx(th, 'text-right')}>Estimated Tax</th>
              <th className={th}>Status</th><th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => {
              const s = STATUS[a.status] ?? STATUS.pending_review;
              return (
                <tr key={a.id} className="border-t border-line-light hover:bg-hover">
                  <td className={cx(td, 'font-mono text-xs')}>{a.propertyId}</td>
                  <td className={td}>{a.wardId ?? '—'}</td>
                  <td className={td}>{a.officerId}</td>
                  <td className={td}>{fmtShort(a.submittedAt)}</td>
                  <td className={cx(td, 'text-right tabular-nums')}>{fmtInr(a.estimatedTaxInr)}</td>
                  <td className={td}><Badge tone={s.tone}>{s.label}</Badge></td>
                  <td className={td}>
                    {a.status === 'pending_review' && (
                      <Button size="sm" variant="secondary" onClick={() => dispatch(updateAssessmentStatus({ id: a.id, status: 'reviewed' }))}>
                        Mark Reviewed
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
