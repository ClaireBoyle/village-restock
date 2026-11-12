import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/server/auth';
import { catalogueVersion, loadCatalogue } from '@/lib/server/catalogue';

export const dynamic = 'force-dynamic';

// GET /api/catalogue?since=<version>
// Devices pass the version they already hold; if nothing changed the reply is tiny.
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'signed_out' }, { status: 401 });

  const since = Number(req.nextUrl.searchParams.get('since'));
  const current = await catalogueVersion();
  const headers = { 'Cache-Control': 'no-store' };
  if (Number.isFinite(since) && since === current) {
    return NextResponse.json({ unchanged: true, version: current }, { headers });
  }
  return NextResponse.json({ unchanged: false, ...(await loadCatalogue()) }, { headers });
}
