'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EXCEPTION_REASONS, EMPTY_ITEM, SHORT_REASONS, activePlacements, areaStatus, collectionLines, exceptions, isChecked,
  lineGot, lineInfo, lineState, summaryText,
} from '@/lib/restock-logic';
import { formatQty, round2 } from '@/lib/restock-math';
import { finishSession, reopenSession, updateLocalSession } from '@/lib/client/restock-store';
import { useSyncStatus } from '@/lib/client/hooks';
import { AREA_BADGE, AREA_LABEL, Badge, Dock, plural, timeOf } from './shared';
import type { RestockCtx } from './RestockApp';

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
  const shortages: [string, string][] = [], notCollected: [string, string][] = [], collected: [string, string][] = [], flagged: string[] = [];
  for (const l of lines) {
    const st = lineState(l, items), info = lineInfo(l, items), got = lineGot(l, items);
    if (l.kind === 'task') { (st === 'done' ? collected : notCollected).push([l.productName, st === 'done' ? 'Done' : 'Task not done']); continue; }
    if (got > 0) collected.push([l.productName, formatQty(got, l.unitSingular, l.unitPlural)]);
    if (st === 'short' && info.reason === 'insufficient') shortages.push([l.productName, `Short ${formatQty(round2(l.total - got), l.unitSingular, l.unitPlural)} (needed ${l.total}, got ${got})`]);
    else if (st !== 'done') notCollected.push([l.productName, `${formatQty(round2(l.total - got), l.unitSingular, l.unitPlural)} not collected${info.reason ? ` (${SHORT_REASONS.find((r) => r[0] === info.reason)![1].toLowerCase()})` : ''}`]);
    if (info.flagged) flagged.push(l.productName);
  }
  const unchecked = covered.filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM));
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

  return (
    <>
      <main className="wrap restock-main">
        {ctx.header}
        <div className="col-head"><h2>{finished ? 'Summary' : 'Finish restock'}</h2>
          {finished ? (session.status === 'finished_exceptions' ? <Badge st="warn" icon="warn">Finished with exceptions</Badge> : <Badge st="ok">Complete</Badge>) : <Badge st="info">Not finished</Badge>}</div>

        {finished ? (
          <div className={`banner ${session.status === 'finished_exceptions' ? 's-warn' : 's-ok'}`}><Icon name={session.status === 'finished_exceptions' ? 'warn' : 'check'} />
            <div><b>{session.status === 'finished_exceptions' ? 'Finished with exceptions' : 'Restock complete'} at {timeOf(session.finishedAt)}</b>
              <p>{session.exceptionReason ? `Reason: ${session.exceptionReason}. Outstanding items are listed below.` : 'Everything was checked and collected.'}</p></div></div>
        ) : ex.length === 0 ? (
          <section className="ready s-ok"><h2><Icon name="check" />Ready to finish</h2><p>Every {session.kind === 'full' ? 'area is complete' : 'product has a number'} and every item is collected or recorded.</p></section>
        ) : (
          <section className="ready s-warn"><h2><Icon name="warn" />Not ready to finish yet</h2>
            <ul className="exlist">{ex.map((e) => (
              <li key={e.text}><span><Badge st={e.status === 'warn' ? 'warn' : AREA_BADGE[e.status]}>{e.text}</Badge><small>{e.detail}</small></span>
                <button className="linkbtn" onClick={() => goTo(e)}>Go there<Icon name="next" /></button></li>
            ))}</ul>
            <p className="meta"><b>Handing over to someone else?</b> Use Save and exit. Your work stays open for the next person.</p>
          </section>
        )}

        {exOpen && ex.length ? (
          <section className="expanel" id="expanel">
            <h3>Finish with exceptions?</h3>
            <p>The restock will close and supervisors will see {ex.length > 1 ? 'these' : 'this'} as outstanding:</p>
            <ul className="exlist">{ex.map((e) => <li key={e.text}><span><Badge st={e.status === 'warn' ? 'warn' : AREA_BADGE[e.status]}>{e.text}</Badge></span></li>)}</ul>
            <b>Reason</b>
            <div className="chips">{EXCEPTION_REASONS.map((r) => <button key={r} className={`chip ${exReason === r ? 'on' : ''}`} onClick={() => setExReason(r)}>{r}</button>)}</div>
            <div className="row-actions">
              <button className="btn" onClick={() => { setExOpen(false); setExReason(null); }}>Cancel</button>
              <button className="btn caution big" disabled={!exReason} onClick={() => { void finishSession(session.id, exReason, who); setExOpen(false); window.scrollTo({ top: 0 }); }}><Icon name="warn" />Confirm finish with exceptions</button>
            </div>
          </section>
        ) : null}

        <div className="sum">
          {session.kind === 'full' ? (
            <section className="sum-card"><h3><Icon name="check" />Areas</h3>
              <ul>{view.areas.map(({ area, placements: ps }) => {
                const st = areaStatus(recorded.get(area.id), ps, items);
                return <li key={area.id}><span>{area.name}</span><span><Badge st={AREA_BADGE[st]}>{st === 'skipped' ? `Skipped: ${areaRecords.get(area.id)?.skipReason ?? ''}` : AREA_LABEL[st]}</Badge></span></li>;
              })}</ul></section>
          ) : null}
          <section className="sum-card" style={{ borderColor: shortages.length ? 'var(--bad-line)' : undefined }}>
            <h3 style={{ color: shortages.length ? 'var(--bad)' : undefined }}><Icon name="warn" />Confirmed shortages</h3>{list(shortages, 'None.')}
            {flagged.length ? <p className="meta"><b>Flagged for supervisor:</b> {flagged.join(', ')}</p> : null}</section>
          <section className="sum-card"><h3><Icon name="circle" />Unfinished</h3>
            {list([...notCollected, ...(unchecked.length ? [['Not checked', unchecked.map((p) => p.productName).join(', ')] as [string, string]] : [])], 'Nothing.')}</section>
          <section className="sum-card"><h3><Icon name="box" />Collected</h3>{list(collected, 'Nothing yet.')}</section>
        </div>

        {finished ? (
          <section className="sum-card"><h3><Icon name="copy" />Copy for supervisors</h3>
            <textarea className="copybox" id="copybox" readOnly value={text} />
            <div className="row-actions"><button className="btn primary" onClick={() => void copy()}><Icon name="copy" />Copy summary</button></div>
            {copied ? <p className="meta" role="status">{copied}</p> : null}
          </section>
        ) : null}
      </main>

      {finished ? (
        <Dock icon={sync.pending ? 'sync' : 'check'}
          title={sync.pending ? (sync.connection === 'offline' ? 'Finished on this device' : 'Uploading…') : 'Finished and saved'}
          sub={sync.pending ? `${plural(sync.pending, 'change')} will upload when there’s a connection. Nothing will be lost.` : 'Supervisors can see this restock.'}>
          <button className="btn" onClick={() => void reopenSession(session.id, who)}>Reopen</button>
          <button className="btn primary big" onClick={ctx.done}><Icon name="home" />Back to home</button>
        </Dock>
      ) : (
        <Dock icon={ex.length ? 'warn' : 'check'} title={ex.length ? `${plural(ex.length, 'thing')} outstanding` : 'Ready to finish'}
          sub={ex.length ? 'Finish restock unlocks when everything is done' : 'Everything is checked and collected'}>
          <button className="btn" onClick={ctx.saveAndExit}><Icon name="save" />Save and exit</button>
          {ex.length ? <button className="btn caution big" onClick={() => { setExOpen(true); window.setTimeout(() => document.getElementById('expanel')?.scrollIntoView({ block: 'start' }), 50); }}>Finish with exceptions&hellip;</button> : null}
          <button className="btn good big" disabled={ex.length > 0} onClick={() => { void finishSession(session.id, null, who); window.scrollTo({ top: 0 }); }}><Icon name="check" />Finish restock</button>
        </Dock>
      )}
    </>
  );
}
