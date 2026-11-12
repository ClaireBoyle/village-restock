// Signed admin sign-in cookie, shared by middleware (edge runtime) and server code.
// Staff don't sign in, so only admins ever get one.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'vr_session';
export const ADMIN_SESSION_HOURS = 12;

export type SessionClaims = { role: 'admin'; aid: string; name: string };

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
    if (payload.role === 'admin' && typeof payload.aid === 'string') {
      return { role: 'admin', aid: payload.aid, name: String(payload.name ?? '') };
    }
    return null;
  } catch {
    return null;
  }
}
