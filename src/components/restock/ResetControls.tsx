'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { localDb } from '@/lib/client/local-db';
import { purgeSession } from '@/lib/client/restock-store';
import { getSyncStatus, syncNow } from '@/lib/client/sync-engine';
import { Sheet } from './SyncControls';
import { plural, timeOf } from './shared';

/** What the server would erase (from POST /api/admin/reset without confirm). */
interface Target {
  id: string; kind: 'full' | 'quick' | 'area'; areaName: string | null; status: string; startedAt: string; finishedAt: string | null;
  people: string[]; entered: number; collected: number; shortages: number;
}
export interface ResetScope { departmentId: string; kind: 'full' | 'quick' | 'area'; tradingDate: string; areaId?: string | null; sessionIds?: string[] }

/** A small "⋯" menu with one admin action. Only rendered for signed-in admins. */
export function AdminMenu({ label, onChoose, action = 'Reset restock…' }: { label: string; onChoose: () => void; action?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="amenu" ref={ref}>
      <button type="button" className="iconbtn amenu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Admin options: ${label}`} onClick={() => setOpen(!open)}><Icon name="more" /></button>
      {open ? (
        <div className="amenu-pop" role="menu">
          <span className="amenu-tag"><Icon name="lock" />Admin</span>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onChoose(); }}><Icon name="reset" />{action}</button>
        </div>
      ) : null}
    </div>
  );
}

const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const statusLabel = (t: Target) => t.status === 'open' ? `In progress, started ${timeOf(t.startedAt)}`
  : t.status === 'finished' ? `Finished ${timeOf(t.finishedAt)}` : t.status === 'finished_exceptions' ? `Finished with exceptions ${timeOf(t.finishedAt)}` : 'Never finished';

/**
 * Confirm and carry out a reset. It must go through the server (so every device drops the
 * restock), so it needs a connection. This device's own waiting changes are uploaded first.
 */
export function ResetSheet({ scope, departmentName, typeLabel, localIds, onClose, onDone }: {
  scope: ResetScope; departmentName: string; typeLabel: string;
  /** Restocks in this scope held on this device (also cleared here afterwards). */
  localIds: string[];
  onClose: () => void; onDone: (n: number) => void;
}) {
  const [phase, setPhase] = useState<'checking' | 'offline' | 'ready' | 'busy' | 'error'>('checking');
  const [targets, setTargets] = useState<Target[]>([]);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(0);
  const [sure, setSure] = useState(false);
  const scopeKey = JSON.stringify(scope);

  const call = async (confirm?: string[]) => {
    const res = await fetch('/api/admin/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ ...scope, confirm }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Only a signed-in admin can reset a restock. Sign in to Admin on this device and try again.');
    if (!res.ok) { if (body.targets) setTargets(body.targets); throw new Error(body.error ?? `The server replied ${res.status}.`); }
    return body as { targets?: Target[]; reset?: number; ids?: string[] };
  };

  useEffect(() => {
    let gone = false;
    void (async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { setPhase('offline'); return; }
      // Upload this device's own changes first, so the confirmation shows everything.
      await syncNow().catch(() => undefined);
      if (gone) return;
      if (getSyncStatus().connection === 'offline') { setPhase('offline'); return; }
      const rows = await localDb().outbox.toArray();
      setWaiting(rows.filter((r) => r.sessionId && localIds.includes(r.sessionId)).length);
      try { const b = await call(); if (!gone) { setTargets(b.targets ?? []); setPhase('ready'); } }
      catch (e) { if (!gone) { setError((e as Error).message); setPhase(navigator.onLine === false ? 'offline' : 'error'); } }
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const go = async () => {
    setPhase('busy'); setError('');
    try {
      const b = await call(targets.map((t) => t.id));
      // Clear this device straight away (other devices follow on their next sync).
      for (const id of new Set([...(b.ids ?? []), ...localIds])) await purgeSession(id, false);
      onDone(b.reset ?? 0);
    } catch (e) {
      setError(navigator.onLine === false ? 'The connection dropped. Nothing was reset. Try again when you’re back online.' : (e as Error).message);
      setPhase('ready'); setSure(false);
    }
  };
  // Nothing on the server, but a copy on this device (e.g. started offline and never uploaded): clear it here.
  const localOnly = phase === 'ready' && targets.length === 0 && localIds.length > 0;

  return (
    <Sheet title="Reset restock?" onClose={onClose}>
      <dl className="rs-facts">
        <div><dt>Department</dt><dd>{departmentName}</dd></div>
        <div><dt>Restock</dt><dd>{typeLabel}</dd></div>
        <div><dt>Date</dt><dd>{dateLabel(scope.tradingDate)}</dd></div>
      </dl>

      {phase === 'checking' ? <p className="meta"><Icon name="sync" /> Checking with the server&hellip;</p> : null}
      {phase === 'offline' ? (
        <div className="banner s-warn"><Icon name="wifioff" /><div><b>Connect to the internet to reset</b>
          <p>A reset is shared with every device, so it has to go through the server. Nothing has been changed.</p></div></div>
      ) : null}
      {phase === 'error' ? <div className="banner s-bad"><Icon name="warn" /><div><b>Couldn&rsquo;t check this restock</b><p>{error}</p></div></div> : null}

      {phase === 'ready' || phase === 'busy' ? (
        <>
          {targets.length ? (
            <ul className="rs-list">{targets.map((t) => (
              <li key={t.id}>
                <b>{statusLabel(t)}</b>
                <span>{plural(t.entered, 'product')} entered &middot; {t.collected} collected{t.shortages ? ` · ${plural(t.shortages, 'shortage')}` : ''}{t.people.length ? ` · ${t.people.join(', ')}` : ''}</span>
              </li>
            ))}</ul>
          ) : localOnly ? <p className="meta">This restock is only on this device (it was never uploaded).</p>
            : <p className="meta">There&rsquo;s nothing to reset: no {typeLabel.toLowerCase()} on the server for this date.</p>}
          {targets.length || localOnly ? (
            <>
              <div className="rs-warn">
                <p><b>This permanently erases, on the server and every device:</b> the quantities entered, collection progress, shortages and the manager email record for {targets.length > 1 ? 'these restocks' : 'this restock'}. It will no longer appear in history or Stock Insights.</p>
                <p>Staff can start a fresh restock straight away. Products, photos, areas, storerooms, targets and settings are not changed.</p>
                {waiting ? <p><Icon name="warn" /> {plural(waiting, 'change')} on this device couldn&rsquo;t upload and will be discarded too.</p> : null}
              </div>
              {error ? <p className="err" role="alert">{error}</p> : null}
              <label className="check rs-sure"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand this can&rsquo;t be undone</label>
            </>
          ) : null}
        </>
      ) : null}

      <div className="row-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        {targets.length ? <button className="btn danger big" disabled={!sure || phase !== 'ready'} onClick={() => void go()}><Icon name="reset" />{phase === 'busy' ? 'Resetting…' : `Reset ${typeLabel.toLowerCase()}`}</button>
          : localOnly ? <button className="btn danger big" disabled={!sure} onClick={() => void (async () => { for (const id of localIds) await purgeSession(id, false); onDone(0); })()}><Icon name="reset" />Clear from this device</button> : null}
      </div>
    </Sheet>
  );
}
