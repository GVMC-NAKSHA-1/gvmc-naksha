import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FiActivity, FiAlertTriangle, FiCheckSquare, FiChevronDown, FiCpu, FiCrosshair, FiDatabase, FiGitMerge, FiGrid,
  FiLayers, FiList, FiLogIn, FiLogOut, FiMap, FiMenu, FiShare2, FiShuffle, FiSliders, FiTool, FiX,
} from 'react-icons/fi';
import PipelineActivity from './PipelineActivity';
import { MdSatellite } from 'react-icons/md';
import DemoModeBadge from './DemoModeBadge';
import { cx } from './ui';
import { fetchWards, selectSelectedWardId, selectWards, selectWardsStatus, setSelectedWard } from '../Redux/slices/wardsSlice';
import { fetchHealth, selectHealth } from '../Redux/slices/adminSlice';
import { fetchConflicts, selectConflicts } from '../Redux/slices/conflictsSlice';
import { AUTH_ENABLED } from '../api/env';
import { getCurrentUser, onAuthChange, signOut } from '../api/auth';

/** Grouped by the PS 26013 lifecycle: ingest → process → harmonize → validate → publish. */
export const NAV = [
  { to: '/', label: 'Command centre', icon: FiGrid, end: true },
  { section: 'Ingest' },
  { to: '/sources', label: 'Data sources', icon: FiDatabase },
  { to: '/georef', label: 'Geo-referencing & CRS', icon: FiCrosshair },
  { section: 'Process' },
  { to: '/extraction', label: 'AI feature extraction', icon: FiCpu },
  { to: '/topology', label: 'Topology QA', icon: FiTool },
  { to: '/map', label: 'Integration map', icon: FiMap },
  { section: 'Harmonize' },
  { to: '/matching', label: 'Spatial matching', icon: FiGitMerge },
  { to: '/attributes', label: 'Attribute mapping', icon: FiShuffle },
  { to: '/conflicts', label: 'Conflicts', icon: FiAlertTriangle, badge: 'conflicts' },
  { section: 'Validate' },
  { to: '/validation', label: 'Validation & sync', icon: FiCheckSquare },
  { to: '/changes', label: 'Change detection', icon: FiActivity },
  { section: 'Publish' },
  { to: '/records', label: 'Golden records', icon: FiLayers },
  { to: '/exchange', label: 'Data exchange (OGC)', icon: FiShare2 },
  { section: 'Admin' },
  { to: '/activity', label: 'Activity log', icon: FiList },
  { to: '/settings', label: 'Settings & health', icon: FiSliders },
];

function useAuthUser() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    if (!AUTH_ENABLED) return undefined;
    let unsub = () => {};
    getCurrentUser().then(setUser);
    onAuthChange(setUser).then((u) => { unsub = u; });
    return () => unsub();
  }, []);
  return user;
}

export function WardPicker({ className }) {
  const dispatch = useDispatch();
  const wards = useSelector(selectWards);
  const status = useSelector(selectWardsStatus);
  const wardId = useSelector(selectSelectedWardId);

  return (
    <label className={cx('relative flex items-center gap-2', className)}>
      <span className="hidden text-xs font-semibold uppercase tracking-wider text-subtle sm:inline">Ward</span>
      <span className="relative min-w-0 flex-1">
        <select
          aria-label="Ward"
          className="w-full min-w-0 cursor-pointer sm:min-w-44 appearance-none rounded-lg border border-line bg-canvas py-1.5 pl-3 pr-8 text-sm text-ink hover:border-primary focus:border-primary focus:shadow-focus focus:outline-none disabled:opacity-60"
          value={wardId ?? ''}
          disabled={status === 'loading'}
          onChange={(e) => dispatch(setSelectedWard(e.target.value || null))}
        >
          <option value="">{status === 'loading' ? 'Loading…' : 'All wards'}</option>
          {wards.map((w) => <option key={w.id} value={w.id}>{`Ward ${w.id} — ${w.name}`}</option>)}
        </select>
        <FiChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" />
      </span>
    </label>
  );
}

