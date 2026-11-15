'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EXCEPTION_REASONS, EMPTY_ITEM, SHORT_REASONS, activePlacements, areaStatus, collectionLines, exceptions, isChecked,
  lineGot, lineInfo, lineState, outcomeLine, stockOutcomes, summaryText, type StockOutcome, type StockStatus,
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
  const [copied, setCopied] = useState('');
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

  const text = summaryText({
    departmentName: view.department.name, kind: session.kind, finishedLabel: finished ? timeOf(session.finishedAt) : null,
    exceptionReason: session.exceptionReason, people: session.people, view, placements, recordedAreas: recorded,
    skipReasons: new Map([...areaRecords].map(([k, v]) => [k, v.skipReason ?? ''])), items,
    dateLabel: new Date(session.startedAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied('Summary copied'); }
    catch { const t = document.getElementById('copybox') as HTMLTextAreaElement | null; t?.focus(); t?.select(); setCopied('Text selected. Use Copy from the menu.'); }
    window.setTimeout(() => setCopied(''), 2500);
  };
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
            <div className={`finish-meta ${session.status === 'finished_exceptions' ? 's-warn' : 's-ok'}`}>
              <Icon name={session.status === 'finished_exceptions' ? 'warn' : 'check'} />
              <span><b>{session.status === 'finished_exceptions' ? 'Finished with exceptions' : 'Restock complete'}</b> at {timeOf(session.finishedAt)}
                {session.exceptionReason ? <> &middot; {session.exceptionReason}</> : null}
                {session.people.length ? <> &middot; {session.people.join(', ')}</> : null}</span>
            </div>
            {report}
            <details className="sum-details">
              <summary><Icon name="list" />Show full record</summary>
              {details}
              <section className="sum-card" style={{ marginTop: 14 }}><h3><Icon name="copy" />Copy for managers</h3>
                <textarea className="copybox" id="copybox" readOnly value={text} />
              </section>
            </details>
            <div><button className="btn" onClick={() => void copy()}><Icon name="copy" />Copy for managers</button>{copied ? <span className="meta" role="status" style={{ marginLeft: 10 }}>{copied}</span> : null}</div>
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
                  <button className="btn caution big" disabled={!exReason} onClick={() => { void finishSession(session.id, exReason, who); setExOpen(false); window.scrollTo({ top: 0 }); }}><Icon name="warn" />Confirm finish with exceptions</button>
                </div>
              </section>
            ) : null}

            {outcomes.length ? report : null}

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
          <button className="btn" onClick={ctx.saveAndExit}><Icon name="save" />Save and exit</button>
          {ex.length ? <button className="btn caution big" onClick={() => { setExOpen(true); window.setTimeout(() => document.getElementById('expanel')?.scrollIntoView({ block: 'start' }), 50); }}>Finish with exceptions&hellip;</button> : null}
          <button className="btn good big" disabled={ex.length > 0} onClick={() => { void finishSession(session.id, null, who); window.scrollTo({ top: 0 }); }}><Icon name="check" />Finish restock</button>
        </Dock>
      )}
    </>
  );
}

const GROUPS: { st: StockStatus; title: string; sub: string; cls: string }[] = [
  { st: 'out', title: 'Out of stock', sub: 'The storeroom had none', cls: 's-bad' },
  { st: 'low', title: 'Running low', sub: 'The storeroom only had some', cls: 's-warn' },
  { st: 'not_topped_up', title: 'Not topped up', sub: 'Not collected for another reason', cls: 's-none' },
];

/** The heart of the summary: what we're now low on or out of, worst first. */
function StockReport({ outcomes, finished }: { outcomes: StockOutcome[]; finished: boolean }) {
  if (!outcomes.length) {
    return (
      <section className="stock-report all-good">
        <Icon name="check" /><div><h2>Nothing low or out of stock</h2><p>Everything collected is back to its target.</p></div>
      </section>
    );
  }
  return (
    <section className="stock-report">
      <h2>{finished ? 'Stock after this restock' : 'Low or out of stock so far'}</h2>
      {GROUPS.map((g) => {
        const rows = outcomes.filter((o) => o.status === g.st);
        if (!rows.length) return null;
        return (
          <div key={g.st} className={`stock-group ${g.cls}`}>
            <div className="stock-group-h"><span className="badge"><Icon name={g.st === 'out' ? 'warn' : g.st === 'low' ? 'down' : 'circle'} />{g.title} &middot; {rows.length}</span><small>{g.sub}</small></div>
            <ul>
              {rows.map((o) => (
                <li key={o.productName}>
                  <span className="sp-name">{o.productName}{o.flagged ? <span className="badge s-bad flag-tag"><Icon name="flag" />Flagged</span> : null}</span>
                  <span className="sp-detail">{outcomeLine(o).slice(o.productName.length + 2)}</span>
                  {o.onShelf !== null && o.target ? <span className="sp-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (o.onShelf / o.target) * 100)}%` }} /></span> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
