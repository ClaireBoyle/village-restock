'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { useKeepValuesForm } from '@/components/useKeepValuesForm';
import type { ActionResult } from '@/app/actions/admin';

type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

const Pending = createContext(false);

/** A form wired to a server action that shows a clear success or error message and keeps typed values on error. */
export function ActionForm({ action, children, className, resetOnSuccess = false, style }: {
  action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; style?: React.CSSProperties;
}) {
  const { state, onSubmit, pending } = useKeepValuesForm(action);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} onSubmit={onSubmit} className={className} style={style}>
      {state?.error ? <div className="banner s-bad" role="alert"><Icon name="warn" /><div><b>{state.error}</b></div></div> : null}
      {state?.ok && state.message ? <div className="banner s-ok" role="status"><Icon name="check" /><div><b>{state.message}</b></div></div> : null}
      <Pending.Provider value={pending}>{children}</Pending.Provider>
    </form>
  );
}

export function SubmitButton({ children, className = 'btn primary', pendingText = 'Saving…' }: {
  children: React.ReactNode; className?: string; pendingText?: string;
}) {
  const pending = useContext(Pending);
  return <button className={className} disabled={pending}>{pending ? pendingText : children}</button>;
}
