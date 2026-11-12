'use client';
import { startTransition, useActionState, type FormEvent } from 'react';

/**
 * Like useActionState, but the form keeps what the person typed when the
 * server returns an error. (React 19 clears a <form action={...}> after every
 * submission, which would make staff re-type everything after a typo.)
 */
export function useKeepValuesForm<S>(action: (prev: S, form: FormData) => Promise<S>) {
  const [state, formAction, pending] = useActionState<S, FormData>(
    action as (prev: Awaited<S>, form: FormData) => Promise<S>,
    undefined as Awaited<S>,
  );
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  return { state, onSubmit, pending };
}
