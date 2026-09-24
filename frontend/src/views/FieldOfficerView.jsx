import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiAlertCircle, FiCheck } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import MapView from '../components/MapView';
import WardSelector from '../components/WardSelector';
import ComparisonControls from '../components/ComparisonControls';
import StatsBar from '../components/StatsBar';
import PropertyList from '../components/PropertyList';
import ConfidenceCard from '../components/ConfidenceCard';
import VerifyPanel from '../components/VerifyPanel';
import RaiseTicketPanel from '../components/RaiseTicketPanel';
import ChatPanel from '../components/ChatPanel';
import { Button, ErrorBanner, SectionTitle } from '../components/ui';
import { COMPARISON_YEARS } from '../mockData/comparisonData';
import { fetchProperties, selectPropertiesError, selectSelectedProperty } from '../Redux/slices/propertiesSlice';
import { selectSelectedWardId, selectWardsError } from '../Redux/slices/wardsSlice';

const panelMotion = {
  initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 },
  transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
};

export default function FieldOfficerView() {
  const dispatch = useDispatch();
  const selectedWardId = useSelector(selectSelectedWardId);
  const selected = useSelector(selectSelectedProperty);
  const propertiesError = useSelector(selectPropertiesError);
  const wardsError = useSelector(selectWardsError);

  const [baseYear, setBaseYear] = useState(2022);
  const [compareYear, setCompareYear] = useState(2024);
  const [ticketMode, setTicketMode] = useState(false);
  const [ticketRaised, setTicketRaised] = useState(false);
  const [toast, setToast] = useState(false);
  const detailRef = useRef(null);
  const firstRender = useRef(true);

  const onBaseYearChange = (y) => {
    setBaseYear(y);
    if (y >= compareYear) setCompareYear(COMPARISON_YEARS.find((c) => c > y) ?? compareYear);
  };
  const onCompareYearChange = (y) => {
    setCompareYear(y);
    if (y <= baseYear) setBaseYear([...COMPARISON_YEARS].reverse().find((b) => b < y) ?? baseYear);
  };

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (selectedWardId) dispatch(fetchProperties({ wardId: selectedWardId, compareYear }));
  }, [compareYear]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTicketMode(false);
    setTicketRaised(false);
    setToast(false);
    if (!selected?.id) return undefined;
    const t = setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
    return () => clearTimeout(t);
  }, [selected?.id]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(false), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const onTicketSuccess = useCallback(() => {
    setTicketMode(false);
    setTicketRaised(true);
    setToast(true);
  }, []);

  const error = propertiesError || wardsError;

  return (
    <PageMotion className="flex flex-col gap-4 p-3 lg:h-[calc(100vh-92px)] lg:flex-row lg:overflow-hidden lg:p-4">
      <div className="h-[clamp(280px,45vh,420px)] shrink-0 overflow-hidden rounded-xl border border-line lg:h-auto lg:flex-[3_1_0]">
        <MapView heatmap={!!selectedWardId} />
      </div>

      <aside className="glass relative flex min-h-0 flex-col lg:max-w-[600px] lg:min-w-[360px] lg:flex-[2_1_0]">
        <AnimatePresence>
          {toast && (
            <motion.div
              {...panelMotion}
              className="absolute left-1/2 top-3 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md bg-success-light px-3 py-1.5 text-xs font-medium text-success-dark shadow-md"
              role="status"
            >
              <FiCheck /> Ticket submitted successfully.
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">Field Officer</h1>
            <WardSelector compareYear={compareYear} />
          </div>

          <ErrorBanner>{error && <><FiAlertCircle className="mr-1 inline" />Failed to load data: {error}</>}</ErrorBanner>

          <ComparisonControls
            baseYear={baseYear}
            compareYear={compareYear}
            onBaseYearChange={onBaseYearChange}
            onCompareYearChange={onCompareYearChange}
          />

          <section className="flex flex-col gap-2 border-t border-line-light pt-2">
            <SectionTitle>Analytics</SectionTitle>
            <StatsBar variant="badge" />
          </section>

          <section className="flex flex-col gap-2 border-t border-line-light pt-2">
            <SectionTitle>Properties</SectionTitle>
            <PropertyList embedded height={260} />
          </section>

          <div ref={detailRef}>
            <AnimatePresence mode="wait">
              {selected && (
                <motion.div key={`${selected.id}-${ticketMode}`} {...panelMotion} className="flex flex-col gap-3">
                  {ticketMode ? (
                    <RaiseTicketPanel onBack={() => setTicketMode(false)} onSuccess={onTicketSuccess} />
                  ) : (
                    <>
                      <ConfidenceCard />
                      <VerifyPanel />
                      <Button
                        variant={ticketRaised ? 'secondary' : 'primary'}
                        disabled={ticketRaised}
                        onClick={() => setTicketMode(true)}
                        className={ticketRaised ? 'w-full border-success! bg-success-light! text-success-dark!' : 'w-full'}
                      >
                        {ticketRaised ? <><FiCheck /> Ticket Raised</> : 'Raise a Ticket'}
                      </Button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>

      <ChatPanel />
    </PageMotion>
  );
}
