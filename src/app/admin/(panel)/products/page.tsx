import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { MoveButtons } from '@/components/admin/MoveButtons';
import { ScrollToRow } from '@/components/admin/ScrollToRow';
import { ProductFilters } from '@/components/admin/ProductFilters';
import { db } from '@/lib/server/db';

const METHOD: Record<string, string> = { par: 'Target level', manual: 'Staff enter need', routine: 'Routine task' };

export default async function Products({ searchParams }: { searchParams: Promise<{ dept?: string; q?: string; status?: string; deleted?: string; saved?: string; at?: string }> }) {
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

  // Normal view: grouped by area in the order staff check them, so the arrows
  // change exactly what staff see. Search and archived views are a flat list.
  const grouped = Boolean(dept) && status === 'active' && !q;
  const byArea = grouped ? await sql`
    select a.id as area_id, a.name as area_name, pl.id as placement_id, pl.par_level,
           p.id, p.name, p.method, p.unit_plural, p.is_sample
    from check_areas a
    join product_placements pl on pl.check_area_id = a.id
    join products p on p.id = pl.product_id and p.status = 'active'
    where a.department_id = ${dept!} and a.active
    order by a.sort_order, a.name, pl.sort_order, pl.created_at` : [];
  const areas: { id: string; name: string; items: typeof byArea }[] = [];
  for (const r of byArea) {
    let g = areas.find((x) => x.id === r.areaId);
    if (!g) areas.push((g = { id: String(r.areaId), name: String(r.areaName), items: [] as unknown as typeof byArea }));
    (g.items as unknown as Record<string, unknown>[]).push(r);
  }
  const seen = new Set<string>(); // first row of each product gets an anchor (#p-<id>) to land on after saving
  const unplaced = grouped ? rows.filter((p) => (p.placements as unknown[]).length === 0) : [];

  return (
    <>
      <div className="page-head">
        <div><h1>Products</h1><p>What staff check, the target level in each area, and where to collect it from.</p></div>
        {dept ? <Link className="btn primary" href={`/admin/products/new?dept=${dept}`}><Icon name="plus" />Add product</Link> : null}
      </div>
      {sp.saved ? <div className="banner s-ok" role="status"><Icon name="check" /><div><b>{sp.saved.slice(0, 80)} saved.</b></div></div> : null}
      {sp.at && /^[0-9a-f-]{36}$/i.test(sp.at) ? <ScrollToRow id={`p-${sp.at}`} /> : null}
      {sp.deleted ? <div className="banner s-ok" role="status"><Icon name="check" /><div><b>{sp.deleted.slice(0, 80)} deleted.</b><p>Past restocks still show it.</p></div></div> : null}

      {departments.length === 0 ? (
        <div className="banner s-info"><Icon name="info" /><div><b>Add a department first</b><p>Products belong to a department.</p></div><Link className="btn small" href="/admin/departments">Departments</Link></div>
      ) : (
        <ProductFilters departments={departments.map((d) => ({ id: String(d.id), name: String(d.name) }))} dept={dept ?? ''} q={q} status={status} />
      )}

      {grouped ? (
        <>
          <p className="meta">Listed area by area, in the order staff check them. Use <b>Arrange order</b> to drag products into the order staff physically find them.</p>
          {areas.length === 0 && unplaced.length === 0 ? <section className="panel"><p className="meta">No products yet. Add the first one.</p></section> : null}
          {(() => { seen.clear(); return null; })()}
          {areas.map((a) => (
            <section key={a.id} className="panel">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 6 }}>
                <h2>{a.name}<span className="meta" style={{ fontWeight: 400, marginLeft: 10 }}>{a.items.length} product{a.items.length === 1 ? '' : 's'}</span></h2>
                <Link className="btn small" href={`/admin/arrange/${a.id}`}><Icon name="list" />Arrange order</Link>
              </div>
              <div className="rows">
                {a.items.map((p, i) => (
                  <div key={String(p.placementId)} className="row" style={{ scrollMarginTop: 90 }}
                    id={seen.has(String(p.id)) ? undefined : (seen.add(String(p.id)), `p-${p.id}`)}>
                    <div className="grow">
                      <div className="title">{String(p.name)} {p.isSample ? <span className="tag sample">Sample</span> : null}</div>
                      <div className="meta tabular">{p.method === 'par' ? `Target ${p.parLevel ?? '\u2013'} ${p.unitPlural}` : METHOD[String(p.method)]}</div>
                    </div>
                    <MoveButtons kind="placement" id={String(p.placementId)} first={i === 0} last={i === a.items.length - 1} label={String(p.name)} />
                    <Link className="btn small" href={`/admin/products/${p.id}`}>Edit<Icon name="next" /></Link>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {unplaced.length ? (
            <section className="panel">
              <h2 style={{ marginBottom: 6 }}>Not in any area</h2>
              <p className="meta">Staff won&rsquo;t see these until you tick an area for them.</p>
              <div className="rows">
                {unplaced.map((p) => (
                  <div key={String(p.id)} className="row" id={`p-${p.id}`} style={{ scrollMarginTop: 90 }}>
                    <div className="grow"><div className="title">{String(p.name)}</div></div>
                    <Link className="btn small" href={`/admin/products/${p.id}`}>Edit<Icon name="next" /></Link>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : dept ? (
        <section className="panel">
          <h2 style={{ marginBottom: 6 }}>
            {String(departments.find((d) => d.id === dept)?.name ?? '')}
            <span className="meta" style={{ fontWeight: 400, marginLeft: 10 }}>{rows.length} {status === 'archived' ? 'archived ' : ''}product{rows.length === 1 ? '' : 's'}{q ? ` matching \u201c${q}\u201d` : ''}</span>
          </h2>
          <div className="rows">
            {rows.length === 0 ? <p className="meta">{q ? `No products match \u201c${q}\u201d.` : 'No archived products.'}</p> : null}
            {rows.map((p) => {
              const pls = p.placements as { area: string; par: number | null }[];
              return (
                <div key={String(p.id)} className="row" style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 220 }}>
                    <div className="title">{String(p.name)} {p.isSample ? <span className="tag sample">Sample</span> : null}</div>
                    <div className="meta">{METHOD[String(p.method)]}{p.category ? ` · ${p.category}` : ''}{p.location ? ` · from ${p.location}` : ''}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {pls.length === 0 ? <span className="tag sample">Not in any area</span> : pls.map((pl) => (
                        <span key={pl.area} className="tag tabular">{pl.area}{p.method === 'par' ? `: ${pl.par ?? 'no target'} ${pl.par === null ? '' : p.unitPlural}` : ''}</span>
                      ))}
                    </div>
                  </div>
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
