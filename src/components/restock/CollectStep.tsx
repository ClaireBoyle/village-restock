'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EMPTY_ITEM, SHORT_REASONS, activePlacements, clearCollectedUpdates, collectionLines, gotAllUpdates, gotFewerUpdates,
  groupByStoreroom, isChecked, lineGot, lineInfo, lineState, type CollectionLine, type ItemState, type ShortReason,
} from '@/lib/restock-logic';
import { formatQty, round2 } from '@/lib/restock-math';
import { setItems } from '@/lib/client/restock-store';
import { ProductThumb } from './ProductCard';
import { Dock, plural } from './shared';
import type { RestockCtx } from './RestockApp';

/** One list for the storeroom run, grouped by where each item is kept. */
export function CollectStep({ ctx }: { ctx: RestockCtx }) {
  const { view, session, items, recorded, who, placements } = ctx;
  const covered = activePlacements(session.kind, placements, recorded);
  const lines = collectionLines(covered, items);
  const groups = groupByStoreroom(lines, view.locationOrder);
  const handled = lines.filter((l) => ['done', 'short'].includes(lineState(l, items))).length;
  const shorts = lines.filter((l) => lineState(l, items) === 'short' && lineInfo(l, items).reason === 'insufficient').length;
  const unchecked = covered.filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM));
  const write = (ups: { placementId: string; fields: Partial<ItemState> }[]) => void setItems(session.id, ups, who);

  return (
    <>
      <main className="wrap restock-main">
        {ctx.header}
        <h2 className="sr-only">Collection list</h2>
        {unchecked.length ? (
          <button className="col-note" onClick={() => ctx.go('check')}><Icon name="circle" /><span><b>{plural(unchecked.length, 'product')} not checked</b> <span className="lg">, so not on this list</span></span><span className="col-go">Check them<Icon name="next" /></span></button>
        ) : null}
        {lines.length === 0 ? <p className="empty">Nothing to collect. Everything checked is at target.</p> : (
          <div className="rooms">
            {groups.map((g) => <Room key={g.name} name={g.name} lines={g.lines} items={items} write={write} />)}
          </div>
        )}
      </main>
      <Dock icon={handled === lines.length ? 'check' : 'list'} progress={lines.length ? handled / lines.length : 1}
        title={lines.length ? <>{handled} of {lines.length} collected{shorts ? <span className="short-tag">{plural(shorts, 'short')}</span> : null}</> : 'Nothing to collect'}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        <button className="btn primary big" onClick={() => ctx.go('finish')}><span className="lg">Review and finish</span><span className="sm">Review</span><Icon name="next" /></button>
      </Dock>
    </>
  );
}

/** One storeroom: header with progress, folds away once everything in it is collected. */
function Room({ name, lines, items, write }: { name: string; lines: CollectionLine[]; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void }) {
  const doneN = lines.filter((l) => ['done', 'short'].includes(lineState(l, items))).length;
  const complete = doneN === lines.length;
  // Folded only if it was already finished when the list opened: never snaps shut under someone's finger.
  const [open, setOpen] = useState(!complete);
  return (
    <section className={`room ${complete ? 'complete' : ''}`}>
      <button className="room-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={complete ? 'check' : 'box'} /><h3>{name}</h3>
        <span className="room-n">{doneN} of {lines.length}</span>
        <span className="room-bar" aria-hidden="true"><i style={{ width: `${Math.round((doneN / lines.length) * 100)}%` }} /></span>
        <Icon name={open ? 'up' : 'down'} />
      </button>
      {open ? <div className="room-lines">{lines.map((l) => <Line key={l.key} line={l} items={items} write={write} />)}</div> : null}
    </section>
  );
}

