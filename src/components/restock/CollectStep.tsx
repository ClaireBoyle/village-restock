'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EMPTY_ITEM, SHORT_REASONS, activePlacements, clearCollectedUpdates, collectPlacements, refillLines, collectionLines, gotAllUpdates, gotFewerUpdates,
  groupByStoreroom, isChecked, isRequired, lineGot, lineInfo, lineState, type CollectionLine, type ItemState, type ShortReason,
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
  // Upstairs pickups were on Refill FOH; this is the downstairs run.
  const lines = collectionLines(collectPlacements(session.kind, placements, recorded), items);
  const groups = groupByStoreroom(lines, view.locationOrder);
  const handled = lines.filter((l) => ['done', 'short'].includes(lineState(l, items))).length;
  const shorts = lines.filter((l) => lineState(l, items) === 'short' && lineInfo(l, items).reason === 'insufficient').length;
  // Only missing target counts: a blank "staff enter" product just didn't need anything.
  const unchecked = covered.filter((p) => isRequired(p) && !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM));
  // One area (an area restock): every line is for it, so don't repeat its name on each line.
  const oneArea = view.areas.length === 1 ? view.areas[0].area.name : null;
  const write = (ups: { placementId: string; fields: Partial<ItemState> }[]) => void setItems(session.id, ups, who);

  return (
    <>
      <main className="wrap restock-main">
        {ctx.header}
        <h2 className="sr-only">Collection list</h2>
        {unchecked.length ? (
          <button className="col-note" onClick={() => ctx.go('check')}><Icon name="circle" /><span><b>{plural(unchecked.length, 'product')} not checked</b> <span className="lg">, so not on this list</span></span><span className="col-go">Check them<Icon name="next" /></span></button>
        ) : null}
        {lines.length === 0 ? <p className="empty">{session.kind === 'area' ? 'Nothing to collect. Nothing was entered as needed.' : 'Nothing to collect. Everything checked is at target.'}</p> : (
          <div className="rooms">
            {groups.map((g) => <Room key={g.lines[0].locationId ?? g.name} name={g.name} lines={g.lines} items={items} write={write} oneArea={oneArea} displayRule={!!view.department.noneOnDisplay}
              note={g.lines[0].locationId ? view.locationNotes.get(g.lines[0].locationId) : undefined} />)}
          </div>
        )}
      </main>
      <Dock icon={handled === lines.length ? 'check' : 'list'} progress={lines.length ? handled / lines.length : 1}
        title={lines.length ? <>{handled} of {lines.length} resolved{shorts ? <span className="short-tag">{plural(shorts, 'shortage')}</span> : null}</> : 'Nothing to collect'}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        <button className="btn primary big" onClick={() => ctx.go('finish')}><span className="lg">Review and finish</span><span className="sm">{lines.length ? 'Review' : 'Finish'}</span><Icon name="next" /></button>
      </Dock>
    </>
  );
}

/** One storeroom: header with progress, folds away once everything in it is collected. */
function Room({ name, lines, items, write, note, oneArea, tickOnly = false, displayRule = false }: {
  name: string; lines: CollectionLine[]; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void;
  /** The storeroom's reminder (e.g. "Use opened boxes first"), shown once under its heading. */
  note?: string; oneArea: string | null;
  /** Refill FOH: just a tick for "grabbed" (anything missing upstairs is covered by the downstairs run). */
  tickOnly?: boolean;
  /** Candy Bar: short is Low stock (even at zero); "None on display" makes it Out of stock. */
  displayRule?: boolean;
}) {
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
      {open && note ? <p className="room-note"><Icon name="info" /><span>{note}</span></p> : null}
      {open ? <div className="room-lines">{lines.map((l) => <Line key={l.key} line={l} items={items} write={write} oneArea={oneArea} tickOnly={tickOnly} displayRule={displayRule} />)}</div> : null}
    </section>
  );
}

