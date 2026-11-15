'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { TopBar, timeLabel } from '@/components/TopBar';
import { OfflineBanner, TopControls } from '@/components/restock/SyncControls';
import { useCatalogue } from '@/lib/client/use-catalogue';
import { useLive } from '@/lib/client/hooks';
import { localDb, type LocalArea, type LocalSession } from '@/lib/client/local-db';
import { tradingDate } from '@/lib/restock-math';
import { adminSignOut } from '@/app/actions/admin';
import type { RemoteSession } from '@/lib/sync-types';
import type { Catalogue, CatDepartment } from '@/lib/catalogue-types';
import { HoldLogo } from './HoldLogo';

type Seg = 'done' | 'skip' | 'none';
/** Tonight's state for one department, from this device's copy or from what other devices uploaded. */
interface DeptState {
  d: CatDepartment;
  kind: 'active' | 'quick' | 'done' | 'exceptions' | 'idle';
  segs: Seg[];           // one per area, in walking order
  doneAreas: number;
  products: number;
  people: string[];
  startedAt: string | null;
  finishedAt: string | null;
  reason: string | null;
  quickCount: number;
  updatedAt: string;
}

const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : '');

function stateFor(cat: Catalogue, d: CatDepartment, local: LocalSession | undefined, localAreas: LocalArea[], remote: RemoteSession | undefined, quick: LocalSession | undefined): DeptState {
  const areas = cat.areas.filter((a) => a.departmentId === d.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const areaIds = new Set(areas.map((a) => a.id));
  const products = cat.placements.filter((p) => areaIds.has(p.checkAreaId)).length;
  const s = local ?? remote;
  const statusOf = (id: string): Seg => {
    const st = local ? localAreas.find((a) => a.sessionId === local.id && a.areaId === id)?.status : remote?.areas.find((a) => a.areaId === id)?.status;
    return st === 'complete' ? 'done' : st === 'skipped' ? 'skip' : 'none';
  };
  const segs = areas.map((a) => statusOf(a.id));
  const base = {
    d, segs, doneAreas: segs.filter((x) => x !== 'none').length, products, people: s?.people ?? [], startedAt: s?.startedAt ?? null,
    finishedAt: s?.finishedAt ?? null, reason: s?.exceptionReason ?? null, quickCount: quick?.selected.length ?? 0,
    updatedAt: s?.updatedAt ?? quick?.updatedAt ?? '',
  };
  if (s && s.status === 'finished') return { ...base, kind: 'done', segs: segs.map(() => 'done'), doneAreas: segs.length };
  if (s && s.status === 'finished_exceptions') return { ...base, kind: 'exceptions' };
  if (s) return { ...base, kind: 'active' };
  if (quick?.selected.length) return { ...base, kind: 'quick' };
  return { ...base, kind: 'idle' };
}

export function HomeScreen({ isAdmin }: { isAdmin: boolean }) {
  const { catalogue, checkedAt, error } = useCatalogue();
  const [toast, setToast] = useState('');
  const [remote, setRemote] = useState<RemoteSession[]>([]);
  const day = catalogue ? tradingDate(new Date(), catalogue.settings.timeZone, catalogue.settings.cutoffHour) : null;
  // The shift's own date: after midnight it's still the same close until the cut-off (5 am).
  const dateLabel = day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';

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
  const localAreas = useLive(async () => localDb().areas.toArray(), [], [] as LocalArea[]);

  const states = catalogue ? catalogue.departments.map((d) => stateFor(catalogue, d,
    local.find((s) => s.departmentId === d.id && s.kind === 'full' && s.tradingDate === day), localAreas,
    remote.find((r) => r.departmentId === d.id),
    local.find((s) => s.departmentId === d.id && s.kind === 'quick' && s.status === 'open'))) : [];
  // The one thing to do next: the most recently worked-on restock that isn't finished.
  const next = [...states].filter((s) => s.kind === 'active' || s.kind === 'quick').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const counts = {
    active: states.filter((s) => s.kind === 'active').length,
    idle: states.filter((s) => s.kind === 'idle' || s.kind === 'quick').length,
    done: states.filter((s) => s.kind === 'done' || s.kind === 'exceptions').length,
  };

  return (
    <>
      <TopBar logo={<HoldLogo />} crumbs="Staff restocking" right={<TopControls catalogueCheckedAt={checkedAt} />} />
      <OfflineBanner />
      <main className="wrap home">
        {isAdmin ? (
          <div className="banner s-info">
            <Icon name="lock" />
            <div><b>An admin is signed in on this device</b><p>Sign out before handing the device back to staff.</p></div>
            <Link className="btn small" href="/admin">Admin</Link>
            <form action={adminSignOut}><button className="btn small">Sign out</button></form>
          </div>
        ) : null}

        <section className="shift" aria-label="Tonight">
          <div className="shift-top">
            <p className="shift-eyebrow"><Icon name="moon" />Tonight &middot; {dateLabel}</p>
            {states.length ? (
              <ul className="shift-tally" aria-label="Departments tonight">
                <li className={`t-active ${counts.active ? '' : 'zero'}`}><b>{counts.active}</b> in progress</li>
                <li className={`t-idle ${counts.idle ? '' : 'zero'}`}><b>{counts.idle}</b> to start</li>
                <li className={`t-done ${counts.done ? '' : 'zero'}`}><b>{counts.done}</b> done</li>
              </ul>
            ) : null}
          </div>
          <h1 className="shift-title">
            {!states.length ? 'Restocking'
              : next ? (next.kind === 'quick' ? 'Pick up where you left off' : 'Restock in progress')
              : counts.done === states.length ? 'Everything is restocked for tomorrow'
              : counts.done ? `${counts.idle} ${counts.idle === 1 ? 'department' : 'departments'} still to restock`
              : 'Ready for the close'}
          </h1>
          {next ? <NextUp s={next} /> : states.length && counts.done === states.length
            ? <p className="shift-sub"><Icon name="check" />All {states.length} departments finished. Nice work.</p>
            : states.length ? <p className="shift-sub">Choose a department below to start a full or quick restock.</p> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="shift-mark" src="/brand/village-v-white.png" alt="" aria-hidden="true" />
        </section>

        <section className="depts" aria-labelledby="depts-h">
          <div className="sec-h"><h2 id="depts-h">Departments</h2>{checkedAt ? <span className="meta">Product data checked {timeLabel(checkedAt)}</span> : null}</div>
          {!catalogue && !error ? <p className="meta">Loading product data&hellip;</p> : null}
          {error && !catalogue ? (
            <div className="banner s-warn"><Icon name="wifioff" /><div><b>No product data on this device yet</b><p>{error}</p></div></div>
          ) : null}
          {catalogue && catalogue.departments.length === 0 ? (
            <div className="banner s-none"><Icon name="info" /><div><b>No departments set up yet</b><p>An admin can add them in Admin.</p></div></div>
          ) : null}
          <div className="dgrid">
            {states.map((s) => <DepartmentCard key={s.d.id} s={s} featured={s === next} />)}
          </div>
        </section>
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}

/** One segment per checking area: filled = done, hatched = skipped, empty = still to do. */
function AreaMeter({ segs, label }: { segs: Seg[]; label: string }) {
  if (!segs.length) return null;
  return (
    <div className="ameter" role="img" aria-label={label}>
      {segs.map((s, i) => <i key={i} className={s} />)}
    </div>
  );
}

function NextUp({ s }: { s: DeptState }) {
  const gold = s.d.theme === 'gold';
  const isQuick = s.kind === 'quick';
  return (
    <Link href={`/d/${s.d.id}`} className={`nextup ${gold ? 'gold' : ''}`}>
      <span className="nu-icon" aria-hidden="true"><Icon name={s.d.icon} /></span>
      <span className="nu-body">
        <span className="nu-label"><span className="live" aria-hidden="true" />{isQuick ? 'Quick restock saved' : 'Next up'}</span>
        <b className="nu-name">{s.d.name}</b>
        {isQuick ? <span className="nu-meta">{s.quickCount} {s.quickCount === 1 ? 'product' : 'products'} on the list</span> : (
          <>
            <AreaMeter segs={s.segs} label={`${s.doneAreas} of ${s.segs.length} areas done`} />
            <span className="nu-meta"><b>{s.doneAreas} of {s.segs.length} areas</b>{s.people.length ? ` · ${s.people.join(', ')}` : ''}{s.startedAt ? ` · since ${t(s.startedAt)}` : ''}</span>
          </>
        )}
      </span>
      <span className="nu-go">{isQuick ? 'Continue' : 'Resume'}<Icon name="play" /></span>
    </Link>
  );
}

function DepartmentCard({ s, featured }: { s: DeptState; featured: boolean }) {
  const { d } = s;
  const gold = d.theme === 'gold';
  const status = {
    active: { icon: 'half', text: 'In progress', sub: `${s.doneAreas} of ${s.segs.length} areas${s.people.length ? ` · ${s.people.join(', ')}` : ''}`, action: 'Resume' },
    quick: { icon: 'bolt', text: 'Quick restock saved', sub: `${s.quickCount} on the list · full restock not started`, action: 'Continue' },
    done: { icon: 'check', text: 'Restocked', sub: `Finished ${t(s.finishedAt)}${s.people.length ? ` · ${s.people.join(', ')}` : ''}`, action: 'View' },
    exceptions: { icon: 'warn', text: 'Finished with exceptions', sub: `${t(s.finishedAt)}${s.reason ? ` · ${s.reason}` : ''}`, action: 'View' },
    idle: { icon: 'circle', text: 'Not started', sub: `${s.segs.length} areas · ${s.products} products`, action: 'Start' },
  }[s.kind] as { icon: 'half' | 'bolt' | 'check' | 'warn' | 'circle'; text: string; sub: string; action: string };
  return (
    <Link href={`/d/${d.id}`} className={`dcard2 k-${s.kind} ${gold ? 'gold' : 'village'} ${featured ? 'featured' : ''}`}
      aria-label={`${d.name}. ${status.text}. ${status.sub}. ${status.action}.`}>
      <span className="dc2-top">
        <span className="dc2-icon" aria-hidden="true"><Icon name={d.icon} /></span>
        <span className="dc2-title">
          {d.groupLabel ? <span className="dc2-group">{d.groupLabel}</span> : null}
          <b className="dc2-name">{d.shortName}</b>
        </span>
        {s.kind === 'done' ? <span className="dc2-seal" aria-hidden="true"><Icon name="check" /></span> : null}
      </span>
      {d.description ? <span className="dc2-desc">{d.description}</span> : null}
      <span className="dc2-status">
        <span className="dc2-st"><span className={`dc2-dot ${s.kind === 'active' ? 'live' : ''}`} aria-hidden="true"><Icon name={status.icon} /></span>{status.text}</span>
        <AreaMeter segs={s.segs} label={`${s.doneAreas} of ${s.segs.length} areas done`} />
        <span className="dc2-sub">{status.sub}</span>
      </span>
      <span className="dc2-go">{status.action}<Icon name="next" /></span>
    </Link>
  );
}
