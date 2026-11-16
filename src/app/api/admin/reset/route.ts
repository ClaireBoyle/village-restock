import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/lib/server/auth';
import { previewReset, resetSessions, resetsReady } from '@/lib/server/reset';

export const dynamic = 'force-dynamic';

const body = z.object({
  departmentId: z.uuid(),
  kind: z.enum(['full', 'quick', 'area']),
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  areaId: z.uuid().nullable().optional(),
  /** Quick restocks: the device's own restock(s). */
  sessionIds: z.array(z.uuid()).max(50).optional(),
  /** Absent: just show what would be erased. Present: reset exactly these (they must match the preview). */
  confirm: z.array(z.uuid()).max(50).optional(),
});

// POST /api/admin/reset: admins only (the middleware already refuses anyone without an admin
// sign-in; this re-checks the account is a current, active admin).
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (viewer.role !== 'admin') return NextResponse.json({ error: 'Only a signed-in admin can reset a restock.' }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'Something went wrong. Reload and try again.' }, { status: 400 });
  if (!(await resetsReady())) return NextResponse.json({ error: 'Run db/migrations/010_restock_resets.sql in Supabase first.' }, { status: 409 });
  const scope = p.data;
  const targets = await previewReset(scope);
  if (!scope.confirm) return NextResponse.json({ targets }, { headers: { 'Cache-Control': 'no-store' } });

  // Only what the admin saw and confirmed, and only in this department and scope.
  const allowed = new Set(targets.map((t) => t.id));
  const ids = scope.confirm.filter((id) => allowed.has(id));
  if (ids.length !== scope.confirm.length) {
    return NextResponse.json({ error: 'This restock changed since you opened the confirmation. Check it again.', targets }, { status: 409 });
  }
  try {
    const n = await resetSessions(ids, { departmentId: scope.departmentId, by: viewer.name });
    return NextResponse.json({ reset: n, ids }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
