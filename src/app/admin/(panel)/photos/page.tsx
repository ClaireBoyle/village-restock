import Link from 'next/link';
import { PhotoFinder } from '@/components/admin/PhotoFinder';
import { db } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Product photos, department by department, in the order staff walk them. */
export default async function Photos({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const sql = db();
  const { dept: q } = await searchParams;
  const depts = await sql`select id, name from departments where active order by sort_order, name`;
  const dept = depts.find((d) => d.id === q) ?? depts[0];
  const [{ hasCredit }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'photos' and column_name = 'credit') as has_credit`;
  const rows = dept ? await sql`
    select distinct on (p.id) p.id, p.name, p.photo_path, a.name as area, a.sort_order as a_sort, pl.sort_order as pl_sort,
      ${hasCredit ? sql`(select credit from photos ph where p.photo_path = '/api/photos/' || ph.id::text)` : sql`null`} as credit
    from products p
    join product_placements pl on pl.product_id = p.id
    join check_areas a on a.id = pl.check_area_id and a.active
    where p.department_id = ${String(dept.id)} and p.status = 'active'
    order by p.id, a.sort_order, pl.sort_order` : [];
  const products = [...rows].sort((x, y) => Number(x.aSort) - Number(y.aSort) || Number(x.plSort) - Number(y.plSort))
    .map((r) => ({ id: String(r.id), name: String(r.name), photo: (r.photoPath as string) ?? null, credit: (r.credit as string) ?? null, area: String(r.area) }));
  return (
    <>
      <div className="page-head">
        <div><h1>Product photos</h1><p>Photos help staff spot the right pack. Find one from Open Food Facts (a free, public product database) or upload your own.</p></div>
      </div>
      <div className="chips" role="tablist" aria-label="Department">
        {depts.map((d) => <Link key={String(d.id)} className={`chip ${d.id === dept?.id ? 'on' : ''}`} href={`/admin/photos?dept=${d.id}`}>{String(d.name)}</Link>)}
      </div>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {products.length ? <PhotoFinder key={String(dept?.id)} products={products} /> : <p className="meta">No products in this department yet.</p>}
      </section>
    </>
  );
}