function HealthDot() {
  const health = useSelector(selectHealth);
  if (!health) return null;
  const ok = health.status === 'ok';
  const down = health.status === 'down';
  const title = down ? 'Backend unreachable' : `db ${health.db} · queue ${health.redis} · storage ${health.r2}`;
  return (
    <NavLink to="/settings" title={title} className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-subtle hover:text-ink sm:inline-flex">
      <span className={cx('size-2 rounded-full', ok ? 'bg-success' : down ? 'bg-danger' : 'bg-warning')} />
      {ok ? 'All systems' : down ? 'Offline' : 'Degraded'}
    </NavLink>
  );
}

function SideNav({ onNavigate }) {
  const conflicts = useSelector(selectConflicts);
  const open = conflicts.filter((c) => c.status !== 'resolved' && c.status !== 'rejected').length;
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3 py-2">
      {NAV.map((item, i) => (item.section ? (
        <div key={item.section} className={cx('px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint', i > 0 && 'pt-4')}>
          {item.section}
        </div>
      ) : (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) => cx(
            'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-ink text-white' : 'text-subtle hover:bg-hover hover:text-ink',
          )}
        >
          <item.icon className="shrink-0 text-base" />
          <span className="flex-1 truncate">{item.label}</span>
          {item.step && <span className="text-[10px] tabular-nums opacity-60">{item.step}</span>}
          {item.badge === 'conflicts' && open > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{open}</span>
          )}
        </NavLink>
      )))}
    </nav>
  );
}

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 px-6 py-5 text-ink hover:no-underline">
      <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary text-lg text-white shadow-sm"><MdSatellite /></span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-wide">NAKSHA GeoIntegrate</span>
        <span className="block text-[11px] text-subtle">PS 26013 · Land records</span>
      </span>
    </NavLink>
  );
}

export default function AppShell({ children }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);
  const wardsStatus = useSelector(selectWardsStatus);
  const wardId = useSelector(selectSelectedWardId);
  const user = useAuthUser();

  useEffect(() => { if (wardsStatus === 'idle') dispatch(fetchWards()); }, [wardsStatus, dispatch]);
  useEffect(() => {
    dispatch(fetchHealth());
    const id = setInterval(() => dispatch(fetchHealth()), 60000);
    return () => clearInterval(id);
  }, [dispatch]);
  // Conflict count drives the sidebar badge.
  useEffect(() => { dispatch(fetchConflicts({ wardId: wardId ?? undefined })); }, [wardId, dispatch]);
  useEffect(() => { setDrawer(false); }, [pathname]);

  const authBtn = 'inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-subtle hover:border-primary hover:text-primary';

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-white lg:flex">
        <Brand />
        <div className="min-h-0 flex-1 overflow-y-auto"><SideNav /></div>
        <p className="border-t border-line-light px-6 py-3 text-[11px] leading-snug text-faint">
          Ministry of Rural Development · DoLR<br />Smart Automation
        </p>
      </aside>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div key="bd" className="fixed inset-0 z-40 bg-black/40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside
              key="dr"
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white shadow-xl lg:hidden"
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="flex items-center justify-between pr-3">
                <Brand />
                <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-hover"><FiX /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto"><SideNav onNavigate={() => setDrawer(false)} /></div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/85 px-3 backdrop-blur sm:px-5">
        <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="inline-flex size-10 items-center justify-center rounded-full text-xl hover:bg-hover lg:hidden">
          <FiMenu />
        </button>
        <WardPicker className="min-w-0 flex-1 sm:flex-none" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PipelineActivity />
          <HealthDot />
          <DemoModeBadge />
          {AUTH_ENABLED && (user ? (
            <button type="button" className={authBtn} title={user.email} onClick={async () => { await signOut(); navigate('/'); }}>
              <FiLogOut /> <span className="hidden sm:inline">Sign out</span>
            </button>
          ) : (
            <NavLink to="/login" className={authBtn}><FiLogIn /> <span className="hidden sm:inline">Sign in</span></NavLink>
          ))}
        </div>
      </header>

      <main className="min-w-0">{children}</main>
    </div>
  );
}
