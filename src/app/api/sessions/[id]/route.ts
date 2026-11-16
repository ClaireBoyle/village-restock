import { NextResponse } from 'next/server';
import { getSession } from '@/lib/server/sync';
import { db } from '@/lib/server/db';
import { sessionWasReset } from '@/lib/server/reset';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const s = await getSession(id);
  if (!s) {
    // 410 = an admin reset it: the device drops its copy. 404 = not uploaded yet.
    if (await sessionWasReset(db(), id)) return NextResponse.json({ error: 'reset', reset: true }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json(s, { headers: { 'Cache-Control': 'no-store' } });
}
