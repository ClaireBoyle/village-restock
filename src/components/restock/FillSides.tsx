'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { sideFillLists, type CollectionLine, type ItemState } from '@/lib/restock-logic';
import { round2 } from '@/lib/restock-math';

/**
 * Fill the stand (e.g. the Candy Bar confection stand): Fill Side A / Fill Side B, each a reference list of only
 * what that side needs, in stand order. What was collected for that side, or what it asked for while it's still to
 * collect. Nothing to tick: it's there to look at while filling. Tap the side's button again to close it.
 */
export function FillSides({ lines, items }: { lines: CollectionLine[]; items: Map<string, ItemState> }) {
  const sides = sideFillLists(lines, items);
  const [open, setOpen] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Opened: brought into view, so the whole side's list is there at a glance.
  useEffect(() => { if (open) listRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [open]);
  if (!sides.length) return null;
  const cur = sides.find((s) => s.side === open);
  return (
    <section className="fill-sides" aria-labelledby="fill-h">
      <h3 id="fill-h" className="sec-title"><Icon name="list" />Fill the stand</h3>
      <div className="fill-btns">
        {sides.map((s) => (
          <button key={s.side} type="button" className={`btn big ${open === s.side ? 'primary' : ''}`} aria-expanded={open === s.side} onClick={() => setOpen(open === s.side ? null : s.side)}>
            Fill {s.side}<small>{s.list.length} {s.list.length === 1 ? 'product' : 'products'}</small>
          </button>
        ))}
      </div>
      {cur ? (
        <div ref={listRef} className="fill-list" role="region" aria-label={`Fill ${cur.side}`}>
          <ul>{cur.list.map((r) => (
            <li key={r.productName} className={r.collected === null ? 'todo' : r.collected < r.requested ? 'short' : ''}>
              <b className="fill-n">{round2(r.qty)}</b><span>{r.productName}</span>
              {r.collected === null ? <small>still to collect</small> : r.collected < r.requested ? <small>of {round2(r.requested)} asked for</small> : null}
            </li>
          ))}</ul>
        </div>
      ) : null}
    </section>
  );
}
