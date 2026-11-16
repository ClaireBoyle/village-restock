import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { ArrangeList } from '@/components/admin/ArrangeList';
import { db } from '@/lib/server/db';

/** Put an area's products in the order staff physically find them (shelf by shelf, left to right). */
export default async function ArrangeArea({ params }: { params: Promise<{ areaId: string }> }) {
  const { areaId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(areaId)) notFound();
  const sql = db();
  const [area] = await sql`select a.id, a.name, a.department_id, d.name as department_name, d.theme
    from check_areas a join departments d on d.id = a.department_id where a.id = ${areaId}`;
  if (!area) notFound();
  const items = await sql`
    select pl.id, p.id as product_id, p.name, c.name as category, p.method, pl.par_level, p.unit_plural, (to_jsonb(pl)->>'heading') as heading
    from product_placements pl
    join products p on p.id = pl.product_id and p.status = 'active'
    left join categories c on c.id = p.category_id
    where pl.check_area_id = ${areaId}
    order by pl.sort_order, pl.created_at`;
  return (
    <>
      <div className="page-head">
        <div>
          <Link className="linkbtn" href={`/admin/products?dept=${area.departmentId}`}><Icon name="back" />Products</Link>
          <h1>Arrange {String(area.name)}</h1>
          <p>{String(area.departmentName)} &middot; Put products in the order staff find them, e.g. top shelf first, left to right. Staff see one list in this order. Optionally add a small subheading above a product to start a group (e.g. &ldquo;Beer, Cider &amp; Hard Soda&rdquo;).</p>
        </div>
      </div>
      <ArrangeList areaId={areaId} items={items.map((r) => ({
        id: String(r.id), productId: String(r.productId), name: String(r.name), category: (r.category as string) ?? null,
        heading: (r.heading as string) ?? null,
        detail: r.method === 'par' ? `Target ${r.parLevel ?? '–'} ${r.unitPlural}` : r.method === 'manual' ? 'Staff enter' : 'Routine task',
      }))} />
    </>
  );
}
