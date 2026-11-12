import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { MoveButtons } from '@/components/admin/MoveButtons';
import { db } from '@/lib/server/db';

const METHOD: Record<string, string> = { par: 'Target level', manual: 'Staff enter need', routine: 'Routine task' };

export default async function Products({ searchParams }: { searchParams: Promise<{ dept?: string; q?: string; status?: string }> }) {
  const sp = await searchParams;
  const sql = db();
  const departments = await sql`select id, name from departments order by sort_order, name`;
  const dept = departments.find((d) => d.id === sp.dept)?.id as string | undefined ?? (departments[0]?.id as string | undefined);
  const status = sp.status === 'archived' ? 'archived' : 'active';
  const q = (sp.q ?? '').trim().slice(0, 60);

  const rows = dept ? await sql`
    select p.id, p.name, p.method, p.unit_plural, p.is_sample, c.name as category, l.name as location,
      coalesce((select json_agg(json_build_object('area', a.name, 'par', pl.par_level) order by a.sort_order)
        from product_placements pl join check_areas a on a.id = pl.check_area_id where pl.product_id = p.id), '[]') as placements
    from products p
    left join categories c on c.id = p.category_id
    left join storage_locations l on l.id = p.default_location_id
    where p.department_id = ${dept} and p.status = ${status}
      ${q ? sql`and p.name ilike ${'%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%'}` : sql``}
    order by p.sort_order, p.name` : [];

  return (
    <>
      <div className="page-head">
        <div><h1>Products</h1><p>What staff check, the target level in each area, and where to collect it from.</p></div>
        {dept ? <Link className="btn primary" href={`/admin/products/new?dept=${dept}`}><Icon name="plus" />Add product</Link> : null}
      </div>

      {departments.length === 0 ? (
        <div className="banner s-info"><Icon name="info" /><div><b>Add a department first</b><p>Products belong to a department.</p></div><Link className="btn small" href="/admin/departments">Departments</Link></div>
      ) : (
        <form className="panel" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="dept">Department</label>
            <select id="dept" name="dept" defaultValue={dept}>{departments.map((d) => <option key={String(d.id)} value={String(d.id)}>{String(d.name)}</option>)}</select></div>
          <div className="field" style={{ flex: '2 1 240px' }}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={q} placeholder="Product name" /></div>
          <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="status">Showing</label>
            <select id="status" name="status" defaultValue={status}><option value="active">Active products</option><option value="archived">Archived products</option></select></div>
          <button className="btn">Apply</button>
        </form>
      )}

      {dept ? (
        <section className="panel">
          <div className="rows">
            {rows.length === 0 ? <p className="meta">{q ? `No products match “${q}”.` : status === 'archived' ? 'No archived products.' : 'No products yet. Add the first one.'}</p> : null}
            {rows.map((p, i) => {
              const pls = p.placements as { area: string; par: number | null }[];
              return (
                <div key={String(p.id)} className="row" style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 220 }}>
                    <div className="title">{String(p.name)} {p.isSample ? <span className="tag sample">Sample</span> : null}</div>
                    <div className="meta">
                      {METHOD[String(p.method)]}{p.category ? ` · ${p.category}` : ''}{p.location ? ` · from ${p.location}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {pls.length === 0 ? <span className="tag sample">Not in any area</span> : pls.map((pl) => (
                        <span key={pl.area} className="tag tabular">{pl.area}{p.method === 'par' ? `: ${pl.par ?? 'no target'} ${pl.par === null ? '' : p.unitPlural}` : ''}</span>
                      ))}
                    </div>
                  </div>
                  {status === 'active' && !q ? <MoveButtons kind="product" id={String(p.id)} first={i === 0} last={i === rows.length - 1} label={String(p.name)} /> : null}
                  <Link className="btn small" href={`/admin/products/${p.id}`}>Edit<Icon name="next" /></Link>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}
