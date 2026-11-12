// Signed session cookie, shared by middleware (edge runtime) and server code.
// The cookie only says WHO this device is signed in as; it holds no stock data.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'vr_session';
export const STAFF_SESSION_DAYS = 30;
export const ADMIN_SESSION_HOURS = 12;

export type SessionClaims =
  | { role: 'staff'; sv: number }                       // sv = staff code version when unlocked
  | { role: 'admin'; aid: string; name: string; sv: number };

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims, maxAgeSeconds: number): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    if (payload.role === 'staff' && typeof payload.sv === 'number') return { role: 'staff', sv: payload.sv };
    if (payload.role === 'admin' && typeof payload.aid === 'string' && typeof payload.sv === 'number') {
      return { role: 'admin', aid: payload.aid, name: String(payload.name ?? ''), sv: payload.sv };
    }
    return null;
  } catch {
    return null;
  }
}
