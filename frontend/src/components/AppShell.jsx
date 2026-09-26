import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiArrowLeft, FiArrowRight, FiChevronDown, FiLogIn, FiLogOut, FiMenu, FiX } from 'react-icons/fi';
import PipelineActivity from './PipelineActivity';
import { MdSatellite } from 'react-icons/md';
import DemoModeBadge from './DemoModeBadge';
import { cx } from './ui';
import { ADMIN, HOME, MAP, STEPS, neighbours } from './nav';
import { fetchWards, selectSelectedWardId, selectWards, selectWardsStatus, setSelectedWard } from '../Redux/slices/wardsSlice';
import { fetchHealth, selectHealth } from '../Redux/slices/adminSlice';
import { fetchConflicts, selectConflicts } from '../Redux/slices/conflictsSlice';
import { AUTH_ENABLED } from '../api/env';
import { getCurrentUser, onAuthChange, signOut } from '../api/auth';

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
    <label className={cx('relative flex items-center gap-2', className)} title="Choose a ward — every page then shows only that ward's data">
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
  const detail = down ? 'The backend cannot be reached' : `Database ${health.db} · queue ${health.redis} · storage ${health.r2}`;
  return (
    <NavLink
      to="/settings"
      title={`${detail} — click for details`}
      className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-subtle hover:border-primary hover:text-ink hover:no-underline sm:inline-flex"
    >
      <span className={cx('size-2 rounded-full', ok ? 'bg-success' : down ? 'bg-danger' : 'bg-warning')} />
      {ok ? 'System OK' : down ? 'Backend offline' : 'System degraded'}
    </NavLink>
  );
}

function useOpenConflicts() {
  const conflicts = useSelector(selectConflicts);
  return conflicts.filter((c) => c.status !== 'resolved' && c.status !== 'rejected').length;
}

const linkCls = ({ isActive }) => cx(
  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:no-underline',
  isActive ? 'bg-ink text-white' : 'text-subtle hover:bg-hover hover:text-ink',
);

function CountBadge({ n }) {
  if (!n) return null;
  return <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{n}</span>;
}

function NavItem({ item, onNavigate, count }) {
  return (
    <NavLink to={item.to} end={item.end} onClick={onNavigate} title={item.hint} className={linkCls}>
      <item.icon className="shrink-0 text-base" />
      <span className="flex-1 truncate">{item.label}</span>
      <CountBadge n={count} />
    </NavLink>
  );
}

