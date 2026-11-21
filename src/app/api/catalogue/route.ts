import { NextResponse, type NextRequest } from 'next/server';
import { catalogueVersion, loadCatalogue } from '@/lib/server/catalogue';

export const dynamic = 'force-dynamic';

// The app release. A copy made by an earlier release may be missing settings the new one reads
// (e.g. a database update run while the previous release was still live), so it's always replaced.
const REV = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? 'dev').slice(0, 12);

// GET /api/catalogue?since=<version>&rev=<release>
// Devices pass the version (and release) they already hold; if nothing changed the reply is tiny.
export async function GET(req: NextRequest) {
  const since = Number(req.nextUrl.searchParams.get('since'));
  const rev = req.nextUrl.searchParams.get('rev') ?? '';
  const current = await catalogueVersion();
  const headers = { 'Cache-Control': 'no-store' };
  if (Number.isFinite(since) && since === current && rev === REV) {
    return NextResponse.json({ unchanged: true, version: current }, { headers });
  }
  return NextResponse.json({ unchanged: false, ...(await loadCatalogue()), rev: REV }, { headers });
}
