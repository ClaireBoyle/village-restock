import Link from 'next/link';
import { PrepTaskForm } from '@/components/admin/EntityForms';
import { MoveButtons } from '@/components/admin/MoveButtons';
import { db } from '@/lib/server/db';
import { PREP_GROUPS } from '@/lib/prep';

/** The morning prep checklist the closing team chooses from on the Finish screen. */
export default async function MorningPrepAdmin({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const sql = db();
  const [{ ok }] = await sql`select to_regclass('public.prep_tasks') is not null as ok`;
  if (!ok) {
    return (<><div className="page-head"><div><h1>Morning prep</h1></div></div>
      <section className="panel"><p>Run <code>db/migrations/017_morning_prep.sql</code> in the Supabase SQL editor to set up the morning prep handover.</p></section></>);
  }
  const depts = await sql`select d.id, d.name, (select count(*) from prep_tasks t where t.department_id = d.id)::int as n
    from departments d where d.active order by (lower(d.name) like '%kitchen%') desc, d.sort_order`;
  const { dept } = await searchParams;
  const cur = depts.find((d) => String(d.id) === dept) ?? depts.find((d) => Number(d.n) > 0) ?? depts[0];
  if (!cur) return null;
  const tasks = await sql`select id, grp, name, active from prep_tasks where department_id = ${String(cur.id)} order by sort_order, name`;
  return (
    <>
      <div className="page-head"><div><h1>Morning prep</h1>
        <p>The checklist the closing team picks from on the Finish screen (&ldquo;Morning prep needed&rdquo;). What they pick is shown to the morning team on the department screen, where each task is marked Done. Staff can also type in a task that isn&rsquo;t here.</p></div></div>
      <nav className="chips" aria-label="Department">{depts.map((d) => (
        <Link key={String(d.id)} className={`chip ${d.id === cur.id ? 'on' : ''}`} href={`/admin/prep?dept=${d.id}`}>{String(d.name)}{Number(d.n) ? ` (${Number(d.n)})` : ''}</Link>
      ))}</nav>
      {PREP_GROUPS.map(([g, label]) => {
        const list = tasks.filter((t) => t.grp === g);
        if (!list.length) return null;
        return (
          <section key={g} className="panel">
            <h2>{label}</h2>
            <div className="rows">{list.map((t) => {
              const i = tasks.indexOf(t);
              return (
                <div key={String(t.id)} className={`row ${t.active ? '' : 'muted'}`} style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 200 }}><div className="title">{String(t.name)}</div>{t.active ? null : <div className="meta">Not on the checklist</div>}</div>
                  <MoveButtons kind="prepTask" id={String(t.id)} first={i === 0} last={i === tasks.length - 1} label={String(t.name)} />
                  <details style={{ flexBasis: '100%' }}>
                    <summary className="linkbtn" style={{ cursor: 'pointer' }}>Edit</summary>
                    <div style={{ paddingBlock: 8 }}><PrepTaskForm departmentId={String(cur.id)} t={{ id: String(t.id), name: String(t.name), group: String(t.grp), active: Boolean(t.active) }} /></div>
                  </details>
                </div>
              );
            })}</div>
          </section>
        );
      })}
      <section className="panel"><PrepTaskForm departmentId={String(cur.id)} /></section>
    </>
  );
}
