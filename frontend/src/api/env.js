// Reads VITE_* first, then the legacy NEXT_PUBLIC_* names so older .env.local files keep working.
const env = import.meta.env;

const pick = (...keys) => {
  for (const k of keys) if (env[k]) return env[k];
  return '';
};

export const API_URL = pick('VITE_API_URL', 'NEXT_PUBLIC_API_URL').replace(/\/$/, '');
export const AGENT_API_URL = (pick('VITE_AGENT_API_URL') || API_URL).replace(/\/$/, '');
export const SUPABASE_URL = pick('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = pick('VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const MOCK_MODE = env.VITE_MOCK === 'true';
