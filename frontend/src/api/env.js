// Reads VITE_* first, then the legacy NEXT_PUBLIC_* names so older .env.local files keep working.
const env = import.meta.env;

const pick = (...keys) => {
  for (const k of keys) if (env[k]) return env[k];
  return '';
};

// A base URL without a scheme ("api.example.com") is a *relative path* to the browser, so every
// call would go to the frontend's own host (Vercel answers POSTs with 405). Add the scheme.
export const normalizeBase = (url) => {
  const u = (url || '').trim().replace(/\/+$/, '');
  if (!u || /^https?:\/\//i.test(u) || u.startsWith('/')) return u;
  return /^(localhost|127\.0\.0\.1)(:|$)/i.test(u) ? `http://${u}` : `https://${u}`;
};

export const API_URL = normalizeBase(pick('VITE_API_URL', 'NEXT_PUBLIC_API_URL'));
export const AGENT_API_URL = normalizeBase(pick('VITE_AGENT_API_URL')) || API_URL;
export const SUPABASE_URL = pick('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = pick('VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const MOCK_MODE = env.VITE_MOCK === 'true';
