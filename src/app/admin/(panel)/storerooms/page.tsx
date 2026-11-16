import { LocationForm } from '@/components/admin/EntityForms';
import { MoveButtons } from '@/components/admin/MoveButtons';
import { db } from '@/lib/server/db';

export default async function Storerooms() {
  const rows = await db()`
    select l.id, l.name, l.active, l.is_sample, coalesce(to_jsonb(l)->>'collect_note', '') as collect_note,
      ((select count(*) from products p where p.default_location_id = l.id and p.status = 'active')
       + (select count(*) from product_placements pl where pl.location_id = l.id))::int as uses
    from storage_locations l order by l.sort_order, l.name`;
  return (
    <>
      <div className="page-head"><div><h1>Storerooms</h1><p>Where staff collect stock from. Collection lists are grouped by these, in this order, so put them in the order staff usually visit them.</p></div></div>
      <section className="panel">
        <div className="rows">
          {rows.length === 0 ? <p className="meta">No storerooms yet.</p> : null}
          {rows.map((l, i) => (
            <div key={String(l.id)} className={`row ${l.active ? '' : 'muted'}`} style={{ flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 200 }}>
                <div className="title">{String(l.name)} {l.isSample ? <span className="tag sample">Sample</span> : null}</div>
                <div className="meta">Used by {Number(l.uses)} products{l.collectNote ? ` · reminder: “${String(l.collectNote)}”` : ''}</div>
              </div>
              <MoveButtons kind="location" id={String(l.id)} first={i === 0} last={i === rows.length - 1} label={String(l.name)} />
              <details style={{ flexBasis: '100%' }}>
                <summary className="linkbtn" style={{ cursor: 'pointer' }}>Edit</summary>
                <div style={{ paddingBlock: 8 }}><LocationForm l={{ id: String(l.id), name: String(l.name), active: Boolean(l.active), collectNote: String(l.collectNote ?? '') }} /></div>
              </details>
            </div>
          ))}
        </div>
      </section>
      <section className="panel"><LocationForm /></section>
    </>
  );
}
