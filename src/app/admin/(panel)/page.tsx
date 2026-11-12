import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ActionForm, SubmitButton } from '@/components/admin/ActionForm';
import { removeSampleData } from '@/app/actions/admin';
import { db, getSetting } from '@/lib/server/db';
import { markUnfinished, serverToday } from '@/lib/server/restocks';

export default async function Overview({ searchParams }: { searchParams: Promise<{ removed?: string }> }) {
  const { removed } = await searchParams;
  const rm = removed?.match(/^(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/);
  const sql = db();
  await markUnfinished();
  const today = await serverToday();
  const [w] = await sql`
    select
      (select count(*) from shortages where status = 'open')::int as open_shortages,
      (select count(*) from restock_sessions where status = 'unfinished' and trading_date >= current_date - 14)::int as unfinished,
      (select count(*) from session_items i join restock_sessions s on s.id = i.session_id where i.conflict is not null and s.status = 'open')::int as clashes`;
  const tonight = await sql`
    select d.name, s.id, s.status, s.people,
      (select count(*) from session_areas a where a.session_id = s.id and a.status in ('complete', 'skipped'))::int as done,
      (select count(*) from check_areas ca where ca.department_id = d.id and ca.active)::int as total
    from departments d left join restock_sessions s on s.department_id = d.id and s.trading_date = ${today} and s.kind = 'full'
    where d.active order by d.sort_order, d.name`;
  const [c] = await sql`
    select
      (select count(*) from departments where active)::int as departments,
      (select count(*) from check_areas where active)::int as areas,
      (select count(*) from storage_locations where active)::int as locations,
      (select count(*) from products where status = 'active')::int as products,
      (select count(*) from products where status = 'archived')::int as archived,
      (select count(*) from products where is_sample)::int as sample_products,
      (select count(*) from products p where p.status = 'active' and p.method = 'par'
         and exists (select 1 from product_placements pl where pl.product_id = p.id and pl.par_level is null))::int as missing_par,
      (select count(*) from products p where p.status = 'active'
         and not exists (select 1 from product_placements pl where pl.product_id = p.id))::int as no_area`;
  const version = await getSetting<number>('catalogue_version', 1);

  const stats: [string, number, string][] = [
    ['Products', Number(c.products), '/admin/products'],
    ['Departments', Number(c.departments), '/admin/departments'],
    ['Checking areas', Number(c.areas), '/admin/departments'],
    ['Storerooms', Number(c.locations), '/admin/storerooms'],
    ['Archived products', Number(c.archived), '/admin/products?status=archived'],
  ];

  return (
    <>
      <div className="page-head">
        <div><h1>Overview</h1><p>Set up what staff check, where they collect it from, and how much should be there.</p></div>
      </div>

      {rm ? (
        <div className="banner s-ok" role="status"><Icon name="check" /><div><b>Sample data removed</b>
          <p>Removed {rm[1]} products, {rm[2]} areas, {rm[3]} categories, {rm[4]} departments and {rm[5]} storerooms. Anything your own products use was kept.</p></div></div>
      ) : null}
      {Number(c.missingPar) > 0 || Number(c.noArea) > 0 ? (
        <div className="banner s-warn"><Icon name="warn" /><div><b>Some products need attention</b>
          <p>{Number(c.missingPar) > 0 ? `${c.missingPar} without a target level. ` : ''}{Number(c.noArea) > 0 ? `${c.noArea} not assigned to any area.` : ''}</p></div>
          <Link className="btn small" href="/admin/products">Review</Link></div>
      ) : null}

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2>Tonight&rsquo;s full restocks</h2><Link className="linkbtn" href="/admin/restocks">All restocks<Icon name="next" /></Link></div>
        <div className="rows">
          {tonight.map((t) => {
            const [cls, label] = !t.id ? ['s-none', 'Not started'] : t.status === 'finished' ? ['s-ok', 'Complete'] : t.status === 'finished_exceptions' ? ['s-warn', 'Finished with exceptions'] : ['s-info', `In progress \u00b7 ${t.done} of ${t.total} areas`];
            return (
              <div key={String(t.name)} className="row">
                <div className="grow"><div className="title">{String(t.name)}</div>{t.people && (t.people as string[]).length ? <div className="meta">{(t.people as string[]).join(', ')}</div> : null}</div>
                <span className={`badge ${cls}`}>{label}</span>
                {t.id ? <Link className="btn small" href={`/admin/restocks/${t.id}`}>Details<Icon name="next" /></Link> : null}
              </div>
            );
          })}
        </div>
      </section>
      {Number(w.openShortages) || Number(w.unfinished) || Number(w.clashes) ? (
        <div className="stat-grid">
          {Number(w.openShortages) ? <Link href="/admin/shortages" className="stat" style={{ background: 'var(--bad-bg)' }}><b className="tabular" style={{ color: 'var(--bad)' }}>{Number(w.openShortages)}</b><span>Open shortages</span></Link> : null}
          {Number(w.unfinished) ? <Link href="/admin/restocks" className="stat" style={{ background: 'var(--warn-bg)' }}><b className="tabular" style={{ color: 'var(--warn)' }}>{Number(w.unfinished)}</b><span>Unfinished restocks (14 days)</span></Link> : null}
          {Number(w.clashes) ? <Link href="/admin/restocks" className="stat" style={{ background: 'var(--warn-bg)' }}><b className="tabular" style={{ color: 'var(--warn)' }}>{Number(w.clashes)}</b><span>Counts waiting for a decision</span></Link> : null}
        </div>
      ) : null}
      <h2 className="sec-title" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-2)' }}>Catalogue</h2>
      <div className="stat-grid">
        {stats.map(([label, n, href]) => (
          <Link key={label} href={href} className="stat"><b className="tabular">{n}</b><span>{label}</span></Link>
        ))}
      </div>

      {Number(c.sampleProducts) > 0 ? (
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="tag sample">Sample</span><h2>Sample data is loaded</h2></div>
          <p className="meta">{c.sampleProducts} example products are in the catalogue so you can try the app. Their names and targets are made up. Remove them before staff start using the app for real. Anything you&rsquo;ve added yourself is kept.</p>
          <ActionForm action={removeSampleData} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ width: 220 }}>
              <label htmlFor="confirm">Type REMOVE to confirm</label>
              <input id="confirm" name="confirm" autoComplete="off" />
            </div>
            <SubmitButton className="btn danger" pendingText="Removing…">Remove sample data</SubmitButton>
          </ActionForm>
        </section>
      ) : null}

      <p className="meta">Catalogue version {String(version)}. Staff devices download changes automatically the next time they&rsquo;re online.</p>
    </>
  );
}
