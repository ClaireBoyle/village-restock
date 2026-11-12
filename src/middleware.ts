import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session-token';

// First line of defence: no valid signed cookie, no access.
// Server code re-checks every request in detail (e.g. that the staff code
// hasn't been changed and that an admin account is still active).
const PUBLIC = ['/unlock', '/admin/login', '/admin/setup', '/api/health'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();

  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith('/api/');
  const needsAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');

  if (!claims || (needsAdmin && claims.role !== 'admin')) {
    if (isApi) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = needsAdmin ? '/admin/login' : '/unlock';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next.js internals and static files (icons, manifest, fonts).
  matcher: ['/((?!_next/|favicon.ico|icons/|manifest.webmanifest|.*\\.(?:png|svg|jpg|jpeg|webp|ico|woff2?)$).*)'],
};
