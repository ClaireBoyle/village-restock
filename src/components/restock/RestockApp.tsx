'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { TopBar } from '@/components/TopBar';
import { useCatalogue } from '@/lib/client/use-catalogue';
import { useLive, useResetIds, useStaffName } from '@/lib/client/hooks';
import { localDb, type LocalArea, type LocalSession } from '@/lib/client/local-db';
import { findOpenQuickSession, openAreaSession, openFullSession, startSession } from '@/lib/client/restock-store';
import { EMPTY_ITEM, departmentView, scopeView, suggestions, usesRefill, withSuggestions, type AreaStatus, type DepartmentView, type ItemState, type PlacementView, type Suggestion } from '@/lib/restock-logic';
import { tradingDate } from '@/lib/restock-math';
import { CheckStep } from './CheckStep';
import { CollectStep } from './CollectStep';
import { FinishStep } from './FinishStep';
import { QuickStep } from './QuickStep';
import { OfflineBanner, TopControls } from './SyncControls';
import { TypeStep } from './TypeStep';
import { AreaPicker } from './AreaPicker';
import { ResetSheet, type ResetScope } from './ResetControls';
import { Stages, timeOf, type Step } from './shared';
import type { RemoteSession } from '@/lib/sync-types';

export interface RestockCtx {
  view: DepartmentView;
  session: LocalSession;
  /** The placements this restock covers: the whole department, or the quick list. */
  placements: PlacementView[];
  /** As they count: Refill FOH suggestions included until staff change them. */
  items: Map<string, ItemState>;
  /** What staff actually entered (no suggestions), for knowing whether a suggestion was changed. */
  rawItems: Map<string, ItemState>;
  /** What's suggested: Refill FOH (from what was grabbed for FOH) and defrost rows (from tomorrow's admits). */
  suggested: Map<string, Suggestion>;
  /** This restock uses the Refill FOH flow (Check FOH → Refill FOH → Check BOH → Collect → Finish). */
  refill: boolean;
  areaRecords: Map<string, LocalArea>;
  recorded: Map<string, AreaStatus>;
  who: string;
  header: React.ReactNode;
  go: (s: Step) => void;
  saveAndExit: () => void;
  done: () => void;
  /** Gold Class Kitchen: show the optional Defrost Planner reminder. */
  hasDefrost: boolean;
  /** Where "done" goes: home, or (area restocks) back to choosing an area. */
  doneLabel: string;
}

type Mode = 'full' | 'quick' | 'area';

function readUrl(): { mode: Mode | null; step: Step; quickId: string | null; areaId: string | null } {
  const p = new URLSearchParams(window.location.search);
  const m = p.get('mode');
  const mode = m === 'full' || m === 'quick' || m === 'area' ? (m as Mode) : null;
  const s = p.get('step');
  return { mode, step: s === 'collect' || s === 'finish' || s === 'refill' || s === 'boh' ? s : 'check', quickId: p.get('s'), areaId: p.get('a') };
}

/**
 * Everything for one department happens on this one screen, so once it has
 * loaded it keeps working with no connection (moving between steps never
 * needs the network). The step is kept in the address so a refresh returns here.
 */
export type ResetFor = { kind: 'full' } | { kind: 'quick' } | { kind: 'area'; areaId: string; areaName: string };

