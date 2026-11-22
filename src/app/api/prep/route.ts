import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/server/db';
import type { PrepHandover } from '@/lib/prep';

export const dynamic = 'force-dynamic';

export interface PrepHandoverResponse { handovers: (PrepHandover & { restockStatus: string; finishedAt: string | null })[] }

// GET /api/prep?dept=<uuid>&since=YYYY-MM-DD -> that department's morning prep handovers since a trading day
// (newest first), for the morning team on any device.
export async function GET(req: NextRequest) {
  const dept = req.nextUrl.searchParams.get('dept') ?? '';
  const since = req.nextUrl.searchParams.get('since') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(dept) || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return NextResponse.json({ error: 'dept and since required' }, { status: 400 });
  const sql = db();
  const headers = { 'Cache-Control': 'no-store' };
  const [{ has }] = await sql`select to_regclass('public.prep_handover_items') is not null as has`;
  if (!has) return NextResponse.json({ handovers: [] } satisfies PrepHandoverResponse, { headers });
  const serviceOnly = req.nextUrl.searchParams.get('service') === '1';
  const rows = await sql`select h.session_id, h.department_id, h.trading_date, h.status, h.updated_by, h.updated_at, s.status as restock_status, s.finished_at
    from prep_handovers h join restock_sessions s on s.id = h.session_id
    where h.department_id = ${dept} and ${serviceOnly ? sql`h.trading_date = ${since}` : sql`h.trading_date >= ${since}`} order by h.trading_date desc, h.updated_at desc ${serviceOnly ? sql`` : sql`limit 5`}`;
  const items = rows.length ? await sql`select id, session_id, task_id, grp, name, qty, note, done_at, done_by from prep_handover_items
    where session_id in ${sql(rows.map((r) => String(r.sessionId)))} order by sort_order` : [];
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  return NextResponse.json({
    handovers: rows.map((h) => ({
      sessionId: String(h.sessionId), departmentId: String(h.departmentId), tradingDate: day(h.tradingDate), status: h.status as 'needed' | 'none',
      updatedBy: (h.updatedBy as string) ?? null, updatedAt: iso(h.updatedAt)!, restockStatus: String(h.restockStatus), finishedAt: iso(h.finishedAt),
      items: items.filter((i) => String(i.sessionId) === String(h.sessionId)).map((i) => ({
        id: String(i.id), taskId: (i.taskId as string) ?? null, group: i.grp as PrepHandover['items'][number]['group'], name: String(i.name),
        qty: (i.qty as string) ?? null, note: (i.note as string) ?? null, doneAt: iso(i.doneAt), doneBy: (i.doneBy as string) ?? null,
      })),
    })),
  } satisfies PrepHandoverResponse, { headers });
}