/** Workflow steps as an accordion: the step you are on stays open, the others collapse to one line each. */
function SideNav({ onNavigate }) {
  const { pathname } = useLocation();
  const openConflicts = useOpenConflicts();
  const current = STEPS.find((s) => s.items.some((i) => i.to === pathname))?.n;
  const [open, setOpen] = useState(() => new Set(current ? [current] : []));
  useEffect(() => {
    if (current) setOpen((o) => (o.has(current) ? o : new Set(o).add(current)));
  }, [current]);

  const toggle = (n) => setOpen((o) => {
    const x = new Set(o);
    if (x.has(n)) x.delete(n); else x.add(n);
    return x;
  });
  const countFor = (item) => (item.badge === 'conflicts' ? openConflicts : 0);

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3 py-2">
      <NavItem item={HOME} onNavigate={onNavigate} />
      <NavItem item={MAP} onNavigate={onNavigate} />

      <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Workflow · 5 steps</div>
      {STEPS.map((s) => {
        const expanded = open.has(s.n);
        const isCurrent = current === s.n;
        const stepCount = s.items.reduce((sum, i) => sum + countFor(i), 0);
        return (
          <div key={s.n}>
            <button
              type="button"
              onClick={() => toggle(s.n)}
              aria-expanded={expanded}
              title={`${expanded ? 'Hide' : 'Show'} step ${s.n}: ${s.items.map((i) => i.label).join(', ')}`}
              className={cx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-hover',
                isCurrent ? 'text-ink' : 'text-subtle',
              )}
            >
              <span className={cx(
                'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums',
                isCurrent ? 'bg-primary text-white' : 'bg-line-light text-subtle',
              )}
              >
                {s.n}
              </span>
              <span className="flex-1 truncate">{s.title}</span>
              {!expanded && <CountBadge n={stepCount} />}
              <FiChevronDown className={cx('shrink-0 text-faint transition-transform', expanded && 'rotate-180')} />
            </button>
            {expanded && (
              <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-line-light pl-1">
                {s.items.map((item) => <NavItem key={item.to} item={item} onNavigate={onNavigate} count={countFor(item)} />)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function AdminLinks({ onNavigate }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-light px-3 py-2">
      {ADMIN.map((item) => <NavItem key={item.to} item={item} onNavigate={onNavigate} />)}
    </div>
  );
}

function Brand() {
  return (
    <NavLink to="/" title="Go to the home page" className="flex items-center gap-2.5 px-6 py-5 text-ink hover:no-underline">
      <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary text-lg text-white shadow-sm"><MdSatellite /></span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-wide">NAKSHA GeoIntegrate</span>
        <span className="block text-[11px] text-subtle">PS 26013 · Land records</span>
      </span>
    </NavLink>
  );
}

/** Previous / next workflow step at the bottom of every workflow page. */
function StepPager() {
  const { pathname } = useLocation();
  const { prev, next } = neighbours(pathname);
  if (!prev && !next) return null;
  const card = 'flex min-w-0 flex-1 flex-col gap-0.5 rounded-xl border border-line bg-white px-4 py-3 shadow-sm transition hover:border-primary hover:no-underline sm:max-w-sm';
  return (
    <nav aria-label="Workflow steps" className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 pb-24 pt-2 sm:flex-row sm:justify-between sm:px-6">
      {prev ? (
        <Link to={prev.to} className={card} title={prev.hint}>
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-subtle"><FiArrowLeft /> Previous · step {prev.step.n}</span>
          <span className="truncate text-sm font-semibold text-ink">{prev.label}</span>
        </Link>
      ) : <span />}
      {next && (
        <Link to={next.to} className={cx(card, 'sm:items-end sm:text-right')} title={next.hint}>
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary">Next · step {next.step.n} <FiArrowRight /></span>
          <span className="truncate text-sm font-semibold text-ink">{next.label}</span>
        </Link>
      )}
    </nav>
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
        <AdminLinks />
        <p className="px-6 pb-3 text-[11px] leading-snug text-faint">Ministry of Rural Development · DoLR</p>
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
                <button type="button" aria-label="Close menu" title="Close menu" onClick={() => setDrawer(false)} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-hover"><FiX /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto"><SideNav onNavigate={() => setDrawer(false)} /></div>
              <AdminLinks onNavigate={() => setDrawer(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/85 px-3 backdrop-blur sm:px-5">
        <button type="button" aria-label="Open menu" title="Open menu" onClick={() => setDrawer(true)} className="inline-flex size-10 items-center justify-center rounded-full text-xl hover:bg-hover lg:hidden">
          <FiMenu />
        </button>
        <WardPicker className="min-w-0 flex-1 sm:flex-none" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PipelineActivity />
          <HealthDot />
          <DemoModeBadge />
          {AUTH_ENABLED && (user ? (
            <button type="button" className={authBtn} title={`Signed in as ${user.email} — click to sign out`} onClick={async () => { await signOut(); navigate('/'); }}>
              <FiLogOut /> <span className="hidden sm:inline">Sign out</span>
            </button>
          ) : (
            <NavLink to="/login" className={authBtn} title="Sign in to your account"><FiLogIn /> <span className="hidden sm:inline">Sign in</span></NavLink>
          ))}
        </div>
      </header>

      <main className="min-w-0">
        {children}
        <StepPager />
      </main>
    </div>
  );
}
