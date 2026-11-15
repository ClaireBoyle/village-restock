'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { TopBar } from '@/components/TopBar';
import { useCatalogue } from '@/lib/client/use-catalogue';
import { useLive, useStaffName } from '@/lib/client/hooks';
import { localDb, type LocalArea, type LocalSession } from '@/lib/client/local-db';
import { findOpenQuickSession, openFullSession, startSession } from '@/lib/client/restock-store';
import { EMPTY_ITEM, departmentView, type AreaStatus, type DepartmentView, type ItemState, type PlacementView } from '@/lib/restock-logic';
import { tradingDate } from '@/lib/restock-math';
import { CheckStep } from './CheckStep';
import { CollectStep } from './CollectStep';
import { FinishStep } from './FinishStep';
import { QuickStep } from './QuickStep';
import { OfflineBanner, TopControls } from './SyncControls';
import { TypeStep } from './TypeStep';
import { DeptBand, Stages, timeOf, type Step } from './shared';
import type { RemoteSession } from '@/lib/sync-types';

export interface RestockCtx {
  view: DepartmentView;
  session: LocalSession;
  /** The placements this restock covers: the whole department, or the quick list. */
  placements: PlacementView[];
  items: Map<string, ItemState>;
  areaRecords: Map<string, LocalArea>;
  recorded: Map<string, AreaStatus>;
  who: string;
  header: React.ReactNode;
  go: (s: Step) => void;
  saveAndExit: () => void;
  done: () => void;
}

type Mode = 'full' | 'quick';

function readUrl(): { mode: Mode | null; step: Step; quickId: string | null } {
  const p = new URLSearchParams(window.location.search);
  const mode = p.get('mode') === 'full' || p.get('mode') === 'quick' ? (p.get('mode') as Mode) : null;
  const s = p.get('step');
  return { mode, step: s === 'collect' || s === 'finish' ? s : 'check', quickId: p.get('s') };
}

/**
 * Everything for one department happens on this one screen, so once it has
 * loaded it keeps working with no connection (moving between steps never
 * needs the network). The step is kept in the address so a refresh returns here.
 */
