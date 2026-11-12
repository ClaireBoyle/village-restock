import { NextResponse, type NextRequest } from 'next/server';
import { sessionsForDay } from '@/lib/server/sync';

export const dynamic = 'force-dynamic';

// GET /api/sessions?date=YYYY-MM-DD  -> that trading day's full restocks (for the home screen and handover)
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date required' }, { status: 400 });
  return NextResponse.json({ sessions: await sessionsForDay(date) }, { headers: { 'Cache-Control': 'no-store' } });
}
