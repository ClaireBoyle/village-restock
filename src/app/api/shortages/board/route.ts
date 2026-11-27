import { NextResponse, type NextRequest } from 'next/server';
import { boardItems, lastNight } from '@/lib/server/restocks';

export const dynamic = 'force-dynamic';

// GET /api/shortages/board?dept=<uuid>&session=<uuid> -> products already short at an earlier restock (already on
// the stock board), for the Finish screen, and what the previous full restock was short of (lastNight).
// session = the restock being finished (left out).
export async function GET(req: NextRequest) {
  const dept = req.nextUrl.searchParams.get('dept') ?? '';
  const session = req.nextUrl.searchParams.get('session') ?? '';
  const id = /^[0-9a-f-]{36}$/i;
  if (!id.test(dept) || (session && !id.test(session))) return NextResponse.json({ error: 'dept required' }, { status: 400 });
  const [items, last] = await Promise.all([boardItems(dept, session || null), lastNight(dept, session || null)]);
  return NextResponse.json({ items, lastNight: last }, { headers: { 'Cache-Control': 'no-store' } });
}
