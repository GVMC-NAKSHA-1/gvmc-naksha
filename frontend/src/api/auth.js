import { AUTH_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

// Supabase is optional: only loaded (dynamic import) when its env vars are set.
let clientPromise = null;

export function getSupabase() {
  if (!AUTH_ENABLED) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
    );
  }
  return clientPromise;
}

export async function getAccessToken() {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signIn(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email, password) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const supabase = await getSupabase();
  if (supabase) await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function onAuthChange(cb) {
  const supabase = await getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_evt, session) => cb(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}
