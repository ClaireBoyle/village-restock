import { NextResponse } from 'next/server';
import { getSession } from '@/lib/server/sync';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const s = await getSession(id);
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(s, { headers: { 'Cache-Control': 'no-store' } });
}
