import { Suspense, lazy, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Route, Routes } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { fetchAdminConfig, selectConfigStatus } from './Redux/slices/adminSlice';
import AppSplash from './components/AppSplash';
import AppShell from './components/AppShell';
import ChatPanel from './components/ChatPanel';
import ScrollToTop from './components/ScrollToTop';
import Loader from './components/Loader';
import { AUTH_ENABLED } from './api/env';

// Route-level code splitting keeps MapLibre out of the initial bundle.
const OverviewPage = lazy(() => import('./views/OverviewPage'));
const SourcesPage = lazy(() => import('./views/SourcesPage'));
const IntegrationMapPage = lazy(() => import('./views/IntegrationMapPage'));
const MatchingPage = lazy(() => import('./views/MatchingPage'));
const AttributeMappingPage = lazy(() => import('./views/AttributeMappingPage'));
const ConflictsPage = lazy(() => import('./views/ConflictsPage'));
const RecordsPage = lazy(() => import('./views/RecordsPage'));
const ChangeDetectionPage = lazy(() => import('./views/ChangeDetectionPage'));
const SettingsPage = lazy(() => import('./views/SettingsPage'));
const GeorefPage = lazy(() => import('./views/GeorefPage'));
const ExtractionPage = lazy(() => import('./views/ExtractionPage'));
const TopologyPage = lazy(() => import('./views/TopologyPage'));
const ValidationPage = lazy(() => import('./views/ValidationPage'));
const ExchangePage = lazy(() => import('./views/ExchangePage'));
const ActivityPage = lazy(() => import('./views/ActivityPage'));
const LoginPage = lazy(() => import('./views/LoginPage'));
const NotFound = lazy(() => import('./views/NotFound'));

export default function App() {
  const dispatch = useDispatch();
  const configStatus = useSelector(selectConfigStatus);
  const showSplash = configStatus === 'idle' || configStatus === 'loading';

  useEffect(() => { dispatch(fetchAdminConfig()); }, [dispatch]);

  return (
    <>
      <ScrollToTop />
      <AnimatePresence>{showSplash && <AppSplash key="app-splash" />}</AnimatePresence>
      <AppShell>
        <Suspense fallback={<div className="flex justify-center py-24"><Loader size="lg" /></div>}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/map" element={<IntegrationMapPage />} />
            <Route path="/matching" element={<MatchingPage />} />
            <Route path="/attributes" element={<AttributeMappingPage />} />
            <Route path="/conflicts" element={<ConflictsPage />} />
            <Route path="/records" element={<RecordsPage />} />
            <Route path="/changes" element={<ChangeDetectionPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/georef" element={<GeorefPage />} />
            <Route path="/extraction" element={<ExtractionPage />} />
            <Route path="/topology" element={<TopologyPage />} />
            <Route path="/validation" element={<ValidationPage />} />
            <Route path="/exchange" element={<ExchangePage />} />
            <Route path="/activity" element={<ActivityPage />} />
            {AUTH_ENABLED && <Route path="/login" element={<LoginPage />} />}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppShell>
      <ChatPanel />
    </>
  );
}
