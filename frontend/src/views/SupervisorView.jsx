import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiDownload } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import WardSelector from '../components/WardSelector';
import TicketsList from '../components/TicketsList';
import AlertPanel from '../components/AlertPanel';
import StatsBar from '../components/StatsBar';
import PropertyList from '../components/PropertyList';
import PendingAssessmentsTable, { PendingAssessmentsBadge } from '../components/PendingAssessmentsPanel';
import { Button, ErrorBanner, Kicker } from '../components/ui';
import { exportAlerts, selectExportStatus } from '../Redux/slices/alertsSlice';
import { openExportUrl } from '../api/exportLayer';
import { selectPropertiesError } from '../Redux/slices/propertiesSlice';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';

export default function SupervisorView() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const exportStatus = useSelector(selectExportStatus);
  const propertiesError = useSelector(selectPropertiesError);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);

  const handleExport = async () => {
    setExportMsg(null);
    const res = await dispatch(exportAlerts(wardId));
    if (res.meta.requestStatus === 'fulfilled') {
      openExportUrl(res.payload.url, `gvmc_ward_${wardId ?? 'all'}.csv`);
      setExportMsg({ ok: true, text: res.payload.rowCount != null ? `Exported ${res.payload.rowCount} rows.` : 'Export ready.' });
    } else {
      setExportMsg({ ok: false, text: `Export failed: ${res.payload}` });
    }
  };

  return (
    <PageMotion className="min-h-[calc(100vh-92px)]">
      <div className="mx-auto w-full max-w-[1800px] px-3 pb-6 pt-6 sm:px-5">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker>Supervisor Workspace</Kicker>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">Ward Oversight</h1>
              <PendingAssessmentsBadge open={pendingOpen} onToggle={() => setPendingOpen((o) => !o)} />
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <WardSelector />
            <Button variant="secondary" onClick={handleExport} disabled={exportStatus === 'loading'}>
              <FiDownload className="text-sm" /> {exportStatus === 'loading' ? 'Exporting…' : 'Export CSV'}
            </Button>
          </div>
        </header>

        {exportMsg && (
          <p className={`mb-3 rounded-md px-3 py-2 text-xs ${exportMsg.ok ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger-dark'}`}>
            {exportMsg.text}
          </p>
        )}
        <ErrorBanner>{propertiesError && `Failed to load data: ${propertiesError}`}</ErrorBanner>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <AnimatePresence>
            {pendingOpen && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
                <PendingAssessmentsTable />
              </motion.div>
            )}
          </AnimatePresence>
          <TicketsList />
          <AlertPanel />
          <StatsBar variant="card" />
          <PropertyList height="max(300px, calc(100vh - 92px - 260px))" />
        </div>
      </div>
    </PageMotion>
  );
}
