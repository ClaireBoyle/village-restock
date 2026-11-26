'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { collectionLines, collectPlacements, sideShares } from '@/lib/restock-logic';
import { formatQty } from '@/lib/restock-math';
import type { RestockCtx } from './RestockApp';
import { ProductThumb } from './ProductCard';
import { Dock } from './shared';

export function StandFillStep({ ctx }: { ctx: RestockCtx }) {
  const { session, placements, recorded, items } = ctx;
  const lines = collectionLines(collectPlacements(session.kind, placements, recorded), items);
  const allocated = new Map(lines.flatMap(line => sideShares(line, items).map(part => [part.placementId, part.collected ?? 0] as const)));
  const groups = new Map<string, { id: string; name: string; amount: string; product: (typeof placements)[number] }[]>();
  for (const p of placements) {
    const qty = allocated.get(p.placementId) ?? 0;
    if (qty <= 0) continue;
    const group = p.side ?? 'Water stand';
    const list = groups.get(group) ?? [];
    list.push({ id: p.placementId, name: p.productName, product: p, amount: formatQty(qty, p.unitSingular, p.unitPlural) });
    groups.set(group, list);
  }

  const key = 'vr-stand-filled-' + session.id;
  const [marks, setMarks] = useState<Record<string, string>>({});
  useEffect(() => {
    try { setMarks(JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}); } catch { setMarks({}); }
  }, [key]);
  function toggle(group: string, signature: string) {
    const next = { ...marks, [group]: marks[group] === signature ? '' : signature };
    setMarks(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Current visit still works. */ }
  }
  return <>
    <main className="wrap restock-main">
      {ctx.header}
      <h2>Fill the stand</h2>
      {!groups.size && <p className="empty">Nothing collected to put out.</p>}
      {[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([group, list]) => {
        const signature = JSON.stringify(list.map(row => [row.id, row.amount]));
        const filled = marks[group] === signature;
        return <section className="stand-panel" data-filled={filled} key={group}>
          <header className="stand-heading">
            <h3>{group}</h3>
            <button className="stand-mark" aria-label={filled ? 'Undo ' + group + ' filled' : 'Mark ' + group + ' filled'} aria-pressed={filled} onClick={() => toggle(group, signature)}>
              {filled ? '✓ Filled · Undo' : 'Mark filled'}
            </button>
          </header>
          <ul className="stand-products">{list.map(row => <li key={row.id}>
            {row.product.photoPath && <ProductThumb src={row.product.photoPath} name={row.name} credit={row.product.photoCredit} className="pphoto" />}
            <span className="stand-name">{row.name}</span><strong className="stand-qty">{row.amount}</strong>
          </li>)}</ul>
        </section>;
      })}
      <style>{`
        .stand-panel { margin: 12px 0; border: 1px solid #40527c; border-radius: 16px; background: #172449; color: #fff; }
        .stand-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: #22355f; border-radius: 15px 15px 0 0; }
        .stand-heading h3 { margin: 0; font-size: 1.15rem; }
        .stand-mark { min-height: 44px; padding: 0 14px; border: 1px solid #829bcb; border-radius: 10px; background: transparent; color: white; font: inherit; font-weight: 600; cursor: pointer; }
        .stand-panel[data-filled=true] .stand-mark { color: #abf3d2; border-color: #72b69a; }
        .stand-products { list-style: none; margin: 0; padding: 0 12px; }
        .stand-products li { display: flex; align-items: center; gap: 10px; padding: 9px 0; min-height: 50px; }
        .stand-products li + li { border-top: 1px solid #344364; }
        .stand-products .pphoto { width: 36px; height: 40px; flex: 0 0 36px; object-fit: contain; }
        .stand-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 550; line-height: 1.25; }
        .stand-qty { background: #293e69; color: #eef4ff; border-radius: 8px; padding: 5px 8px; font-size: .9rem; text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>
    </main>
    <Dock icon="list" title="">
      <button className="btn" onClick={ctx.saveAndExit}>Save &amp; exit</button>
      <button className="btn primary big" onClick={() => ctx.go('finish')}>Review and finish<Icon name="next" /></button>
    </Dock>
  </>;
}