export function RestockApp({ departmentId, isAdmin = false }: { departmentId: string; isAdmin?: boolean }) {
  const router = useRouter();
  const { catalogue, checkedAt } = useCatalogue();
  const [who] = useStaffName();
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>('check');
  const [opening, setOpening] = useState(false);
  const [remoteAll, setRemote] = useState<RemoteSession[]>([]);
  const resetIds = useResetIds();
  const remote = remoteAll.filter((s) => !resetIds.has(s.id));
  // The quick or area restock being worked on. Kept by id so it stays on screen after it's finished.
  const [quickId, setQuickId] = useState<string | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  // Admin reset: what's being reset, and a refresh after it's done.
  const [resetting, setResetting] = useState<{ scope: ResetScope; typeLabel: string; localIds: string[] } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [toast, setToast] = useState('');
  useEffect(() => { const u = readUrl(); setMode(u.mode); setStep(u.step); setQuickId(u.quickId); setAreaId(u.areaId); }, []);

  const view = useMemo(() => (catalogue ? departmentView(catalogue, departmentId) : null), [catalogue, departmentId]);
  const today = catalogue ? tradingDate(new Date(), catalogue.settings.timeZone, catalogue.settings.cutoffHour) : null;

  const fullSession = useLive(async () => (today ? (await localDb().sessions.where('[departmentId+kind+tradingDate]').equals([departmentId, 'full', today]).first()) ?? null : null), [departmentId, today], null);
  const quickSession = useLive(async () => (quickId && mode !== 'area' ? (await localDb().sessions.get(quickId)) ?? null : (await findOpenQuickSession(departmentId)) ?? null), [departmentId, quickId, mode], null);
  const areaSession = useLive(async () => (mode === 'area' && quickId ? (await localDb().sessions.get(quickId)) ?? null : null), [quickId, mode], null);
  const session = mode === 'full' ? fullSession : mode === 'quick' ? quickSession : mode === 'area' ? areaSession : null;

  // What other devices have done tonight: a full restock already started, or area restocks. (Skipped quietly when offline.)
  useEffect(() => {
    if (!today || mode) return;
    const load = () => fetch(`/api/sessions?date=${today}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((b: { sessions: RemoteSession[] } | null) => b && setRemote(b.sessions.filter((s) => s.departmentId === departmentId)))
      .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 20_000); // keep other devices' progress current while choosing
    return () => window.clearInterval(id);
  }, [today, fullSession, departmentId, mode, refresh]);
  const remoteFull = fullSession ? null : remote.find((s) => s.kind === 'full') ?? null;

  const itemRows = useLive(async () => (session ? localDb().items.where('sessionId').equals(session.id).toArray() : []), [session?.id], []);
  const areaRows = useLive(async () => (session ? localDb().areas.where('sessionId').equals(session.id).toArray() : []), [session?.id], []);

  const setUrl = useCallback((m: Mode | null, s: Step, q: string | null = null, a: string | null = null) => {
    const p = new URLSearchParams();
    if (m) { p.set('mode', m); p.set('step', s); if (m !== 'full' && q) p.set('s', q); if (m === 'area' && a) p.set('a', a); }
    window.history.replaceState(null, '', `${window.location.pathname}${m ? `?${p}` : ''}`);
  }, []);
  const go = useCallback((s: Step) => { setStep(s); setUrl(mode, s, quickId, areaId); window.scrollTo({ top: 0 }); }, [mode, setUrl, quickId, areaId]);

  /** `keep`: the step from the address after a refresh, so it doesn't jump back to the start. */
  const begin = async (m: Mode, keep?: Step, area?: string | null) => {
    if (!today) return;
    setOpening(true);
    try {
      let q: string | null = null;
      let first: Step = keep ?? 'check';
      if (m === 'full') {
        const s = await openFullSession(departmentId, today, who);
        if (s.status === 'finished' || s.status === 'finished_exceptions') first = 'finish'; // already done: show its summary
      } else if (m === 'area') {
        if (!area) return;
        q = (await openAreaSession(departmentId, area, today, who)).id;
        setQuickId(q); setAreaId(area);
      } else {
        q = ((await findOpenQuickSession(departmentId)) ?? (await startSession(departmentId, 'quick', today, who))).id;
        setQuickId(q);
      }
      setMode(m); setStep(first); setUrl(m, first, q, m === 'area' ? area ?? null : null); window.scrollTo({ top: 0 });
    } finally { setOpening(false); }
  };
  const showFullSummary = () => { setMode('full'); setStep('finish'); setUrl('full', 'finish'); };
  /** An area restock already finished tonight: show its summary. */
  const showAreaSummary = (id: string, area: string) => { setQuickId(id); setAreaId(area); setMode('area'); setStep('finish'); setUrl('area', 'finish', id, area); window.scrollTo({ top: 0 }); };
  const toChooser = () => { setMode(null); setQuickId(null); setAreaId(null); setUrl(null, 'check'); window.scrollTo({ top: 0 }); };

  // The restock on screen was reset by an admin (on another device): go back to the start.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!mode) { shown.current = null; return; } // choosing again: forget the last one
    if (session) { shown.current = session.id; return; }
    if (shown.current && !opening) {
      void localDb().sessions.get(shown.current).then((s) => { if (!s) { shown.current = null; toChooser(); } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, mode, opening]);

  /** Admin: open the reset confirmation for tonight's full restock, this device's quick restock, or one area. */
  const startReset = async (r: ResetFor) => {
    if (!today || !view) return;
    const db = localDb();
    const mine = (await db.sessions.where('departmentId').equals(departmentId).toArray());
    if (r.kind === 'full') {
      setResetting({ scope: { departmentId, kind: 'full', tradingDate: today }, typeLabel: 'Full restock',
        localIds: mine.filter((s) => s.kind === 'full' && s.tradingDate === today).map((s) => s.id) });
    } else if (r.kind === 'quick') {
      const q = mine.filter((s) => s.kind === 'quick' && s.status === 'open');
      setResetting({ scope: { departmentId, kind: 'quick', tradingDate: q[0]?.tradingDate ?? today, sessionIds: q.map((s) => s.id) }, typeLabel: 'Quick restock', localIds: q.map((s) => s.id) });
    } else {
      setResetting({ scope: { departmentId, kind: 'area', tradingDate: today, areaId: r.areaId }, typeLabel: `${r.areaName} restock`,
        localIds: mine.filter((s) => s.kind === 'area' && s.areaId === r.areaId && s.tradingDate === today).map((s) => s.id) });
    }
  };
  const resetSheet = resetting && view ? (
    <ResetSheet scope={resetting.scope} departmentName={view.department.name} typeLabel={resetting.typeLabel} localIds={resetting.localIds}
      onClose={() => setResetting(null)}
      onDone={(n) => { setResetting(null); setRefresh((x) => x + 1); setToast(n ? 'Restock reset. Staff can start a fresh one now.' : 'Cleared from this device.');
        window.setTimeout(() => setToast(''), 3500); }} />
  ) : null;
  const toastEl = toast ? <div className="toast" role="status">{toast}</div> : null;

  // Opened from an address with ?mode=full but nothing on this device yet: set it up.
  useEffect(() => {
    if (mode === 'full' && today && fullSession === null && !opening) void begin('full', step);
    if (mode === 'quick' && today && quickSession === null && !opening && step === 'check') void begin('quick', step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, today]);
  // An area restock that isn't on this device (an old link): open that area afresh.
  useEffect(() => {
    if (mode !== 'area' || !today || opening) return;
    let gone = false;
    void (async () => {
      const s = quickId ? await localDb().sessions.get(quickId) : undefined;
      if (!s && !gone) { if (areaId) void begin('area', 'check', areaId); else toChooser(); }
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, today]);

  const gold = view?.department.theme === 'gold';
  const hasDefrost = !!catalogue?.defrostItems?.some((i) => i.departmentId === departmentId);
  // Each department has its own backdrop: deep navy (Village) or dark gold (Gold Class).
  const themeCls = `theme-navy ${gold ? 'theme-gold gc' : ''}`;
  const activeSession = session;
  const sessionArea = activeSession?.kind === 'area' ? view?.areas.find((a) => a.area.id === activeSession.areaId)?.area.name ?? 'Area' : null;
  const top = (
    <>
      <TopBar backHref={mode ? undefined : '/'}
        title={mode && view ? view.department.name : undefined}
        crumbs={mode && activeSession ? `${sessionArea ?? (activeSession.kind === 'full' ? 'Full restock' : 'Quick restock')} · started ${timeOf(activeSession.startedAt)}`
          : view ? `Home › ${view.department.name}${mode ? ` › ${mode === 'full' ? 'Full' : mode === 'area' ? 'Area' : 'Quick'} restock` : ''}` : 'Home'}
        right={<TopControls catalogueCheckedAt={checkedAt} />}
        logo={mode ? <button className="iconbtn" onClick={toChooser} aria-label={view?.department.restockByArea ? 'Back to choosing an area' : 'Back to restock options'}><Icon name="back" /></button> : undefined} />
      <OfflineBanner />
    </>
  );

  if (!catalogue || !view) {
    return (
      <div className={themeCls}>{top}
        <main className="wrap restock-main">
          {!catalogue ? <p className="meta">Loading&hellip;</p> : <div className="banner s-warn"><Icon name="warn" /><div><b>Department not found</b><p>It may have been hidden by an admin.</p></div></div>}
        </main>
      </div>
    );
  }

  if (!mode && view.department.restockByArea) {
    return (
      <div className={themeCls}>{top}
        <AreaPicker view={view} remote={remote} quickSession={quickSession} today={today!} opening={opening}
          onStart={(a) => void begin('area', 'check', a)} onSummary={showAreaSummary} onQuick={() => void begin('quick')}
          onReset={isAdmin ? (r) => void startReset(r) : undefined} />
        {resetSheet}{toastEl}
      </div>
    );
  }

  if (!mode) {
    return (
      <div className={themeCls}>{top}
        <TypeStep view={view} fullSession={fullSession} remoteFull={remoteFull} quickSession={quickSession} opening={opening}
          onStart={(m) => void begin(m)} onSummary={showFullSummary} hasDefrost={hasDefrost}
          onReset={isAdmin ? (r) => void startReset(r) : undefined} />
        {resetSheet}{toastEl}
      </div>
    );
  }

  if (!session) return <div className={themeCls}>{top}<main className="wrap restock-main"><p className="meta">Opening restock&hellip;</p></main></div>;

  const rawItems = new Map<string, ItemState>(itemRows.map((r) => [r.placementId, { ...EMPTY_ITEM, ...r }]));
  const areaRecords = new Map(areaRows.map((a) => [a.areaId, a]));
  const recorded = new Map<string, AreaStatus>(areaRows.filter((a) => a.status !== 'not_started').map((a) => [a.areaId, a.status as AreaStatus]));
  // Refill FOH: what's grabbed upstairs is suggested for that spot's downstairs list.
  const refill = usesRefill(session.kind, view);
  // Defrost rows (Gold Class Kitchen): what to pull is suggested from tomorrow's admits and what's ready.
  const admits = session.forecastAdmits ?? null;
  const suggested = suggestions(session.kind, view, rawItems, recorded, admits);
  const items = suggested.size ? withSuggestions(session.kind, view, rawItems, recorded, admits) : rawItems;
  // Steps only the Refill FOH flow has fall back to the plain ones elsewhere.
  // ("refill" was its own step; it's now part of Upstairs.)
  const shownStep: Step = refill ? (step === 'refill' ? 'boh' : step) : step === 'refill' || step === 'boh' ? 'check' : step;
  // An area restock sees only its own area: its products, its collection list, its finish.
  const scoped = session.kind === 'area' ? scopeView(view, session.areaId) : view;
  const placements = session.kind === 'quick' ? session.selected.map((id) => view.byId.get(id)).filter((p): p is PlacementView => Boolean(p)) : scoped.placements;
  const byArea = session.kind === 'area';

  const ctx: RestockCtx = {
    view: scoped, session, placements, items, rawItems, suggested, refill, areaRecords, recorded, who, go, hasDefrost,
    // Restock screens: one slim step bar, no banner, so products start near the top of the screen.
    header: <div className="rbar"><Stages kind={session.kind} current={shownStep} onGo={go} refill={refill} /></div>,
    // Area restocks go back to choosing an area, where this one shows as saved (or done).
    saveAndExit: byArea ? toChooser : () => router.push('/?saved=1'),
    done: byArea ? toChooser : () => router.push('/'),
    doneLabel: byArea ? `Back to ${view.department.shortName}` : 'Back to home',
  };

  return (
    <div className={themeCls}>
      {top}
      {shownStep === 'check' ? (session.kind !== 'quick' ? <CheckStep key="foh" ctx={ctx} phase={refill ? 'foh' : 'all'} /> : <QuickStep ctx={ctx} />)
        : shownStep === 'boh' ? <CheckStep key="boh" ctx={ctx} phase="boh" />
        : shownStep === 'collect' ? <CollectStep ctx={ctx} /> : <FinishStep ctx={ctx} />}
    </div>
  );
}
