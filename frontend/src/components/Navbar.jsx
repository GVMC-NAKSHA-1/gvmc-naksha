import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { MdSatellite } from 'react-icons/md';
import { FiLogIn, FiLogOut, FiMenu, FiX } from 'react-icons/fi';
import DemoModeBadge from './DemoModeBadge';
import { cx } from './ui';
import { AUTH_ENABLED } from '../api/env';
import { getCurrentUser, onAuthChange, signOut } from '../api/auth';

export const NAV_LINKS = [
  { to: '/officer', label: 'Field Officer' },
  { to: '/supervisor', label: 'Supervisor' },
  { to: '/commissioner', label: 'Commissioner' },
  { to: '/integration', label: 'Integration' },
  { to: '/admin', label: 'Admin' },
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

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { scrollY } = useScroll();
  const user = useAuthUser();

  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 8));
  useEffect(() => { setOpen(false); }, [pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const authBtn = 'inline-flex items-center gap-1 rounded-full border border-line px-2 py-1 text-xs text-subtle transition-colors hover:border-primary hover:text-primary';

  return (
    <>
      <nav
        aria-label="Main"
        className={cx(
          'fixed left-1/2 top-4 z-30 grid h-[60px] w-[calc(100%-24px)] -translate-x-1/2 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-full border bg-white pl-3 pr-2 transition-shadow duration-300 md:w-[min(calc(100%-32px),920px)]',
          scrolled ? 'border-line shadow-lg' : 'border-line/65 shadow-sm',
        )}
      >
        <NavLink to="/" className="group inline-flex items-center gap-2 font-bold text-ink" aria-label="GVMC home">
          <span className="inline-flex size-[30px] items-center justify-center rounded-lg bg-primary/12 text-base text-primary transition-colors group-hover:bg-primary/20">
            <MdSatellite />
          </span>
          <span className="hidden text-[13px] tracking-[0.02em] md:inline">GVMC</span>
        </NavLink>

        <ul className="hidden items-center justify-center gap-0.5 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className={({ isActive }) => cx(
                  'relative inline-flex items-center whitespace-nowrap rounded-full px-2 py-2 text-[13px] font-medium transition-colors lg:px-3',
                  isActive ? 'text-white' : 'text-subtle hover:bg-hover hover:text-ink',
                )}
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="navbar-active-pill"
                        className="absolute inset-0 rounded-full bg-ink"
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                      />
                    )}
                    <span className="relative z-10">{l.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="col-start-3 flex items-center justify-end gap-2">
          <DemoModeBadge />
          {AUTH_ENABLED && (user ? (
            <button type="button" className={authBtn} onClick={handleSignOut} title={user.email}>
              <FiLogOut /> <span className="hidden md:inline">Sign out</span>
            </button>
          ) : (
            <NavLink to="/login" className={authBtn}>
              <FiLogIn /> <span className="hidden md:inline">Sign in</span>
            </NavLink>
          ))}
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full text-xl text-ink hover:bg-hover md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <FiX /> : <FiMenu />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              key="drawer"
              className="glass fixed inset-x-3 top-[84px] z-50 flex flex-col gap-1 p-2 md:hidden"
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            >
              {NAV_LINKS.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) => cx(
                    'flex min-h-12 items-center rounded-lg px-3 text-base',
                    isActive ? 'bg-ink text-white' : 'text-ink hover:bg-hover',
                  )}
                >
                  {l.label}
                </NavLink>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
