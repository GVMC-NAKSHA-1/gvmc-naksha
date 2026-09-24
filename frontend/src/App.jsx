import { Suspense, lazy, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Route, Routes } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { fetchAdminConfig, selectConfigStatus } from './Redux/slices/adminSlice';
import AppSplash from './components/AppSplash';
import Navbar from './components/Navbar';
import ScrollToTop from './components/ScrollToTop';
import { AUTH_ENABLED } from './api/env';
import Loader from './components/Loader';

// Route-level code splitting keeps MapLibre out of the initial bundle.
const HomePage = lazy(() => import('./views/HomePage'));
const FieldOfficerView = lazy(() => import('./views/FieldOfficerView'));
const SupervisorView = lazy(() => import('./views/SupervisorView'));
const CommissionerView = lazy(() => import('./views/CommissionerView'));
const IntegrationView = lazy(() => import('./views/IntegrationView'));
const AdminPanel = lazy(() => import('./views/AdminPanel'));
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
      <Navbar />
      <div className="min-h-screen pt-[92px]">
        <Suspense fallback={<div className="flex justify-center py-20"><Loader size="lg" /></div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/officer" element={<FieldOfficerView />} />
          <Route path="/supervisor" element={<SupervisorView />} />
          <Route path="/commissioner" element={<CommissionerView />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/integration" element={<IntegrationView />} />
          {AUTH_ENABLED && <Route path="/login" element={<LoginPage />} />}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </div>
    </>
  );
}