function Line({ line, items, write, oneArea, tickOnly = false, displayRule = false }: { line: CollectionLine; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void; oneArea: string | null; tickOnly?: boolean; displayRule?: boolean }) {
  const st = lineState(line, items);
  const info = lineInfo(line, items);
  const got = lineGot(line, items);
  // Editing a shortfall: open after "Got fewer" or "Change", or whenever a fewer amount isn't confirmed yet.
  const [editing, setEditing] = useState(false);
  const [others, setOthers] = useState(false);
  const open = line.kind === 'qty' && st !== 'done' && (editing || st === 'part');
  // Where it goes back to, so staff know where to restock (several areas are listed with their amounts).
  const forTxt = line.kind === 'task' ? line.parts[0].areaName
    : line.parts.length > 1 ? line.parts.map((p) => `${p.areaName} ${round2(p.need)}`).join(' · ') : line.parts[0].areaName;
  const step = Number.isInteger(line.total) ? 1 : 0.5;
  const short = round2(line.total - got);
  const u = (n: number) => (n === 1 ? line.unitSingular : line.unitPlural);
  const reasonText = (r: ShortReason | null) => SHORT_REASONS.find((x) => x[0] === r)?.[1] ?? '';
  // Short labels for the folded line (the full wording is in the editor).
  const shortReason = (r: ShortReason | null) => (r === 'access' ? 'Couldn’t access' : r === 'time' ? 'Interrupted' : r === 'other' ? 'Other reason' : '');

  /** Save the amount collected. Nothing counts as a shortage until it's confirmed. */
  const setGot = (g: number) => {
    if (g >= line.total) { write(gotAllUpdates(line)); setEditing(false); setOthers(false); return; }
    // A result already confirmed keeps its reason while the amount is corrected.
    write(gotFewerUpdates(line, g, info.reason, info.flagged, info.noneOnDisplay));
  };
  /** Confirm: a plain shortfall is "not enough in storeroom" unless another reason was picked. */
  const confirm = (reason: ShortReason | null = info.reason) => {
    write(gotFewerUpdates(line, got, reason ?? 'insufficient', info.flagged, info.noneOnDisplay));
    setEditing(false); setOthers(false);
  };
  const pickReason = (r: ShortReason) => write(gotFewerUpdates(line, got, r, info.flagged, info.noneOnDisplay));
  const flag = () => write(gotFewerUpdates(line, got, info.reason, !info.flagged, info.noneOnDisplay));
  /** Candy Bar: none collected and none left on display → Out of stock (tap again to undo). */
  const toggleNone = () => write(gotFewerUpdates(line, got, info.reason, info.flagged, !info.noneOnDisplay));
  const stockShort = st === 'short' && info.reason === 'insufficient';
  const stockLabel = displayRule ? (stockShort && got === 0 && info.noneOnDisplay ? 'Out of stock' : 'Low stock') : (got === 0 ? 'Out of stock' : 'Running low');
  const askNone = displayRule && stockShort && got === 0 && !open;
  const undo = () => { write(clearCollectedUpdates(line)); setEditing(false); setOthers(false); };

  // One glance: the amount first and biggest, then the name, then one round tick for "got all".
  // "Got fewer" is a small link; done / short lines say so quietly with Undo / Change.
  const all = () => write(gotAllUpdates(line));
  const startFewer = () => { setEditing(true); setGot(Math.max(0, Math.floor(line.total) - 1)); };
  let act: React.ReactNode = null;
  if (st === 'done') {
    act = <button type="button" className="l-tick on" onClick={undo} aria-label={`Undo ${line.productName}`}><Icon name="check" /></button>;
  } else if (!open && !(st === 'short')) {
    act = <button type="button" className="l-tick l-all" onClick={all}
      aria-label={line.kind === 'task' ? `Done: ${line.productName}` : tickOnly ? `Grabbed ${round2(line.total)} ${line.productName}` : `Got all ${round2(line.total)} ${line.productName}`}><Icon name="check" /></button>;
  }
  const sub = line.kind === 'task' ? (line.instructions || forTxt)
    : oneArea && line.parts.length === 1 ? null : `For ${forTxt}`;

  return (
    <div className={`line ${st === 'done' ? 'done' : st === 'short' ? (info.reason === 'insufficient' ? 'short' : 'short op') : 'todo'} ${open ? 'editing' : ''}`} data-line={line.productName}>
      <div className="lrow">
        {line.kind === 'qty' ? (
          <span className="l-amt l-qty" aria-label={`${round2(line.total)} ${u(line.total)}`}>
            <b>{st === 'short' && !open ? <>{round2(got)}<i>/{round2(line.total)}</i></> : round2(line.total)}</b><small>{u(line.total)}</small>
          </span>
        ) : <span className="l-amt task" aria-hidden="true"><Icon name="task" /></span>}
        <ProductThumb src={line.photoPath} name={line.productName} credit={line.photoCredit} className="l-photo" />
        <div className="l-nm">
          <b>{line.productName}</b>
          {st === 'short' && !open ? (
            <small className="l-why">{info.reason === 'insufficient' ? stockLabel : shortReason(info.reason)} &middot; short {formatQty(short, line.unitSingular, line.unitPlural)}{info.flagged ? ' · flagged' : ''}
              <button type="button" className="linkbtn l-link" onClick={() => setEditing(true)}>Change</button></small>
          ) : st === 'done' ? (
            <small className="l-ok">{line.kind === 'task' ? 'Done' : tickOnly ? 'Grabbed' : 'Collected'}<button type="button" className="linkbtn l-link" onClick={undo}>Undo</button></small>
          ) : (
            <small>{sub ? <span>{sub}</span> : null}
              {line.kind === 'qty' && !open && !tickOnly ? <button type="button" className="linkbtn l-link l-few" onClick={startFewer} aria-label={`Got fewer ${line.productName}`}>Got fewer</button> : null}</small>
          )}
        </div>
        {act}
      </div>
      {askNone ? (
        // Nothing collected: is there really none left out front? Then it's out of stock.
        <div className="l-none-row">
          <button type="button" className={`btn small l-none ${info.noneOnDisplay ? 'on' : ''}`} aria-pressed={info.noneOnDisplay} onClick={toggleNone}>
            <Icon name={info.noneOnDisplay ? 'check' : 'warn'} />None on display</button>
          {info.noneOnDisplay ? <small>Marked out of stock &middot; tap again to undo</small> : null}
        </div>
      ) : null}
      {open ? (
        <div className="fewer">
          <div className="fw-row">
            <b>Got</b>
            <div className="pstep">
              <button onClick={() => setGot(Math.max(0, round2(got - step)))} aria-label="One less" disabled={got <= 0}><Icon name="minus" /></button>
              <input className="qty-input" readOnly value={round2(got)} aria-label={`Collected of ${round2(line.total)}`} />
              <button onClick={() => setGot(round2(got + step))} aria-label="One more"><Icon name="plus" /></button>
            </div>
            <span className="fw-of">of {round2(line.total)}</span>
            {info.reason ? <button className="linkbtn fw-x" onClick={undo}>Clear</button> : <button className="linkbtn fw-x" onClick={undo}>Cancel</button>}
            <span className="short-txt"><Icon name="warn" />Short {formatQty(short, line.unitSingular, line.unitPlural)}</span>
          </div>
          {others ? (
            <div className="chips fw-reasons" role="group" aria-label="Reason">
              {SHORT_REASONS.map(([v, l]) => <button key={v} className={`chip ${(info.reason ?? 'insufficient') === v ? 'on' : ''}`} onClick={() => pickReason(v)}>{l}</button>)}
            </div>
          ) : null}
          <div className="fw-foot">
            <button className="linkbtn fw-other" onClick={() => setOthers(!others)} aria-expanded={others}>
              {info.reason && info.reason !== 'insufficient' ? reasonText(info.reason) : 'Other reason'}<Icon name={others ? 'up' : 'down'} />
            </button>
            <button className={`flag ${info.flagged ? 'on' : ''}`} aria-pressed={info.flagged} onClick={flag} aria-label={info.flagged ? 'Flagged for manager' : 'Flag for manager'}><Icon name="flag" /><span>{info.flagged ? 'Flagged' : 'Flag'}</span></button>
            <span style={{ flex: 1 }} />
            <button className="btn primary fw-ok" onClick={() => confirm()}><Icon name="check" />Confirm</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Refill FOH (Gold Class Bar): what to grab from upstairs (BOH bar fridge, walk-in fridge,
 * cupboards) for front of house, grouped by where it's kept. Not on the downstairs list:
 * what needs replacing upstairs is suggested on the next step, Check BOH.
 */
export function RefillStep({ ctx }: { ctx: RestockCtx }) {
  const { view, session, items, recorded, who, placements } = ctx;
  const lines = refillLines(session.kind, placements, recorded, items);
  const groups = groupByStoreroom(lines, view.pickupOrder);
  const grabbed = lines.filter((l) => lineState(l, items) === 'done').length;
  const write = (ups: { placementId: string; fields: Partial<ItemState> }[]) => void setItems(session.id, ups, who);
  const nSug = ctx.suggested.size;
  return (
    <>
      <main className="wrap restock-main">
        {ctx.header}
        <h2 className="sr-only">Refill FOH from upstairs</h2>
        {lines.length === 0 ? <p className="empty">Nothing to grab from upstairs. Nothing entered for front of house comes from the BOH fridge, walk-in or cupboards.</p> : (
          <>
            <p className="aguide-line refill-intro"><Icon name="info" /><span>Grab these from upstairs and refill front of house.{nSug ? ` What needs replacing is suggested on the next step, Check BOH.` : ''}</span></p>
            <div className="rooms">
              {groups.map((g) => <Room key={g.lines[0].locationId ?? g.name} name={g.name} lines={g.lines} items={items} write={write} oneArea={null} tickOnly />)}
            </div>
          </>
        )}
      </main>
      <Dock icon={grabbed === lines.length ? 'check' : 'list'} progress={lines.length ? grabbed / lines.length : 1}
        title={lines.length ? `${grabbed} of ${lines.length} grabbed` : 'Nothing to grab'}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        <button className="btn primary big" onClick={() => ctx.go('boh')}><span className="lg">Next: Check BOH</span><span className="sm">Check BOH</span><Icon name="next" /></button>
      </Dock>
    </>
  );
}
