'use client';
// Gold Class Kitchen rows that aren't a plain "how many to collect":
// * RefillRow: a working drawer or tub refilled from stock already upstairs. One tap: Stocked (enough for
//   service, already full or topped up) or Needs stock (couldn't fill it: e.g. the box under it was used up).
//   Just the answer: what's needed from downstairs is entered under the spare stock, below.
// * LinkedRow: the same item elsewhere (e.g. a dessert on the walk-in's dessert shelf) showing the
//   requirement already planned in Defrost, and editing that one total.
// * PendingRefills: refills still to do ("Needs stock"), shown after collecting and before finishing.
import { Icon } from '@/components/Icon';
import type { ItemState, PlacementView } from '@/lib/restock-logic';
import { formatQty, round2 } from '@/lib/restock-math';
import { NumberBox } from './DefrostParts';

/**
 * A working drawer or tub: Stocked or Needs stock, nothing else (starts unanswered, so staff see what's checked).
 * Tap the chosen one again to undo.
 */
export function RefillRow({ p, item, onChange, photo }: { p: PlacementView; item: ItemState; onChange: (f: Partial<ItemState>) => void; photo: React.ReactNode }) {
  const v = item.refillStatus ?? null;
  const stocked = v === 'refilled' || v === 'full';
  const needs = v === 'needs_stock';
  return (
    <article className={`prow card rrow s-${needs ? 'warn' : stocked ? 'ok' : 'none'} ${v ? '' : 'quiet'}`} data-placement={p.placementId}>
      {photo}
      <div className="pt"><h3>{p.productName}</h3>
        <p className="ps sr-only" id={`s-${p.placementId}`}>{stocked ? 'Stocked' : needs ? 'Needs stock' : 'Not checked yet'}</p></div>
      <div className="pc rr-acts" role="group" aria-label={`${p.productName}: drawer`}>
        <button type="button" className={`rr-b k-stocked ${stocked ? 'on' : ''}`} aria-pressed={stocked}
          onClick={() => onChange({ refillStatus: stocked ? null : 'refilled' })}>{stocked ? <Icon name="check" /> : null}Stocked</button>
        <button type="button" className={`rr-b k-needs_stock ${needs ? 'on' : ''}`} aria-pressed={needs}
          onClick={() => onChange({ refillStatus: needs ? null : 'needs_stock' })}>{needs ? <Icon name="check" /> : null}Needs stock</button>
      </div>
    </article>
  );
}

export function LinkedRow({ p, target, item, onChange, photo }: {
  p: PlacementView; target: PlacementView;
  /** The linked row's item (as it counts, suggestions included). */
  item: ItemState;
  /** Changes the linked row (one total, never a second requirement). */
  onChange: (f: Partial<ItemState>) => void; photo: React.ReactNode;
}) {
  const v = item.requestedQty;
  const q = (n: number) => formatQty(n, target.unitSingular, target.unitPlural);
  const where = target.areaName;
  const status = v === null ? <>Not planned in {where} yet</>
    : v > 0 ? <><Icon name="check" />Already planned in {where}: <b>{q(v)}</b></>
    : <><Icon name="check" />{where}: not needed</>;
  const step = target.allowDecimal ? 0.5 : 1;
  const set = (n: number | null) => onChange({ requestedQty: n });
  return (
    <article className={`prow card lrow s-${v && v > 0 ? 'warn' : v === 0 ? 'ok' : 'none'} ${v === null ? 'quiet' : ''}`} data-placement={p.placementId}>
      {photo}
      <div className="pt"><h3>{p.productName}</h3><p className="ps" id={`s-${p.placementId}`}>{status}</p></div>
      <div className="pc">
        {v === null
          ? <button type="button" className="padd" onClick={() => set(1)} aria-label={`Add ${p.productName} to ${where}`}><Icon name="plus" />Add</button>
          : <div className="pstep">
              <button type="button" onClick={() => set(v === 0 ? null : Math.max(0, round2(v - step)))} aria-label={`One less ${p.productName}`}><Icon name={v === 0 ? 'x' : 'minus'} /></button>
              <NumberBox id={`q-${p.placementId}`} value={v} onCommit={set} label={`${p.productName}: total planned in ${where}`} allowDecimal={target.allowDecimal} unitPlural={target.unitPlural} />
              <button type="button" onClick={() => set(round2(v + step))} aria-label={`One more ${p.productName}`}><Icon name="plus" /></button>
            </div>}
      </div>
      <p className="pwide lr-hint">One total with {where}: changing it here changes it there.</p>
    </article>
  );
}

/** Refills still to do: listed so staff fill the drawers once the stock is up. One tap each. */
export function PendingRefills({ list, onRefilled, title = 'Refills still to do' }: { list: PlacementView[]; onRefilled: (p: PlacementView) => void; title?: string }) {
  if (!list.length) return null;
  return (
    <section className="rr-pending" aria-labelledby="rr-pending-h">
      <h3 id="rr-pending-h"><Icon name="up" />{title}<small>{list.length}</small></h3>
      <ul>{list.map((p) => (
        <li key={p.placementId} data-refill={p.productName}>
          <span><b>{p.productName}</b><small>From {p.refillSource}</small></span>
          <button type="button" className="btn small good" onClick={() => onRefilled(p)} aria-label={`Refilled: ${p.productName}`}><Icon name="check" />Refilled</button>
        </li>
      ))}</ul>
    </section>
  );
}

/**
 * A portioning check while refilling (e.g. portioned lamb in Freezer 2): one tick, "Needs portioning",
 * puts its task on tomorrow's morning prep handover. It changes nothing in the restock.
 */
export function PortionCheckRow({ p, taskName, on, onToggle, photo }: { p: PlacementView; taskName: string; on: boolean; onToggle: () => void; photo: React.ReactNode }) {
  return (
    <article className={`prow card pcrow s-${on ? 'warn' : 'none'} ${on ? '' : 'quiet'}`} data-placement={p.placementId}>
      {photo}
      <div className="pt"><h3>{p.productName}</h3>
        <p className="ps" id={`s-${p.placementId}`}>{on ? <><Icon name="clock" />On the prep checklist and morning handover: {taskName}</> : <span className="sr-only">Not ticked</span>}</p></div>
      <div className="pc">
        <button type="button" className={`pnn pc-tick ${on ? 'on' : ''}`} aria-pressed={on} onClick={onToggle}
          aria-label={`${p.productName}: needs portioning`}>{on ? <Icon name="check" /> : null}Needs portioning</button>
      </div>
    </article>
  );
}
