// Demo mode has no login: each workspace acts as the backend role it needs
// (backend AuthGuard with AUTH_DEV_BYPASS=true reads the `x-dev-role` header).
const ROLE_BY_PATH = [
  ['/officer', 'official'],
  ['/supervisor', 'official'],
  ['/commissioner', 'analyst'],
  ['/integration', 'admin'],   // uploads/run need analyst|admin, resolve needs official|admin
  ['/admin', 'admin'],
];

export function roleForPath(pathname = '/') {
  const hit = ROLE_BY_PATH.find(([prefix]) => pathname.startsWith(prefix));
  return hit ? hit[1] : 'admin';
}

export function currentDevRole() {
  if (typeof window === 'undefined') return 'admin';
  return roleForPath(window.location.pathname);
}
