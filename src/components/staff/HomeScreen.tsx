'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { TopBar, timeLabel } from '@/components/TopBar';
import { OfflineBanner, TopControls } from '@/components/restock/SyncControls';
import { useCatalogue } from '@/lib/client/use-catalogue';
import { useLive, useResetIds } from '@/lib/client/hooks';
import { localDb, type LocalArea, type LocalItem, type LocalSession } from '@/lib/client/local-db';
import { tradingDate } from '@/lib/restock-math';
import { EMPTY_ITEM, departmentView, scopeView, shortageCount, type AreaStatus, type ItemState } from '@/lib/restock-logic';
import { adminSignOut } from '@/app/actions/admin';
import type { RemoteSession } from '@/lib/sync-types';
import type { Catalogue, CatDepartment } from '@/lib/catalogue-types';
import { HoldLogo } from './HoldLogo';

type Seg = 'done' | 'skip' | 'none';
/** Tonight's state for one department, from this device's copy or from what other devices uploaded. */
interface DeptState {
  d: CatDepartment;
  kind: 'active' | 'quick' | 'done' | 'exceptions' | 'idle' | 'part';
  /** Departments restocked area by area: each area's state tonight, in words. */
  areaDetail?: string;
  segs: Seg[];           // one per area, in walking order
  doneAreas: number;
  products: number;
  people: string[];
  startedAt: string | null;
  finishedAt: string | null;
  reason: string | null;
  quickCount: number;
  updatedAt: string;
  /** Finished tonight: how many stock shortages it recorded (out of stock or low). */
  shortages: number;
}

/** A finished restock's stock shortages, from this device's copy or the uploaded one. */
function shortagesOf(cat: Catalogue, d: CatDepartment, s: LocalSession | RemoteSession, localItems: LocalItem[], localAreas: LocalArea[]): number {
  const whole = departmentView(cat, d.id);
  if (!whole) return 0;
  const view = s.kind === 'area' ? scopeView(whole, s.areaId) : whole;
  const remote = 'items' in s ? s : null;
  const items = new Map<string, ItemState>((remote ? remote.items : localItems.filter((i) => i.sessionId === s.id)).map((r) => [r.placementId, { ...EMPTY_ITEM, ...r }]));
  const recorded = new Map<string, AreaStatus>((remote ? remote.areas : localAreas.filter((a) => a.sessionId === s.id))
    .filter((a) => a.status === 'complete' || a.status === 'skipped').map((a) => [a.areaId, a.status as AreaStatus]));
  const admits = 'forecastAdmits' in s ? s.forecastAdmits ?? null : null;
  return shortageCount(s.kind, view, items, recorded, admits);
}

const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : '');

function stateFor(cat: Catalogue, d: CatDepartment, local: LocalSession | undefined, localAreas: LocalArea[], localItems: LocalItem[], remote: RemoteSession | undefined, quick: LocalSession | undefined): DeptState {
  const areas = cat.areas.filter((a) => a.departmentId === d.id && !a.parentAreaId).sort((a, b) => a.sortOrder - b.sortOrder); // sections are part of their area
  const areaIds = new Set(cat.areas.filter((a) => a.departmentId === d.id).map((a) => a.id)); // includes sections
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
    shortages: s && s.status !== 'open' && s.status !== 'unfinished' ? shortagesOf(cat, d, s, localItems, localAreas) : 0,
  };
  if (s && s.status === 'finished') return { ...base, kind: 'done', segs: segs.map(() => 'done'), doneAreas: segs.length };
  if (s && s.status === 'finished_exceptions') return { ...base, kind: 'exceptions' };
  if (s) return { ...base, kind: 'active' };
  if (quick?.selected.length) return { ...base, kind: 'quick' };
  return { ...base, kind: 'idle' };
}

/**
 * Departments restocked area by area (Candy Bar): an area counts as done once it has a finished
 * restock tonight. Opened-but-empty area restocks don't count as started.
 */
