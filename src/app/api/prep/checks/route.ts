import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/server/db';
import type { PrepCheck } from '@/lib/prep';

export const dynamic = 'force-dynamic';

export interface PrepChecksResponse { ready: boolean; checks: PrepCheck[] }

// GET /api/prep/checks?dept=<uuid>&since=YYYY-MM-DD -> that department's Prep checklist from a trading day on
// (this service, and last night's "Leave for morning" jobs for the morning team), shared between devices.
export async function GET(req: NextRequest) {
  const dept = req.nextUrl.searchParams.get('dept') ?? '';
  const since = req.nextUrl.searchParams.get('since') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(dept) || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return NextResponse.json({ error: 'dept and since required' }, { status: 400 });
  const sql = db();
  const headers = { 'Cache-Control': 'no-store' };
  const [{ has }] = await sql`select to_regclass('public.prep_checks') is not null as has`;
  if (!has) return NextResponse.json({ ready: false, checks: [] } satisfies PrepChecksResponse, { headers });
  const rows = await sql`select trading_date, task_id, status, morning, note, morning_done_at, morning_done_by, updated_by, updated_at
    from prep_checks where department_id = ${dept} and trading_date >= ${since} order by trading_date`;
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  return NextResponse.json({
    ready: true,
    checks: rows.map((r) => ({
      departmentId: dept, tradingDate: day(r.tradingDate), taskId: String(r.taskId), status: (r.status as PrepCheck['status']) ?? null,
      morning: Boolean(r.morning), note: (r.note as string) ?? null, morningDoneAt: iso(r.morningDoneAt), morningDoneBy: (r.morningDoneBy as string) ?? null,
      updatedBy: (r.updatedBy as string) ?? null, updatedAt: iso(r.updatedAt)!,
    })),
  } satisfies PrepChecksResponse, { headers });
}
