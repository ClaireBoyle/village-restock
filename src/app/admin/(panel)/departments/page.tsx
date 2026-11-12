import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { DepartmentForm, type DepartmentRow } from '@/components/admin/EntityForms';
import { MoveButtons } from '@/components/admin/MoveButtons';
import { db } from '@/lib/server/db';

export default async function Departments() {
  const rows = (await db()`
    select d.id, d.name, d.short_name, d.group_label, d.theme, d.icon, d.description, d.active, d.is_sample,
      (select count(*) from check_areas a where a.department_id = d.id and a.active)::int as areas,
      (select count(*) from products p where p.department_id = d.id and p.status = 'active')::int as products
    from departments d order by d.sort_order, d.name`) as unknown as (DepartmentRow & { isSample: boolean; areas: number; products: number })[];

  return (
    <>
      <div className="page-head"><div><h1>Departments &amp; areas</h1><p>Departments appear as cards on the home screen. Open one to set up the areas staff check, in the order they walk them.</p></div></div>
      <section className="panel">
        <div className="rows">
          {rows.length === 0 ? <p className="meta">No departments yet. Add your first one below.</p> : null}
          {rows.map((d, i) => (
            <div key={d.id} className={`row ${d.active ? '' : 'muted'}`}>
              <span className={d.theme === 'gold' ? 'gc' : ''}><span className="dicon" style={{ width: 44, height: 44, borderRadius: 13 }} aria-hidden="true"><Icon name={d.icon} /></span></span>
              <div className="grow">
                <div className="title">{d.name} {d.isSample ? <span className="tag sample">Sample</span> : null} {!d.active ? <span className="tag">Hidden</span> : null}</div>
                <div className="meta">{d.areas} areas · {d.products} products</div>
              </div>
              <MoveButtons kind="department" id={d.id} first={i === 0} last={i === rows.length - 1} label={d.name} />
              <Link className="btn small" href={`/admin/departments/${d.id}`}>Open<Icon name="next" /></Link>
            </div>
          ))}
        </div>
      </section>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Add a department</h2>
        <DepartmentForm />
      </section>
    </>
  );
}