function areaStateFor(cat: Catalogue, d: CatDepartment, local: LocalSession[], localItems: LocalItem[], localAreas: LocalArea[], remote: RemoteSession[], quick: LocalSession | undefined): DeptState {
  const areas = cat.areas.filter((a) => a.departmentId === d.id && !a.parentAreaId).sort((a, b) => a.sortOrder - b.sortOrder);
  const areaIds = new Set(cat.areas.filter((a) => a.departmentId === d.id).map((a) => a.id));
  const products = cat.placements.filter((p) => areaIds.has(p.checkAreaId)).length;
  const hasEntries = (id: string, remoteItems?: RemoteSession['items']) => (remoteItems ?? localItems.filter((i) => i.sessionId === id))
    .some((i) => i.requestedQty !== null || i.currentQty !== null || i.routineChoice !== null);
  const localIds = new Set(local.map((s) => s.id));
  const runs = [
    ...local.filter((s) => s.departmentId === d.id && s.kind === 'area').map((s) => ({ s, entered: hasEntries(s.id) })),
    ...remote.filter((r) => r.departmentId === d.id && r.kind === 'area' && !localIds.has(r.id)).map((r) => ({ s: r, entered: hasEntries(r.id, r.items) })),
  ];
  const per = areas.map((a) => {
    const mine = runs.filter((r) => r.s.areaId === a.id);
    const open = mine.find((r) => r.s.status === 'open' && r.entered);
    const done = mine.filter((r) => r.s.status === 'finished' || r.s.status === 'finished_exceptions')
      .sort((x, y) => String(y.s.finishedAt).localeCompare(String(x.s.finishedAt)))[0];
    return { a, open, done };
  });
  const segs: Seg[] = per.map((p) => (p.done ? 'done' : 'none'));
  const doneAreas = segs.filter((x) => x === 'done').length;
  const people = [...new Set(runs.filter((r) => r.entered || r.s.status !== 'open').flatMap((r) => r.s.people))];
  const kind: DeptState['kind'] = per.some((p) => p.open) ? 'active' : areas.length && doneAreas === areas.length ? 'done' : doneAreas ? 'part' : quick?.selected.length ? 'quick' : 'idle';
  const short = per.map((p) => (p.done ? shortagesOf(cat, d, p.done.s, localItems, localAreas) : 0));
  const areaDetail = per.map((p, i) => `${p.a.name} ${p.open ? 'in progress' : p.done ? `✓ ${t(p.done.s.finishedAt)}${short[i] ? ` · ${short[i]} short` : ''}` : 'not yet'}`).join(' · ');
  const updated = runs.map((r) => r.s.updatedAt).sort().pop() ?? quick?.updatedAt ?? '';
  return {
    d, kind, segs, doneAreas, products, people, startedAt: null, finishedAt: null, reason: null,
    quickCount: quick?.selected.length ?? 0, updatedAt: updated, areaDetail: areas.length ? areaDetail : undefined,
    shortages: short.reduce((a, b) => a + b, 0),
  };
}

