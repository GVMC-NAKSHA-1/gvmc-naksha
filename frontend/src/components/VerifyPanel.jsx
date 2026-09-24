import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiLoader } from 'react-icons/fi';
import {
  resetVerifyStatus, selectSelectedProperty, selectVerifyError, selectVerifyStatus, verifyProperty,
} from '../Redux/slices/propertiesSlice';
import { PROPERTY_STATUS } from '../utils/format';
import { Badge, SectionTitle, TONE_BG, TONE_TEXT, cx } from './ui';

const ACTIONS = ['verified', 'underassessed', 'false_positive', 'already_assessed'];

export default function VerifyPanel() {
  const dispatch = useDispatch();
  const p = useSelector(selectSelectedProperty);
  const status = useSelector(selectVerifyStatus);
  const error = useSelector(selectVerifyError);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (status !== 'succeeded') return undefined;
    const t = setTimeout(() => dispatch(resetVerifyStatus()), 3000);
    return () => clearTimeout(t);
  }, [status, dispatch]);

  if (!p) return null;
  const current = PROPERTY_STATUS[p.status] ?? PROPERTY_STATUS.pending;
  const busy = status === 'loading';

  const verify = (s) => {
    setPending(s);
    dispatch(verifyProperty({ id: p.id, status: s, updatedBy: 'officer' }));
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3 shadow-sm">
      <header className="flex items-center justify-between">
        <SectionTitle>Verification</SectionTitle>
        <Badge tone={current.tone}>{current.label}</Badge>
      </header>
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map((s) => {
          const meta = PROPERTY_STATUS[s];
          const isCurrent = p.status === s;
          return (
            <button
              key={s}
              type="button"
              disabled={isCurrent || busy}
              onClick={() => verify(s)}
              className={cx(
                'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition hover:brightness-95 disabled:opacity-70',
                TONE_BG[meta.tone], TONE_TEXT[meta.tone],
                isCurrent && 'shadow-[0_0_0_2px_currentColor]',
              )}
            >
              {busy && pending === s && <FiLoader className="animate-spin" />}
              {meta.label}
            </button>
          );
        })}
      </div>
      <AnimatePresence>
        {(status === 'succeeded' || status === 'failed') && (
          <motion.p
            key={status}
            initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cx('rounded-md px-3 py-1.5 text-xs', status === 'succeeded' ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger-dark')}
          >
            {status === 'succeeded' ? 'Status updated successfully.' : error}
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}
