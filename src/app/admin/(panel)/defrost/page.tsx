import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ActionForm, SubmitButton } from '@/components/admin/ActionForm';
import { DefrostItemForm } from '@/components/admin/DefrostItemForm';
import { saveDefrostServiceTime } from '@/app/actions/admin';
import { db, getSetting } from '@/lib/server/db';

export const dynamic = 'force-dynamic';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export default async function DefrostSetup({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const sql = db();
  const [{ has }] = await sql`select to_regclass('public.defrost_items') is not null as has`;
  if (!has) {
    return (
      <>
        <div className="page-head"><div><h1>Defrost Planner</h1></div></div>
        <div className="banner s-warn"><Icon name="warn" /><div><b>One database step needed</b><p>Run <code>db/migrations/006_defrost_planner.sql</code> in Supabase &rsaquo; SQL Editor, then reload this page.</p></div></div>
      </>
    );
  }
  const { dept: q } = await searchParams;
  const depts = await sql`select d.id, d.name, (select count(*) from defrost_items i where i.department_id = d.id)::int as n from departments d where d.active order by d.sort_order, d.name`;
  const dept = depts.find((d) => d.id === q) ?? depts.find((d) => Number(d.n) > 0) ?? depts.find((d) => /kitchen/i.test(String(d.name))) ?? depts[0];
  const items = dept ? await sql`select * from defrost_items where department_id = ${String(dept.id)} order by active desc, sort_order, name` : [];
  // Stage 3 groundwork: what actually happened, by weekday of the service (information only).
  const history = dept ? await sql`
    select e.item_id, extract(isodow from p.service_date)::int as dow, count(*)::int as n,
      avg(e.defrost_qty) filter (where e.defrost_qty is not null) as defrosted,
      sum(coalesce(e.discarded_qty, 0)) as discarded, count(*) filter (where e.ran_out)::int as ran_out
    from defrost_entries e join defrost_plans p on p.id = e.plan_id
    where p.department_id = ${String(dept.id)} and p.service_date >= current_date - 56
    group by e.item_id, dow` : [];
  const serviceTime = String(await getSetting<string>('defrost_service_time', '11:00'));
  const n2 = (v: unknown) => String(Math.round(Number(v) * 100) / 100);

  return (
    <>
      <div className="page-head">
        <div><h1>Defrost Planner</h1><p>What staff should defrost for the next service. Separate from restocking and from the morning opener&rsquo;s prep.</p></div>
      </div>

      <div className="chips" role="tablist" aria-label="Department">
        {depts.map((d) => <Link key={String(d.id)} className={`chip ${d.id === dept?.id ? 'on' : ''}`} href={`/admin/defrost?dept=${d.id}`}>{String(d.name)}{Number(d.n) ? ` (${d.n})` : ''}</Link>)}
      </div>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>Next service</h2>
        <p className="meta">Suggestions check that stock can be safely thawed by this time the next day.</p>
        <ActionForm action={saveDefrostServiceTime} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field"><label htmlFor="st">Next service starts at</label><input id="st" name="serviceTime" type="time" defaultValue={serviceTime} required /></div>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </section>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>{dept ? `${String(dept.name)} items` : 'Items'}</h2>
        <p className="meta">Only add stock that genuinely needs defrosting. The suggestion is <b>expected demand + buffer − usable chilled − already thawing</b>, rounded up to the pack size. Nothing here is ever changed automatically.</p>
        <div className="rows">
          {items.length === 0 ? <p className="meta">No items yet.</p> : null}
          {items.map((i) => {
            const h = history.filter((r) => r.itemId === i.id);
            return (
              <div key={String(i.id)} className={`row ${i.active ? '' : 'muted'}`} style={{ flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 220 }}>
                  <div className="title">{String(i.name)} {!i.active ? <span className="tag">Hidden</span> : null} {i.thawHours === null ? <span className="badge s-bad">No thaw time</span> : null}</div>
                  <div className="meta">Expected {n2(i.expectedDemand)} + buffer {n2(i.buffer)} {String(i.unitPlural)} &middot; packs of {n2(i.packSize)}{i.thawHours !== null ? ` · thaw ${n2(i.thawHours)} h` : ''}{i.shelfLifeHours !== null ? ` · use within ${n2(i.shelfLifeHours)} h` : ''}</div>
                  {h.length ? (
                    <div className="df-hist" aria-label="Last 8 weeks by weekday">
                      {DAYS.map((d, k) => { const r = h.find((x) => Number(x.dow) === k + 1); return (
                        <span key={d} className={r ? '' : 'none'} title={r ? `${r.n} services recorded` : 'No records'}>
                          <b>{DAY_LABEL[d]}</b>{r && Number(r.n) >= 3 && r.defrosted !== null ? <>{n2(r.defrosted)}<small>avg defrosted</small></> : <small>{r ? `${r.n} record${Number(r.n) === 1 ? '' : 's'}` : '–'}</small>}
                          {r && Number(r.discarded) > 0 ? <small className="w">{n2(r.discarded)} discarded</small> : null}
                          {r && Number(r.ranOut) > 0 ? <small className="w">ran out ×{r.ranOut}</small> : null}
                        </span>); })}
                    </div>
                  ) : null}
                </div>
                <details style={{ flexBasis: '100%' }}>
                  <summary className="linkbtn" style={{ cursor: 'pointer' }}>Edit {String(i.name)}</summary>
                  <div style={{ paddingBlock: 8 }}><DefrostItemForm departmentId={String(dept!.id)} item={{
                    id: String(i.id), name: String(i.name), unitSingular: String(i.unitSingular), unitPlural: String(i.unitPlural),
                    expectedDemand: Number(i.expectedDemand), weekdayDemand: (i.weekdayDemand as Record<string, number>) ?? {}, buffer: Number(i.buffer),
                    packSize: Number(i.packSize), minQty: Number(i.minQty), thawMethod: String(i.thawMethod), thawHours: i.thawHours === null ? null : Number(i.thawHours),
                    shelfLifeHours: i.shelfLifeHours === null ? null : Number(i.shelfLifeHours), safetyNotes: String(i.safetyNotes), active: Boolean(i.active),
                  }} /></div>
                </details>
              </div>
            );
          })}
        </div>
        {dept ? (
          <details>
            <summary className="btn small" style={{ listStyle: 'none', display: 'inline-flex' }}><Icon name="plus" />Add an item</summary>
            <div style={{ paddingTop: 12 }}><DefrostItemForm departmentId={String(dept.id)} /></div>
          </details>
        ) : null}
        <p className="meta">History shows averages once a weekday has 3 or more recorded services. Use it to review weekday targets; it never changes them by itself.</p>
      </section>
    </>
  );
}