export function HomeScreen({ isAdmin }: { isAdmin: boolean }) {
  const { catalogue, checkedAt, error } = useCatalogue();
  const [toast, setToast] = useState('');
  const [remoteAll, setRemote] = useState<RemoteSession[]>([]);
  const resetIds = useResetIds();
  const remote = remoteAll.filter((s) => !resetIds.has(s.id));
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
  // Tonight's restocks on this device (area and full): their items, for progress and shortage counts.
  const runIds = local.filter((s) => s.kind === 'area' || s.kind === 'full').map((s) => s.id);
  const localItems = useLive(async () => (runIds.length ? localDb().items.where('sessionId').anyOf(runIds).toArray() : []), [runIds.join()], [] as LocalItem[]);

  const states = catalogue ? catalogue.departments.map((d) => {
    const quick = local.find((s) => s.departmentId === d.id && s.kind === 'quick' && s.status === 'open');
    if (d.restockByArea) return areaStateFor(catalogue, d, local.filter((s) => s.tradingDate === day), localItems, localAreas, remote, quick);
    return stateFor(catalogue, d,
      local.find((s) => s.departmentId === d.id && s.kind === 'full' && s.tradingDate === day), localAreas, localItems,
      remote.find((r) => r.departmentId === d.id && r.kind === 'full'), quick);
  }) : [];
  const doneCount = states.filter((s) => s.kind === 'done' || s.kind === 'exceptions').length;

  return (
    <div className="theme-navy">
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

        {/* Tonight's restocking: every department side by side, equally. Each closer finds their own. */}
        <section className="shift" aria-labelledby="tonight-h">
          <div className="shift-top">
            <p className="shift-eyebrow"><Icon name="moon" />{dateLabel}</p>
            {states.length && doneCount === states.length ? <p className="shift-done"><Icon name="check" />All finished</p> : null}
          </div>
          <h1 className="shift-title" id="tonight-h">Restocking</h1>
          {states.length ? (
            <ul className="lanes">
              {states.map((s) => <Lane key={s.d.id} s={s} />)}
            </ul>
          ) : null}
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
            {states.map((s) => <DepartmentCard key={s.d.id} s={s} />)}
          </div>
        </section>
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
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

const STATUS: Record<DeptState['kind'], { icon: 'half' | 'bolt' | 'check' | 'warn' | 'circle'; text: string }> = {
  active: { icon: 'half', text: 'In progress' },
  quick: { icon: 'bolt', text: 'Quick restock saved' },
  done: { icon: 'check', text: 'Restocked' },
  part: { icon: 'half', text: 'Partly restocked' },
  exceptions: { icon: 'warn', text: 'Finished with exceptions' },
  idle: { icon: 'circle', text: 'Not started' },
};

/**
 * Finished tonight: "✓ Stocked" (green), or "✓ Done · 2 shortages" (amber) so the team can see what
 * still needs following up. Finished with exceptions and no shortages: "✓ Done · <reason>" (amber).
 */
function finishedLabel(s: DeptState): { text: string; warn: boolean } | null {
  if (s.kind !== 'done' && s.kind !== 'exceptions') return null;
  if (s.shortages > 0) return { text: `✓ Done · ${s.shortages} shortage${s.shortages === 1 ? '' : 's'}`, warn: true };
  if (s.kind === 'exceptions') return { text: `✓ Done · ${s.reason ?? 'finished with exceptions'}`, warn: true };
  return { text: '✓ Stocked', warn: false };
}

/** One department's line in tonight's overview: status, area progress, who and when. */
function Lane({ s }: { s: DeptState }) {
  const unset = s.kind === 'idle' && s.segs.length === 0;
  const st = unset ? { icon: 'info' as const, text: 'Not set up yet' } : STATUS[s.kind];
  const fin = finishedLabel(s);
  const detail = unset ? 'An admin can add its areas and products' : s.areaDetail ? s.areaDetail : s.kind === 'active' ? `${s.doneAreas} of ${s.segs.length} areas${s.people.length ? ` · ${s.people.join(', ')}` : ''}${s.startedAt ? ` · since ${t(s.startedAt)}` : ''}`
    : s.kind === 'quick' ? `${s.quickCount} on the list · full restock not started`
    : s.kind === 'done' ? `Finished ${t(s.finishedAt)}${s.people.length ? ` · ${s.people.join(', ')}` : ''}`
    : s.kind === 'exceptions' ? `${t(s.finishedAt)}${s.reason ? ` · ${s.reason}` : ''}`
    : `${s.segs.length} areas · ${s.products} products`;
  return (
    <li className={`lane k-${unset ? 'unset' : s.kind} ${s.d.theme === 'gold' ? 'gold' : 'village'} ${fin ? `fin ${fin.warn ? 'fin-warn' : 'fin-ok'}` : ''}`}>
      <div className="ln-head">
        <span className="ln-icon" aria-hidden="true"><Icon name={s.d.icon} /></span>
        <span className="ln-name">{s.d.groupLabel ? <small>{s.d.groupLabel}</small> : null}<b>{s.d.shortName}</b></span>
      </div>
      {fin ? <p className={`ln-st fin-label ${fin.warn ? 'warn' : 'ok'}`}>{fin.text}</p>
        : <p className="ln-st"><span className={`ln-dot ${s.kind === 'active' ? 'live' : ''}`} aria-hidden="true"><Icon name={st.icon} /></span>{st.text}</p>}
      <AreaMeter segs={s.segs} label={`${s.doneAreas} of ${s.segs.length} areas done`} />
      <p className="ln-meta">{detail}</p>
    </li>
  );
}

/** A department's way in: its colour block and the one action that applies tonight. */
function DepartmentCard({ s }: { s: DeptState }) {
  const { d } = s;
  const gold = d.theme === 'gold';
  const unset = s.kind === 'idle' && s.segs.length === 0;
  const action = unset ? 'Not set up yet' : s.d.restockByArea ? (s.kind === 'active' ? 'Resume restock' : 'Choose an area')
    : { active: 'Resume restock', quick: 'Continue quick restock', done: 'View summary', exceptions: 'View summary', idle: 'Start restock', part: 'Resume restock' }[s.kind];
  const fin = finishedLabel(s);
  return (
    <Link href={`/d/${d.id}`} className={`dcard2 k-${unset ? 'unset' : s.kind} ${gold ? 'gold' : 'village'} ${fin ? `fin ${fin.warn ? 'fin-warn' : 'fin-ok'}` : ''}`}
      aria-label={`${d.name}: ${unset ? 'Not set up yet' : `${fin ? fin.text.replace('✓ ', '') : STATUS[s.kind].text}. ${action}`}.`}>
      {/* The colour-block title, as staff know it: Village blue, or Gold Class gold */}
      <span className="dc2-block">
        <span className="dc2-title">
          {d.groupLabel ? <span className="dc2-group">{d.groupLabel}</span> : null}
          <b className="dc2-name">{d.shortName}</b>
        </span>
        <span className="dc2-icon" aria-hidden="true"><Icon name={s.kind === 'done' ? 'check' : d.icon} /></span>
      </span>
      {fin ? <span className={`dc2-fin fin-label ${fin.warn ? 'warn' : 'ok'}`}>{fin.text}</span> : null}
      {d.description ? <span className="dc2-desc">{d.description}</span> : null}
      <span className="dc2-go">{action}<Icon name="next" /></span>
    </Link>
  );
}
