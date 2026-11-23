'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import {
  areaReminders,
  EMPTY_ITEM, SKIP_REASONS, type ItemState, activePlacements, areaNotes, areaStatus, collectPlacements, collectionLines, isChecked, isRequired, needOf,
  defrostSource, phaseAreas, refillLines, groupByStoreroom, lineState, usesAdmits, prepFromStock, prepNeedText, pullState, type CollectionLine,
} from '@/lib/restock-logic';
import { applyStockPrep, tickPrep } from '@/lib/client/prep-store';
import { defrostRowInfo } from '@/lib/defrost-rows';
import { AdmitsBox, DefrostPullList, DefrostRouteLine, DefrostRow } from './DefrostParts';
import { LinkedRow, PortionCheckRow, RefillRow } from './KitchenRows';
import { useLive } from '@/lib/client/hooks';
import { Line } from './CollectStep';
import { round2 } from '@/lib/restock-math';
import { setAdmits, setArea, setItems, updateLocalSession } from '@/lib/client/restock-store';
import { localDb } from '@/lib/client/local-db';
import { PhotoZoom, ProductRow, ProductThumb } from './ProductCard';
import { AREA_BADGE, Badge, Dock, Ring, timeOf } from './shared';
import type { RestockCtx } from './RestockApp';

/** Remember, per area and per device, whether staff opened the full area guide (it starts as a two-line preview). */
function useGuideOpen(areaId: string): [boolean, (o: boolean) => void] {
  const key = `vr-guide-open-${areaId}`;
  const [open, setOpen] = useState(false);
  useEffect(() => { try { setOpen(localStorage.getItem(key) === '1'); } catch { setOpen(false); } }, [key]);
  return [open, (o: boolean) => { setOpen(o); try { if (o) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* private mode */ } }];
}

/**
 * Full Restock: area by area, in the order staff physically walk them.
 * Refill FOH flow (Gold Class Bar): `foh` shows the front-of-house areas, `boh` the upstairs
 * spots things were grabbed from (with what was taken already suggested); `all` is everything.
 */
