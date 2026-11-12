import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session-token';

// First line of defence for the admin area: no valid admin cookie, no access.
// Staff screens are checked on the server instead, because whether they need
// the optional staff access code is a setting stored in the database.
// Server code re-checks every admin request too (e.g. the account is still active).
const PUBLIC = ['/admin/login', '/admin/setup'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  if (!needsAdmin || PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();

  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (claims?.role !== 'admin') {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next.js internals and static files (icons, manifest, fonts).
  matcher: ['/((?!_next/|favicon.ico|icons/|manifest.webmanifest|.*\\.(?:png|svg|jpg|jpeg|webp|ico|woff2?)$).*)'],
};
