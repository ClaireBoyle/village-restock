'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createFirstAdmin, signInAdmin } from '@/lib/server/auth';

export type FormState = { error?: string } | undefined;

export async function adminSignInAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  const r = await signInAdmin(email, password);
  if (!r.ok) return { error: r.error };
  redirect('/admin');
}

const setupSchema = z.object({
  setupCode: z.string().min(1, 'Enter the setup code.'),
  name: z.string().trim().min(1, 'Enter your name.').max(40),
  email: z.email('Enter a valid email address.'),
  password: z.string().min(10, 'Use at least 10 characters for the password.').max(200),
});

export async function setupAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = await createFirstAdmin(parsed.data);
  if (!r.ok) return { error: r.error };
  redirect('/admin');
}
