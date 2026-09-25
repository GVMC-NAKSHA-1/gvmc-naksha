import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MdSatellite } from 'react-icons/md';
import PageMotion from '../components/PageMotion';
import { Button, inputCls, labelCls } from '../components/ui';
import { signIn, signUp } from '../api/auth';

// Only routed when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set.
export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'signup') {
        await signUp(email, password);
        setMsg({ ok: true, text: 'Account created. Confirm your email if required, then sign in.' });
        setMode('signin');
      } else {
        await signIn(email, password);
        navigate('/');
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message ?? 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageMotion className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="glass flex w-full max-w-sm flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><MdSatellite /></span>
          <div>
            <h1 className="text-lg font-bold">NAKSHA GeoIntegrate</h1>
            <p className="text-xs text-subtle">{mode === 'signin' ? 'Sign in to your workspace' : 'Create an account'}</p>
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Email</span>
          <input className={inputCls} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Password</span>
          <input className={inputCls} type="password" required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {msg && <p className={`rounded-md px-3 py-2 text-xs ${msg.ok ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger-dark'}`}>{msg.text}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
        <p className="text-center text-[11px] text-faint">Without signing in, workspaces run in demo mode.</p>
      </form>
    </PageMotion>
  );
}
