'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EXCEPTION_REASONS, EMPTY_ITEM, SHORT_REASONS, activePlacements, areaStatus, collectionLines, exceptions, isChecked,
  lineGot, lineInfo, lineState, outcomeLine, stockOutcomes, type StockOutcome,
} from '@/lib/restock-logic';
import { formatQty, round2 } from '@/lib/restock-math';
import { finishSession, reopenSession, updateLocalSession } from '@/lib/client/restock-store';
import { useSyncStatus } from '@/lib/client/hooks';
import { AREA_BADGE, AREA_LABEL, Badge, Dock, plural, timeOf } from './shared';
import type { RestockCtx } from './RestockApp';

/**
 * Before finishing: only what needs doing, plus the shortages that will be
 * reported (the rest is under "Show full summary").
 * After finishing: the full record for managers, ready to copy.
 */
export function FinishStep({ ctx }: { ctx: RestockCtx }) {
  const { view, session, items, recorded, areaRecords, who, placements } = ctx;
  const sync = useSyncStatus();
  const [exOpen, setExOpen] = useState(false);
  const [exReason, setExReason] = useState<string | null>(null);
  const [note, setNote] = useState(session.note ?? '');
  const noteTimer = useRef<number | undefined>(undefined);
  // Keep the draft on this device, so leaving the screen doesn't lose it.
  const editNote = (v: string) => {
    setNote(v);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => void updateLocalSession(session.id, { note: v }), 400);
  };
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  const finalNote = note.trim() ? note.trim() : null;
  const finished = session.status === 'finished' || session.status === 'finished_exceptions';
  const ex = finished ? [] : exceptions({ kind: session.kind, view, placements, recordedAreas: recorded, items });

  const covered = activePlacements(session.kind, placements, recorded);
  const lines = collectionLines(covered, items);
  const notCollected: [string, string][] = [], collected: [string, string][] = [];
  for (const l of lines) {
    const st = lineState(l, items), info = lineInfo(l, items), got = lineGot(l, items);
    if (l.kind === 'task') { (st === 'done' ? collected : notCollected).push([l.productName, st === 'done' ? 'Done' : 'Task not done']); continue; }
    if (got > 0) collected.push([l.productName, formatQty(got, l.unitSingular, l.unitPlural)]);
    if (st !== 'done' && info.reason !== 'insufficient') notCollected.push([l.productName, `${formatQty(round2(l.total - got), l.unitSingular, l.unitPlural)} not collected${info.reason ? ` (${SHORT_REASONS.find((r) => r[0] === info.reason)![1].toLowerCase()})` : ''}`]);
  }
  const outcomes = stockOutcomes(lines, items, view.byId);
  // Products nobody checked, grouped by area ("Fridge 2: Milk, Butter portions")
  const uncheckedByArea = new Map<string, string[]>();
  for (const p of covered) {
    if (isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)) continue;
    uncheckedByArea.set(p.areaName, [...(uncheckedByArea.get(p.areaName) ?? []), p.productName]);
  }

  const list = (rows: [string, string][], empty: string) => rows.length
    ? <ul>{rows.map(([a, b]) => <li key={a + b}><span>{a}</span><span>{b}</span></li>)}</ul> : <p className="muted">{empty}</p>;
  const goTo = (e: (typeof ex)[number]) => {
    if (e.areaId) void updateLocalSession(session.id, { curAreaId: e.areaId });
    ctx.go(e.kind === 'collect' ? 'collect' : 'check');
  };

  const report = <StockReport outcomes={outcomes} finished={finished} />;

  const details = (
    <div className="sum">
      {session.kind === 'full' ? (
        <section className="sum-card"><h3><Icon name="check" />Areas</h3>
          <ul>{view.areas.map(({ area, placements: ps }) => {
            const st = areaStatus(recorded.get(area.id), ps, items);
            return <li key={area.id}><span>{area.name}</span><span><Badge st={AREA_BADGE[st]}>{st === 'skipped' ? `Skipped: ${areaRecords.get(area.id)?.skipReason ?? ''}` : AREA_LABEL[st]}</Badge></span></li>;
          })}</ul></section>
      ) : null}
      <section className="sum-card"><h3><Icon name="circle" />Unfinished</h3>
        {notCollected.length === 0 && uncheckedByArea.size === 0 ? <p className="muted">Nothing.</p> : null}
        {notCollected.length ? list(notCollected, '') : null}
        {[...uncheckedByArea].map(([area, names]) => (
          <p key={area} className="unchecked-row"><b>Not checked in {area}:</b> {names.join(', ')}</p>
        ))}
      </section>
      <section className="sum-card"><h3><Icon name="box" />Collected</h3>{list(collected, 'Nothing yet.')}</section>
    </div>
  );

  return (
    <>
      <main className="wrap restock-main">
        {ctx.header}

        {finished ? (
          <>
            <div className={`finish-meta finish-hero ${session.status === 'finished_exceptions' ? 's-warn' : 's-ok'}`}>
              <span className="fh-icon"><Icon name={session.status === 'finished_exceptions' ? 'warn' : 'check'} /></span>
              <div>
                <h2>{session.status === 'finished_exceptions' ? 'Finished with exceptions' : 'Restock complete'}</h2>
                <p>Finished at {timeOf(session.finishedAt)}{session.people.length ? <> &middot; {session.people.join(', ')}</> : null}</p>
                {session.exceptionReason ? <p className="fh-reason"><Icon name="warn" />{session.exceptionReason}</p> : null}
              </div>
            </div>
            {session.note ? (
              <section className="note-sent"><h3><Icon name="list" />Comments{session.kind === 'full' ? ' sent to managers' : ''}</h3><p>{session.note}</p></section>
            ) : null}
            {report}
          </>
        ) : (
          <>
            <h2 className="finish-title">Finish restock</h2>
            {ex.length === 0 ? (
              <section className="ready s-ok"><h2><Icon name="check" />Ready to finish</h2><p>Every {session.kind === 'full' ? 'area is complete' : 'product has a number'} and every item is collected or recorded.</p></section>
            ) : (
              <section className="ready s-warn"><h2><Icon name="warn" />Still to do</h2>
                <ul className="exlist compact">{ex.map((e) => (
                  <li key={e.text}><span><b>{e.text}</b>{e.detail ? <small>{e.detail}</small> : null}</span>
                    <button className="linkbtn" onClick={() => goTo(e)}>Go there<Icon name="next" /></button></li>
                ))}</ul>
                <p className="meta"><b>Handing over?</b> Use Save and exit. The restock stays open for the next person.</p>
              </section>
            )}

            {exOpen && ex.length ? (
              <section className="expanel" id="expanel">
                <h3>Finish with exceptions?</h3>
                <p>The restock will close and managers will see {ex.length > 1 ? 'these' : 'this'} as outstanding:</p>
                <ul className="exlist compact">{ex.map((e) => <li key={e.text}><span><b>{e.text}</b></span></li>)}</ul>
                <b>Reason</b>
                <div className="chips">{EXCEPTION_REASONS.map((r) => <button key={r} className={`chip ${exReason === r ? 'on' : ''}`} onClick={() => setExReason(r)}>{r}</button>)}</div>
                <div className="row-actions">
                  <button className="btn" onClick={() => { setExOpen(false); setExReason(null); }}>Cancel</button>
                  <button className="btn caution big" disabled={!exReason} onClick={() => { void finishSession(session.id, exReason, who, finalNote); setExOpen(false); window.scrollTo({ top: 0 }); }}><Icon name="warn" />Confirm finish with exceptions</button>
                </div>
              </section>
            ) : null}

            {outcomes.some((o) => o.status !== 'not_topped_up') ? report : null}

            <section className="note-box">
              <label htmlFor="finish-note"><b>Comments for managers</b> <span className="muted">(optional)</span></label>
              <p className="meta">{session.kind === 'full' ? 'Added to the email managers get when you finish.' : 'Saved with this restock for managers to see.'} For example: a broken fridge, a delivery that didn&rsquo;t arrive.</p>
              <textarea id="finish-note" rows={3} maxLength={1000} value={note} onChange={(e) => editNote(e.target.value)} placeholder="Anything managers should know?" />
            </section>

            <details className="sum-details">
              <summary><Icon name="list" />Show full summary</summary>
              {details}
            </details>
          </>
        )}
      </main>

      {finished ? (
        <Dock icon={sync.pending ? 'sync' : 'check'}
          title={sync.pending ? (sync.connection === 'offline' ? 'Finished on this device' : 'Uploading…') : 'Finished and saved'}
          sub={sync.pending
            ? (sync.connection === 'offline' ? `${plural(sync.pending, 'change')} will upload when there’s a connection. Nothing will be lost.` : 'Sending to the server now.')
            : 'Managers can see this restock.'}>
          <button className="btn" onClick={() => void reopenSession(session.id, who)}>Reopen</button>
          <button className="btn primary big" onClick={ctx.done}><Icon name="home" />Back to home</button>
        </Dock>
      ) : (
        <Dock icon={ex.length ? 'warn' : 'check'} title={ex.length ? 'Not finished yet' : 'Ready to finish'}
          sub={ex.length ? 'Finish restock unlocks when everything is done' : 'Everything is checked and collected'}>
          <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
          {ex.length ? <button className="btn caution big" onClick={() => { setExOpen(true); window.setTimeout(() => document.getElementById('expanel')?.scrollIntoView({ block: 'start' }), 50); }}><span className="lg">Finish with exceptions&hellip;</span><span className="sm">With exceptions&hellip;</span></button> : null}
          <button className="btn good big" disabled={ex.length > 0} onClick={() => { void finishSession(session.id, null, who, finalNote); window.scrollTo({ top: 0 }); }}><Icon name="check" />Finish restock</button>
        </Dock>
      )}
    </>
  );
}

