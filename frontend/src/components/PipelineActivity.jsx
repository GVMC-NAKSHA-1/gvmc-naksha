import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { FiCheckCircle, FiClock, FiLoader, FiList, FiX, FiXCircle } from 'react-icons/fi';
import { fetchJobs, selectActiveJobs, selectJobs } from '../Redux/slices/jobsSlice';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { JOB_LABEL, fmtRelative, humanize } from '../utils/format';
import { cx } from './ui';

const ICON = { queued: FiClock, running: FiLoader, done: FiCheckCircle, failed: FiXCircle };
const COLOR = { queued: 'text-subtle', running: 'text-info-dark', done: 'text-success', failed: 'text-danger' };

/** Top-bar button + drawer showing the ETL / processing pipeline jobs as they run. */
export default function PipelineActivity() {
  const dispatch = useDispatch();
  const jobs = useSelector(selectJobs);
  const active = useSelector(selectActiveJobs);
  const wardId = useSelector(selectSelectedWardId);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  // Poll fast while work is in flight, slowly otherwise.
  useEffect(() => {
    const tick = () => dispatch(fetchJobs({ limit: 40 }));
    tick();
    timer.current = setInterval(tick, active.length ? 4000 : 30000);
    return () => clearInterval(timer.current);
  }, [dispatch, active.length]);

  const shown = jobs.filter((j) => !wardId || !j.wardId || j.wardId === wardId).slice(0, 30);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Background jobs"
        title={active.length ? `${active.length} background job(s) processing now — click to follow them` : 'See the processing jobs (uploads, building extraction, matching…) and whether they finished'}
        className={cx(
          'relative inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
          active.length ? 'border-info bg-info-light text-info-dark' : 'border-line text-subtle hover:bg-hover hover:text-ink',
        )}
      >
        <FiList />
        <span className="hidden sm:inline">{active.length ? `${active.length} job${active.length > 1 ? 's' : ''} running` : 'Jobs'}</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div key="bd" className="fixed inset-0 z-40 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside
              key="panel"
              role="dialog"
              aria-label="Background jobs"
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-line bg-white shadow-xl"
              initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }} transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              <header className="flex items-center gap-2 border-b border-line px-4 py-3">
                <FiList className="text-subtle" />
                <h2 className="flex-1 text-sm font-semibold">Background jobs</h2>
                <button type="button" aria-label="Close" title="Close" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-hover"><FiX /></button>
              </header>
              <p className="border-b border-line-light px-4 py-2 text-[11px] text-subtle">
                Work the system does for you after an upload or a “Run” button: processing files, building extraction, matching, building records and quality checks. Updates live.
              </p>
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {shown.length === 0 && <li className="px-4 py-8 text-center text-xs text-subtle">No jobs yet.</li>}
                {shown.map((j) => {
                  const Icon = ICON[j.status] ?? FiClock;
                  return (
                    <li key={j.id} className="flex gap-3 border-b border-line-light px-4 py-2.5">
                      <Icon className={cx('mt-0.5 shrink-0', COLOR[j.status], j.status === 'running' && 'animate-spin')} />
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="flex items-center gap-2">
                          <strong className="truncate text-ink">{JOB_LABEL[j.jobType] ?? humanize(j.jobType)}</strong>
                          {j.wardId && <span className="text-faint">ward {j.wardId}</span>}
                          <span className="ml-auto whitespace-nowrap text-faint">{fmtRelative(j.createdAt)}</span>
                        </div>
                        {j.error && <p className="mt-0.5 line-clamp-2 text-danger">{j.error}</p>}
                        {j.result && !j.error && (
                          <p className="mt-0.5 truncate text-subtle">
                            {Object.entries(j.result).filter(([, v]) => typeof v !== 'object').slice(0, 3).map(([k, v]) => `${humanize(k)}: ${v}`).join(' · ')}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Link to="/activity" onClick={() => setOpen(false)} title="Open the full history of jobs and decisions" className="border-t border-line px-4 py-3 text-center text-xs font-medium">
                Open full activity log →
              </Link>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
