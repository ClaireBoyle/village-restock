'use client';
import { useRef, useState } from 'react';
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
  // Areas not checked yet (neither done nor skipped): an empty list doesn't mean "nothing needed".
  const checksPending = view.areas.some(({ area }) => !['complete', 'skipped'].includes(recorded.get(area.id) ?? ''));
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
        {lines.length === 0 ? <p className="empty">{session.kind === 'area' ? 'Nothing to collect. Nothing was entered as needed.'
          : checksPending ? 'Nothing added to the collection list yet. Some areas haven’t been checked.' : 'Nothing to collect. Every area is checked and nothing is needed.'}</p> : (
          <div className="rooms">
            {groups.map((g) => <Room key={g.lines[0].locationId ?? g.name} name={g.name} lines={g.lines} items={items} write={write} oneArea={oneArea} displayRule={!!view.department.noneOnDisplay}
              note={roomNote(g.lines, view.locationNotes)} />)}
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

/**
 * A storeroom's reminder (e.g. Dry storage: "Use stock from the open-box shelf first…"). Straws aren't
 * picked from open boxes, so a room with only straws on the list doesn't show it.
 */
function roomNote(lines: CollectionLine[], notes: Map<string, string>) {
  const id = lines[0]?.locationId;
  if (!id || !notes.has(id)) return undefined;
  return lines.every((l) => /\bstraws?\b/i.test(l.productName)) ? undefined : notes.get(id);
}

/** One storeroom: header with progress, folds away once everything in it is collected. */
function Room({ name, lines, items, write, note, oneArea, tickOnly = false, displayRule = false }: {
  name: string; lines: CollectionLine[]; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void;
  /** The storeroom's reminder (e.g. "Use opened boxes first"), shown once under its heading. */
  note?: string; oneArea: string | null;
  /** Collect upstairs: "grabbed" wording; Got fewer records how many were actually there (no reasons). */
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

export function Line({ line, items, write, oneArea, tickOnly = false, displayRule = false }: { line: CollectionLine; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void; oneArea: string | null; tickOnly?: boolean; displayRule?: boolean }) {
  const st = lineState(line, items);
  const info = lineInfo(line, items);
  const got = lineGot(line, items);
  // "Got fewer" opens a small editor. Nothing is saved until Confirm; Cancel puts the row back as it was.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [more, setMore] = useState(false);
  const [dReason, setDReason] = useState<ShortReason | null>(null); // null = not enough in the storeroom
  const [dFlag, setDFlag] = useState(false);
  const fewRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // An amount left unconfirmed by an older version of the app also opens the editor, to be finished.
  const open = line.kind === 'qty' && st !== 'done' && (editing || st === 'part');
  // Where it goes back to, so staff know where to restock (several areas are listed with their amounts).
  const forTxt = line.kind === 'task' ? line.parts[0].areaName
    : line.parts.length > 1 ? line.parts.map((p) => `${p.areaName} ${round2(p.need)}`).join(' · ') : line.parts[0].areaName;
  const step = Number.isInteger(line.total) ? 1 : 0.5;
  const short = round2(line.total - got);
  const u = (n: number) => (n === 1 ? line.unitSingular : line.unitPlural);
  // Short labels for the folded line.
  const shortReason = (r: ShortReason | null) => (r === 'access' ? 'Couldn’t access' : r === 'time' ? 'Interrupted' : r === 'other' ? 'Other reason' : '');

  // The amount typed in the editor (blank until staff enter one).
  const num = draft.trim() === '' ? null : Number(draft.replace(',', '.'));
  const valid = num !== null && Number.isFinite(num) && num >= 0 && (step === 0.5 ? Number.isInteger(num * 2) : Number.isInteger(num));
  const dShort = valid ? round2(Math.max(0, line.total - num!)) : null;
  const inputId = `got-${line.key.replace(/[^a-z0-9]/gi, '')}`;

  /** Open the editor: blank for a new shortfall, the recorded amount when changing one. */
  const openEditor = () => {
    setEditing(true); setMore(false);
    setDraft(st === 'short' || st === 'part' ? String(round2(got)) : '');
    setDReason(info.reason && info.reason !== 'insufficient' ? info.reason : null);
    setDFlag(info.flagged);
    window.setTimeout(() => document.getElementById(inputId)?.focus(), 30);
  };
  /** Back to the same row (focus and scroll stay there). */
  const close = () => {
    setEditing(false); setMore(false);
    window.setTimeout(() => { (fewRef.current ?? rowRef.current)?.focus({ preventScroll: true }); rowRef.current?.scrollIntoView({ block: 'nearest' }); }, 30);
  };
  const cancel = () => { if (st === 'part') write(clearCollectedUpdates(line)); close(); };
  /** Confirm saves it: all of it is "got all"; less is a shortfall ("not enough in storeroom" unless another reason). */
  const confirm = () => {
    if (!valid) return;
    if (num! >= line.total) write(gotAllUpdates(line));
    else write(gotFewerUpdates(line, num!, tickOnly ? 'insufficient' : dReason ?? 'insufficient', tickOnly ? false : dFlag, info.noneOnDisplay));
    close();
  };
  const bump = (dir: 1 | -1) => {
    const next = valid ? num! + dir * step : dir > 0 ? step : 0;
    setDraft(String(round2(Math.min(line.total, Math.max(0, next)))));
  };

  /** Candy Bar: none collected and none left on display → Out of stock (tap again to undo). */
  const toggleNone = () => write(gotFewerUpdates(line, got, info.reason, info.flagged, !info.noneOnDisplay));
  const stockShort = st === 'short' && info.reason === 'insufficient';
  const stockLabel = displayRule ? (stockShort && got === 0 && info.noneOnDisplay ? 'Out of stock' : 'Low stock') : (got === 0 ? 'Out of stock' : 'Running low');
  const askNone = displayRule && stockShort && got === 0 && !open;
  const undo = () => { write(clearCollectedUpdates(line)); setEditing(false); setMore(false); };

  // One glance: the amount first and biggest, then the name, then "Got all" (one tap) with
  // "Got fewer" as its own, separate button. Done / short lines say so quietly with Undo / Change.
  const all = () => write(gotAllUpdates(line));
  let act: React.ReactNode = null;
  if (st === 'done') {
    act = <button type="button" className="l-tick on" onClick={undo} aria-label={`Undo ${line.productName}`}><Icon name="check" /></button>;
  } else if (!open && st !== 'short') {
    act = (
      <span className="l-btns">
        {line.kind === 'qty' ? <button ref={fewRef} type="button" className="btn l-few" onClick={openEditor} aria-label={`Got fewer ${line.productName}`}>Got fewer</button> : null}
        <button type="button" className="l-tick l-all" onClick={all}
          aria-label={line.kind === 'task' ? `Done: ${line.productName}` : tickOnly ? `Grabbed ${round2(line.total)} ${line.productName}` : `Got all ${round2(line.total)} ${line.productName}`}><Icon name="check" /></button>
      </span>
    );
  }
  const sub = line.kind === 'task' ? (line.instructions || forTxt)
    : oneArea && line.parts.length === 1 ? null : `For ${forTxt}`;

  return (
    <div ref={rowRef} tabIndex={-1} className={`line ${st === 'done' ? 'done' : st === 'short' ? (info.reason === 'insufficient' ? 'short' : 'short op') : 'todo'} ${open ? 'editing' : ''}`} data-line={line.productName}>
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
            <small className="l-why">{tickOnly ? `Grabbed ${round2(got)} of ${round2(line.total)}` : <>{info.reason === 'insufficient' ? stockLabel : shortReason(info.reason)} &middot; short {formatQty(short, line.unitSingular, line.unitPlural)}{info.flagged ? ' · flagged' : ''}</>}
              <button type="button" className="linkbtn l-link" onClick={openEditor}>Change</button></small>
          ) : st === 'done' ? (
            <small className="l-ok">{line.kind === 'task' ? 'Done' : tickOnly ? 'Grabbed' : 'Collected'}<button type="button" className="linkbtn l-link" onClick={undo}>Undo</button></small>
          ) : sub ? <small><span>{sub}</span></small> : null}
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
        <div className="fewer" role="group" aria-labelledby={`${inputId}-q`}>
          <label className="fw-q" id={`${inputId}-q`} htmlFor={inputId}>How many did you get?</label>
          <div className="fw-row">
            <div className="pstep">
              <button type="button" onClick={() => bump(-1)} aria-label="One less" disabled={valid && num! <= 0}><Icon name="minus" /></button>
              <input id={inputId} className="qty-input" type="text" inputMode={step === 0.5 ? 'decimal' : 'numeric'} autoComplete="off" placeholder="–" value={draft}
                aria-label={`How many ${line.productName} did you get, of ${round2(line.total)}`}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } }} />
              <button type="button" onClick={() => bump(1)} aria-label="One more"><Icon name="plus" /></button>
            </div>
            <span className="fw-of">of {round2(line.total)} {u(line.total)}</span>
            {dShort !== null && dShort > 0 ? <span className="short-txt"><Icon name="warn" />Short {formatQty(dShort, line.unitSingular, line.unitPlural)}</span>
              : dShort === 0 ? <span className="fw-all"><Icon name="check" />That&rsquo;s all of it</span> : null}
          </div>
          <div className="fw-foot">
            <button type="button" className="btn fw-x" onClick={cancel}>Cancel</button>
            {tickOnly ? null : <button type="button" className="linkbtn fw-more" onClick={() => setMore(!more)} aria-expanded={more}>More options{dReason || dFlag ? ' (1+)' : ''}<Icon name={more ? 'up' : 'down'} /></button>}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn primary fw-ok" disabled={!valid} onClick={confirm}><Icon name="check" />Confirm</button>
          </div>
          {more && !tickOnly ? (
            <div className="fw-options">
              <div className="chips fw-reasons" role="group" aria-label="Other reason">
                {SHORT_REASONS.filter(([v]) => v !== 'insufficient').map(([v, l]) => (
                  <button type="button" key={v} className={`chip ${dReason === v ? 'on' : ''}`} aria-pressed={dReason === v} onClick={() => setDReason(dReason === v ? null : v)}>{l}</button>
                ))}
              </div>
              <button type="button" className={`flag ${dFlag ? 'on' : ''}`} aria-pressed={dFlag} onClick={() => setDFlag(!dFlag)}><Icon name="flag" /><span>{dFlag ? 'Flagged for manager' : 'Flag for manager'}</span></button>
              <p className="meta">With no other reason, it&rsquo;s recorded as &ldquo;not enough in the storeroom&rdquo;.</p>
            </div>
          ) : null}
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
  // Ticked, or Got fewer confirmed (including none there).
  const grabbed = lines.filter((l) => ['done', 'short'].includes(lineState(l, items))).length;
  const write = (ups: { placementId: string; fields: Partial<ItemState> }[]) => void setItems(session.id, ups, who);
  const nSug = ctx.suggested.size;
  return (
    <>
      <main className="wrap restock-main">
        {ctx.header}
        <h2 className="sr-only">Collect upstairs</h2>
        {lines.length === 0 ? <p className="empty">Nothing to grab from upstairs. Nothing entered for front of house comes from the BOH fridge, walk-in or cupboards.</p> : (
          <>
            <p className="aguide-line refill-intro"><Icon name="info" /><span>Grab these for the bar. Tick each one, or use Got fewer if there wasn&rsquo;t enough.{nSug ? ' What you grab is suggested on the next step, Top up BOH.' : ''}</span></p>
            <div className="rooms">
              {groups.map((g) => <Room key={g.lines[0].locationId ?? g.name} name={g.name} lines={g.lines} items={items} write={write} oneArea={null} tickOnly />)}
            </div>
          </>
        )}
      </main>
      <Dock icon={grabbed === lines.length ? 'check' : 'list'} progress={lines.length ? grabbed / lines.length : 1}
        title={lines.length ? `${grabbed} of ${lines.length} grabbed` : 'Nothing to grab'}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        <button className="btn primary big" onClick={() => ctx.go('boh')}><span className="lg">Next: Top up BOH</span><span className="sm">Top up BOH</span><Icon name="next" /></button>
      </Dock>
    </>
  );
}
