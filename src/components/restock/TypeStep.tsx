'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useLive } from '@/lib/client/hooks';
import { localDb, type LocalSession } from '@/lib/client/local-db';
import { areaStatus, EMPTY_ITEM, type AreaStatus, type DepartmentView, type ItemState } from '@/lib/restock-logic';
import { AREA_BADGE, AREA_LABEL, Badge, timeOf } from './shared';
import type { RemoteSession } from '@/lib/sync-types';

const TIPS_KEY = 'vr-hide-tips';

/** Choose Full or Quick Restock, with tonight's progress at a glance. */
export function TypeStep({ view, fullSession, remoteFull, quickSession, opening, onStart, onSummary }: {
  view: DepartmentView; fullSession: LocalSession | null; remoteFull: RemoteSession | null; quickSession: LocalSession | null; opening: boolean;
  onStart: (m: 'full' | 'quick') => void; onSummary: () => void;
}) {
  const [hideTips, setHideTips] = useState(true);
  useEffect(() => { try { setHideTips(localStorage.getItem(TIPS_KEY) === '1'); } catch { setHideTips(false); } }, []);
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
      {hideTips ? (
        <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={toggleTips}><Icon name="info" />How restocking works</button>
      ) : (
        <section className="how" aria-label="How restocking works">
          <div className="how-step"><span className="n">1</span><div><b>Check stock</b><p>Enter what&rsquo;s there now. The app works out what you need.</p></div></div>
          <div className="how-step"><span className="n">2</span><div><b>Collect</b><p>One list, grouped by storeroom.</p></div></div>
          <div className="how-step"><span className="n">3</span><div><b>Finish</b><p>Note anything the storeroom was out of.</p></div></div>
          <button className="linkbtn" onClick={toggleTips}>Hide tips</button>
        </section>
      )}
      <div className="types">
        <section className={`type type-full ${src && !finished ? 'k-active' : ''}`}>
          <div className="type-h">
            <span className="type-icon" aria-hidden="true"><Icon name="list" /></span>
            <h2>Full Restock</h2>
            {finished ? (src!.status === 'finished_exceptions' ? <Badge st="warn" icon="warn">Finished with exceptions {timeOf(src!.finishedAt)}</Badge> : <Badge st="ok">Complete {timeOf(src!.finishedAt)}</Badge>)
              : src ? <Badge st="info">In progress since {timeOf(src.startedAt)}</Badge> : <Badge st="none">Not started tonight</Badge>}
          </div>
          <p className="lead">Every area, checked properly. For <b>closing shifts</b>.</p>
          <div className="areas-mini">{view.areas.map(({ area, placements }) => {
            const st = areaStatus(recorded.get(area.id), placements, items);
            return <Badge key={area.id} st={AREA_BADGE[st]}>{area.name}: {AREA_LABEL[st]}</Badge>;
          })}</div>
          <p className="meta">{view.areas.length} areas &middot; {view.placements.length} products &middot; shared, so anyone can continue it{src?.people.length ? ` · ${src.people.join(', ')}` : ''}</p>
          <div className="actions">
            {finished && fullSession ? <button className="btn primary big" onClick={onSummary}>View summary</button>
              : <button className="btn primary big" disabled={opening} onClick={() => onStart('full')}>{src ? <>{finished ? 'Open restock' : 'Resume full restock'}<Icon name="next" /></> : 'Start full restock'}</button>}
          </div>
        </section>
        <section className="type type-quick">
          <div className="type-h">
            <span className="type-icon" aria-hidden="true"><Icon name="bolt" /></span>
            <h2>Quick Restock</h2>{quickSession?.selected.length ? <Badge st="info">{quickSession.selected.length} on your list</Badge> : null}
          </div>
          <p className="lead">Only what&rsquo;s running low. For <b>short breaks between sessions</b>.</p>
          <p className="meta">Search or browse, then collect straight away. Kept separate from the full restock.</p>
          <div className="actions"><button className={`btn big ${src && !finished ? '' : 'primary'}`} disabled={opening} onClick={() => onStart('quick')}>{quickSession ? 'Continue quick restock' : 'Start quick restock'}</button></div>
        </section>
      </div>
    </main>
  );
}