export function CheckStep({ ctx, phase = 'all' }: { ctx: RestockCtx; phase?: 'foh' | 'boh' | 'all' }) {
  const { view: whole, session, items, areaRecords, recorded, who } = ctx;
  // This step's screens only; products, notes and lists still see the whole department.
  const view = { ...whole, areas: phaseAreas(whole, phase) };
  const [skipOpen, setSkipOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [review, setReview] = useState(false);
  // Defrost: the rows "Mark remaining items not needed" marked, so they can be undone.
  const [bulk, setBulk] = useState<string[] | null>(null);
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({});
  // A stand checked side by side (e.g. the confection stand): the side staff are on, kept while they work
  // through it (remembered per area on this device).
  const [sideOn, setSideOn] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('vr-stand-side') ?? '{}') as Record<string, string>; } catch { return {}; }
  });
  const pickSide = (areaId: string, secId: string) => setSideOn((s) => {
    const next = { ...s, [areaId]: secId };
    try { localStorage.setItem('vr-stand-side', JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  // Long subheading groups can be folded away (open by default; remembered on this device).
  const [shut, setShut] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setShut(JSON.parse(localStorage.getItem('vr-shut-groups') ?? '{}')); } catch { /* private mode */ } }, []);
  const toggleGroup = (id: string) => setShut((cur) => {
    const next = { ...cur, [id]: !cur[id] };
    if (!next[id]) delete next[id];
    try { localStorage.setItem('vr-shut-groups', JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  }); // sections expanded/collapsed on this screen // the "N to collect" list above the bottom bar
  // The kitchen reminder can be hidden for this restock (remembered on this device).
  const remKey = `vr-kreminder-${session.id}`;
  const [reminderHidden, setReminderHidden] = useState(false);
  useEffect(() => { try { setReminderHidden(localStorage.getItem(remKey) === '1'); } catch { /* private mode */ } }, [remKey]);
  const hideReminder = () => { setReminderHidden(true); try { localStorage.setItem(remKey, '1'); } catch { /* private mode */ } };
  const chk = (p: { placementId: string } & Parameters<typeof isChecked>[0]) => isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM);
  const statusOf = (areaId: string) => areaStatus(recorded.get(areaId), whole.areas.find((a) => a.area.id === areaId)!.placements, items);
  const firstOpen = view.areas.find(({ area }) => !['complete', 'skipped'].includes(statusOf(area.id)))?.area.id;
  const curId = view.areas.some((a) => a.area.id === session.curAreaId) ? session.curAreaId! : firstOpen ?? view.areas[0]?.area.id;
  const cur = view.areas.find((a) => a.area.id === curId);
  const [guideOpen, setGuideOpen] = useGuideOpen(cur?.area.id ?? 'none');
  // Morning prep handover (Kitchen): portioning checks while refilling tick their task on it.
  const handover = useLive(async () => (ctx.prepTasks.length ? localDb().prep.get(session.id) : undefined), [session.id, ctx.prepTasks.length], undefined);

  // Defrost: whether the "Pull for defrost" list has been scrolled into view (then the dock says Continue).
  const [pullSeen, setPullSeen] = useState<string | null>(null);
  const goArea = (id: string) => { setSkipOpen(false); void updateLocalSession(session.id, { curAreaId: id }); window.scrollTo({ top: 0 }); };
  if (!cur) return <main className="wrap restock-main">{ctx.header}<div className="banner s-none"><Icon name="info" /><div><b>This department has no areas yet</b><p>An admin can add them in Admin.</p></div></div></main>;

  // Stay on this area after completing or skipping it, so staff see the confirmation and choose where to go next.
  const pin = () => { if (session.curAreaId !== cur.area.id) void updateLocalSession(session.id, { curAreaId: cur.area.id }); };
  const st = statusOf(cur.area.id);
  const rec = areaRecords.get(cur.area.id);
  const done = cur.placements.filter(chk).length;
  const left = cur.placements.length - done;
  // Exception-based: only missing target counts matter; a blank "staff enter" product just didn't need anything.
  const reqLeft = cur.placements.filter((p) => isRequired(p) && !chk(p)).length;
  const next = view.areas.find(({ area }) => area.id !== cur.area.id && !['complete', 'skipped'].includes(statusOf(area.id)));
  const active = activePlacements(session.kind, view.placements, recorded);
  const byArea = session.kind === 'area';
  const single = view.areas.length === 1;
  // What's on the lists so far: the downstairs run, plus (on Check the bar) what's to grab upstairs.
  const grabAll = phase !== 'all' ? refillLines(session.kind, ctx.placements, recorded, items) : [];
  const downstairs = collectionLines(collectPlacements(session.kind, ctx.placements, recorded), items);
  const lines = [...(phase === 'foh' ? grabAll : []), ...downstairs];
  // Defrost (Kitchen): its own page. Amounts set here; Pulled once moved, on "Pull for defrost" below.
  const defrostRows = cur.placements.filter((p) => p.defrost);
  const isDefrost = defrostRows.length > 0 && !ctx.refill;
  const pickupOf = (p: (typeof cur.placements)[number]) => session.kind === 'full' && !!p.pickupAreaId;
  const dItem = (p: (typeof cur.placements)[number]) => items.get(p.placementId) ?? EMPTY_ITEM;
  const reviewed = defrostRows.filter((p) => dItem(p).requestedQty !== null).length;
  const toPull = defrostRows.filter((p) => (needOf(p, dItem(p)) ?? 0) > 0 && (pickupOf(p) ? pullState(p, dItem(p)).state === 'todo' : !dItem(p).collectedMode)).length;
  const untouched = defrostRows.filter((p) => dItem(p).requestedQty === null && !dItem(p).conflict);
  // Upstairs freezer pulls not done yet ("View upstairs items to pull"), and whether that list has been reached.
  const pullTodo = isDefrost ? defrostRows.filter((p) => pickupOf(p) && (needOf(p, dItem(p)) ?? 0) > 0 && pullState(p, dItem(p)).state === 'todo').length : 0;

  // Upstairs, at this location: what to grab for the bar (from this spot or its cupboards).
  const spotIds = new Set([cur.area.id, ...cur.sections.map((x) => x.area.id)]);
  const grab = phase === 'boh' ? grabAll.filter((l) => l.locationId && spotIds.has(l.locationId)) : [];
  const grabGroups = groupByStoreroom(grab, view.pickupOrder);
  const lineStateOf = (l: CollectionLine) => lineState(l, items);
  const writeItems = (ups: { placementId: string; fields: Partial<ItemState> }[]) => void setItems(session.id, ups, who);
  // "Mark remaining items not needed" (untouched rows only), with an undo for the ones still at 0.
  const markRest = () => { const ids = untouched.map((p) => p.placementId); setBulk(ids); writeItems(ids.map((id) => ({ placementId: id, fields: { requestedQty: 0 } }))); };
  const undoRest = () => {
    if (!bulk) return;
    writeItems(bulk.filter((id) => ctx.rawItems.get(id)?.requestedQty === 0).map((id) => ({ placementId: id, fields: { requestedQty: null } })));
    setBulk(null);
  };
  // Refill FOH flow: one next action. "Done → <next area>" marks this area done (nothing entered is fine)
  // and moves on; once every area here is done or skipped, it's the next step.
  const flow = phase !== 'all';
  // Kitchen (a full restock with Defrost): the same one next action through every area (Defrost → Freezer 1 →
  // … → Dry stock), so no area is skipped by jumping straight to the collection list.
  const walk = flow || (session.kind === 'full' && !ctx.refill && ctx.placements.some((p) => p.defrost));
  // After the bar: upstairs. After upstairs (or the Kitchen's last area): the collection list, or sign-off when it's empty.
  const nextStep = phase === 'foh' ? 'boh' as const : !downstairs.length && (phase === 'boh' || walk) ? 'finish' as const : 'collect' as const;
  const curIdx = view.areas.findIndex((a) => a.area.id === cur.area.id);
  const after = [...view.areas.slice(curIdx + 1), ...view.areas.slice(0, curIdx)];
  const nextOpen = after.find(({ area }) => !['complete', 'skipped'].includes(statusOf(area.id)));
  // Every area checked (done or skipped).
  const allChecked = view.areas.every(({ area }) => ['complete', 'skipped'].includes(statusOf(area.id)));
  const stepName = phase === 'foh' ? 'Upstairs' : nextStep === 'finish' ? 'Finish' : flow ? 'Collect downstairs' : 'Collection list';
  // What to show as progress. Target-level products need a count; everything else is exception-based,
  // so we count what was entered rather than "checked".
  const progressOf = (ps: typeof active) => {
    const req = ps.filter(isRequired);
    return { req: req.length, counted: req.filter(chk).length, entered: ps.filter((p) => !isRequired(p) && chk(p)).length };
  };
  const areaLabel = (ps: typeof active, short = false) => {
    const g = progressOf(ps);
    if (g.req) return short ? `${g.counted}/${g.req}` : `${g.counted} of ${g.req} counted${g.entered ? ` · ${g.entered} entered` : ''}`;
    return g.entered || !short ? `${g.entered} entered` : '';
  };
  const all = progressOf(active);

  const notes = areaNotes(cur.placements);
  // The area's own short instruction, when set, replaces the long note repeated on every product.
  const sharedNotes = cur.area.guideText.trim() ? [] : notes.shared;
  // Gold Class Bar: "None left here" on items added to collect (Bar and Upstairs checks).
  const noneLeftOn = !!whole.department.noneLeftCheck;
  const hasGuide = !!(cur.area.guideText || cur.area.guidePhotoPath || sharedNotes.length);
  const guideShort = !cur.area.guidePhotoPath && !sharedNotes.length && cur.area.guideText.trim().length <= 110 && !cur.area.guideText.includes('\n');

  // Save a product. If that was the last unchecked product in the area, the
  // area completes by itself (only on that change, so a reopened area isn't
  // snapped shut again while staff edit it).
  const onItem = async (p: (typeof cur.placements)[number], fields: Partial<ItemState>, resolve?: boolean) => {
    // Read the latest saved values from the device (not this screen's last render), so two quick
    // taps in a row can't each miss the other and leave a fully checked area open.
    const fresh = async () => new Map((await localDb().items.where('sessionId').equals(session.id).toArray()).map((r) => [r.placementId, { ...EMPTY_ITEM, ...r }]));
    const allChecked = (m: Map<string, ItemState>) => cur.placements.every((x) => isChecked(x, m.get(x.placementId) ?? EMPTY_ITEM));
    const beforeMap = await fresh();
    const before = allChecked(beforeMap);
    await setItems(session.id, [{ placementId: p.placementId, fields }], who, resolve);
    const afterMap = await fresh();
    const after = allChecked(afterMap);
    // Made or portioned in morning prep (e.g. vodka sauce): entering an amount selects its prep task on the handover.
    const task = p.prepTaskId && !p.defrost && session.kind === 'full' ? ctx.prepTasks.find((t) => t.id === p.prepTaskId) : undefined;
    if (task) {
      const was = prepNeedText(prepFromStock(session.kind, ctx.placements, recorded, beforeMap).get(task.id)) !== null;
      const now = prepNeedText(prepFromStock(session.kind, ctx.placements, recorded, afterMap).get(task.id)) !== null;
      if (was !== now) await applyStockPrep(session, task, now, who);
    }
    const rec = await localDb().areas.get([session.id, cur.area.id]);
    const closed = rec?.status === 'complete' || rec?.status === 'skipped';
    if (!before && after && !closed) { pin(); await setArea(session.id, cur.area.id, 'complete', null, who); }
  };
  // Same product already entered elsewhere on this screen (e.g. Back bench) → say so in the cupboard, to avoid double-counting.
  // In a section (e.g. the upstairs Wine / Spirits cupboard): show what's already on the downstairs
  // list for the same product from anywhere in this restock (e.g. "Already 1 for Back bench").
  const alsoEntered = (p: (typeof cur.placements)[number]) => {
    // Each side of a stand is entered on its own (the totals are added up on the collection list).
    if (p.side) return null;
    // Refill FOH: what was grabbed here for front of house is suggested (and says so).
    const sug = ctx.suggested.get(p.placementId);
    if (sug && !sug.defrost) {
      const taken = !ctx.refill ? `${round2(sug.qty)} to replace what's going to defrost`
        : sug.from.map((f) => (f.short ? `${round2(f.need)} still needed for ${f.areaName} (not enough here)` : `${round2(f.need)} taken for ${f.areaName}`)).join(' · ');
      const raw = ctx.rawItems.get(p.placementId)?.requestedQty ?? null;
      return raw === null ? `Suggested: ${taken}. Add any more this freezer needs, or remove it.` : raw === sug.qty ? taken : `${taken} (suggested ${round2(sug.qty)})`;
    }
    if (!p.optional && p.areaId === p.screenAreaId) return null;
    // Grabbed upstairs (e.g. the FOH bar fridge inside the Back bench stop), or refilled from another
    // compartment (e.g. the chicken tenders drawer, from the box): it says where it comes from instead.
    if (p.pickupAreaId || p.prepTaskId) return null;
    // Pickups grabbed upstairs aren't on the downstairs list, so they don't count here; nor is a "Needs prep"
    // tick (e.g. pizza cheese to portion in Freezer 2): that's a prep job, not an amount.
    const others = view.placements.filter((x) => x.productId === p.productId && x.placementId !== p.placementId && !(session.kind === 'full' && x.pickupAreaId) && !x.prepTaskId)
      .map((x) => ({ x, need: needOf(x, items.get(x.placementId) ?? EMPTY_ITEM) })).filter((o) => (o.need ?? 0) > 0);
    return others.length ? `Already ${others.map((o) => `${Math.round(o.need! * 100) / 100} for ${o.x.areaName}`).join(', ')}` : null;
  };
  // On the back bar: once something is added, say where to grab it if it's also kept in a cupboard
  // section on another screen (e.g. "Grab it from the Wine cupboard"). Items with no upstairs
  // overflow (e.g. syrups) get no note: they simply come from downstairs.
  const fromCupboard = (p: (typeof cur.placements)[number]) => {
    if (!((needOf(p, items.get(p.placementId) ?? EMPTY_ITEM) ?? 0) > 0)) return null;
    if (ctx.refill && p.pickupAreaName) return `Grab it from the ${p.pickupAreaName}`;
    if (p.areaId !== p.screenAreaId) return null;
    if (ctx.refill) return null; // comes straight from downstairs
    const c = view.placements.find((x) => x.productId === p.productId && x.areaId !== x.screenAreaId && x.screenAreaId !== p.screenAreaId);
    return c ? `Grab it from the ${c.areaName}` : null;
  };
  // Check BOH: products with a suggestion (taken for FOH) go to the top of the screen.
  // Kitchen: what was pulled for defrost is suggested for its freezer, at the top of that freezer's screen.
  // (A screen that starts with refills, e.g. Freezer 2, keeps them in place: refill first, then check the spare stock.)
  const startsWithRefills = cur.placements.some((p) => p.refillSource);
  const taken = (phase === 'boh' || !ctx.refill) && !startsWithRefills ? cur.placements.filter((p) => { const s = ctx.suggested.get(p.placementId); return !!s && !s.defrost; }) : [];
  const takenIds = new Set(taken.map((p) => p.placementId));
  /** A list without the products shown at the top; a subheading moves to the next product still there. */
  const rest = (list: typeof cur.placements) => {
    if (!takenIds.size) return list;
    const out: typeof cur.placements = [];
    let carry: string | null = null;
    for (const p of list) {
      if (takenIds.has(p.placementId)) { carry = p.heading ?? carry; continue; }
      out.push(carry && !p.heading ? { ...p, heading: carry } : p);
      carry = null;
    }
    return out;
  };
  // A compartment named after its freezer ("Freezer 1 · Upper left") reads as just "Upper left" on that freezer's screen.
  const secName = (n: string) => (n.startsWith(`${cur.area.name} · `) ? n.slice(cur.area.name.length + 3) : n);
  const photoOf = (p: (typeof cur.placements)[number]) => (p.photoPath ? <ProductThumb src={p.photoPath} name={p.productName} credit={p.photoCredit} className="pphoto" /> : <span className="pphoto ph" aria-hidden="true"><Icon name="box" /></span>);
  const linkedTo = (p: (typeof cur.placements)[number]) => (p.linkedPlacementId ? whole.byId.get(p.linkedPlacementId) : undefined);
  const portionTask = (p: (typeof cur.placements)[number]) => (p.refillSource && p.prepTaskId && session.kind === 'full' ? ctx.prepTasks.find((t) => t.id === p.prepTaskId) : undefined);
  const stockRow = (p: (typeof cur.placements)[number], showArea = false, compact = false) => portionTask(p) ? (
    // Portioning check while refilling: one tick puts its task on tomorrow's morning prep (nothing in the restock).
    <PortionCheckRow key={p.placementId} p={p} taskName={portionTask(p)!.name} photo={photoOf(p)}
      on={handover?.status === 'needed' && handover.items.some((i) => i.taskId === p.prepTaskId)}
      onToggle={() => void tickPrep(session, portionTask(p)!, !(handover?.status === 'needed' && handover.items.some((i) => i.taskId === p.prepTaskId)), who)} />
  ) : p.refillSource ? (
    // A working drawer or tub: Refilled / Already full / Needs stock (the task only, never an amount).
    <RefillRow key={p.placementId} p={p} item={items.get(p.placementId) ?? EMPTY_ITEM} photo={photoOf(p)} onChange={(fields) => void onItem(p, fields)} />
  ) : linkedTo(p) ? (
    // The same requirement as another row (e.g. already planned in Defrost): one total, edited here or there.
    <LinkedRow key={p.placementId} p={p} target={linkedTo(p)!} item={items.get(p.linkedPlacementId!) ?? EMPTY_ITEM} photo={photoOf(p)}
      onChange={(fields) => void onItem(linkedTo(p)!, fields)} />
  ) : p.defrost && !items.get(p.placementId)?.conflict ? (
    // Defrost rows: set an amount or Not needed, with where it's from and where it goes (no photo placeholder).
    <DefrostRow key={p.placementId} p={p} item={items.get(p.placementId) ?? EMPTY_ITEM} rawQty={ctx.rawItems.get(p.placementId)?.requestedQty ?? null}
      suggestion={ctx.suggested.get(p.placementId)?.defrost} admits={session.forecastAdmits ?? null} pickup={pickupOf(p)} compact={compact}
      photo={p.photoPath ? <ProductThumb src={p.photoPath} name={p.productName} credit={p.photoCredit} className="pphoto" /> : null}
      onChange={(fields, resolve) => void onItem(p, fields, resolve)} />
  ) : (
    <ProductRow key={p.placementId} p={p} showArea={showArea} item={items.get(p.placementId) ?? EMPTY_ITEM} note={alsoEntered(p) ?? fromCupboard(p) ?? notes.own.get(p.placementId)}
      suggestedQty={ctx.suggested.get(p.placementId)?.qty} noneLeft={noneLeftOn}
      onChange={(fields, resolve) => void onItem(p, fields, resolve)} />
  );
  const renderRow = (p: (typeof cur.placements)[number], showArea = false) => {
    const row = stockRow(p, showArea);
    if (session.kind !== 'full' || whole.department.name !== 'Gold Class Kitchen' ||
        cur.area.name !== 'Freezer 2' || p.productName.toLowerCase() !== 'zucchini wedges' || portionTask(p)) return row;
    const name = 'Portion zucchini wedges';
    const task = ctx.prepTasks.find(t => t.name.toLowerCase() === name.toLowerCase()) ??
      { id: null, name, group: 'vegetables' as const };
    const selected = handover?.items.some(i => i.name.toLowerCase() === name.toLowerCase()) ?? false;
    return <div key={p.placementId}>{row}
      <button type="button" className="btn small" aria-pressed={selected}
        aria-label="Zucchini wedges: needs portioning" onClick={() => void tickPrep(session, task, !selected, who)}>
        {selected ? '✓ Portion zucchini wedges' : 'Portion zucchini wedges'}
      </button>
    </div>;
  };
  /**
   * A list with its subheadings. A heading starts a group; groups of 15 or more products can be
   * folded with a tap on the heading (they start open, so nothing needs an extra tap).
   */
  const LONG = 15; // only very long groups (e.g. 31 spirits); shorter ones never fold
  const renderList = (list: typeof cur.placements) => {
    // A product moved above the first subheading belongs to that first group (the list starts with its heading).
    // Several rows before it (e.g. Freezer 2's drawers before "Check the portioning") are their own part, unheaded.
    const f = list.findIndex((x) => x.heading);
    const ps = f === 1 ? list.map((x, n) => (n === 0 ? { ...x, heading: list[f].heading } : n === f ? { ...x, heading: null } : x)) : list;
    const out: React.ReactNode[] = [];
    let i = 0;
    while (i < ps.length) {
      const head = ps[i].heading;
      let j = i + 1;
      while (j < ps.length && !ps[j].heading) j++;
      const group = ps.slice(i, j);
      if (head) {
        const id = group[0].placementId;
        const foldable = group.length >= LONG;
        const closed = foldable && !!shut[id];
        const entered = group.filter((x) => (needOf(x, items.get(x.placementId) ?? EMPTY_ITEM) ?? 0) > 0).length;
        out.push(foldable
          ? <button key={`h-${id}`} type="button" className="phead fold" onClick={() => toggleGroup(id)} aria-expanded={!closed}>
              <span>{head}</span><small>{closed ? `${group.length} products${entered ? ` · ${entered} to collect` : ''}` : ''}</small><Icon name={closed ? 'down' : 'up'} /></button>
          : <h3 key={`h-${id}`} className="phead">{head}</h3>);
        if (closed) { i = j; continue; }
      }
      // Defrost: a group that all goes the same way (e.g. the desserts) is one list, its route said once above it.
      const route = (x: (typeof group)[number]) => `${defrostSource(x)}|${x.putNote ?? ''}`;
      if (isDefrost && group.length >= 3 && group.every((x) => x.defrost && !items.get(x.placementId)?.conflict && !defrostRowInfo(x).canSuggest)
          && new Set(group.map(route)).size === 1) {
        out.push(
          <div key={`l-${group[0].placementId}`} className="dgroup">
            <DefrostRouteLine p={group[0]} />
            <div className="dlist">{group.map((x) => stockRow(x, false, true))}</div>
          </div>);
      } else out.push(...group.map((x) => renderRow(x)));
      i = j;
    }
    return out;
  };
  /** Mark this area done (even with nothing entered) and go to the next one still to do, or the next step. */
  const doneAndNext = async () => {
    pin();
    await setArea(session.id, cur.area.id, 'complete', null, who);
    if (nextOpen) goArea(nextOpen.area.id); else ctx.go(nextStep);
  };
  const reopen = () => { pin(); void setArea(session.id, cur.area.id, 'not_started', null, who); };
  const firstUnchecked = () => {
    const p = cur.placements.find((x) => !chk(x));
    const row = p && document.querySelector<HTMLElement>(`[data-placement="${p.placementId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.querySelector<HTMLElement>('input.qty-input, .pseg button')?.focus({ preventScroll: true });
  };

  // (Defrost: the footer's "Continue →" is the one way on, so no second button here.)
  const nextBtn = walk || isDefrost ? null : next
    ? <button className="btn primary" onClick={() => goArea(next.area.id)}>Next: {next.area.name}<Icon name="next" /></button>
    : <button className="btn primary" onClick={() => ctx.go(byArea && !lines.length ? 'finish' : 'collect')}>{byArea && !lines.length ? 'Finish' : 'Collection list'}<Icon name="next" /></button>;

  return (
    <>
      <main className="wrap restock-main">
      {ctx.header}
      {ctx.hasDefrost && !reminderHidden && !ctx.placements.some((p) => p.defrost) ? (
        <aside className="kreminder" aria-label="Kitchen reminder">
          <Icon name="clock" />
          <p><b>Kitchen reminder:</b> Remember to check what needs defrosting for the next service and refill the freezer containers. You can use the Defrost Planner at any time.</p>
          <span className="kr-acts"><Link className="linkbtn" href={`/d/${view.department.id}/defrost`}>Open Defrost Planner<Icon name="next" /></Link></span>
          <button className="iconbtn kr-x" onClick={hideReminder} aria-label="Hide reminder"><Icon name="x" /></button>
        </aside>
      ) : null}
      <div className={`chk-layout ${single ? 'one' : ''}`}>
        {single ? null : <nav className="rail" aria-label="Areas">
          {view.areas.map(({ area, placements }) => {
            const s = statusOf(area.id), r = areaRecords.get(area.id);
            const g = progressOf(placements);
            const pct = s === 'complete' || s === 'skipped' ? 1 : g.req ? g.counted / g.req : 0;
            // "Checked · nothing needed" and "Unchecked" can both have nothing entered: say which.
            const g2 = progressOf(placements);
            const sub = s === 'skipped' ? `Skipped${r?.skipReason ? ` · ${r.skipReason}` : ''}`
              : s === 'complete' ? (g2.entered || g2.req ? `Checked · ${g2.entered ? `${g2.entered} entered` : 'all counted'}` : 'Checked · nothing needed')
              : g2.req || g2.entered ? areaLabel(placements) : 'Unchecked';
            const subSm = s === 'complete' ? 'Checked' : s === 'skipped' ? 'Skipped' : g2.req || g2.entered ? areaLabel(placements, true) : 'Unchecked';
            return (
              <button key={area.id} className={`area-btn s-${AREA_BADGE[s]} ${area.id === cur.area.id ? 'cur' : ''}`} onClick={() => goArea(area.id)} aria-current={area.id === cur.area.id ? 'true' : undefined}>
                <Ring pct={pct} st={AREA_BADGE[s]} /><span className="t"><b>{area.name}</b><small className="lg">{sub}</small><small className="sm">{subSm}</small></span>
              </button>
            );
          })}
        </nav>}

        <section className="area" aria-labelledby="area-name">
          <div className="area-head">
            <div className="ah-t">
              <h2 id="area-name">{cur.area.name}</h2>
              <p className="ah-sub">
                {st === 'complete' && !byArea ? <Badge st="ok">Complete</Badge> : st === 'skipped' ? <Badge st="skip" icon="skip">Skipped</Badge> : null}
                {/* Target counts are worth tracking here; "N entered" is already in the bar at the bottom. */}
                {progressOf(cur.placements).req ? <span>{areaLabel(cur.placements)}</span> : null}
              </p>
            </div>
            <div className="acts">
              {reqLeft > 0 && done > 0 && st !== 'skipped' ? <button className="btn small" onClick={firstUnchecked}><Icon name="down" /><span className="lg">Next to count</span><span className="sm">Next</span></button> : null}
              {st !== 'complete' && st !== 'skipped' && !byArea && !flow ? <button className="btn small" onClick={() => setSkipOpen(true)}><Icon name="skip" />Skip</button> : null}
            </div>
          </div>

          {(() => {
            // Refill tasks ticked elsewhere whose stock is here (e.g. the malt powder container, from this cupboard).
            const rem = areaReminders(whole, cur.area.id, items);
            return rem.length ? (
              <section className="take-down area-remind" aria-labelledby="area-remind-h">
                <Icon name="warn" />
                <div><h3 id="area-remind-h">Refill while you&rsquo;re here</h3>
                  <ul>{rem.map(({ p, done }) => (
                    <li key={p.placementId} className={done ? 'done' : ''} data-remind={p.productName}>
                      <span><b>{p.productName}</b>{p.instructions ? <small>{p.instructions}</small> : null}</span>
                      <button type="button" className={`l-tick ${done ? 'on' : 'l-all'}`} aria-pressed={done}
                        aria-label={done ? `${p.productName}: refilled (tap to undo)` : `Refilled: ${p.productName}`}
                        onClick={() => writeItems([{ placementId: p.placementId, fields: { collectedMode: done ? null : 'all', collectedQty: null } }])}><Icon name="check" /></button>
                    </li>
                  ))}</ul></div>
              </section>
            ) : null;
          })()}

          {skipOpen ? (
            <div className="skip-panel"><b>Why are you skipping {cur.area.name}?</b>
              <div className="chips">{SKIP_REASONS.map((r) => <button key={r} className="chip" onClick={() => { pin(); void setArea(session.id, cur.area.id, 'skipped', r, who); setSkipOpen(false); }}>{r}</button>)}</div>
              <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setSkipOpen(false)}>Cancel</button></div>
          ) : null}

          {hasGuide && guideShort ? (
            // A short instruction: one compact line, no card.
            <p className="aguide-line"><Icon name="info" /><span>{cur.area.guideText.trim()}</span></p>
          ) : hasGuide ? (
            // Area instructions, once: a two-line preview that opens with a tap (remembered per area on this device).
            <section className={`aguide ${guideOpen ? 'open' : ''}`}>
              {cur.area.guidePhotoPath ? (
                <button className="ag-photo" onClick={() => setZoom(true)} aria-label={`Show photo of ${cur.area.name} fully stocked`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cur.area.guidePhotoPath} alt="" />
                </button>
              ) : <Icon name="info" />}
              <button className="ag-text" onClick={() => setGuideOpen(!guideOpen)} aria-expanded={guideOpen} aria-label={guideOpen ? 'Show less of the area guide' : 'Show all of the area guide'}>
                {cur.area.guideText ? cur.area.guideText.split(/\n+/).map((t, i) => <span key={i}>{t}</span>) : null}
                {sharedNotes.map((t) => <span key={t}>{t}</span>)}
              </button>
              <button className="ag-more linkbtn" onClick={() => setGuideOpen(!guideOpen)} tabIndex={-1} aria-hidden="true">{guideOpen ? 'Less' : 'More'}</button>
            </section>
          ) : null}
          {noneLeftOn && cur.placements.some((p) => p.method === 'manual' && (needOf(p, items.get(p.placementId) ?? EMPTY_ITEM) ?? 0) > 0) ? (
            <p className="aguide-line nl-hint"><Icon name="info" /><span>Entered a top-up? <b>Some left</b> is chosen for you: an open bottle or jar with usable stock counts. Tap <b>None left</b> if the spot is empty.</span></p>
          ) : null}
          {usesAdmits(cur.placements) ? (
            // Tomorrow's forecast admits: once per restock, for every suggested amount.
            <AdmitsBox admits={session.forecastAdmits ?? null} onSave={(n) => void setAdmits(session.id, n, who)}
              missing={cur.placements.filter((p) => p.defrost && defrostRowInfo(p).canSuggest && (items.get(p.placementId) ?? EMPTY_ITEM).currentQty === null).length} />
          ) : null}
          {zoom && cur.area.guidePhotoPath ? <PhotoZoom src={cur.area.guidePhotoPath} title={`${cur.area.name} fully stocked`} onClose={() => setZoom(false)} /> : null}

          {grab.length ? (
            // Upstairs, one screen per location: first what to take to the bar (tick, or Got fewer if
            // there wasn't enough), then below it what to bring up, with what was grabbed already suggested.
            <section className="grab" aria-labelledby="grab-h">
              <h3 className="sec-title" id="grab-h"><Icon name="up" />Grab for the bar<small>{grab.filter((l) => ['done', 'short'].includes(lineStateOf(l))).length} of {grab.length}</small></h3>
              <p className="grab-hint">Tick each one as you take it, or use Got fewer if there wasn&rsquo;t enough.</p>
              {grabGroups.map((g) => (
                <div key={g.lines[0].locationId ?? g.name} className="grab-group">
                  {grabGroups.length > 1 ? <h4 className="phead">{g.name}</h4> : null}
                  <div className="room-lines">{g.lines.map((l) => <Line key={l.key} line={l} items={items} write={writeItems} oneArea={null} tickOnly />)}</div>
                </div>
              ))}
            </section>
          ) : null}
          {phase === 'boh' ? <h3 className="sec-title bring-h"><Icon name="down" />Bring up from downstairs<small>Add only what looks low</small></h3> : null}

          <div className={`prows ${isDefrost ? 'drows' : ''}`}>
            {cur.placements.length === 0 ? <p className="meta">No products in this area yet.</p> : null}
            {/* Optional subheadings (e.g. "Mixers, Water & Milk") in the same list */}
            {taken.length ? (
              // Refill FOH: everything taken for front of house first, so none of it is lost in a long list.
              // A row stays here even after it's changed or removed, so it never jumps away mid-tap.
              <>
                <h3 className="phead taken-h"><span>{ctx.refill ? 'Replace what you grabbed' : 'Replace what’s going to defrost'}</span><small>{taken.length} suggested</small></h3>
                {taken.map((p) => renderRow({ ...p, areaName: secName(p.areaName) }, p.areaId !== cur.area.id))}
                {/* The rest starts with its own subheading if it has one; otherwise a plain divider. */}
                {rest(cur.own).length && !rest(cur.own).some((x) => x.heading) ? <h3 className="phead">Everything else</h3> : null}
              </>
            ) : null}
            {renderList(rest(cur.own))}
          </div>

          {(() => {
            // Sides of a stand: one switch, one side's list at a time (entries are saved as they're made).
            const sides = cur.sections.filter((x) => x.mode === 'side');
            if (!sides.length) return null;
            const on = sides.find((x) => x.area.id === sideOn[cur.area.id]) ?? sides[0];
            return (
              <section className="stand-sides" aria-label="Sides of the stand">
                <div className="side-switch" role="tablist" aria-label="Side">
                  {sides.map((x) => {
                    const n = x.placements.filter(chk).length;
                    return (
                      <button key={x.area.id} type="button" role="tab" aria-selected={x === on} className={x === on ? 'on' : ''} onClick={() => pickSide(cur.area.id, x.area.id)}>
                        <b>{secName(x.area.name)}</b><small>{n ? `${n} entered` : 'Not started'}</small>
                      </button>
                    );
                  })}
                </div>
                {on.area.guideText ? <p className="psec-hint"><Icon name="info" /><span>{on.area.guideText}</span></p> : null}
                <div className="prows" role="tabpanel" aria-label={secName(on.area.name)}>{renderList(rest(on.placements))}</div>
              </section>
            );
          })()}
          {cur.sections.filter((x) => x.mode !== 'side').map((sec) => {
            const enteredHere = sec.placements.filter(chk).length;
            // Working drawers and tubs (e.g. Freezer 2): "3 of 11 checked" (portioning checks aren't drawers).
            const drawers = sec.placements.some((x) => x.refillSource && !x.prepTaskId) ? sec.placements.filter((x) => !x.prepTaskId) : null;
            const open = openSecs[sec.area.id] ?? (sec.mode === 'open' || enteredHere > 0);
            return (
              <section key={sec.area.id} className={`psec ${sec.mode} ${open ? 'open' : ''}`}>
                <button type="button" className="psec-h" onClick={() => setOpenSecs((o) => ({ ...o, [sec.area.id]: !open }))} aria-expanded={open}>
                  <span className="psec-t"><b>{secName(sec.area.name)}</b>{sec.mode === 'optional' ? <span className="psec-tag">Optional</span> : null}</span>
                  <small>{drawers ? `${drawers.filter(chk).length} of ${drawers.length} checked`
                    : enteredHere ? `${enteredHere} entered` : `${sec.placements.length} product${sec.placements.length === 1 ? '' : 's'}`}</small>
                  <Icon name={open ? 'up' : 'down'} />
                </button>
                {open ? (
                  <>
                    {sec.mode === 'optional' ? <p className="psec-hint"><Icon name="info" /><span>{ctx.refill ? <>What was taken for front of house is already suggested. Add anything else that looks low.</> : <>Only add <b>extra</b> stock this needs from downstairs. Anything already entered above is already on the collection list.</>}</span></p>
                      : sec.area.guideText ? <p className="psec-hint"><Icon name="info" /><span>{sec.area.guideText}</span></p> : null}
                    <div className="prows">{renderList(rest(sec.placements))}{taken.length && !rest(sec.placements).length ? <p className="meta">All suggested above (Replace what you {ctx.refill ? 'grabbed' : 'pulled'}).</p> : null}</div>
                  </>
                ) : null}
              </section>
            );
          })}

          {isDefrost ? (
            <div className="dr-rest">
              {bulk ? <p><Icon name="check" />{bulk.length} marked not needed <button type="button" className="linkbtn" onClick={undoRest}>Undo</button></p>
                : untouched.length && reviewed ? <button type="button" className="btn dr-rest-b" onClick={markRest}>Mark the remaining {untouched.length} not needed</button> : null}
            </div>
          ) : null}
          {isDefrost ? (
            <DefrostPullList rows={defrostRows.map((p) => ({ p, item: dItem(p), pickup: pickupOf(p) }))}
              freezerOrder={whole.areas.map((a) => a.area.name)} onChange={(p, fields) => void onItem(p, fields)} />
          ) : null}

          {st === 'skipped' ? (
            <div className="banner s-skip area-end"><Icon name="skip" /><div><b>{cur.area.name} skipped</b><p>{rec?.skipReason}{rec?.updatedBy ? ` · ${rec.updatedBy}` : ''} {timeOf(rec?.updatedAt)}</p></div>
              <button className="btn" onClick={() => void setArea(session.id, cur.area.id, 'not_started', null, who)}>Undo skip</button>{nextBtn}</div>
          ) : st === 'complete' ? (
            <div className="banner s-ok area-end">
              <button className="banner-toggle" onClick={reopen} aria-label={`${cur.area.name} complete. Tap to reopen it`}>
                <Icon name="check" /><span><b>{cur.area.name} complete</b><p>{rec?.updatedBy ? `${rec.updatedBy}, ` : ''}{timeOf(rec?.updatedAt)} &middot; <u>Tap to reopen</u></p></span>
              </button>{nextBtn}</div>
          ) : reqLeft ? (
            <div className="banner s-none area-end"><Icon name="circle" /><div><b>{reqLeft} target {reqLeft === 1 ? 'count' : 'counts'} still needed</b><p>Count what&rsquo;s on the shelf, or tap Full.</p></div>
              <button className="btn" onClick={firstUnchecked}>Go to the first one</button>
              <button className="btn area-skip-end" onClick={() => { setSkipOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="skip" />Skip area</button></div>
          ) : flow ? (
            // Refill FOH flow: "Done" is in the bottom bar; an area nobody checked can be skipped here (every screen size).
            <div className="area-end area-next flow-end">
              <button className="btn area-skip-flow" onClick={() => { setSkipOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="skip" />Skip {cur.area.name}</button>
              <span className="meta">Only if it wasn&rsquo;t checked</span>
            </div>
          ) : byArea ? null : (
            // Nothing required is missing: just a quiet pointer to the next area (no sign-off needed).
            <div className="area-end area-next">
              {/* Optional: lets a reopened area count as done again. Never required to finish. */}
              {!left ? <button className="btn small" onClick={() => { pin(); void setArea(session.id, cur.area.id, 'complete', null, who); }}><Icon name="check" />Mark {cur.area.name} complete</button> : null}
              {nextBtn}
            </div>
          )}
        </section>
      </div>
      </main>
      <Dock icon="list" progress={all.req ? all.counted / all.req : undefined}
        above={review && lines.length ? (
          <div className="entered" id="entered-list">
            <ul>{lines.map((l) => (
              <li key={l.key}><button onClick={() => { const pl = l.parts[0]; setReview(false); const vp = view.byId.get(pl.placementId); if (vp?.optional) setOpenSecs((o) => ({ ...o, [vp.areaId]: true })); goArea(vp?.screenAreaId ?? cur.area.id);
                // On the other part of the Refill FOH flow (front of house vs upstairs): go there.
                if (vp && phase !== 'all' && !view.areas.some((x) => x.area.id === vp.screenAreaId)) ctx.go(phase === 'foh' ? 'boh' : 'check');
                window.setTimeout(() => document.querySelector(`[data-placement="${pl.placementId}"]`)?.scrollIntoView({ block: 'center' }), 120); }}>
                <b>{l.kind === 'task' ? '✓' : Math.round(l.total * 100) / 100}</b><span>{l.photoPath ? <img className="en-photo" src={l.photoPath} alt="" loading="lazy" /> /* eslint-disable-line @next/next/no-img-element */ : null}{l.productName}</span><small>{l.parts.map((x) => x.areaName).join(', ')}</small>
              </button></li>
            ))}</ul>
          </div>
        ) : null}
        title={isDefrost ? <span className="dr-progress"><b>{reviewed} of {defrostRows.length}</b> reviewed &middot; <b>{toPull}</b> {toPull === 1 ? 'item' : 'items'} to pull</span> : <>{all.req ? <>{`${all.counted} of ${all.req} counted`}<span className="dock-sep"> &middot; </span></> : null}
          <button type="button" className="dock-2 dock-review" onClick={() => setReview(!review)} disabled={!lines.length} aria-expanded={review} aria-controls="entered-list">
            {lines.length ? `${lines.length} to collect` : 'Nothing added to the collection list'}{lines.length ? <Icon name={review ? 'down' : 'up'} /> : null}</button></>}
        sub={walk ? undefined : next && st === 'complete' ? `Next area: ${next.area.name}` : byArea && !lines.length ? 'Tap + Add on anything that needs topping up' : undefined}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        {isDefrost && !flow ? (
          // Defrost: carry on to the next area (Defrost counts as done); the collection list is there but secondary.
          <>
            <button className="btn dr-list" onClick={() => ctx.go('collect')}><span className="lg">Collection list</span><span className="sm">List</span></button>
            {pullTodo ? <SeenWatch targetId="pull-h" onSeen={() => setPullSeen(cur.area.id)} /> : null}
            {pullTodo && pullSeen !== cur.area.id ? (
              // Something to pull from the upstairs freezers: there first (then Continue, once the list is in view).
              <button className="btn primary big flow-next dr-to-pull" onClick={() => document.getElementById('pull-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                <span className="lg">View upstairs items to pull ({pullTodo})</span><span className="sm">To pull ({pullTodo})</span><Icon name="down" /></button>
            ) : (
              <button className="btn primary big flow-next" onClick={() => void doneAndNext()}>
                <span className="fn-l">Continue</span><span className="fn-to" aria-hidden="true">&rarr;</span><span className="fn-n">{nextOpen ? nextOpen.area.name : stepName}</span><Icon name="next" /></button>
            )}
          </>
        ) : walk ? (
          // One primary next action, the same on phone, iPad and laptop.
          reqLeft > 0 && !['complete', 'skipped'].includes(st)
            ? <button className="btn primary big" onClick={firstUnchecked}><span>Count {reqLeft} left</span><Icon name="down" /></button>
            : !['complete', 'skipped'].includes(st)
              ? <button className="btn primary big flow-next" onClick={() => void doneAndNext()}>
                  <span className="fn-l">Done</span><span className="fn-to" aria-hidden="true">&rarr;</span><span className="fn-n">{nextOpen ? nextOpen.area.name : stepName}</span><Icon name="next" /></button>
              : <button className="btn primary big flow-next" onClick={() => (nextOpen ? goArea(nextOpen.area.id) : ctx.go(nextStep))}>
                  <span className="fn-n">{nextOpen ? `Next: ${nextOpen.area.name}` : stepName}</span><Icon name="next" /></button>
        ) : (byArea || allChecked) && !lines.length
          // Nothing on the collection list and nothing left to check: straight to sign-off.
          ? <button className="btn primary big" onClick={() => ctx.go('finish')}><span className="lg">Nothing needed: finish</span><span className="sm">Finish</span><Icon name="next" /></button>
          : <button className="btn primary big" onClick={() => ctx.go('collect')}><span className="lg">Collection list</span><span className="sm">Collect</span><Icon name="next" /></button>}
      </Dock>
    </>
  );
}

/** Tells the screen once an element (e.g. the "Pull for defrost" list) has been scrolled into view. */
function SeenWatch({ targetId, onSeen }: { targetId: string; onSeen: () => void }) {
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) onSeen(); });
    io.observe(el);
    return () => io.disconnect();
  }, [targetId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
