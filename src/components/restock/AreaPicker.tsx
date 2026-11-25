'use client';
import { Icon } from '@/components/Icon';
import { useLive } from '@/lib/client/hooks';
import { localDb, type LocalSession } from '@/lib/client/local-db';
import { collectionLines, EMPTY_ITEM, type DepartmentView, type ItemState } from '@/lib/restock-logic';
import type { RemoteSession } from '@/lib/sync-types';
import { Badge, timeOf } from './shared';
import { AdminMenu } from './ResetControls';
import type { ResetFor } from './RestockApp';

interface AreaRun { id: string; status: LocalSession['status']; startedAt: string; finishedAt: string | null; people: string[]; entered: number; local: boolean }

/**
 * Departments restocked area by area (Candy Bar): pick the area you're about to restock.
 * Each area is its own restock (enter what's needed, collect, finish), at any time and in any order.
 */
export function AreaPicker({ view, remote, quickSession, today, opening, onStart, onSummary, onQuick, onReset }: {
  view: DepartmentView; remote: RemoteSession[]; quickSession: LocalSession | null; today: string; opening: boolean;
  onStart: (areaId: string) => void; onSummary: (sessionId: string, areaId: string) => void; onQuick: () => void;
  /** Admins only: reset tonight's restocks of an area, or this device's quick restock. */
  onReset?: (r: ResetFor) => void;
}) {
  const sessions = useLive(async () => (await localDb().sessions.where('departmentId').equals(view.department.id).toArray())
    .filter((s) => s.kind === 'area' && s.tradingDate === today), [view.department.id, today], [] as LocalSession[]);
  const items = useLive(async () => (sessions.length ? localDb().items.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray() : []), [sessions.map((s) => s.id).join()], []);

  const entered = (sessionId: string, rows: { sessionId?: string; placementId: string; requestedQty?: number | null; currentQty?: number | null; routineChoice?: string | null }[]) =>
    rows.filter((r) => (r.sessionId ?? sessionId) === sessionId && (r.requestedQty !== null && r.requestedQty !== undefined || r.currentQty !== null && r.currentQty !== undefined || !!r.routineChoice)).length;

  /** Tonight's restocks of one area, from this device and from others (this device's copy wins). */
  const runsFor = (areaId: string): AreaRun[] => {
    const mine: AreaRun[] = sessions.filter((s) => s.areaId === areaId).map((s) => ({
      id: s.id, status: s.status, startedAt: s.startedAt, finishedAt: s.finishedAt, people: s.people, local: true, entered: entered(s.id, items),
    }));
    const ids = new Set(mine.map((r) => r.id));
    const theirs: AreaRun[] = remote.filter((s) => s.kind === 'area' && s.areaId === areaId && !ids.has(s.id)).map((s) => ({
      id: s.id, status: s.status, startedAt: s.startedAt, finishedAt: s.finishedAt, people: s.people, local: false, entered: entered(s.id, s.items.map((i) => ({ ...i, sessionId: s.id }))),
    }));
    return [...mine, ...theirs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  };

  return (
    <main className="wrap restock-main">
      <section className={`dhero ${view.department.theme === 'gold' ? 'gold' : ''}`}>
        <span className="dh-icon" aria-hidden="true"><Icon name={view.department.icon} /></span>
        <div className="dh-t">
          {view.department.groupLabel ? <span className="dh-group">{view.department.groupLabel}</span> : null}
          <h1>{view.department.shortName}</h1>
          <p className="dh-sub">Choose the area you&rsquo;re restocking</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="dh-mark" src="/brand/village-v-white.png" alt="" aria-hidden="true" />
      </section>

      <div className="apick">
        {view.areas.map(({ area, placements }) => {
          const runs = runsFor(area.id);
          // Carry on with one that has something entered; an opened-but-empty one just counts as not started.
          const open = runs.find((r) => r.status === 'open' && r.entered > 0);
          const last = runs.find((r) => r.status === 'finished' || r.status === 'finished_exceptions');
          const photos = placements.filter((p) => p.photoPath).slice(0, 4);
          // How much this open restock still needs collecting (this device's copy only).
          const toCollect = open?.local ? collectionLines(placements, new Map<string, ItemState>(items.filter((i) => i.sessionId === open.id).map((r) => [r.placementId, { ...EMPTY_ITEM, ...r }]))).length : null;
          return (
            <section key={area.id} className={`type acard ${open ? 'k-active' : last ? 'k-done' : ''}`} aria-labelledby={`ap-${area.id}`}>
              <div className="ac-top">
                <div className="ac-t">
                  <h2 id={`ap-${area.id}`}>{area.name}</h2>
                </div>
                {onReset && runs.length ? <AdminMenu label={`${area.name} restock`} onChoose={() => onReset({ kind: 'area', areaId: area.id, areaName: area.name })} /> : null}
                {photos.length ? (
                  <span className="ac-photos" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {photos.map((p) => <img key={p.placementId} src={p.photoPath!} alt="" loading="lazy" />)}
                  </span>
                ) : null}
              </div>
              <p className="ac-st">
                {open ? <Badge st="info">In progress &middot; {open.entered} entered{toCollect !== null ? ` · ${toCollect} to collect` : ''}{open.people.length ? ` · ${open.people.join(', ')}` : ''}</Badge>
                  : last ? (last.status === 'finished_exceptions' ? <Badge st="warn" icon="warn">Finished with exceptions {timeOf(last.finishedAt)}</Badge> : <Badge st="ok">Restocked {timeOf(last.finishedAt)}{last.people.length ? ` · ${last.people.join(', ')}` : ''}</Badge>)
                  : <Badge st="none">Not restocked tonight</Badge>}
              </p>
              <div className="ac-acts">
                {last && !open && last.local ? <button className="btn" onClick={() => onSummary(last.id, area.id)}>Summary</button> : null}
                <button className="btn primary big" disabled={opening} onClick={() => onStart(area.id)}>
                  {open ? 'Resume' : last ? 'Restock again' : 'Start'}<Icon name="next" />
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <div className="quick-row">
        <button className="quick-link" onClick={onQuick} disabled={opening}>
          <Icon name="bolt" /><span><b>{quickSession?.selected.length ? 'Continue stock top-up' : 'Stock top-up'}</b><small>Search for anything running low, from any area</small></span><Icon name="next" />
        </button>
        {onReset && quickSession ? <AdminMenu label="Stock top-up" onChoose={() => onReset({ kind: 'quick' })} /> : null}
      </div>
    </main>
  );
}
