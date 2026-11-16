'use client';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { EMPTY_ITEM, collectionLines, isChecked } from '@/lib/restock-logic';
import { formatQty } from '@/lib/restock-math';
import { setItems, updateLocalSession } from '@/lib/client/restock-store';
import { ProductRow, ProductThumb } from './ProductCard';
import { Dock, initials } from './shared';
import type { RestockCtx } from './RestockApp';

/** Quick Restock: pick just what's running low, no full inspection. */
export function QuickStep({ ctx }: { ctx: RestockCtx }) {
  const { view, session, items, who, placements } = ctx;
  const [q, setQ] = useState('');
  const [by, setBy] = useState<'area' | 'cat'>('area');
  const [chip, setChip] = useState('all');
  const selected = new Set(session.selected);

  const chips = useMemo(() => by === 'area'
    ? view.areas.map(({ area }) => [area.id, area.name] as const)
    : [...new Set(view.placements.map((p) => p.categoryName).filter(Boolean) as string[])].map((c) => [c, c] as const), [by, view]);

  const query = q.trim().toLowerCase();
  const results = view.placements.filter((p) => {
    if (query) return `${p.productName} ${p.areaName} ${p.categoryName ?? ''}`.toLowerCase().includes(query);
    if (chip === 'all') return true;
    return by === 'area' ? p.areaId === chip : p.categoryName === chip;
  });

  const toggle = (id: string) => {
    const next = selected.has(id) ? session.selected.filter((x) => x !== id) : [...session.selected, id];
    void updateLocalSession(session.id, { selected: next });
  };
  const lines = collectionLines(placements, items);
  const unchecked = placements.filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).length;

  return (
    <>
      <main className="wrap restock-main">
        {ctx.header}
        <div className="quick">
          <section className="qpanel" aria-label="Find products">
            <label className="search" htmlFor="qsearch"><Icon name="search" />
              <input id="qsearch" type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
            <div className="segb" role="group" aria-label="Browse by">
              <button className={by === 'area' ? 'on' : ''} onClick={() => { setBy('area'); setChip('all'); }}>By area</button>
              <button className={by === 'cat' ? 'on' : ''} onClick={() => { setBy('cat'); setChip('all'); }}>By category</button>
            </div>
            <div className="chips">
              {[['all', 'All'] as const, ...chips].map(([v, l]) => <button key={v} className={`chip ${chip === v && !query ? 'on' : ''}`} onClick={() => { setChip(v); setQ(''); }}>{l}</button>)}
            </div>
            {results.length === 0 ? <p className="empty">No products match &ldquo;{q}&rdquo;. Try a shorter word.</p> : (
              <div className="qlist">
                {results.map((p) => {
                  const on = selected.has(p.placementId);
                  return (
                    <div key={p.placementId} className="qrow">
                      {p.photoPath ? <ProductThumb src={p.photoPath} name={p.productName} credit={p.photoCredit} className="q-photo" /> : <div className="thumb" aria-hidden="true">{initials(p.productName)}</div>}
                      <div className="t"><b>{p.productName}</b><small>{p.areaName} &middot; {p.method === 'par' && p.par !== null ? `Target ${formatQty(p.par, p.unitSingular, p.unitPlural)}` : p.method === 'manual' ? 'Enter what you need' : 'Routine task'}</small></div>
                      <button className={`btn ${on ? 'good' : ''}`} onClick={() => toggle(p.placementId)} aria-pressed={on}>{on ? <><Icon name="check" />Added</> : <><Icon name="plus" />Add</>}</button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="picked" aria-label="Your list">
            <h2 style={{ fontSize: 22 }}>Your list ({placements.length})</h2>
            <div className="prows">
              {placements.length === 0 ? <div className="empty"><b>Your list is empty.</b><br />Tap <b>Add</b> on anything that&rsquo;s running low.</div> : placements.map((p) => (
                <ProductRow key={p.placementId} p={p} item={items.get(p.placementId) ?? EMPTY_ITEM} showArea onRemove={() => toggle(p.placementId)}
                  note={p.method !== 'routine' ? p.instructions : null}
                  onChange={(fields, resolve) => void setItems(session.id, [{ placementId: p.placementId, fields }], who, resolve)} />
              ))}
            </div>
          </section>
        </div>
      </main>
      <Dock icon="list" title={`${placements.length} on your list · ${lines.length} to collect`} sub={unchecked ? `${unchecked} still need a number` : placements.length ? 'Ready to collect' : 'Add products to start'}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        <button className="btn primary big" onClick={() => ctx.go('collect')} disabled={!lines.length}><span className="lg">Collection list</span><span className="sm">Collect</span><Icon name="next" /></button>
      </Dock>
    </>
  );
}
