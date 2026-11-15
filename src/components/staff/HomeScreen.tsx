'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { TopBar, timeLabel } from '@/components/TopBar';
import { OfflineBanner, TopControls } from '@/components/restock/SyncControls';
import { useCatalogue } from '@/lib/client/use-catalogue';
import { useLive } from '@/lib/client/hooks';
import { localDb, type LocalSession } from '@/lib/client/local-db';
import { tradingDate } from '@/lib/restock-math';
import { adminSignOut } from '@/app/actions/admin';
import type { RemoteSession } from '@/lib/sync-types';
import type { CatDepartment } from '@/lib/catalogue-types';
import { HoldLogo } from './HoldLogo';

interface DeptStatus { st: 'none' | 'info' | 'ok' | 'warn'; text: string; small: string; pct: number | null; action: string }

const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : '');

function statusFor(totalAreas: number, local: LocalSession | undefined, localDone: number, remote: RemoteSession | undefined, quick: LocalSession | undefined): DeptStatus {
  // This device's copy is the most up to date for its own work; otherwise use what other devices uploaded.
  const s = local ?? remote;
  const done = local ? localDone : remote ? remote.areas.filter((a) => a.status === 'complete' || a.status === 'skipped').length : 0;
  if (s && (s.status === 'finished' || s.status === 'finished_exceptions')) {
    return s.status === 'finished_exceptions'
      ? { st: 'warn', text: 'Finished with exceptions', small: `${t(s.finishedAt)}${s.exceptionReason ? ` · ${s.exceptionReason}` : ''}`, pct: null, action: 'View' }
      : { st: 'ok', text: 'Restocked for tomorrow', small: `Finished ${t(s.finishedAt)}${s.people.length ? ` · ${s.people.join(', ')}` : ''}`, pct: 1, action: 'View' };
  }
  if (s) return { st: 'info', text: `In progress · ${done} of ${totalAreas} areas`, small: `${s.people.join(', ') || 'Started'} · since ${t(s.startedAt)}`, pct: totalAreas ? done / totalAreas : 0, action: 'Resume' };
  if (quick?.selected.length) return { st: 'info', text: `Quick restock · ${quick.selected.length} products`, small: 'Saved. Tap to continue.', pct: null, action: 'Continue' };
  return { st: 'none', text: 'Not started tonight', small: 'Full or quick restock', pct: null, action: 'Start' };
}

export function HomeScreen({ isAdmin }: { isAdmin: boolean }) {
  const { catalogue, checkedAt, error } = useCatalogue();
  const [toast, setToast] = useState('');
  const [remote, setRemote] = useState<RemoteSession[]>([]);
  const day = catalogue ? tradingDate(new Date(), catalogue.settings.timeZone, catalogue.settings.cutoffHour) : null;
  const dateLabel = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: catalogue?.settings.timeZone });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('saved') === '1') {
      setToast('Saved. Anyone can carry on from here.');
      window.history.replaceState(null, '', '/');
      const id = window.setTimeout(() => setToast(''), 3000);
      return () => window.clearTimeout(id);
    }
  }, []);

  // Other devices' progress tonight (silently skipped when offline).
  useEffect(() => {
    if (!day) return;
    const load = () => fetch(`/api/sessions?date=${day}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((b) => b && setRemote(b.sessions)).catch(() => undefined);
    void load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [day]);

  const local = useLive(async () => (day ? (await localDb().sessions.toArray()).filter((s) => s.tradingDate === day || (s.kind === 'quick' && s.status === 'open')) : []), [day], [] as LocalSession[]);
  const localAreas = useLive(async () => localDb().areas.toArray(), [], []);

  return (
    <>
      <TopBar logo={<HoldLogo />} crumbs="Staff restocking" right={<TopControls catalogueCheckedAt={checkedAt} />} />
      <OfflineBanner />
      <main className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 26, paddingBlock: '22px 32px' }}>
        {isAdmin ? (
          <div className="banner s-info">
            <Icon name="lock" />
            <div><b>An admin is signed in on this device</b><p>Sign out before handing the device back to staff.</p></div>
            <Link className="btn small" href="/admin">Admin</Link>
            <form action={adminSignOut}><button className="btn small">Sign out</button></form>
          </div>
        ) : null}
        <section className="welcome">
          <div>
            <p className="date">{dateLabel}</p>
            <h1>Restocking</h1>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="welcome-mark" src="/brand/village-v-white.png" alt="" aria-hidden="true" />
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="sr-only">Departments</h2>
          {!catalogue && !error ? <p className="meta">Loading product data&hellip;</p> : null}
          {error && !catalogue ? (
            <div className="banner s-warn"><Icon name="wifioff" /><div><b>No product data on this device yet</b><p>{error}</p></div></div>
          ) : null}
          {catalogue && catalogue.departments.length === 0 ? (
            <div className="banner s-none"><Icon name="info" /><div><b>No departments set up yet</b><p>An admin can add them in Admin.</p></div></div>
          ) : null}

          <div className="dgrid">
            {catalogue?.departments.map((d) => {
              const totalAreas = catalogue.areas.filter((a) => a.departmentId === d.id).length;
              const full = local.find((s) => s.departmentId === d.id && s.kind === 'full' && s.tradingDate === day);
              const doneLocal = full ? localAreas.filter((a) => a.sessionId === full.id && (a.status === 'complete' || a.status === 'skipped')).length : 0;
              const quick = local.find((s) => s.departmentId === d.id && s.kind === 'quick' && s.status === 'open');
              return <DepartmentCard key={d.id} d={d} status={statusFor(totalAreas, full, doneLocal, remote.find((r) => r.departmentId === d.id), quick)} />;
            })}
          </div>
        </section>

        <footer className="meta" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{checkedAt ? `Product data checked ${timeLabel(checkedAt)}` : ''}</span>
        </footer>
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}

function DepartmentCard({ d, status }: { d: CatDepartment; status: DeptStatus }) {
  return (
    <Link href={`/d/${d.id}`} className={`dcard ${d.theme === 'gold' ? 'gc' : ''}`} aria-label={`${d.name}. ${status.text}. ${status.action}.`}>
      <div className="dc-head">
        <div className="dc-titles">
          {d.groupLabel ? <p className="eyebrow">{d.groupLabel}</p> : null}
          <h3>{d.shortName}</h3>
        </div>
        <span className="dicon" aria-hidden="true"><Icon name={d.icon} /></span>
      </div>
      {d.description ? <p className="dc-desc">{d.description}</p> : null}
      <div className="dc-foot">
        <div className={`dc-status s-${status.st}`}>
          <span className="st"><span className="dot" aria-hidden="true" />{status.text}</span>
          {status.pct !== null ? <div className="dc-bar" aria-hidden="true"><i style={{ width: `${Math.round(status.pct * 100)}%` }} /></div> : null}
          <small>{status.small}</small>
        </div>
        <span className="dc-go-lbl">{status.action}</span>
        <span className="dc-go" aria-hidden="true"><Icon name="next" /></span>
      </div>
    </Link>
  );
}
