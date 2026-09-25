import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiList, FiRefreshCw } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import EmptyState from '../components/EmptyState';
import { Badge, Button, Card, PageHeader, cx, selectCls, td, th } from '../components/ui';
import { fetchAudit, fetchJobs, selectAudit, selectJobs } from '../Redux/slices/jobsSlice';
import { JOB_LABEL, JOB_STATUS, fmtDateTime, humanize } from '../utils/format';

const duration = (a, b) => {
  if (!a || !b) return '—';
  const s = (new Date(b) - new Date(a)) / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${(s / 60).toFixed(1)} min`;
};

export default function ActivityPage() {
  const dispatch = useDispatch();
  const jobs = useSelector(selectJobs);
  const audit = useSelector(selectAudit);
  const [tab, setTab] = useState('jobs');
  const [status, setStatus] = useState('');

  const load = () => { dispatch(fetchJobs({ limit: 200, status: status || undefined })); dispatch(fetchAudit({ limit: 200 })); };
  useEffect(load, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        step="Admin · Governance"
        title="Activity log"
        description="Every automated pipeline job and every human decision (conflict resolutions, topology fixes, verifications, geo-referencing) is recorded for traceable, standardised land governance."
        actions={<Button variant="secondary" onClick={load}><FiRefreshCw /> Refresh</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[['jobs', 'Pipeline jobs'], ['audit', 'Audit trail']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cx('rounded-full border px-3 py-1.5 text-sm', tab === k ? 'border-ink bg-ink text-white' : 'border-line text-subtle')}>{l}</button>
        ))}
        {tab === 'jobs' && (
          <select className={cx(selectCls, 'ml-auto')} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Job status">
            <option value="">All statuses</option>
            {Object.keys(JOB_STATUS).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      <Card className="overflow-x-auto p-0">
        {tab === 'jobs' ? (jobs.length === 0 ? <EmptyState icon={FiList} message="No jobs recorded." /> : (
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead><tr><th className={th}>Job</th><th className={th}>Ward</th><th className={th}>Status</th><th className={th}>Queued</th><th className={th}>Duration</th><th className={th}>Result / error</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-line-light">
                  <td className={td}>{JOB_LABEL[j.jobType] ?? humanize(j.jobType)}</td>
                  <td className={td}>{j.wardId ?? '—'}</td>
                  <td className={td}><Badge tone={JOB_STATUS[j.status]}>{j.status}</Badge>{j.attempts > 1 && <span className="ml-1 text-[11px] text-faint">×{j.attempts}</span>}</td>
                  <td className={cx(td, 'whitespace-nowrap text-subtle')}>{fmtDateTime(j.createdAt)}</td>
                  <td className={cx(td, 'tabular-nums')}>{duration(j.startedAt, j.finishedAt)}</td>
                  <td className={cx(td, 'max-w-[360px] truncate text-xs', j.error ? 'text-danger' : 'text-subtle')} title={j.error ?? JSON.stringify(j.result ?? {})}>
                    {j.error ?? (j.result ? Object.entries(j.result).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${humanize(k)}: ${v}`).join(' · ') : '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )) : (audit.length === 0 ? <EmptyState icon={FiList} message="No audit entries." /> : (
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>Entity</th><th className={th}>Detail</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-line-light">
                  <td className={cx(td, 'whitespace-nowrap text-subtle')}>{fmtDateTime(a.createdAt)}</td>
                  <td className={td}>{a.actor}</td>
                  <td className={cx(td, 'font-mono text-xs')}>{a.action}</td>
                  <td className={cx(td, 'font-mono text-xs text-subtle')}>{a.entity}</td>
                  <td className={cx(td, 'max-w-[320px] truncate text-xs text-subtle')} title={JSON.stringify(a.detail)}>{JSON.stringify(a.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Card>
    </PageMotion>
  );
}
