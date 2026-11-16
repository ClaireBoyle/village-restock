import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// GET /api/defrost?dept=<uuid>&date=YYYY-MM-DD -> that service's Defrost Planner entries (handover between devices)
export async function GET(req: NextRequest) {
  const dept = req.nextUrl.searchParams.get('dept') ?? '';
  const date = req.nextUrl.searchParams.get('date') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(dept) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'dept and date required' }, { status: 400 });
  const sql = db();
  const [{ has }] = await sql`select to_regclass('public.defrost_plans') is not null as has`;
  if (!has) return NextResponse.json({ plan: null, entries: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const [plan] = await sql`select id, people, updated_at from defrost_plans where department_id = ${dept} and service_date = ${date}`;
  const entries = plan ? await sql`select item_id, chilled_qty, thawing_qty, adjust_qty, suggested_qty, defrost_qty, ran_out, discarded_qty, discard_reason, updated_by, updated_at
    from defrost_entries where plan_id = ${String(plan.id)}` : [];
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return NextResponse.json({
    plan: plan ? { id: String(plan.id), people: plan.people } : null,
    entries: entries.map((e) => ({
      itemId: String(e.itemId), chilled: n(e.chilledQty), thawing: n(e.thawingQty), adjust: n(e.adjustQty), suggested: n(e.suggestedQty),
      defrost: n(e.defrostQty), ranOut: Boolean(e.ranOut), discarded: n(e.discardedQty), discardReason: (e.discardReason as string) ?? null,
      updatedBy: (e.updatedBy as string) ?? null, updatedAt: new Date(e.updatedAt as string).toISOString(),
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