/**
 * What we're now low on or out of. Orange = running low, red = out of stock.
 * "Not topped up" (ran out of time etc.) is a small note: the storeroom isn't short.
 */
function StockReport({ outcomes, finished }: { outcomes: StockOutcome[]; finished: boolean }) {
  const low = outcomes.filter((o) => o.status === 'low');
  const out = outcomes.filter((o) => o.status === 'out');
  const other = outcomes.filter((o) => o.status === 'not_topped_up');
  if (!low.length && !out.length) {
    return (
      <>
        <section className="stock-panel all-good">
          <Icon name="check" /><div><h2>Nothing low or out of stock</h2><p>{finished ? 'Everything collected is back to its target.' : 'So far, the storerooms had everything.'}</p></div>
        </section>
        {finished && other.length ? <OtherNote rows={other} /> : null}
      </>
    );
  }
  const row = (o: StockOutcome) => (
    <li key={o.productName}>
      <div className="sp-top">
        <span className="sp-name">{o.productName}</span>
        {o.flagged ? <span className="badge s-bad flag-tag"><Icon name="flag" />Flagged</span> : null}
        {o.onShelf !== null && o.target ? <span className="sp-shelf">{fmt(o.onShelf)} of {fmt(o.target)} on the shelf</span> : null}
      </div>
      <span className="sp-detail">{o.status === 'out' ? `None left in the storeroom \u00b7 needed ${fmt(o.needed)} ${o.needed === 1 ? o.unitSingular : o.unitPlural}` : `Storeroom had ${fmt(o.got)}, short ${fmt(o.short)} ${o.short === 1 ? o.unitSingular : o.unitPlural}`}</span>
      {o.status === 'out' && o.affects.length ? <span className="sp-affects"><Icon name="x" />Set as sold out: <b>{o.affects.join(', ')}</b></span> : null}
    </li>
  );
  return (
    <>
      {out.length ? (
        <section className="stock-panel out">
          <h2><Icon name="warn" />Out of stock <span className="count">{out.length}</span></h2>
          <ul>{out.map(row)}</ul>
        </section>
      ) : null}
      {low.length ? (
        <section className="stock-panel low">
          <h2><Icon name="down" />Running low <span className="count">{low.length}</span></h2>
          <ul>{low.map(row)}</ul>
        </section>
      ) : null}
      {finished && other.length ? <OtherNote rows={other} /> : null}
    </>
  );
}

function OtherNote({ rows }: { rows: StockOutcome[] }) {
  return <p className="meta other-note"><b>Not topped up</b> (not a storeroom shortage): {rows.map((o) => outcomeLine(o)).join('; ')}</p>;
}

const fmt = (n: number) => String(round2(n));
