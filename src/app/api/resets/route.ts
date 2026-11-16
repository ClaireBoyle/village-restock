import { NextResponse } from 'next/server';
import { recentResets } from '@/lib/server/reset';

export const dynamic = 'force-dynamic';

// GET /api/resets: restocks (and defrost records) an admin reset recently, by id only.
// Devices drop their old copies of these and any changes still queued for them.
export async function GET() {
  return NextResponse.json(await recentResets(), { headers: { 'Cache-Control': 'no-store' } });
}
