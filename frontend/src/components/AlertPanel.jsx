import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiBellOff, FiPlus } from 'react-icons/fi';
import {
  fetchAlerts, generateWardAlert, resetGenerateStatus, selectAlerts, selectAlertsStatus,
  selectGenerateError, selectGenerateStatus, selectLastGenerated,
} from '../Redux/slices/alertsSlice';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { ALERT_SEVERITY, fmtRelative } from '../utils/format';
import EmptyState from './EmptyState';
import { Badge, Card, SectionTitle, Skeleton, TONE_BG, TONE_TEXT, cx } from './ui';

export default function AlertPanel() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const alerts = useSelector(selectAlerts);
  const status = useSelector(selectAlertsStatus);
  const genStatus = useSelector(selectGenerateStatus);
  const genError = useSelector(selectGenerateError);
  const lastGenerated = useSelector(selectLastGenerated);

  useEffect(() => {
    if (!wardId) return;
    dispatch(resetGenerateStatus());
    dispatch(fetchAlerts(wardId));
  }, [wardId, dispatch]);

  if (!wardId) return null;
  const generating = genStatus === 'loading';
  const genTone = lastGenerated ? ALERT_SEVERITY[lastGenerated.severity] ?? 'info' : 'danger';

  return (
    <Card className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <SectionTitle>AI Alerts</SectionTitle>
        <span className="rounded-full bg-primary px-2 text-xs font-semibold text-white tabular-nums">{alerts.length}</span>
        <button
          type="button"
          onClick={() => dispatch(generateWardAlert(wardId))}
          disabled={generating}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary-light disabled:opacity-60"
        >
          <FiPlus /> {generating ? 'Generating…' : 'Generate'}
        </button>
      </header>

      <AnimatePresence>
        {(genStatus === 'succeeded' || genStatus === 'failed') && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className={cx('rounded-md px-3 py-2 text-xs', TONE_BG[genTone], TONE_TEXT[genTone])}
          >
            {genStatus === 'succeeded'
              ? <><strong className="uppercase">{lastGenerated?.severity}</strong> — {lastGenerated?.text}</>
              : genError}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex max-h-[280px] flex-col gap-2 overflow-y-auto">
        {status === 'loading' ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
        ) : alerts.length === 0 ? (
          <EmptyState icon={FiBellOff} message="No alerts for this ward." />
        ) : (
          alerts.map((a, i) => (
            <article
              key={a.id}
              className="animate-fade-up rounded-lg border border-line-light bg-canvas p-3"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="mb-1 flex items-center gap-2">
                <Badge tone={ALERT_SEVERITY[a.severity] ?? 'info'}>{a.severity}</Badge>
                <span className="text-xs text-faint">{fmtRelative(a.createdAt)}</span>
              </div>
              <p className="text-sm text-ink">{a.text}</p>
            </article>
          ))
        )}
      </div>
    </Card>
  );
}
