import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { ADMIN_SESSION_HOURS, SESSION_COOKIE, signSession, verifySession, type SessionClaims } from '@/lib/session-token';

// Staff screens are open to anyone with the link (no staff accounts or codes).
// Only the admin area, where products and par levels are changed, needs a
// sign-in. Its entrance is hidden in the staff app (press and hold the logo).
export type Viewer =
  | { role: 'staff' }
  | { role: 'admin'; adminId: string; name: string };

const MAX_FAILURES = 8;
const FAILURE_WINDOW_MINUTES = 15;

// ---------------------------------------------------------------------------
// Session cookie (admins only)
// ---------------------------------------------------------------------------
async function writeCookie(claims: SessionClaims, maxAgeSeconds: number) {
  const token = await signSession(claims, maxAgeSeconds);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Who is using the app: a signed-in, active admin, or otherwise staff. */
export async function getViewer(): Promise<Viewer> {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (claims) {
    const rows = await db()`select id, display_name from admins where id = ${claims.aid} and active`;
    if (rows.length) return { role: 'admin', adminId: claims.aid, name: String(rows[0].displayName) };
  }
  return { role: 'staff' };
}

/** For admin pages and admin server actions. */
export async function requireAdmin(): Promise<Extract<Viewer, { role: 'admin' }>> {
  const v = await getViewer();
  if (v.role !== 'admin') redirect('/admin/login');
  return v;
}

// ---------------------------------------------------------------------------
// Slowing down password guessing
// ---------------------------------------------------------------------------
async function ipHash(): Promise<string> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`${process.env.SESSION_SECRET ?? ''}:${ip}`).digest('hex').slice(0, 32);
}

async function isLockedOut(hash: string): Promise<boolean> {
  const [{ n }] = await db()`
    select count(*)::int as n from login_failures
    where kind = 'admin' and ip_hash = ${hash}
      and failed_at > now() - make_interval(mins => ${FAILURE_WINDOW_MINUTES})`;
  return Number(n) >= MAX_FAILURES;
}

async function recordFailure(hash: string) {
  await db()`insert into login_failures (kind, ip_hash) values ('admin', ${hash})`;
  await db()`delete from login_failures where failed_at < now() - interval '1 day'`;
}

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= bcrypt.hash('not-a-real-password', 12));

export type AuthResult = { ok: true } | { ok: false; error: string };

const LOCKED = `Too many wrong attempts. Wait ${FAILURE_WINDOW_MINUTES} minutes and try again.`;

// ---------------------------------------------------------------------------
// Admin sign-in
// ---------------------------------------------------------------------------
export async function signInAdmin(email: string, password: string): Promise<AuthResult> {
  const hash = await ipHash();
  if (await isLockedOut(hash)) return { ok: false, error: LOCKED };
  const rows = await db()`select id, display_name, password_hash from admins where lower(email) = lower(${email.trim()}) and active`;
  const row = rows[0];
  // Compare against a dummy hash when the email is unknown, so timing doesn't reveal which emails exist.
  const ok = await bcrypt.compare(password, row ? String(row.passwordHash) : await dummyHash());
  if (!row || !ok) {
    await recordFailure(hash);
    return { ok: false, error: 'Email or password is incorrect.' };
  }
  await db()`update admins set last_login_at = now() where id = ${String(row.id)}`;
  await writeCookie({ role: 'admin', aid: String(row.id), name: String(row.displayName) }, ADMIN_SESSION_HOURS * 3600);
  return { ok: true };
}

export async function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 12);
}

export async function adminCount(): Promise<number> {
  const [{ n }] = await db()`select count(*)::int as n from admins`;
  return Number(n);
}

/** Creates the very first admin. Only works while there are no admins and the setup code matches. */
export async function createFirstAdmin(input: { setupCode: string; name: string; email: string; password: string }): Promise<AuthResult> {
  const expected = process.env.ADMIN_SETUP_CODE;
  if (!expected) return { ok: false, error: 'ADMIN_SETUP_CODE is not set on the server. See README.md.' };
  const hash = await ipHash();
  if (await isLockedOut(hash)) return { ok: false, error: LOCKED };
  if (input.setupCode !== expected) {
    await recordFailure(hash);
    return { ok: false, error: 'Setup code is incorrect.' };
  }
  const passwordHash = await hashSecret(input.password);
  const created = await db().begin(async (tx) => {
    await tx`lock table admins in exclusive mode`;
    const [{ n }] = await tx`select count(*)::int as n from admins`;
    if (Number(n) > 0) return null;
    const [row] = await tx`
      insert into admins (email, display_name, password_hash)
      values (${input.email.trim()}, ${input.name.trim()}, ${passwordHash}) returning id`;
    return String(row.id);
  });
  if (!created) return { ok: false, error: 'An admin already exists. Sign in instead.' };
  await writeCookie({ role: 'admin', aid: created, name: input.name.trim() }, ADMIN_SESSION_HOURS * 3600);
  return { ok: true };
}
