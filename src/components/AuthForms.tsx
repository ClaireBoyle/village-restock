'use client';
import Link from 'next/link';
import { Icon } from './Icon';
import { useKeepValuesForm } from './useKeepValuesForm';
import { adminSignInAction, setupAction, type FormState } from '@/app/actions/auth';

function Submit({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return <button className="btn primary wide" style={{ minHeight: 56 }} disabled={pending}>{pending ? 'Checking…' : children}</button>;
}

function ErrorBanner({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return <div className="banner s-bad" role="alert"><Icon name="warn" /><div><b>{state.error}</b></div></div>;
}

export function AdminSignInForm() {
  const { state, onSubmit, pending } = useKeepValuesForm(adminSignInAction);
  return (
    <form onSubmit={onSubmit} className="auth-card">
      <span className="logo" style={{ width: 52, height: 52, borderRadius: 16 }} aria-hidden="true"><Icon name="lock" /></span>
      <div><h1>Admin sign in</h1><p className="meta" style={{ marginTop: 4 }}>For supervisors who manage products and par levels.</p></div>
      <ErrorBanner state={state} />
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      <Submit pending={pending}>Sign in</Submit>
      <Link className="linkbtn" href="/" style={{ alignSelf: 'center' }}>Back to restocking</Link>
    </form>
  );
}

export function SetupForm() {
  const { state, onSubmit, pending } = useKeepValuesForm(setupAction);
  return (
    <form onSubmit={onSubmit} className="auth-card">
      <span className="logo" style={{ width: 52, height: 52, borderRadius: 16 }} aria-hidden="true"><Icon name="cog" /></span>
      <div><h1>Create the first admin</h1><p className="meta" style={{ marginTop: 4 }}>This page only works once, before any admin exists. The setup code is the ADMIN_SETUP_CODE value from the server settings.</p></div>
      <ErrorBanner state={state} />
      <div className="field"><label htmlFor="setupCode">Setup code</label><input id="setupCode" name="setupCode" type="password" autoComplete="off" required /></div>
      <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" required maxLength={40} /></div>
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /><small>At least 10 characters.</small></div>
      <Submit pending={pending}>Create admin</Submit>
    </form>
  );
}
