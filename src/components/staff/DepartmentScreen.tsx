'use client';
import { Icon } from '@/components/Icon';
import { ConnectionPill, TopBar } from '@/components/TopBar';
import { useCatalogue } from '@/lib/client/use-catalogue';
import { formatQty } from '@/lib/restock-math';

// Phase 1: shows the department exactly as staff will check it (areas in
// order, products, par levels, storerooms) so the catalogue can be verified on
// the iPad. Full and Quick Restock arrive in Phase 2.
export function DepartmentScreen({ id }: { id: string }) {
  const { catalogue, checkedAt, connection } = useCatalogue();
  const d = catalogue?.departments.find((x) => x.id === id);
  const areas = catalogue?.areas.filter((a) => a.departmentId === id) ?? [];
  const productById = new Map(catalogue?.products.map((p) => [p.id, p]));
  const locationById = new Map(catalogue?.locations.map((l) => [l.id, l.name]));

  return (
    <div className={d?.theme === 'gold' ? 'gc' : ''}>
      <TopBar backHref="/" crumbs={d ? `Home › ${d.name}` : 'Home'} right={<ConnectionPill connection={connection} checkedAt={checkedAt} />} />
      <main className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBlock: '16px 32px' }}>
        {!catalogue ? <p className="meta">Loading&hellip;</p> : !d ? (
          <div className="banner s-warn"><Icon name="warn" /><div><b>Department not found</b><p>It may have been hidden by an admin.</p></div></div>
        ) : (
          <>
            <section className="dband">
              <span className="dicon" aria-hidden="true"><Icon name={d.icon} /></span>
              <div style={{ flex: 1, minWidth: 180 }}>
                {d.groupLabel ? <p className="eyebrow">{d.groupLabel}</p> : null}
                <h1>{d.shortName}</h1>
                <p className="meta">{areas.length} areas to check</p>
              </div>
            </section>

            <div className="banner s-info">
              <Icon name="info" />
              <div><b>Full and Quick Restock are coming in the next build.</b><p>For now this screen shows each area&rsquo;s products and targets, so you can check the setup is right.</p></div>
            </div>

            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', alignItems: 'start' }}>
              {areas.map((a) => {
                const items = catalogue.placements
                  .filter((pl) => pl.checkAreaId === a.id && productById.has(pl.productId))
                  .map((pl) => ({ pl, p: productById.get(pl.productId)! }));
                return (
                  <section key={a.id} className="panel">
                    <h2>{a.name}</h2>
                    {a.guideText ? <p className="meta" style={{ marginTop: 4 }}>{a.guideText}</p> : null}
                    <div className="rows" style={{ marginTop: 8 }}>
                      {items.length === 0 ? <p className="meta">No products in this area yet.</p> : items.map(({ pl, p }) => (
                        <div className="row" key={pl.id}>
                          <div className="grow">
                            <div className="title">{p.name}</div>
                            <div className="meta">From {locationById.get(pl.locationId ?? p.defaultLocationId ?? '') ?? 'no storeroom set'}</div>
                          </div>
                          <span className="tag tabular">
                            {p.method === 'par' && pl.parLevel != null ? `Target ${formatQty(pl.parLevel, p.unitSingular, p.unitPlural)}`
                              : p.method === 'manual' ? 'Enter what you need' : 'Routine task'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
