'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EMPTY_ITEM, SHORT_REASONS, activePlacements, clearCollectedUpdates, collectionLines, gotAllUpdates, gotFewerUpdates,
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
  const lines = collectionLines(covered, items);
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
            {groups.map((g) => <Room key={g.name} name={g.name} lines={g.lines} items={items} write={write} oneArea={oneArea}
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
function Room({ name, lines, items, write, note, oneArea }: {
  name: string; lines: CollectionLine[]; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void;
  /** The storeroom's reminder (e.g. "Use opened boxes first"), shown once under its heading. */
  note?: string; oneArea: string | null;
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
      {open ? <div className="room-lines">{lines.map((l) => <Line key={l.key} line={l} items={items} write={write} oneArea={oneArea} />)}</div> : null}
    </section>
  );
}

function Line({ line, items, write, oneArea }: { line: CollectionLine; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void; oneArea: string | null }) {
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
    write(gotFewerUpdates(line, g, info.reason, info.flagged));
  };
  /** Confirm: a plain shortfall is "not enough in storeroom" unless another reason was picked. */
  const confirm = (reason: ShortReason | null = info.reason) => {
    write(gotFewerUpdates(line, got, reason ?? 'insufficient', info.flagged));
    setEditing(false); setOthers(false);
  };
  const pickReason = (r: ShortReason) => write(gotFewerUpdates(line, got, r, info.flagged));
  const flag = () => write(gotFewerUpdates(line, got, info.reason, !info.flagged));
  const undo = () => { write(clearCollectedUpdates(line)); setEditing(false); setOthers(false); };

  let right: React.ReactNode = null;
  if (st === 'done') {
    right = <div className="l-done"><span><Icon name="check" /><span className="lg">{line.kind === 'task' ? 'Done' : 'Collected'}</span></span><button className="linkbtn" onClick={undo}>Undo</button></div>;
  } else if (st === 'short' && !open) {
    right = <div className={`l-done short ${info.reason === 'insufficient' ? '' : 'op'}`}><span><Icon name="warn" />{got} of {round2(line.total)}</span><button className="linkbtn" onClick={() => setEditing(true)}>Change</button></div>;
  } else if (line.kind === 'task') {
    right = <button className="btn good l-all" onClick={() => write(gotAllUpdates(line))}><Icon name="check" />Done</button>;
  } else if (!open) {
    right = <div className="l-acts">
      <button className="btn l-few" onClick={() => { setEditing(true); setGot(Math.max(0, Math.floor(line.total) - 1)); }} aria-label={`Got fewer ${line.productName}`}>Got fewer</button>
      <button className="btn good l-all" onClick={() => write(gotAllUpdates(line))} aria-label={`Got all ${round2(line.total)} ${line.productName}`}><Icon name="check" />Got all</button>
    </div>;
  }

  return (
    <div className={`line ${st === 'done' ? 'done' : st === 'short' ? (info.reason === 'insufficient' ? 'short' : 'short op') : 'todo'} ${open ? 'editing' : ''}`} data-line={line.productName}>
      <div className="l-main">
        <ProductThumb src={line.photoPath} name={line.productName} credit={line.photoCredit} className="l-photo" />
        <div className="l-name"><b>{line.productName}</b>{line.kind === 'task' ? <small>{line.instructions || forTxt}</small>
          : st === 'short' && !open ? <small className="l-why">{info.reason === 'insufficient' ? (got === 0 ? 'Out of stock' : 'Running low') : shortReason(info.reason)} &middot; short {formatQty(short, line.unitSingular, line.unitPlural)}{info.flagged ? ' · flagged' : ''}</small>
          : oneArea && line.parts.length === 1 ? null : <small>For {forTxt}</small>}</div>
        <div className="l-right">
          {line.kind === 'qty' && !(st === 'short' && !open) ? <span className="l-qty"><b>{round2(line.total)}</b><small>{u(line.total)}</small></span> : null}
          {right}
        </div>
      </div>
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