function Line({ line, items, write }: { line: CollectionLine; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void }) {
  const st = lineState(line, items);
  const info = lineInfo(line, items);
  const got = lineGot(line, items);
  const [fewer, setFewer] = useState(false);
  const showFewer = line.kind === 'qty' && st !== 'done' && (info.anyPartial || fewer) && !(st === 'short' && !fewer);
  // Where it goes back to, so staff know where to restock (several areas are listed with their amounts).
  const forTxt = line.kind === 'task' ? line.parts[0].areaName
    : line.parts.length > 1 ? line.parts.map((p) => `${p.areaName} ${round2(p.need)}`).join(' · ') : line.parts[0].areaName;
  const setFewerValues = (g: number, reason: ShortReason | null, flagged: boolean) => {
    if (g >= line.total) { write(gotAllUpdates(line)); setFewer(false); return; }
    write(gotFewerUpdates(line, g, reason, flagged));
  };
  const undo = () => { write(clearCollectedUpdates(line)); setFewer(false); };
  const step = Number.isInteger(line.total) ? 1 : 0.5;
  const short = round2(line.total - got);

  let right: React.ReactNode;
  if (st === 'done') {
    right = <div className="l-done"><span><Icon name="check" /><span className="lg">{line.kind === 'task' ? 'Done' : 'Collected'}</span></span><button className="linkbtn" onClick={undo}>Undo</button></div>;
  } else if (st === 'short' && !fewer) {
    right = <div className="l-done short"><span><Icon name="warn" />Got {round2(got)}</span><button className="linkbtn" onClick={() => setFewer(true)}>Change</button></div>;
  } else if (line.kind === 'task') {
    right = <button className="btn good l-all" onClick={() => write(gotAllUpdates(line))}><Icon name="check" />Done</button>;
  } else if (!showFewer) {
    right = <div className="l-acts">
      <button className="btn l-few" onClick={() => { setFewer(true); setFewerValues(Math.max(0, Math.floor(line.total) - 1), null, false); }} aria-label={`Got fewer ${line.productName}`}>Fewer</button>
      <button className="btn good l-all" onClick={() => write(gotAllUpdates(line))} aria-label={`Got all ${round2(line.total)} ${line.productName}`}><Icon name="check" />Got all</button>
    </div>;
  }

  return (
    <div className={`line ${st === 'done' ? 'done' : st === 'short' ? 'short' : 'todo'}`} data-line={line.productName}>
      <div className="l-main">
        <ProductThumb src={line.photoPath} name={line.productName} credit={line.photoCredit} className="l-photo" />
        <div className="l-name"><b>{line.productName}</b><small>{line.kind === 'task' ? line.instructions || forTxt : <>For {forTxt}</>}</small></div>
        <div className="l-right">
          {line.kind === 'qty' ? <span className="l-qty"><b>{round2(line.total)}</b><small>{line.total === 1 ? line.unitSingular : line.unitPlural}</small></span> : null}
          {right}
        </div>
      </div>
      {showFewer ? (
        <div className="fewer">
          <div className="fw-row"><b>Got</b>
            <div className="pstep">
              <button onClick={() => setFewerValues(Math.max(0, round2(got - step)), info.reason, info.flagged)} aria-label="One less"><Icon name="minus" /></button>
              <input className="qty-input" readOnly value={round2(got)} aria-label="Collected" />
              <button onClick={() => setFewerValues(round2(got + step), info.reason, info.flagged)} aria-label="One more"><Icon name="plus" /></button>
            </div>
            <span className="short-txt"><Icon name="warn" />Short {formatQty(short, line.unitSingular, line.unitPlural)}</span></div>
          <b>Why?</b>
          <div className="chips">{SHORT_REASONS.map(([v, l]) => <button key={v} className={`chip ${info.reason === v ? 'on' : ''}`} onClick={() => setFewerValues(got, v, info.flagged)}>{l}</button>)}</div>
          {info.reason === 'insufficient' ? <p className="meta">Managers will see this as a confirmed shortage.</p> : info.reason ? <p className="meta">Recorded as not collected. No low-stock alert.</p> : null}
          <div className="fw-foot">
            <button className={`flag ${info.flagged ? 'on' : ''}`} aria-pressed={info.flagged} onClick={() => setFewerValues(got, info.reason, !info.flagged)}>
              <span className="box">{info.flagged ? <Icon name="check" /> : null}</span><Icon name="flag" />Flag for manager</button>
            <span style={{ flex: 1 }} />
            <button className="linkbtn" onClick={undo}>Cancel</button>
            {info.reason ? <button className="btn small" onClick={() => setFewer(false)}>Done</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
