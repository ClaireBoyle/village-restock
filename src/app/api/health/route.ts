import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Tiny endpoint the app pings to tell "really online" from "wifi without internet".
export function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
