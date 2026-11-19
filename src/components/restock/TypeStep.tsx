'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useLive } from '@/lib/client/hooks';
import { localDb, type LocalSession } from '@/lib/client/local-db';
import { areaStatus, EMPTY_ITEM, phaseAreas, usesRefill, type AreaStatus, type DepartmentView, type ItemState } from '@/lib/restock-logic';
import { AREA_BADGE, AREA_LABEL, Badge, timeOf } from './shared';
import type { RemoteSession } from '@/lib/sync-types';
import { AdminMenu } from './ResetControls';
import type { ResetFor } from './RestockApp';
import { MorningPrepHome } from './MorningPrep';

const TIPS_KEY = 'vr-hide-tips';

/** Choose Full or Quick Restock, with tonight's progress at a glance. */
export function TypeStep({ view, fullSession, remoteFull, quickSession, opening, onStart, onSummary, hasDefrost = false, onReset, prep }: {
  view: DepartmentView; fullSession: LocalSession | null; remoteFull: RemoteSession | null; quickSession: LocalSession | null; opening: boolean;
  onStart: (m: 'full' | 'quick') => void; onSummary: () => void;
  /** Gold Class Kitchen: offer the (optional) Defrost Planner beside Kitchen Restock. */
  hasDefrost?: boolean;
  /** Admins only: reset a restock. */
  onReset?: (r: ResetFor) => void;
  /** Gold Class Kitchen: the morning prep handover for the morning team. */
  prep?: { today: string; who: string } | null;
}) {
  const [hideTips, setHideTips] = useState(true);
  // Closed unless someone opened it on this device: the Start button comes first.
  useEffect(() => { try { setHideTips(localStorage.getItem(TIPS_KEY) !== '0'); } catch { setHideTips(true); } }, []);
  const toggleTips = () => { const v = !hideTips; setHideTips(v); try { localStorage.setItem(TIPS_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

  const areaRows = useLive(async () => (fullSession ? localDb().areas.where('sessionId').equals(fullSession.id).toArray() : []), [fullSession?.id], []);
  const itemRows = useLive(async () => (fullSession ? localDb().items.where('sessionId').equals(fullSession.id).toArray() : []), [fullSession?.id], []);
  // This device's copy if it has one, otherwise what other devices have uploaded.
  const src = fullSession ?? remoteFull;
  const items = fullSession
    ? new Map<string, ItemState>(itemRows.map((r) => [r.placementId, { ...EMPTY_ITEM, ...r }]))
    : new Map<string, ItemState>((remoteFull?.items ?? []).map((r) => [r.placementId, { ...EMPTY_ITEM, ...r }]));
  const recorded = fullSession
    ? new Map<string, AreaStatus>(areaRows.filter((a) => a.status !== 'not_started').map((a) => [a.areaId, a.status as AreaStatus]))
    : new Map<string, AreaStatus>((remoteFull?.areas ?? []).filter((a) => a.status === 'complete' || a.status === 'skipped').map((a) => [a.areaId, a.status]));
  const finished = src && (src.status === 'finished' || src.status === 'finished_exceptions');
  const doneAreas = view.areas.filter(({ area }) => recorded.get(area.id) === 'complete' || recorded.get(area.id) === 'skipped').length;
  // Gold Class Bar: front of house, then the upstairs spots (Refill FOH flow).
  const refill = usesRefill('full', view);
  const steps: [string, string][] = refill
    ? [['Check the bar', 'Walk the bar and enter only what needs topping up.'], ['Upstairs', 'At each spot: grab for the bar, then what to bring up (what you grabbed is suggested).'], ['Collect downstairs', 'One list, by storeroom.'], ['Finish', 'Note anything the storeroom was out of.']]
    : [['Check stock', 'Enter what’s needed. The app works out the rest.'], ['Collect', 'One list, grouped by storeroom.'], ['Finish', 'Note anything the storeroom was out of.']];
  // Small name-only pills (the colour and icon give the status), shown once a restock is under way.
  const pills = (areas: typeof view.areas) => areas.map(({ area, placements }) => {
    const st = areaStatus(recorded.get(area.id), placements, items);
    return <span key={area.id} className={`apill s-${AREA_BADGE[st]}`} title={AREA_LABEL[st]} aria-label={`${area.name}: ${AREA_LABEL[st]}`}><Icon name={AREA_BADGE[st] === 'ok' ? 'check' : AREA_BADGE[st] === 'skip' ? 'skip' : AREA_BADGE[st] === 'info' ? 'half' : 'circle'} />{area.name}</span>;
  });

  return (
    <main className="wrap restock-main">
      <section className={`dhero ${view.department.theme === 'gold' ? 'gold' : ''}`}>
        <span className="dh-icon" aria-hidden="true"><Icon name={view.department.icon} /></span>
        <div className="dh-t">
          {view.department.groupLabel ? <span className="dh-group">{view.department.groupLabel}</span> : null}
          <h1>{view.department.shortName}</h1>
          <p className="dh-sub">{finished ? (src!.status === 'finished_exceptions' ? `Finished with exceptions at ${timeOf(src!.finishedAt)}` : `Restocked tonight at ${timeOf(src!.finishedAt)}`)
            : src ? `Full restock in progress · ${doneAreas} of ${view.areas.length} areas${src.people.length ? ` · ${src.people.join(', ')}` : ''}` : `${view.areas.length} areas · ${view.placements.length} products`}</p>
          {src ? <div className="ameter" role="img" aria-label={`${doneAreas} of ${view.areas.length} areas done`}>{view.areas.map(({ area }) => <i key={area.id} className={recorded.get(area.id) === 'complete' ? 'done' : recorded.get(area.id) === 'skipped' ? 'skip' : ''} />)}</div> : null}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="dh-mark" src="/brand/village-v-white.png" alt="" aria-hidden="true" />
      </section>
      {/* Kitchen: last night's morning prep handover, for the morning team (tracked apart from the restock). */}
      {prep ? <MorningPrepHome departmentId={view.department.id} today={prep.today} who={prep.who} /> : null}
      {hideTips ? (
        <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={toggleTips}><Icon name="info" />How restocking works</button>
      ) : (
        <section className={`how ${steps.length > 3 ? 'compact' : ''}`} aria-label="How restocking works">
          {steps.map(([t, d], i) => <div key={t} className="how-step"><span className="n">{i + 1}</span><div><b>{t}</b><p>{d}</p></div></div>)}
          <button className="linkbtn" onClick={toggleTips}>Hide tips</button>
        </section>
      )}
      <div className={`types ${hasDefrost ? 'with-defrost' : ''}`}>
        {hasDefrost ? (
          <section className="type type-defrost">
            <div className="type-h">
              <span className="type-icon" aria-hidden="true"><Icon name="clock" /></span>
              <h2>Defrost Planner</h2>
              <Badge st="info" icon="info">Recommended</Badge>
            </div>
            <p className="lead">What frozen stock to defrost for the <b>next service</b>.</p>
            <p className="meta">Optional, and separate from restocking: use it before, after or between.</p>
            <div className="actions"><Link className="btn big" href={`/d/${view.department.id}/defrost`}>Open Defrost Planner<Icon name="next" /></Link></div>
          </section>
        ) : null}
        <section className={`type type-full ${src && !finished ? 'k-active' : ''}`}>
          <div className="type-h">
            <span className="type-icon" aria-hidden="true"><Icon name="list" /></span>
            <h2>{hasDefrost ? 'Kitchen Restock' : 'Full Restock'}</h2>
            {finished ? (src!.status === 'finished_exceptions' ? <Badge st="warn" icon="warn">Finished with exceptions {timeOf(src!.finishedAt)}</Badge> : <Badge st="ok">Complete {timeOf(src!.finishedAt)}</Badge>)
              : src ? <Badge st="info">In progress since {timeOf(src.startedAt)}</Badge> : <Badge st="none">Not started tonight</Badge>}
            {onReset && src ? <AdminMenu label={`${hasDefrost ? 'Kitchen' : 'Full'} restock`} onChoose={() => onReset({ kind: 'full' })} /> : null}
          </div>
          <p className="lead">Every area, for <b>closing shifts</b>. Shared, so anyone can continue it.</p>
          {/* The button first, so it's on screen without scrolling. */}
          <div className="actions">
            {finished && fullSession ? <button className="btn primary big" onClick={onSummary}>View summary</button>
              : <button className="btn primary big" disabled={opening} onClick={() => onStart('full')}>{src ? <>{finished ? 'Open restock' : `Resume ${hasDefrost ? 'kitchen' : 'full'} restock`}<Icon name="next" /></> : <>Start {hasDefrost ? 'kitchen' : 'full'} restock<Icon name="next" /></>}</button>}
          </div>
          {src ? (
            // Where it's up to (for whoever picks it up next), compact.
            refill ? (
              <div className="apills-groups">
                <div><small>Front of house</small><div className="apills">{pills(phaseAreas(view, 'foh'))}</div></div>
                <div><small>Back of house</small><div className="apills">{pills(phaseAreas(view, 'boh'))}</div></div>
              </div>
            ) : <div className="apills">{pills(view.areas)}</div>
          ) : refill ? <p className="meta steps-line">{steps.map(([t]) => t).join(' → ')}</p> : null}
        </section>
        <section className="type type-quick">
          <div className="type-h">
            <span className="type-icon" aria-hidden="true"><Icon name="bolt" /></span>
            <h2>Quick Restock</h2>{quickSession?.selected.length ? <Badge st="info">{quickSession.selected.length} on your list</Badge> : null}
            {onReset && quickSession ? <AdminMenu label="Quick restock" onChoose={() => onReset({ kind: 'quick' })} /> : null}
          </div>
          <p className="lead">Only what&rsquo;s running low, <b>between sessions</b>. Separate from the full restock.</p>
          <div className="actions"><button className={`btn big ${src && !finished ? '' : 'primary'}`} disabled={opening} onClick={() => onStart('quick')}>{quickSession ? 'Continue quick restock' : 'Start quick restock'}</button></div>
        </section>
      </div>
    </main>
  );
}

