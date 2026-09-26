import { assertSafeAuthConfig } from './auth-config';

describe('assertSafeAuthConfig', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterAll(() => warn.mockRestore());

  it('allows real auth with any origin', () => {
    expect(() => assertSafeAuthConfig({ AUTH_DEV_BYPASS: 'false', FRONTEND_ORIGIN: 'https://naksha.vercel.app' })).not.toThrow();
    expect(() => assertSafeAuthConfig({ FRONTEND_ORIGIN: 'https://naksha.vercel.app' })).not.toThrow();
  });

  it('allows bypass for local frontends', () => {
    expect(() => assertSafeAuthConfig({ AUTH_DEV_BYPASS: 'true', FRONTEND_ORIGIN: 'http://localhost:3001,http://127.0.0.1:5173' })).not.toThrow();
    expect(() => assertSafeAuthConfig({ AUTH_DEV_BYPASS: 'true' })).not.toThrow();
  });

  it('refuses bypass when a deployed frontend is configured', () => {
    expect(() => assertSafeAuthConfig({ AUTH_DEV_BYPASS: 'TRUE', FRONTEND_ORIGIN: 'http://localhost:3001,https://naksha.vercel.app' }))
      .toThrow(/naksha\.vercel\.app/);
    expect(() => assertSafeAuthConfig({ AUTH_DEV_BYPASS: 'true', FRONTEND_ORIGIN: 'http://localhost.evil.com' })).toThrow();
  });

  it('allows an explicitly open deployment', () => {
    expect(() => assertSafeAuthConfig({
      AUTH_DEV_BYPASS: 'true', FRONTEND_ORIGIN: 'https://demo.example.org', AUTH_DEV_BYPASS_ALLOW_REMOTE: 'true',
    })).not.toThrow();
  });
});
