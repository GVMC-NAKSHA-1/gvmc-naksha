// Demo mode has no login. Every workspace in this app drives the integration pipeline, whose
// write endpoints need `admin` or `analyst` (upload, matching, assembly) and `official` or
// `admin` (conflict resolution, verification, export) — so demo requests act as `admin`.
// The backend reads this `x-dev-role` header only when AUTH_DEV_BYPASS=true.
export function currentDevRole() {
  return 'admin';
}
