import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { AreaForm, CategoryForm, DepartmentForm, type DepartmentRow } from '@/components/admin/EntityForms';
import { PhotoField } from '@/components/admin/PhotoField';
import { MoveButtons } from '@/components/admin/MoveButtons';
import { db } from '@/lib/server/db';

export default async function DepartmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = db();
  const [d] = (await sql`select id, name, short_name, group_label, theme, icon, description, active, coalesce((to_jsonb(departments)->>'restock_by_area')::boolean, false) as restock_by_area,
    coalesce((to_jsonb(departments)->>'none_on_display')::boolean, false) as none_on_display from departments where id = ${id}`) as unknown as DepartmentRow[];
  if (!d) notFound();
  const areas = await sql`
    select a.id, a.name, a.guide_text, a.guide_photo_path, a.active, a.is_sample,
      (to_jsonb(a)->>'parent_area_id') as parent_area_id, coalesce(to_jsonb(a)->>'section_mode', 'open') as section_mode,
      (select count(*) from product_placements pl join products p on p.id = pl.product_id and p.status = 'active' where pl.check_area_id = a.id)::int as products
    from check_areas a where a.department_id = ${id} order by a.sort_order, a.name`;
  const categories = await sql`
    select c.id, c.name, c.active, (select count(*) from products p where p.category_id = c.id and p.status = 'active')::int as products
    from categories c where c.department_id = ${id} order by c.sort_order, c.name`;

  return (
    <div className={d.theme === 'gold' ? 'gc' : ''} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="page-head">
        <div><Link className="linkbtn" href="/admin/departments"><Icon name="back" />All departments</Link><h1>{d.name}</h1></div>
        <Link className="btn" href={`/admin/products?dept=${d.id}`}>Products in this department<Icon name="next" /></Link>
      </div>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>Checking areas</h2>
        <p className="meta">The physical places staff check, such as a fridge or a shelf. Put them in the order staff usually walk them.</p>
        <div className="rows">
          {areas.length === 0 ? <p className="meta">No areas yet.</p> : null}
          {areas.map((a, i) => (
            <div key={String(a.id)} className={`row ${a.active ? '' : 'muted'}`} style={{ flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 200 }}>
                <div className="title">{String(a.name)} {a.isSample ? <span className="tag sample">Sample</span> : null} {!a.active ? <span className="tag">Hidden</span> : null}</div>
                <div className="meta">{Number(a.products)} products{a.guideText ? ' · has a stocking guide' : ''}{a.guidePhotoPath ? ' · has a photo' : ''}{a.parentAreaId ? ` · section of ${String(areas.find((x) => x.id === a.parentAreaId)?.name ?? '?')}${a.sectionMode === 'optional' ? ' (optional)' : a.sectionMode === 'collapsed' ? ' (collapsed)' : ''}` : ''}</div>
              </div>
              <Link className="btn small" href={`/admin/arrange/${a.id}`}><Icon name="list" />Arrange products</Link>
              <MoveButtons kind="area" id={String(a.id)} first={i === 0} last={i === areas.length - 1} label={String(a.name)} />
              <details style={{ flexBasis: '100%' }}>
                <summary className="linkbtn" style={{ cursor: 'pointer' }}>Edit {String(a.name)}</summary>
                <div style={{ paddingBlock: 8 }}><AreaForm departmentId={id} parents={areas.filter((x) => !x.parentAreaId && x.id !== a.id).map((x) => ({ id: String(x.id), name: String(x.name) }))}
                  a={{ id: String(a.id), name: String(a.name), guideText: String(a.guideText), active: Boolean(a.active), parentAreaId: (a.parentAreaId as string) ?? null, sectionMode: String(a.sectionMode) }} /></div>
                <div style={{ paddingBlock: 8 }}><b style={{ display: 'block', marginBottom: 8 }}>Guide photo</b>
                  <PhotoField kind="area" id={String(a.id)} current={(a.guidePhotoPath as string) ?? null}
                    hint="A photo of the area fully stocked, so staff can see how it should look." /></div>
              </details>
            </div>
          ))}
        </div>
        <details>
          <summary className="btn small" style={{ listStyle: 'none', display: 'inline-flex' }}><Icon name="plus" />Add an area</summary>
          <div style={{ paddingTop: 12 }}><AreaForm departmentId={id} parents={areas.filter((x) => !x.parentAreaId).map((x) => ({ id: String(x.id), name: String(x.name) }))} /></div>
        </details>
      </section>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>Categories</h2>
        <p className="meta">Used to browse and search in Quick Restock, e.g. Beer, Dairy, Cups.</p>
        <div className="rows">
          {categories.map((c, i) => (
            <div key={String(c.id)} className={`row ${c.active ? '' : 'muted'}`} style={{ flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 200 }}><div className="title">{String(c.name)}</div><div className="meta">{Number(c.products)} products</div></div>
              <MoveButtons kind="category" id={String(c.id)} first={i === 0} last={i === categories.length - 1} label={String(c.name)} />
              <details style={{ flexBasis: '100%' }}>
                <summary className="linkbtn" style={{ cursor: 'pointer' }}>Rename or hide</summary>
                <div style={{ paddingBlock: 8 }}><CategoryForm departmentId={id} c={{ id: String(c.id), name: String(c.name), active: Boolean(c.active) }} /></div>
              </details>
            </div>
          ))}
        </div>
        <CategoryForm departmentId={id} />
      </section>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Department details</h2>
        <DepartmentForm d={d} />
      </section>
    </div>
  );
}
