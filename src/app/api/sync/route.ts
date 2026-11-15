import { NextResponse, after, type NextRequest } from 'next/server';
import { processEmailOutbox } from '@/lib/server/email';
import { applyOps } from '@/lib/server/sync';
import { syncRequestSchema, type SyncResponse } from '@/lib/sync-types';

export const dynamic = 'force-dynamic';

// POST /api/sync  { deviceId, ops: [...] }
// Applies each change once, in order, and reports what happened to each.
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = syncRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid sync request' }, { status: 400 });
  const results = await applyOps(parsed.data.deviceId, parsed.data.ops);
  // Send any manager emails queued by a finished restock (and retry failed ones) after replying.
  after(() => processEmailOutbox().catch((e) => console.error('email outbox', e)));
  const res: SyncResponse = { results, serverTime: new Date().toISOString() };
  return NextResponse.json(res, { headers: { 'Cache-Control': 'no-store' } });
}