export function RestockApp({ departmentId }: { departmentId: string }) {
  const router = useRouter();
  const { catalogue, checkedAt } = useCatalogue();
  const [who] = useStaffName();
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>('check');
  const [opening, setOpening] = useState(false);
  const [remoteFull, setRemoteFull] = useState<RemoteSession | null>(null);
  // The quick restock being worked on. Kept by id so it stays on screen after it's finished.
  const [quickId, setQuickId] = useState<string | null>(null);
  useEffect(() => { const u = readUrl(); setMode(u.mode); setStep(u.step); setQuickId(u.quickId); }, []);

  const view = useMemo(() => (catalogue ? departmentView(catalogue, departmentId) : null), [catalogue, departmentId]);
  const today = catalogue ? tradingDate(new Date(), catalogue.settings.timeZone, catalogue.settings.cutoffHour) : null;

  const fullSession = useLive(async () => (today ? (await localDb().sessions.where('[departmentId+kind+tradingDate]').equals([departmentId, 'full', today]).first()) ?? null : null), [departmentId, today], null);
  const quickSession = useLive(async () => (quickId ? (await localDb().sessions.get(quickId)) ?? null : (await findOpenQuickSession(departmentId)) ?? null), [departmentId, quickId], null);
  const session = mode === 'full' ? fullSession : mode === 'quick' ? quickSession : null;

  // Has another device already started tonight's full restock? (Skipped quietly when offline.)
  useEffect(() => {
    if (!today || fullSession) return;
    fetch(`/api/sessions?date=${today}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((b: { sessions: RemoteSession[] } | null) => setRemoteFull(b?.sessions.find((s) => s.departmentId === departmentId) ?? null))
      .catch(() => undefined);
  }, [today, fullSession, departmentId]);

  const itemRows = useLive(async () => (session ? localDb().items.where('sessionId').equals(session.id).toArray() : []), [session?.id], []);
  const areaRows = useLive(async () => (session ? localDb().areas.where('sessionId').equals(session.id).toArray() : []), [session?.id], []);

  const setUrl = useCallback((m: Mode | null, s: Step, q: string | null = null) => {
    const p = new URLSearchParams();
    if (m) { p.set('mode', m); p.set('step', s); if (m === 'quick' && q) p.set('s', q); }
    window.history.replaceState(null, '', `${window.location.pathname}${m ? `?${p}` : ''}`);
  }, []);
  const go = useCallback((s: Step) => { setStep(s); setUrl(mode, s, quickId); window.scrollTo({ top: 0 }); }, [mode, setUrl, quickId]);

  /** `keep`: the step from the address after a refresh, so it doesn't jump back to the start. */
  const begin = async (m: Mode, keep?: Step) => {
    if (!today) return;
    setOpening(true);
    try {
      let q: string | null = null;
      let first: Step = keep ?? 'check';
      if (m === 'full') {
        const s = await openFullSession(departmentId, today, who);
        if (s.status === 'finished' || s.status === 'finished_exceptions') first = 'finish'; // already done: show its summary
      }
      else {
        q = ((await findOpenQuickSession(departmentId)) ?? (await startSession(departmentId, 'quick', today, who))).id;
        setQuickId(q);
      }
      setMode(m); setStep(first); setUrl(m, first, q); window.scrollTo({ top: 0 });
    } finally { setOpening(false); }
  };
  const showFullSummary = () => { setMode('full'); setStep('finish'); setUrl('full', 'finish'); };

  // Opened from an address with ?mode=full but nothing on this device yet: set it up.
  useEffect(() => {
    if (mode === 'full' && today && fullSession === null && !opening) void begin('full', step);
    if (mode === 'quick' && today && quickSession === null && !opening && step === 'check') void begin('quick', step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, today]);

  const gold = view?.department.theme === 'gold';
  const top = (
    <>
      <TopBar backHref={mode ? undefined : '/'} crumbs={view ? `Home › ${view.department.name}${mode ? ` › ${mode === 'full' ? 'Full' : 'Quick'} restock` : ''}` : 'Home'}
        right={<TopControls catalogueCheckedAt={checkedAt} />}
        logo={mode ? <button className="iconbtn" onClick={() => { setMode(null); setQuickId(null); setUrl(null, 'check'); }} aria-label="Back to restock options"><Icon name="back" /></button> : undefined} />
      <OfflineBanner />
    </>
  );

  if (!catalogue || !view) {
    return (
      <div className={gold ? 'gc' : ''}>{top}
        <main className="wrap restock-main">
          {!catalogue ? <p className="meta">Loading&hellip;</p> : <div className="banner s-warn"><Icon name="warn" /><div><b>Department not found</b><p>It may have been hidden by an admin.</p></div></div>}
        </main>
      </div>
    );
  }

  if (!mode) {
    return (
      <div className={gold ? 'gc' : ''}>{top}
        <TypeStep view={view} fullSession={fullSession} remoteFull={remoteFull} quickSession={quickSession} opening={opening}
          onStart={(m) => void begin(m)} onSummary={showFullSummary} />
      </div>
    );
  }

  if (!session) return <div className={gold ? 'gc' : ''}>{top}<main className="wrap restock-main"><p className="meta">Opening restock&hellip;</p></main></div>;

  const items = new Map<string, ItemState>(itemRows.map((r) => [r.placementId, { ...EMPTY_ITEM, ...r }]));
  const areaRecords = new Map(areaRows.map((a) => [a.areaId, a]));
  const recorded = new Map<string, AreaStatus>(areaRows.filter((a) => a.status !== 'not_started').map((a) => [a.areaId, a.status as AreaStatus]));
  const placements = session.kind === 'full' ? view.placements : session.selected.map((id) => view.byId.get(id)).filter((p): p is PlacementView => Boolean(p));
  const sub = `${session.kind === 'full' ? 'Full restock' : 'Quick restock'} · started ${timeOf(session.startedAt)}${session.people.length ? ` · ${session.people.join(', ')}` : ''}`;

  const ctx: RestockCtx = {
    view, session, placements, items, areaRecords, recorded, who, go,
    header: <DeptBand d={view.department} sub={sub} right={<Stages kind={session.kind} current={step} onGo={go} />} />,
    saveAndExit: () => router.push('/?saved=1'),
    done: () => router.push('/'),
  };

  return (
    <div className={gold ? 'gc' : ''}>
      {top}
      {step === 'check' ? (session.kind === 'full' ? <CheckStep ctx={ctx} /> : <QuickStep ctx={ctx} />)
        : step === 'collect' ? <CollectStep ctx={ctx} /> : <FinishStep ctx={ctx} />}
    </div>
  );
}
