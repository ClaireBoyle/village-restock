'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EXCEPTION_REASONS, EMPTY_ITEM, SHORT_REASONS, activePlacements, areaStatus, collectPlacements, collectionLines, exceptions, isChecked, isRequired,
  isShortage, lineGot, lineInfo, lineState, pendingRefills, restockOutcomes, type ItemState, type StockOutcome,
} from '@/lib/restock-logic';
import { useLive } from '@/lib/client/hooks';
import { localDb } from '@/lib/client/local-db';
import { setPrep } from '@/lib/client/prep-store';
import { MorningPrepPicker, PrepSummary } from './MorningPrep';
import { PendingRefills } from './KitchenRows';
import { formatQty, round2 } from '@/lib/restock-math';
import { finishSession, reopenSession, setItems, updateLocalSession } from '@/lib/client/restock-store';
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
  // "Completed by": starts with the name already entered for this run; a change is kept on this device
  // (also if staff leave the run open), and saved with the restock when it's finished.
  const [doneBy, setDoneBy] = useState(session.completedBy ?? (who || session.people[session.people.length - 1] || ''));
  const byTimer = useRef<number | undefined>(undefined);
  const editDoneBy = (v: string) => {
    setDoneBy(v);
    window.clearTimeout(byTimer.current);
    byTimer.current = window.setTimeout(() => void updateLocalSession(session.id, { completedBy: v }), 400);
  };
  useEffect(() => () => window.clearTimeout(byTimer.current), []);
  const [saveError, setSaveError] = useState('');
  /** Finish: the name and comments go with it. If saving fails, nothing typed is lost. */
  const finish = async (reason: string | null) => {
    setSaveError('');
    window.clearTimeout(byTimer.current);
    try {
      await updateLocalSession(session.id, { completedBy: doneBy });
      await finishSession(session.id, reason, who, finalNote, doneBy.trim() || null);
      window.scrollTo({ top: 0 });
    } catch {
      setSaveError('Couldn’t save the restock on this device. Nothing was lost: try Finish again.');
    }
  };
  const finished = session.status === 'finished' || session.status === 'finished_exceptions';
  // Morning prep handover (Kitchen full restocks): its own record, answered before finishing.
  const prepOn = ctx.prepTasks.length > 0 && session.kind === 'full';
  const handover = useLive(async () => (prepOn ? localDb().prep.get(session.id) : undefined), [session.id, prepOn], undefined);
  const prepMissing = prepOn && !handover && !finished;
  const goPrep = () => document.getElementById('morning-prep')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const ex = finished ? [] : exceptions({ kind: session.kind, view, placements, recordedAreas: recorded, items });
  // Area restocks (e.g. Candy Bar's confection stand) are named after their area.
  const areaName = session.kind === 'area' ? view.areas[0]?.area.name ?? 'Area' : null;
  const emailed = session.kind !== 'quick';

  const covered = activePlacements(session.kind, placements, recorded);
  const lines = collectionLines(collectPlacements(session.kind, placements, recorded), items);
  const notCollected: [string, string][] = [], collected: [string, string][] = [];
  for (const l of lines) {
    const st = lineState(l, items), info = lineInfo(l, items), got = lineGot(l, items);
    if (l.kind === 'task') { (st === 'done' ? collected : notCollected).push([l.productName, st === 'done' ? 'Done' : 'Task not done']); continue; }
    if (got > 0) collected.push([l.productName, formatQty(got, l.unitSingular, l.unitPlural)]);
    if (st !== 'done' && info.reason !== 'insufficient') notCollected.push([l.productName, `${formatQty(round2(l.total - got), l.unitSingular, l.unitPlural)} not collected${info.reason ? ` (${SHORT_REASONS.find((r) => r[0] === info.reason)![1].toLowerCase()})` : ''}`]);
  }
  const displayRule = !!view.department.noneOnDisplay;
  const outcomes = restockOutcomes(session.kind, view, placements, recorded, items, lines);
  // Recorded "couldn't collect" results (access, time, other): not a shortage, but managers should know.
  const incomplete = outcomes.some((o) => o.status === 'not_topped_up' && o.reason);
  const finishReason = (r: string | null) => r ?? (incomplete ? 'Collection incomplete' : null);
  // Products nobody checked, grouped by area ("Fridge 2: Milk, Butter portions")
  const uncheckedByArea = new Map<string, string[]>();
  for (const p of covered) {
    // Only missing target counts: a blank "staff enter" product just wasn't needed.
    if (!isRequired(p) || isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)) continue;
    uncheckedByArea.set(p.areaName, [...(uncheckedByArea.get(p.areaName) ?? []), p.productName]);
  }

  const list = (rows: [string, string][], empty: string) => rows.length
    ? <ul>{rows.map(([a, b]) => <li key={a + b}><span>{a}</span><span>{b}</span></li>)}</ul> : <p className="muted">{empty}</p>;
  const goTo = (e: (typeof ex)[number]) => {
    if (e.areaId) void updateLocalSession(session.id, { curAreaId: e.areaId });
    ctx.go(e.kind === 'collect' ? 'collect' : 'check');
  };

  // Gold Class Bar: staff can change a status worked out from the checks (only while the restock is open).
  const correct = finished ? undefined : (o: StockOutcome, st: NonNullable<ItemState['statusOverride']>) =>
    void setItems(session.id, (o.placementIds ?? []).map((placementId) => ({ placementId, fields: { statusOverride: st === o.auto ? null : st } })), who);
  const report = <StockReport outcomes={outcomes} displayRule={displayRule} onCorrect={correct} />;

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
                <h2>{session.status === 'finished_exceptions' ? 'Finished with exceptions' : areaName ? `${areaName} restocked` : 'Restock complete'}</h2>
                <p>Finished at {timeOf(session.finishedAt)}{session.completedBy ? <> &middot; Completed by <b className="fh-by">{session.completedBy}</b></> : session.people.length ? <> &middot; {session.people.join(', ')}</> : null}</p>
                {session.exceptionReason ? <p className="fh-reason"><Icon name="warn" />{session.exceptionReason}</p> : null}
              </div>
            </div>
            {prepOn ? <section className="prep done-view"><PrepSummary handover={handover} title="Morning prep handover" />
              <p className="meta">{handover ? 'Saved for the morning team on the Kitchen screen.' : 'No handover was given.'}</p></section> : null}
            {session.note ? (
              <section className="note-sent"><h3><Icon name="list" />Comments{emailed ? ' sent to managers' : ''}</h3><p>{session.note}</p></section>
            ) : null}
            {report}
          </>
        ) : (
          <>
            <h2 className="finish-title">{areaName ? `Finish ${areaName}` : 'Finish restock'}</h2>
            {/* Straight to what matters: anything still to do, then shortages, then comments. */}
            {ex.length === 0 ? null : (
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
                  <button className="btn caution big" disabled={!exReason} onClick={() => { void finish(exReason); setExOpen(false); }}><Icon name="warn" />Confirm finish with exceptions</button>
                </div>
              </section>
            ) : null}

            {report}

            {/* Kitchen: drawers still waiting for their refill (not a shortage). */}
            <PendingRefills list={pendingRefills(session.kind, placements, recorded, items)}
              onRefilled={(p) => void setItems(session.id, [{ placementId: p.placementId, fields: { refillStatus: 'refilled' } }], who)} />
            {prepOn ? <MorningPrepPicker tasks={ctx.prepTasks} handover={handover}
              onSave={(st, list) => void setPrep(session, st, list, who)} /> : null}

            {/* Always shown (also when there are no shortages): who is signing this restock off. */}
            <section className="note-box by-box">
              <label htmlFor="completed-by"><b>Completed by</b></label>
              <input id="completed-by" type="text" maxLength={40} autoComplete="name" value={doneBy} onChange={(e) => editDoneBy(e.target.value)} placeholder="Your name" />
            </section>
            {saveError ? <p className="err" role="alert">{saveError}</p> : null}

            <section className="note-box">
              <label htmlFor="finish-note"><b>Comments for managers</b> <span className="muted">(optional)</span></label>
              <textarea id="finish-note" rows={2} maxLength={1000} value={note} onChange={(e) => editNote(e.target.value)} placeholder="Anything managers should know?" />
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
          <button className="btn primary big" onClick={ctx.done}><Icon name={areaName ? 'back' : 'home'} />{ctx.doneLabel}</button>
        </Dock>
      ) : (
        <Dock icon={ex.length || prepMissing ? 'warn' : 'check'} title={ex.length ? `${plural(ex.length, 'thing')} still to do` : prepMissing ? <button type="button" className="dock-2 linkbtn" onClick={goPrep}>Answer Morning prep first</button> : ''}>
          <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
          {ex.length ? <button className="btn caution big" disabled={prepMissing} onClick={() => { setExOpen(true); window.setTimeout(() => document.getElementById('expanel')?.scrollIntoView({ block: 'start' }), 50); }}><span className="lg">Finish with exceptions&hellip;</span><span className="sm">With exceptions&hellip;</span></button> : null}
          <button className="btn good big" disabled={ex.length > 0 || prepMissing} onClick={() => void finish(finishReason(null))}><Icon name="check" />{areaName ? 'Finish' : 'Finish restock'}</button>
        </Dock>
      )}
    </>
  );
}

