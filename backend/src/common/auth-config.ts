// AUTH_DEV_BYPASS opens every route. docker-compose.yml defaults it to true and the same compose
// file is used on the deploy host, so a production .env that forgets the variable would run with
// auth off. Refuse to boot when bypass is on and the API serves a non-local frontend, unless the
// operator explicitly accepts it (e.g. a public throw-away demo).
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i;

export function assertSafeAuthConfig(env: NodeJS.ProcessEnv): void {
  const bypass = (env.AUTH_DEV_BYPASS ?? 'false').toLowerCase() === 'true';
  if (!bypass) return;
  const origins = (env.FRONTEND_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const remote = origins.filter((o) => !LOCAL.test(o));
  if (remote.length && (env.AUTH_DEV_BYPASS_ALLOW_REMOTE ?? '').toLowerCase() !== 'true') {
    throw new Error(
      `AUTH_DEV_BYPASS=true but FRONTEND_ORIGIN includes ${remote.join(', ')}: this would expose every ` +
      'route without login. Set AUTH_DEV_BYPASS=false and the SUPABASE_* keys, or set ' +
      'AUTH_DEV_BYPASS_ALLOW_REMOTE=true if this deployment is deliberately open.',
    );
  }
  // eslint-disable-next-line no-console
  console.warn('[auth] AUTH_DEV_BYPASS=true — every route is open. Never use this in production.');
}
