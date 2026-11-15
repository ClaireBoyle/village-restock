import { requireAdmin } from '@/lib/server/auth';
import { exportProductsCsv, exportRestocksCsv, exportShortagesCsv } from '@/lib/server/catalogue-csv';
import { loadCatalogue } from '@/lib/server/catalogue';

export const dynamic = 'force-dynamic';

// Admin only (also blocked by the middleware for anyone not signed in as an admin).
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  await requireAdmin();
  const { kind } = await params;
  const today = new Date().toISOString().slice(0, 10);
  let csv: string;
  if (kind === 'products') csv = await exportProductsCsv();
  else if (kind === 'shortages') csv = await exportShortagesCsv();
  else if (kind === 'restocks') csv = await exportRestocksCsv((await loadCatalogue()).settings.timeZone);
  else return new Response('Not found', { status: 404 });
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="village-restock-${kind}-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