/**
 * What managers will act on, as compact rows: confirmed storeroom shortages (out of stock /
 * running low), then collection that couldn't be finished (not a shortage). Nothing at all
 * when everything was collected.
 */
function StockReport({ outcomes, displayRule = false, onCorrect }: {
  outcomes: StockOutcome[]; displayRule?: boolean;
  /** Gold Class Bar: change a shortage's status (Out of stock / Still available / Not sure). */
  onCorrect?: (o: StockOutcome, status: NonNullable<ItemState['statusOverride']>) => void;
}) {
  const [changing, setChanging] = useState<string | null>(null);
  const short = outcomes.filter(isShortage);
  const incomplete = outcomes.filter((o) => o.status === 'not_topped_up' && o.reason);
  if (!short.length && !incomplete.length) return null;
  const q = (o: StockOutcome, n: number) => `${fmt(n)} ${n === 1 ? o.unitSingular : o.unitPlural}`;
  const why = (o: StockOutcome) => SHORT_REASONS.find((r) => r[0] === o.reason)?.[1] ?? 'Not collected';
  const CHOICES: [NonNullable<ItemState['statusOverride']>, string][] = [['out', 'Out of stock'], ['low', 'Still available'], ['unconfirmed', 'Not sure']];
  const row = (o: StockOutcome, kind: 'out' | 'low' | 'unc' | 'inc') => (
    <li key={o.productName} className={`sr-row k-${kind}`} data-outcome={o.productName}>
      <span className="sr-dot" aria-hidden="true" />
      <span className="sr-t">
        <b>{o.productName}{o.flagged ? <span className="sr-flag"><Icon name="flag" />Flagged</span> : null}</b>
        {o.upstairs ? (
          // Gold Class Bar: from the "None left here" ticks and what was collected downstairs.
          <small>{kind === 'out' ? <>Out of stock &middot; {q(o, o.short)} short</>
            : kind === 'low' ? <>Low stock &middot; {q(o, o.short)} short &middot; {o.got > 0 ? `${q(o, o.got)} collected` : 'Still available upstairs'}</>
            : <>Top-up incomplete &middot; {q(o, o.short)} short &middot; Upstairs stock not confirmed</>}
            {o.overridden ? <> &middot; Changed</> : null}
            {onCorrect && o.got === 0 ? <button type="button" className="linkbtn sr-change" aria-expanded={changing === o.productName}
              onClick={() => setChanging(changing === o.productName ? null : o.productName)}>{changing === o.productName ? 'Done' : 'Change'}</button> : null}</small>
        ) : (
          <small>{kind === 'out' ? <>Out of stock{o.noneOnDisplay ? <> &middot; None on display</> : null} &middot; Short {q(o, o.short)}</>
            // Candy Bar: Low stock with how many short (also when none was collected).
            : kind === 'low' && displayRule ? <>Low stock &middot; Short {q(o, o.short)}{o.got > 0 ? <> &middot; Collected {fmt(o.got)}</> : null}</>
            : kind === 'low' ? <>Running low &middot; Collected {fmt(o.got)} of {q(o, o.needed)}</>
            : <>Collection incomplete &middot; {why(o)} &middot; {q(o, o.short)} not collected</>}</small>
        )}
        {kind === 'out' && o.affects.length ? <small className="sr-affects">Set as sold out: <b>{o.affects.join(', ')}</b></small> : null}
        {onCorrect && o.upstairs && changing === o.productName ? (
          <span className="chips sr-fix" role="group" aria-label={`Status of ${o.productName}`}>
            {CHOICES.map(([v, label]) => (
              <button type="button" key={v} className={`chip ${o.status === v ? 'on' : ''}`} aria-pressed={o.status === v}
                onClick={() => { onCorrect(o, v); setChanging(null); }}>{label}</button>
            ))}
          </span>
        ) : null}
      </span>
    </li>
  );
  const kindOf = (o: StockOutcome) => (o.status === 'out' ? 'out' : o.status === 'low' ? 'low' : 'unc');
  return (
    <>
      {short.length ? (
        <section className="sreport" aria-labelledby="sr-short"><h3 id="sr-short">Stock shortages <span className="count">{short.length}</span></h3>
          {/* Out of stock first: what the next shift can't serve. */}
          <ul>{short.map((o) => row(o, kindOf(o)))}</ul></section>
      ) : null}
      {incomplete.length ? (
        <section className="sreport" aria-labelledby="sr-inc"><h3 id="sr-inc">Collection incomplete <span className="count">{incomplete.length}</span></h3>
          <ul>{incomplete.map((o) => row(o, 'inc'))}</ul></section>
      ) : null}
    </>
  );
}

const fmt = (n: number) => String(round2(n));
