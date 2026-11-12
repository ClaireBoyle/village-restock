import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ActionForm, SubmitButton } from '@/components/admin/ActionForm';
import { removeSampleData } from '@/app/actions/admin';
import { db, getSetting } from '@/lib/server/db';

export default async function Overview({ searchParams }: { searchParams: Promise<{ removed?: string }> }) {
  const { removed } = await searchParams;
  const rm = removed?.match(/^(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/);
  const sql = db();
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
