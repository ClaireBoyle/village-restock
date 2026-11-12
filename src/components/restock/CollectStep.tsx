'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EMPTY_ITEM, SHORT_REASONS, activePlacements, clearCollectedUpdates, collectionLines, gotAllUpdates, gotFewerUpdates,
  groupByStoreroom, isChecked, lineGot, lineInfo, lineState, type CollectionLine, type ItemState, type ShortReason,
} from '@/lib/restock-logic';
import { formatQty, round2 } from '@/lib/restock-math';
import { setItems } from '@/lib/client/restock-store';
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
        <div className="col-head"><h2>Collection list</h2>
          <div className="progress"><b>{handled} of {lines.length} done{shorts ? <> &middot; <span style={{ color: 'var(--bad)' }}>{plural(shorts, 'shortage')}</span></> : null}</b>
            <div className="meter"><i style={{ width: `${lines.length ? Math.round((handled / lines.length) * 100) : 0}%` }} /></div></div>
        </div>
        {unchecked.length ? (
          <div className="banner s-none"><Icon name="circle" /><div><b>{plural(unchecked.length, 'product')} not checked, so not on this list</b>
            <p>{unchecked.slice(0, 6).map((p) => p.productName).join(', ')}{unchecked.length > 6 ? '…' : ''}</p></div>
            <button className="btn" onClick={() => ctx.go('check')}><Icon name="back" />Check them</button></div>
        ) : null}
        {lines.length === 0 ? <p className="empty">Nothing to collect. Everything checked is at target.</p> : (
          <div className="rooms">
            {groups.map((g) => {
              const left = g.lines.filter((l) => ['todo', 'part'].includes(lineState(l, items))).length;
              return (
                <section key={g.name} className="room">
                  <div className="room-h"><Icon name="box" /><h3>{g.name}</h3><small>{left ? `${left} to get` : 'All done'}</small></div>
                  <div className="room-lines">{g.lines.map((l) => <Line key={l.key} line={l} items={items} write={write} />)}</div>
                </section>
              );
            })}
          </div>
        )}
      </main>
      <Dock icon={handled === lines.length ? 'check' : 'list'} title={lines.length - handled ? `${plural(lines.length - handled, 'item')} still to collect` : 'Collection done'} sub="Review before finishing">
        <button className="btn" onClick={ctx.saveAndExit}><Icon name="save" />Save and exit</button>
        <button className="btn primary big" onClick={() => ctx.go('finish')}>Review and finish<Icon name="next" /></button>
      </Dock>
    </>
  );
}

function Line({ line, items, write }: { line: CollectionLine; items: Map<string, ItemState>; write: (u: { placementId: string; fields: Partial<ItemState> }[]) => void }) {
  const st = lineState(line, items);
  const info = lineInfo(line, items);
  const got = lineGot(line, items);
  const [fewer, setFewer] = useState(false);
  const showFewer = info.anyPartial || fewer;
  const forTxt = line.kind === 'task' ? line.parts[0].areaName
    : line.parts.length > 1 ? line.parts.map((p) => `${p.areaName} ${round2(p.need)}`).join(' · ') : line.parts[0].areaName;
  const qcls = st === 'done' ? 's-ok' : st === 'short' ? 's-bad' : 's-warn';
  const setFewerValues = (g: number, reason: ShortReason | null, flagged: boolean) => {
    if (g >= line.total) { write(gotAllUpdates(line)); setFewer(false); return; }
    write(gotFewerUpdates(line, g, reason, flagged));
  };
  const step = Number.isInteger(line.total) ? 1 : 0.5;

  let actions: React.ReactNode;
  if (line.kind === 'task') {
    actions = st === 'done'
      ? <div className="l-done"><span><Icon name="check" />Done</span><button className="linkbtn" onClick={() => write(clearCollectedUpdates(line))}>Undo</button></div>
      : <><p className="meta">{line.instructions}</p><div className="l-actions"><button className="btn good" onClick={() => write(gotAllUpdates(line))}><Icon name="check" />Done</button></div></>;
  } else if (st === 'done') {
    actions = <div className="l-done"><span><Icon name="check" />Collected {formatQty(line.total, line.unitSingular, line.unitPlural)}</span><button className="linkbtn" onClick={() => { write(clearCollectedUpdates(line)); setFewer(false); }}>Undo</button></div>;
  } else if (showFewer) {
    const short = round2(line.total - got);
    actions = (
      <div className="fewer">
        <div className="fw-row"><b>Collected</b>
          <div className="stepper">
            <button onClick={() => setFewerValues(Math.max(0, round2(got - step)), info.reason, info.flagged)} aria-label="One less"><Icon name="minus" /></button>
            <input className="qty-input" readOnly value={round2(got)} aria-label="Collected" />
            <button onClick={() => setFewerValues(round2(got + step), info.reason, info.flagged)} aria-label="One more"><Icon name="plus" /></button>
          </div>
          <span className="short-txt"><Icon name="warn" />Short {formatQty(short, line.unitSingular, line.unitPlural)}</span></div>
        <b>Why?</b>
        <div className="chips">{SHORT_REASONS.map(([v, l]) => <button key={v} className={`chip ${info.reason === v ? 'on' : ''}`} onClick={() => setFewerValues(got, v, info.flagged)}>{l}</button>)}</div>
        {info.reason === 'insufficient' ? <p className="meta">Supervisors will see this as a confirmed shortage.</p> : info.reason ? <p className="meta">Recorded as not collected. No low-stock alert.</p> : null}
        <button className={`flag ${info.flagged ? 'on' : ''}`} aria-pressed={info.flagged} onClick={() => setFewerValues(got, info.reason, !info.flagged)}>
          <span className="box">{info.flagged ? <Icon name="check" /> : null}</span><Icon name="flag" />Flag for supervisor</button>
        <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => { write(clearCollectedUpdates(line)); setFewer(false); }}>Cancel</button>
      </div>
    );
  } else {
    actions = (
      <div className="l-actions">
        <button className="btn good" onClick={() => write(gotAllUpdates(line))}><Icon name="check" />Got all {round2(line.total)}</button>
        <button className="btn" onClick={() => { setFewer(true); setFewerValues(Math.max(0, Math.floor(line.total) - 1), null, false); }}>Got fewer</button>
      </div>
    );
  }

  return (
    <div className={`line ${st === 'done' ? 'done' : st === 'short' ? 'short' : 'todo'}`} data-line={line.productName}>
      <div className="l-main">
        <div className="l-name"><b>{line.productName}</b><small>For {forTxt}</small></div>
        {line.kind === 'task'
          ? <span className={`l-qty ${qcls}`}><Icon name={st === 'done' ? 'check' : 'task'} /><small>Task</small></span>
          : <span className={`l-qty ${qcls}`}><b>{round2(line.total)}</b><small>{line.total === 1 ? line.unitSingular : line.unitPlural}</small></span>}
      </div>
      {actions}
    </div>
  );
}
