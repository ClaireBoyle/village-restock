'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { collectionLines, collectPlacements, sideShares } from '@/lib/restock-logic';
import { formatQty } from '@/lib/restock-math';
import type { RestockCtx } from './RestockApp';
import { Dock } from './shared';

export function StandFillStep({ ctx }: { ctx: RestockCtx }) {
  const { session, placements, recorded, items } = ctx;
  const lines = collectionLines(collectPlacements(session.kind, placements, recorded), items);
  const allocated = new Map(lines.flatMap(line => sideShares(line, items).map(part => [part.placementId, part.collected ?? 0] as const)));
  const groups = new Map<string, { id: string; name: string; amount: string }[]>();
  for (const p of placements) {
    const qty = allocated.get(p.placementId) ?? 0;
    if (qty <= 0) continue;
    const group = p.side ?? 'Water stand';
    const list = groups.get(group) ?? [];
    list.push({ id: p.placementId, name: p.productName, amount: formatQty(qty, p.unitSingular, p.unitPlural) });
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
        return <section className="fill-sides" key={group}>
          <h3 className="sec-title">{group}</h3>
          <div className="fill-list"><ul>{list.map(row => <li key={row.id}><b>{row.amount}</b><span>{row.name}</span></li>)}</ul></div>
          <button className="btn big" aria-pressed={filled} onClick={() => toggle(group, signature)}>{filled ? '✓ ' + group + ' filled' : 'Mark ' + group + ' filled'}</button>
        </section>;
      })}
    </main>
    <Dock icon="list" title="">
      <button className="btn" onClick={ctx.saveAndExit}>Save &amp; exit</button>
      <button className="btn primary big" onClick={() => ctx.go('finish')}>Review and finish<Icon name="next" /></button>
    </Dock>
  </>;
}
