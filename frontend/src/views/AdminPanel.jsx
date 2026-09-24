import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCheckCircle, FiDatabase, FiRefreshCw, FiSliders, FiUpload } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import { Badge, Button, Kicker, cx, inputCls } from '../components/ui';
import {
  fetchAdminConfig, resetUploadStatus, saveDbConfig, selectDataMode, selectLastRefresh, selectNdbiThreshold,
  selectPipelineStatus, selectUploadError, selectUploadResult, selectUploadStatus, triggerRefresh, uploadCSV,
} from '../Redux/slices/adminSlice';
import { PIPELINE_STATUS, fmtDateTime } from '../utils/format';

function Section({ n, icon: Icon, title, aside, children }) {
  return (
    <section className="animate-fade-up rounded-xl border border-line bg-white p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-2xl font-bold tabular-nums text-line">{n}</span>
        <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon /></span>
        <h2 className="text-base font-semibold">{title}</h2>
        {aside && <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-subtle">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

function InlineMsg({ msg }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.span
          initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
          className={cx('text-xs font-medium', msg.ok ? 'text-success' : 'text-danger')}
          role="status"
        >
          {msg.text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Shows a message for 3s. */
function useFlash() {
  const [msg, setMsg] = useState(null);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const flash = (ok, text) => {
    setMsg({ ok, text });
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 3000);
  };
  return [msg, flash];
}

const DB_FIELDS = [
  { key: 'host', label: 'Host', placeholder: 'rds-endpoint.ap-south-1.rds.amazonaws.com' },
  { key: 'port', label: 'Port', placeholder: '5432' },
  { key: 'database', label: 'Database', placeholder: 'gvmc' },
  { key: 'username', label: 'Username', placeholder: 'admin' },
  { key: 'password', label: 'Password', placeholder: '••••••••', type: 'password' },
];

export default function AdminPanel() {
  const dispatch = useDispatch();
  const dataMode = useSelector(selectDataMode);
  const pipelineStatus = useSelector(selectPipelineStatus);
  const lastRefresh = useSelector(selectLastRefresh);
  const threshold = useSelector(selectNdbiThreshold);
  const uploadStatus = useSelector(selectUploadStatus);
  const uploadError = useSelector(selectUploadError);
  const uploadResult = useSelector(selectUploadResult);

  const [csv, setCsv] = useState(null);
  const [db, setDb] = useState({ host: '', port: '5432', database: '', username: '', password: '' });
  const [ndbi, setNdbi] = useState(threshold);
  const [dbMsg, flashDb] = useFlash();
  const [ndbiMsg, flashNdbi] = useFlash();

  useEffect(() => { setNdbi(threshold); }, [threshold]);
  useEffect(() => () => { dispatch(resetUploadStatus()); }, [dispatch]);

  // Poll while the pipeline is running.
  useEffect(() => {
    if (pipelineStatus !== 'running') return undefined;
    const id = setInterval(() => dispatch(fetchAdminConfig()), 10000);
    return () => clearInterval(id);
  }, [pipelineStatus, dispatch]);

  const saveDb = async (e) => {
    e.preventDefault();
    const res = await dispatch(saveDbConfig(db));
    flashDb(res.meta.requestStatus === 'fulfilled', res.meta.requestStatus === 'fulfilled' ? 'Saved.' : 'Failed to save.');
  };

  const saveNdbi = async () => {
    const res = await dispatch(saveDbConfig({ ndbi_threshold: ndbi }));
    flashNdbi(res.meta.requestStatus === 'fulfilled', res.meta.requestStatus === 'fulfilled' ? 'Saved.' : 'Failed to save.');
  };

  const running = pipelineStatus === 'running';

  return (
    <PageMotion className="min-h-[calc(100vh-92px)]">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 lg:px-12">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
          <div>
            <Kicker>System Configuration</Kicker>
            <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
          </div>
          <Badge tone={dataMode === 'live' ? 'success' : 'warning'}>{dataMode === 'live' ? 'Live Data' : 'Demo Mode'}</Badge>
        </header>

        <div className="flex flex-col gap-6">
          <Section n="01" icon={FiUpload} title="Upload GVMC Property Data">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => { setCsv(e.target.files?.[0] ?? null); dispatch(resetUploadStatus()); }}
                className="text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:border-primary"
              />
              <Button onClick={() => csv && dispatch(uploadCSV(csv))} disabled={!csv || uploadStatus === 'loading'}>
                {uploadStatus === 'loading' ? 'Uploading…' : 'Upload CSV'}
              </Button>
            </div>
            <AnimatePresence>
              {uploadStatus === 'succeeded' && (
                <motion.p initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-success-light px-3 py-2 text-sm text-success-dark">
                  <FiCheckCircle /> Data loaded successfully. {uploadResult?.propertiesImported?.toLocaleString() ?? 0} properties imported.
                  {uploadResult?.message && <span className="text-xs opacity-80"> {uploadResult.message}</span>}
                </motion.p>
              )}
              {uploadStatus === 'failed' && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 rounded-md bg-danger-light px-3 py-2 text-sm text-danger-dark">
                  {uploadError}
                </motion.p>
              )}
            </AnimatePresence>
          </Section>

          <Section n="02" icon={FiDatabase} title="Database Configuration">
            <form onSubmit={saveDb} className="flex flex-col gap-3">
              {DB_FIELDS.map((f) => (
                <label key={f.key} className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(100px,140px)_1fr] sm:gap-3">
                  <span className="text-sm font-medium text-subtle">{f.label}</span>
                  <input
                    className={inputCls}
                    type={f.type ?? 'text'}
                    placeholder={f.placeholder}
                    value={db[f.key]}
                    onChange={(e) => setDb((d) => ({ ...d, [f.key]: e.target.value }))}
                    autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                  />
                </label>
              ))}
              <div className="flex items-center gap-3 sm:pl-[152px]">
                <Button type="submit">Save Config</Button>
                <InlineMsg msg={dbMsg} />
              </div>
            </form>
          </Section>

          <Section
            n="03"
            icon={FiRefreshCw}
            title="Detection Pipeline"
            aside={(
              <>
                <span className="inline-flex items-center gap-1.5">Status <Badge tone={PIPELINE_STATUS[pipelineStatus] ?? 'secondary'}>{pipelineStatus}</Badge></span>
                <span>Last refresh <strong className="text-ink">{fmtDateTime(lastRefresh)}</strong></span>
              </>
            )}
          >
            <Button onClick={() => dispatch(triggerRefresh())} disabled={running}>
              <FiRefreshCw className={running ? 'animate-spin' : ''} /> Trigger Refresh
            </Button>
          </Section>

          <Section n="04" icon={FiSliders} title="Detection Sensitivity" aside={<span>NDBI Threshold: <strong className="text-ink tabular-nums">{Number(ndbi).toFixed(2)}</strong></span>}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex min-w-[240px] flex-1 flex-col gap-1">
                <input
                  type="range" min="0.05" max="0.30" step="0.01" value={ndbi}
                  onChange={(e) => setNdbi(Number(e.target.value))}
                  className="w-full accent-primary"
                  aria-label="NDBI threshold"
                />
                <div className="flex justify-between text-xs text-faint">
                  <span>0.05 (sensitive)</span><span>0.30 (strict)</span>
                </div>
              </div>
              <Button onClick={saveNdbi}>Save Threshold</Button>
              <InlineMsg msg={ndbiMsg} />
            </div>
          </Section>
        </div>
      </div>
    </PageMotion>
  );
}
