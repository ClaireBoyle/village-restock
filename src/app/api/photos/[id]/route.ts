import { db } from '@/lib/server/db';

// Photos never change (a new photo gets a new id), so devices may keep them for good.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const [p] = await db()`select data, content_type from photos where id = ${id}`;
  if (!p) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(p.data as Buffer), {
    headers: {
      'Content-Type': String(p.contentType),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
