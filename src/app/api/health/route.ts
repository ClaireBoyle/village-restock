import { NextResponse, type NextRequest } from 'next/server';
import postgres from 'postgres';
import { db } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

const timed = async (f: () => Promise<unknown>, ms = 20_000) => {
  const t = Date.now();
  try {
    await Promise.race([f(), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);
    return { ms: Date.now() - t };
  } catch (e) {
    return { ms: Date.now() - t, error: String((e as Error).message ?? e).slice(0, 200) };
  }
};

// Tiny endpoint the app pings to tell "really online" from "wifi without internet".
// ?db=1 also times a trivial database query (no data returned), to diagnose slow pages.
export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (req.nextUrl.searchParams.get('db') !== '1') return NextResponse.json({ ok: true, at: new Date().toISOString() }, { headers });
  const shared = await timed(() => db()`select 1`);
  let fresh: { ms: number; error?: string } = { ms: 0, error: 'no DATABASE_URL' };
  if (process.env.DATABASE_URL) {
    const one = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 8, idle_timeout: 1 });
    fresh = await timed(() => one`select 1`);
    one.end({ timeout: 1 }).catch(() => {});
  }
  return NextResponse.json({ ok: !shared.error, shared, fresh, at: new Date().toISOString() }, { headers });
}
