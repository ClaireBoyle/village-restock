// The rules of a restock, as pure functions shared by the device and the server.
// No storage, no React: easy to test and to reason about.
import type { Catalogue, CatArea, CatDepartment, ReadyTarget, RestockMethod } from './catalogue-types';
import { defrostSuggestion, type DefrostSuggestion } from './defrost-rows';
import { formatQty, requiredForPar, round2 } from './restock-math';

export type ShortReason = 'insufficient' | 'access' | 'time' | 'other';
export type AreaStatus = 'not_started' | 'in_progress' | 'complete' | 'skipped';
export type CardState = 'none' | 'ok' | 'warn' | 'bad';
/** full: every area, once a night · quick: a picked list · area: one area on its own (e.g. Candy Bar's confection stand). */
export type SessionKind = 'full' | 'quick' | 'area';
/** Area restocks follow the full-restock rules, just for one area. */
const asFull = (kind: SessionKind) => kind !== 'quick';

/** Two devices entered different values for the same thing. The server kept "theirs". */
export interface Conflict {
  field: 'currentQty' | 'requestedQty' | 'routineChoice';
  theirs: number | string | null; theirsBy: string | null; theirsAt: string | null;
  mine: number | string | null; mineBy: string | null; mineAt: string | null;
}
/** Fields where a clash between two people must be resolved by a person. */
export const CONFLICT_FIELDS = ['currentQty', 'requestedQty', 'routineChoice'] as const;
export type LineState = 'todo' | 'done' | 'part' | 'short';

export const SHORT_REASONS: [ShortReason, string][] = [
  ['insufficient', 'Not enough in storeroom'],
  ['access', 'Couldn’t access stock'],
  ['time', 'Interrupted / ran out of time'],
  ['other', 'Other'],
];
/** Reasons that mean "couldn't finish collecting", not "the storeroom was short". */
export const isOperational = (r: ShortReason | null | undefined) => r === 'access' || r === 'time' || r === 'other';
export const SKIP_REASONS = ['Being cleaned or defrosted', 'Another staff member is doing it', 'Ran out of time', 'Not in use tonight'];
export const EXCEPTION_REASONS = ['Ran out of time before close', 'Stock or area unavailable', 'Manager approved', 'Other'];

/** One product in one checking area, with everything a card needs. */
export interface PlacementView {
  placementId: string;
  productId: string;
  areaId: string;
  areaName: string;
  productName: string;
  unitSingular: string;
  unitPlural: string;
  method: RestockMethod;
  par: number | null;
  allowDecimal: boolean;
  locationId: string | null;
  locationName: string | null;
  instructions: string;
  categoryName: string | null;
  /** Menu items to mark as sold out if this product runs out. */
  affects: string[];
  /** Reference photo, if one has been added. */
  /** The area whose screen this product appears on (its own area, or the area its section belongs to). */
  screenAreaId: string;
  /** In an optional section (e.g. Spirits cupboard): never required, collapsed by default. */
  optional: boolean;
  /** Subheading shown above this product (starts a group, e.g. "Mixers, Water & Milk"). */
  heading?: string | null;
  /** Full restock: grabbed from this upstairs area for front of house ("Refill FOH"), not from downstairs. */
  pickupAreaId?: string | null;
  pickupAreaName?: string | null;
  /** What's grabbed is suggested for the same product in the pickup area, to replace it from downstairs. */
  pickupSuggest?: boolean;
  photoPath: string | null;
  photoCredit?: string | null;
  /** Defrost rows (Gold Class Kitchen): pull an amount or "Not needed", with where it's from and where it goes. */
  defrost?: boolean;
  grabNote?: string | null;
  fallbackNote?: string | null;
  putNote?: string | null;
  readyUnitSingular?: string | null;
  readyUnitPlural?: string | null;
  readyPer?: number | null;
  readyTargets?: ReadyTarget[];
}

/** What staff have recorded for one placement during a restock. Blank = not yet. */
export interface ItemState {
  currentQty: number | null;
  requestedQty: number | null;
  routineChoice: 'needed' | 'not_needed' | null;
  collectedMode: 'all' | 'partial' | null;
  collectedQty: number | null;
  shortfallReason: ShortReason | null;
  flagged: boolean;
  /** Candy Bar: nothing collected and none left on display (Out of stock). */
  noneOnDisplay?: boolean;
  /** Set when two people entered different counts; cleared when someone chooses. */
  conflict?: Conflict | null;
}

export const EMPTY_ITEM: ItemState = {
  currentQty: null, requestedQty: null, routineChoice: null,
  collectedMode: null, collectedQty: null, shortfallReason: null, flagged: false, noneOnDisplay: false, conflict: null,
};

/** A section shown inside an area's screen (e.g. "Spirits cupboard" inside Back bench). */
export interface AreaSection { area: CatArea; mode: 'open' | 'collapsed' | 'optional'; placements: PlacementView[] }

export interface DepartmentView {
  department: CatDepartment;
  /** Screens staff move between. Each area's placements include those of its sections, after its own. */
  areas: { area: CatArea; placements: PlacementView[]; own: PlacementView[]; sections: AreaSection[] }[];
  placements: PlacementView[];
  byId: Map<string, PlacementView>;
  locationOrder: Map<string, number>;
  /** Storeroom reminders for the collection list, by storeroom id. */
  locationNotes: Map<string, string>;
  /**
   * Refill FOH: screens that are upstairs pickup spots (they hold an area something is grabbed from).
   * Empty for departments without pickups, which keep the plain Check → Collect → Finish flow.
   */
  bohScreenIds: Set<string>;
  /** Pickup spots in walking order (the department's area order), for grouping the Refill FOH list. */
  pickupOrder: Map<string, number>;
}

/** Arrange a department's catalogue area by area, in staff checking order. */
export function departmentView(cat: Catalogue, departmentId: string): DepartmentView | null {
  const department = cat.departments.find((d) => d.id === departmentId);
  if (!department) return null;
  const products = new Map(cat.products.map((p) => [p.id, p]));
  const locations = new Map(cat.locations.map((l) => [l.id, l]));
  const categories = new Map(cat.categories.map((c) => [c.id, c.name]));
  const all = cat.areas
    .filter((a) => a.departmentId === departmentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const ids = new Set(all.map((a) => a.id));
  const byArea = new Map(all.map((a) => [a.id, a]));
  // A section belongs to another area's screen; one whose parent is gone or itself a section stands alone.
  const parentOf = (a: CatArea) => {
    const pid = a.parentAreaId;
    if (!pid || pid === a.id || !ids.has(pid)) return null;
    const parent = all.find((x) => x.id === pid)!;
    return parent.parentAreaId && ids.has(parent.parentAreaId) ? null : pid;
  };
  // An area with defrost rows (e.g. Defrost): every "staff enter" product in it is one, even one just added without notes.
  const placementsOf = (area: CatArea, screenAreaId: string, optional: boolean) => {
    const list = placementRows(area, screenAreaId, optional);
    return list.some((p) => p.defrost) ? list.map((p) => (p.method === 'manual' && !p.defrost ? { ...p, defrost: true, readyTargets: [] } : p)) : list;
  };
  const placementRows = (area: CatArea, screenAreaId: string, optional: boolean) => cat.placements
    .filter((pl) => pl.checkAreaId === area.id && products.get(pl.productId)?.departmentId === departmentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((pl): PlacementView => {
      const p = products.get(pl.productId)!;
      const locId = pl.locationId ?? p.defaultLocationId;
      const pick = pl.pickupAreaId && pl.pickupAreaId !== area.id ? byArea.get(pl.pickupAreaId) : undefined;
      // A unit override needs both words (e.g. bottle / bottles), or it's ignored.
      const ownUnit = pl.unitSingular?.trim() && pl.unitPlural?.trim();
      return {
        placementId: pl.id, productId: p.id, areaId: area.id, areaName: area.name, productName: p.name,
        unitSingular: ownUnit ? pl.unitSingular!.trim() : p.unitSingular, unitPlural: ownUnit ? pl.unitPlural!.trim() : p.unitPlural, method: p.method,
        pickupAreaId: pick?.id ?? null, pickupAreaName: pick?.name ?? null, pickupSuggest: !!pick && !!pl.pickupSuggest,
        par: pl.parLevel, allowDecimal: p.allowDecimal, locationId: locId,
        locationName: locId ? locations.get(locId)?.name ?? null : null,
        instructions: pl.instructions ?? p.instructions,
        categoryName: p.categoryId ? categories.get(p.categoryId) ?? null : null,
        affects: p.affects ?? [],
        photoPath: p.photoPath ?? null,
        photoCredit: p.photoCredit ?? null,
        heading: pl.heading?.trim() || null,
        screenAreaId, optional,
        ...defrostFields(pl, p.method),
      };
    });
  const areas = all.filter((a) => !parentOf(a)).map((area) => {
    const own = placementsOf(area, area.id, false);
    const sections: AreaSection[] = all.filter((a) => parentOf(a) === area.id).map((sec) => {
      const mode = sec.sectionMode === 'optional' || sec.sectionMode === 'collapsed' ? sec.sectionMode : 'open';
      return { area: sec, mode, placements: placementsOf(sec, area.id, mode === 'optional') };
    });
    return { area, own, sections, placements: [...own, ...sections.flatMap((x) => x.placements)] };
  });
  const placements = areas.flatMap((a) => a.placements);
  // Upstairs pickup spots, and the screens they're on (an area, or the area a section belongs to).
  const pickupOrder = new Map<string, number>();
  areas.forEach((a, i) => { pickupOrder.set(a.area.id, i * 100); a.sections.forEach((x, j) => pickupOrder.set(x.area.id, i * 100 + j + 1)); });
  // Not an Upstairs step: defrost pulls (pulled on the Defrost screen) and refills from the same screen
  // (e.g. the chicken tenders drawer, refilled from the box in another compartment of the same freezer).
  const screenOf = (id: string) => { const a = byArea.get(id)!; return parentOf(a) ?? a.id; };
  const bohScreenIds = new Set(placements.filter((p) => p.pickupAreaId && !p.defrost && screenOf(p.pickupAreaId) !== p.screenAreaId)
    .map((p) => screenOf(p.pickupAreaId!)));
  return {
    department, areas, placements, bohScreenIds, pickupOrder,
    byId: new Map(placements.map((p) => [p.placementId, p])),
    locationOrder: new Map(cat.locations.map((l, i) => [l.id, l.sortOrder * 1000 + i])),
    locationNotes: new Map(cat.locations.filter((l) => l.collectNote?.trim()).map((l) => [l.id, l.collectNote!.trim()])),
  };
}

/** Defrost notes and targets, only on "staff enter" products that have any. */
function defrostFields(pl: Catalogue['placements'][number], method: RestockMethod): Partial<PlacementView> {
  const t = (v: string | null | undefined) => v?.trim() || null;
  const grabNote = t(pl.grabNote), fallbackNote = t(pl.fallbackNote), putNote = t(pl.putNote);
  const readyTargets = pl.readyTargets ?? [];
  if (method !== 'manual' || !(grabNote || putNote || fallbackNote || readyTargets.length)) return {};
  return {
    defrost: true, grabNote, fallbackNote, putNote, readyTargets,
    readyUnitSingular: t(pl.readyUnitSingular), readyUnitPlural: t(pl.readyUnitPlural), readyPer: pl.readyPer ?? null,
  };
}

/** The view has defrost rows with admits targets: ask for tomorrow's forecast admits. */
export const usesAdmits = (placements: PlacementView[]) => placements.some((p) => p.defrost && p.readyTargets?.length);

/** The same view, narrowed to one area (and its sections): what an area restock covers. */
export function scopeView(view: DepartmentView, areaId: string | null | undefined): DepartmentView {
  const areas = view.areas.filter((a) => a.area.id === areaId);
  const placements = areas.flatMap((a) => a.placements);
  return { ...view, areas, placements, byId: new Map(placements.map((p) => [p.placementId, p])) };
}

// ---------------------------------------------------------------------------
// One product card
// ---------------------------------------------------------------------------
/** Amount to collect, or null while the card hasn't been filled in. */
export function needOf(p: PlacementView, i: ItemState): number | null {
  if (p.method === 'par') return p.par === null ? null : requiredForPar(p.par, i.currentQty);
  if (p.method === 'manual') return i.requestedQty;
  return null;
}

/**
 * Restocking is exception-based: staff enter numbers only for what needs topping up.
 * Only target-level (par) products need a count before a restock can finish cleanly;
 * a blank "staff enter" product or routine task simply wasn't needed (still recorded as
 * "not entered", which is different from 0).
 */
export function isRequired(p: PlacementView): boolean {
  return p.method === 'par' && !p.optional;
}

export function isChecked(p: PlacementView, i: ItemState): boolean {
  if (i.conflict) return false; // needs a person to choose first
  if (p.method === 'par') return i.currentQty !== null;
  if (p.method === 'manual') return i.requestedQty !== null;
  return i.routineChoice !== null;
}

/** none = not checked (grey) · warn = something to collect (amber) · ok = stocked (green). */
export function cardState(p: PlacementView, i: ItemState): CardState {
  if (i.conflict) return 'bad';
  if (!isChecked(p, i)) return 'none';
  if (p.method === 'routine') return i.routineChoice === 'needed' ? 'warn' : 'ok';
  return (needOf(p, i) ?? 0) > 0 ? 'warn' : 'ok';
}

// ---------------------------------------------------------------------------
// Instructions: say general things once per area, not under every product
// ---------------------------------------------------------------------------
/**
 * Splits product instructions into notes for the whole area (the same text on
 * several products, e.g. "check both sides of the stand") and notes that are
 * really about one product. Nothing is removed from the data: shared text is
 * just shown once at the top of the area instead of under every product.
 */
export function areaNotes(placements: PlacementView[]): { shared: string[]; own: Map<string, string> } {
  const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
  const withText = placements.filter((p) => p.method !== 'routine' && p.instructions.trim());
  const counts = new Map<string, { text: string; n: number }>();
  for (const p of withText) {
    const k = norm(p.instructions);
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { text: p.instructions.trim(), n: 1 });
  }
  // Shared = on at least 3 products, or on every product when the area is small (2+).
  const isShared = (n: number) => n >= 3 || (n >= 2 && n === placements.length);
  const shared = [...counts.values()].filter((c) => isShared(c.n)).map((c) => c.text);
  const sharedKeys = new Set(shared.map(norm));
  const own = new Map<string, string>();
  for (const p of withText) if (!sharedKeys.has(norm(p.instructions))) own.set(p.placementId, p.instructions.trim());
  return { shared, own };
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------
export function areaStatus(recorded: AreaStatus | undefined, placements: PlacementView[], items: Map<string, ItemState>): AreaStatus {
  if (recorded === 'complete' || recorded === 'skipped') return recorded;
  return placements.some((p) => isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)) ? 'in_progress' : 'not_started';
}

// ---------------------------------------------------------------------------
// Collection list
// ---------------------------------------------------------------------------
export interface CollectionLine {
  key: string;
  kind: 'qty' | 'task';
  productName: string;
  unitSingular: string;
  unitPlural: string;
  locationId: string | null;
  locationName: string;
  total: number;
  instructions: string;
  /** Reference photo of the product, if one has been added. */
  photoPath?: string | null;
  photoCredit?: string | null;
  /** Defrost rows: where to grab it, where to look if that's empty, and where it goes. */
  grabNote?: string | null;
  fallbackNote?: string | null;
  putNote?: string | null;
  /** Each placement this line restocks, with how much it needs. */
  parts: { placementId: string; areaName: string; need: number }[];
}

/**
 * Everything that needs collecting, one line per product per storeroom.
 * The same product needed in two areas becomes one line with both amounts
 * listed (products have one unit, so amounts never mix units).
 */
export function collectionLines(placements: PlacementView[], items: Map<string, ItemState>): CollectionLine[] {
  const map = new Map<string, CollectionLine>();
  for (const p of placements) {
    const i = items.get(p.placementId) ?? EMPTY_ITEM;
    const locationName = p.locationName ?? 'No storeroom set';
    if (p.method === 'routine') {
      if (i.routineChoice !== 'needed') continue;
      map.set(`task:${p.placementId}`, {
        key: `task:${p.placementId}`, kind: 'task', productName: p.productName, unitSingular: p.unitSingular,
        unitPlural: p.unitPlural, locationId: p.locationId, locationName, total: 0, instructions: p.instructions, photoPath: p.photoPath ?? null, photoCredit: p.photoCredit ?? null,
        parts: [{ placementId: p.placementId, areaName: p.areaName, need: 0 }],
      });
      continue;
    }
    const need = needOf(p, i);
    if (!need) continue;
    // Same product, same storeroom, same unit (packs for the fridge never merge with single bottles).
    const key = `${p.productId}|${p.locationId ?? ''}|${p.unitPlural}`;
    const line = map.get(key) ?? {
      key, kind: 'qty' as const, productName: p.productName, unitSingular: p.unitSingular, unitPlural: p.unitPlural,
      locationId: p.locationId, locationName, total: 0, instructions: p.instructions, photoPath: p.photoPath ?? null, photoCredit: p.photoCredit ?? null, parts: [],
      ...(p.defrost ? { grabNote: p.grabNote ?? null, fallbackNote: p.fallbackNote ?? null, putNote: p.putNote ?? null } : {}),
    };
    line.total = round2(line.total + need);
    line.parts.push({ placementId: p.placementId, areaName: p.areaName, need });
    map.set(key, line);
  }
  return [...map.values()];
}

/** Lines grouped by storeroom, storerooms in the admin's order. */
export function groupByStoreroom(lines: CollectionLine[], locationOrder: Map<string, number>) {
  const groups = new Map<string, { name: string; order: number; lines: CollectionLine[] }>();
  for (const l of lines) {
    const k = l.locationId ?? '';
    const g = groups.get(k) ?? { name: l.locationName, order: l.locationId ? locationOrder.get(l.locationId) ?? 1e9 : 2e9, lines: [] };
    g.lines.push(l);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/** How much of a line has been collected (all parts added up). */
export function lineGot(line: CollectionLine, items: Map<string, ItemState>): number {
  if (line.kind === 'task') return 0;
  return round2(line.parts.reduce((sum, part) => {
    const i = items.get(part.placementId) ?? EMPTY_ITEM;
    if (i.collectedMode === 'all') return sum + part.need;
    if (i.collectedMode === 'partial') return sum + Math.min(i.collectedQty ?? 0, part.need);
    return sum;
  }, 0));
}

export function lineInfo(line: CollectionLine, items: Map<string, ItemState>) {
  const first = items.get(line.parts[0].placementId) ?? EMPTY_ITEM;
  const modes = line.parts.map((p) => (items.get(p.placementId) ?? EMPTY_ITEM).collectedMode);
  return { reason: first.shortfallReason, flagged: first.flagged, noneOnDisplay: !!first.noneOnDisplay, anyPartial: modes.includes('partial'), allAll: modes.every((m) => m === 'all') };
}

/** todo = not touched · done = all collected · part = fewer, no reason yet · short = fewer, reason given. */
export function lineState(line: CollectionLine, items: Map<string, ItemState>): LineState {
  const info = lineInfo(line, items);
  if (info.allAll) return 'done';
  if (!info.anyPartial) return 'todo';
  if (line.kind === 'qty' && lineGot(line, items) >= line.total) return 'done';
  return info.reason ? 'short' : 'part';
}

/** Changes to record "got all" on every part of a line. */
export function gotAllUpdates(line: CollectionLine): { placementId: string; fields: Partial<ItemState> }[] {
  return line.parts.map((p) => ({
    placementId: p.placementId,
    fields: { collectedMode: 'all', collectedQty: line.kind === 'task' ? null : p.need, shortfallReason: null, flagged: false, noneOnDisplay: false },
  }));
}

/**
 * Changes to record "got fewer": the collected amount is shared out across the
 * line's areas in list order, so each area knows how much it actually received.
 */
export function gotFewerUpdates(line: CollectionLine, got: number, reason: ShortReason | null, flagged: boolean, noneOnDisplay = false) {
  let left = Math.max(0, Math.min(got, line.total));
  // "None on display" only means something when nothing was collected.
  const none = noneOnDisplay && left === 0;
  return line.parts.map((p) => {
    const share = round2(Math.min(left, p.need));
    left = round2(left - share);
    return { placementId: p.placementId, fields: { collectedMode: 'partial' as const, collectedQty: share, shortfallReason: reason, flagged, noneOnDisplay: none } };
  });
}

/**
 * How a confirmed storeroom shortage reads. Usually none collected = Out of stock. With the
 * "None on display" rule (Candy Bar) anything short is Low stock, even at zero, until staff
 * say there's none left on display.
 */
export function shortStatus(got: number, noneOnDisplay: boolean, displayRule: boolean): 'out' | 'low' {
  if (displayRule) return got === 0 && noneOnDisplay ? 'out' : 'low';
  return got === 0 ? 'out' : 'low';
}

export function clearCollectedUpdates(line: CollectionLine) {
  return line.parts.map((p) => ({
    placementId: p.placementId,
    fields: { collectedMode: null, collectedQty: null, shortfallReason: null, flagged: false, noneOnDisplay: false } as Partial<ItemState>,
  }));
}

// ---------------------------------------------------------------------------
// Finishing
// ---------------------------------------------------------------------------
export interface Exception { kind: 'area' | 'unchecked' | 'collect'; status: AreaStatus | 'warn'; text: string; detail: string; areaId?: string }

/**
 * Everything that stops a clean "Finish restock". A confirmed storeroom
 * shortage is NOT an exception: it's a recorded outcome managers act on.
 */
export function exceptions(args: {
  kind: SessionKind;
  view: DepartmentView;
  placements: PlacementView[];          // what this session covers (all, or the quick list)
  recordedAreas: Map<string, AreaStatus>;
  items: Map<string, ItemState>;
}): Exception[] {
  const { kind, view, placements, recordedAreas, items } = args;
  const out: Exception[] = [];
  if (asFull(kind)) {
    for (const { area, placements: ps } of view.areas) {
      const st = areaStatus(recordedAreas.get(area.id), ps, items);
      const req = ps.filter(isRequired);
      const done = req.filter((p) => isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).length;
      if (st === 'skipped') out.push({ kind: 'area', status: st, text: `${area.name} skipped`, detail: '', areaId: area.id });
      else if (st !== 'complete' && done < req.length) out.push({ kind: 'area', status: st, text: `${area.name}: ${req.length - done} target count${req.length - done === 1 ? '' : 's'} missing`, detail: `${done} of ${req.length} counted`, areaId: area.id });
    }
  } else {
    const un = placements.filter((p) => isRequired(p) && !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM));
    if (un.length) out.push({ kind: 'unchecked', status: 'not_started', text: `${un.length} product${un.length === 1 ? '' : 's'} without a number`, detail: un.map((p) => p.productName).join(', ') });
  }
  const covered = activePlacements(kind, placements, recordedAreas);
  const clashes = covered.filter((p) => items.get(p.placementId)?.conflict);
  if (clashes.length) out.push({ kind: 'unchecked', status: 'not_started', text: `${clashes.length} product${clashes.length === 1 ? ' needs' : 's need'} a decision`, detail: `Two different counts: ${clashes.map((p) => p.productName).join(', ')}`, areaId: clashes[0].areaId });
  // Outstanding = nobody has recorded what happened yet. A confirmed result (all, fewer with
  // "not enough in storeroom", or a reason such as "couldn't access stock") is resolved.
  const outstanding = collectionLines(covered.filter((p) => !isPickup(kind, p)), items).filter((l) => {
    const st = lineState(l, items);
    return st === 'todo' || st === 'part';
  });
  if (outstanding.length) {
    out.push({ kind: 'collect', status: 'warn', text: `${outstanding.length} item${outstanding.length === 1 ? '' : 's'} not fully collected`, detail: outstanding.map((l) => l.productName).join(', ') });
  }
  return out;
}

/** Placements that still count: skipped areas are left out of collecting. */
export function activePlacements(kind: SessionKind, placements: PlacementView[], recordedAreas: Map<string, AreaStatus>) {
  // Skipping an area also skips its sections (they're on the same screen).
  return asFull(kind) ? placements.filter((p) => recordedAreas.get(p.screenAreaId ?? p.areaId) !== 'skipped') : placements;
}

// ---------------------------------------------------------------------------
// Refill FOH (Gold Class Bar): grab from upstairs first, then replace it from downstairs
// ---------------------------------------------------------------------------
/** This restock uses the Refill FOH flow: Check FOH → Refill FOH → Check BOH → Collect → Finish. */
export const usesRefill = (kind: SessionKind, view: DepartmentView) => kind === 'full' && view.bohScreenIds.size > 0;

/**
 * Grabbed upstairs for front of house (Refill FOH), or pulled from a freezer on the Defrost screen:
 * on that list, not the downstairs list (full restocks only).
 */
export const isPickup = (kind: SessionKind, p: PlacementView) => kind === 'full' && !!p.pickupAreaId;

/** What the downstairs collection list covers: skipped areas and upstairs pickups left out. */
export function collectPlacements(kind: SessionKind, placements: PlacementView[], recordedAreas: Map<string, AreaStatus>) {
  return activePlacements(kind, placements, recordedAreas).filter((p) => !isPickup(kind, p));
}

/** The areas (screens) for one part of the flow: front of house first, then upstairs back of house. */
export function phaseAreas(view: DepartmentView, phase: 'foh' | 'boh' | 'all') {
  if (phase === 'all' || !view.bohScreenIds.size) return view.areas;
  return view.areas.filter((a) => view.bohScreenIds.has(a.area.id) === (phase === 'boh'));
}

/** The Refill FOH list: what to grab from each upstairs spot, one line per product per spot. */
export function refillLines(kind: SessionKind, placements: PlacementView[], recordedAreas: Map<string, AreaStatus>, items: Map<string, ItemState>) {
  const picks = activePlacements(kind, placements, recordedAreas).filter((p) => isPickup(kind, p))
    .map((p) => ({ ...p, locationId: p.pickupAreaId!, locationName: p.pickupAreaName ?? 'Upstairs' }));
  return collectionLines(picks, items);
}

export interface Suggestion {
  qty: number; from: { areaName: string; need: number }[];
  /** Defrost rows: worked out from tomorrow's admits and what's already ready. */
  defrost?: DefrostSuggestion;
}

/**
 * What staff actually grabbed upstairs for FOH, suggested for the same product in the spot it came
 * from (e.g. 1 Shiraz grabbed from the Wine cupboard → 1 Shiraz suggested for the Wine cupboard).
 * Based on what was collected on "Collect upstairs" (all of it, or the amount under Got fewer):
 * nothing grabbed (or not ticked yet) suggests nothing. Only for pickups marked "suggest" (wine,
 * spirits, small sparkling water), never for beers taken as single bottles out of packs.
 */
export function suggestions(kind: SessionKind, view: DepartmentView, items: Map<string, ItemState>, recordedAreas: Map<string, AreaStatus>, admits: number | null = null): Map<string, Suggestion> {
  const out = new Map<string, Suggestion>();
  // Defrost rows: from tomorrow's admits and what staff counted as already ready (0 = nothing to pull).
  if (admits !== null) {
    for (const p of activePlacements(kind, view.placements, recordedAreas)) {
      if (!p.defrost) continue;
      const d = defrostSuggestion(p, admits, (items.get(p.placementId) ?? EMPTY_ITEM).currentQty);
      if (d) out.set(p.placementId, { qty: d.qty, from: [], defrost: d });
    }
  }
  if (kind !== 'full') return out;
  const picks = activePlacements(kind, view.placements, recordedAreas).filter((p) => p.pickupSuggest && p.pickupAreaId);
  for (const p of picks) {
    const raw = items.get(p.placementId) ?? EMPTY_ITEM;
    // A defrost amount suggested from admits counts as entered (until staff change it).
    const ds = out.get(p.placementId);
    const i = raw.requestedQty === null && ds?.defrost ? { ...raw, requestedQty: ds.qty } : raw;
    const want = needOf(p, i) ?? 0;
    const need = i.collectedMode === 'all' ? want : i.collectedMode === 'partial' ? Math.min(want, i.collectedQty ?? 0) : 0;
    if (need <= 0) continue;
    // The same product in the pickup spot, counted in the same unit and entered by staff.
    const t = view.placements.find((x) => x.areaId === p.pickupAreaId && x.productId === p.productId && x.method === 'manual' && x.unitPlural === p.unitPlural);
    if (!t) continue;
    const s = out.get(t.placementId) ?? { qty: 0, from: [] };
    s.qty = round2(s.qty + need);
    s.from.push({ areaName: p.areaName, need });
    out.set(t.placementId, s);
  }
  return out;
}

/**
 * The items as they count: a suggestion stands until staff change it. Whatever they leave is
 * final (change 1 to 3 → 3 in total; remove it → 0). Nothing is saved until they touch it.
 */
export function withSuggestions(kind: SessionKind, view: DepartmentView, items: Map<string, ItemState>, recordedAreas: Map<string, AreaStatus>, admits: number | null = null): Map<string, ItemState> {
  const sug = suggestions(kind, view, items, recordedAreas, admits);
  if (!sug.size) return items;
  const out = new Map(items);
  for (const [id, s] of sug) {
    const i = items.get(id) ?? EMPTY_ITEM;
    if (i.requestedQty === null && !i.conflict) out.set(id, { ...i, requestedQty: s.qty });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stock after the restock: what we're now low on or out of
// ---------------------------------------------------------------------------
export type StockStatus = 'out' | 'low' | 'not_topped_up';

export interface StockOutcome {
  productName: string; unitSingular: string; unitPlural: string;
  status: StockStatus;
  /** How much was needed, collected, and is still missing. */
  needed: number; got: number; short: number;
  /** For target-level products: what's now on the shelf vs the target (all areas added up). */
  onShelf: number | null; target: number | null;
  reason: ShortReason | null; flagged: boolean;
  /** Menu items to mark as sold out (from the product's settings). */
  affects: string[];
  /** Candy Bar: staff said none is left on display. */
  noneOnDisplay?: boolean;
}

/**
 * One entry per product that is still below target after collecting:
 *   out           the storeroom had none (confirmed),
 *   low           the storeroom only had some (confirmed),
 *   not_topped_up not collected for another reason (time, access, not done).
 * Worst first: out, then low, then not topped up.
 */
export function stockOutcomes(lines: CollectionLine[], items: Map<string, ItemState>, byId: Map<string, PlacementView>, displayRule = false): StockOutcome[] {
  const out: StockOutcome[] = [];
  for (const l of lines) {
    if (l.kind !== 'qty') continue;
    const st = lineState(l, items);
    if (st === 'done') continue;
    const info = lineInfo(l, items), got = lineGot(l, items), short = round2(l.total - got);
    let onShelf: number | null = 0, target: number | null = 0;
    for (const part of l.parts) {
      const p = byId.get(part.placementId), i = items.get(part.placementId) ?? EMPTY_ITEM;
      if (!p || p.method !== 'par' || p.par === null || i.currentQty === null) { onShelf = null; target = null; break; }
      const collected = i.collectedMode === 'all' ? part.need : i.collectedMode === 'partial' ? Math.min(i.collectedQty ?? 0, part.need) : 0;
      onShelf = round2(onShelf! + i.currentQty + collected);
      target = round2(target! + p.par);
    }
    const confirmed = info.reason === 'insufficient';
    out.push({
      productName: l.productName, unitSingular: l.unitSingular, unitPlural: l.unitPlural,
      status: confirmed ? shortStatus(got, info.noneOnDisplay, displayRule) : 'not_topped_up',
      noneOnDisplay: confirmed && got === 0 && info.noneOnDisplay,
      needed: l.total, got, short, onShelf, target, reason: info.reason, flagged: info.flagged,
      affects: byId.get(l.parts[0].placementId)?.affects ?? [],
    });
  }
  const rank: Record<StockStatus, number> = { out: 0, low: 1, not_topped_up: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.productName.localeCompare(b.productName));
}

/**
 * How many stock shortages (out of stock or low) a restock recorded: the same count as
 * "Stock shortages" on its Review screen. Upstairs suggestions count as entered.
 */
export function shortageCount(kind: SessionKind, view: DepartmentView, items: Map<string, ItemState>, recordedAreas: Map<string, AreaStatus>, admits: number | null = null): number {
  const it = withSuggestions(kind, view, items, recordedAreas, admits);
  const lines = collectionLines(collectPlacements(kind, view.placements, recordedAreas), it);
  return stockOutcomes(lines, it, view.byId, !!view.department.noneOnDisplay).filter((o) => o.status === 'out' || o.status === 'low').length;
}

export function outcomeLine(o: StockOutcome): string {
  const q = (n: number) => formatQty(n, o.unitSingular, o.unitPlural);
  const shelf = o.onShelf !== null && o.target !== null ? ` \u00b7 ${round2(o.onShelf)} of ${round2(o.target)} on the shelf` : '';
  if (o.status === 'out' && o.noneOnDisplay) return `${o.productName}: none on display and none in the storeroom (needed ${q(o.needed)})${shelf}`;
  if (o.status === 'out') return `${o.productName}: none in the storeroom (needed ${q(o.needed)})${shelf}`;
  if (o.status === 'low' && o.got === 0) return `${o.productName}: none collected, short ${q(o.short)}${shelf}`;
  if (o.status === 'low') return `${o.productName}: only ${q(o.got)} in the storeroom, short ${q(o.short)}${shelf}`;
  const why = o.reason === 'time' ? 'interrupted / ran out of time' : o.reason === 'access' ? 'couldn\u2019t access stock' : o.reason === 'other' ? 'other reason' : 'not collected';
  return `${o.productName}: ${q(o.short)} not collected (${why})${shelf}`;
}

/** The plain-text summary staff copy for managers. Leads with what we're low on or out of. */
export function summaryText(args: {
  departmentName: string; kind: SessionKind; finishedLabel: string | null; exceptionReason: string | null;
  people: string[]; view: DepartmentView; placements: PlacementView[]; recordedAreas: Map<string, AreaStatus>;
  /** The name confirmed on the Finish screen. */
  completedBy?: string | null;
  skipReasons: Map<string, string>; items: Map<string, ItemState>; dateLabel: string;
}): string {
  const { view, items, recordedAreas } = args;
  const L: string[] = [];
  L.push(`VILLAGE RESTOCK: ${args.departmentName}`);
  L.push(`${args.kind === 'full' ? 'Full' : args.kind === 'area' ? `${view.areas[0]?.area.name ?? 'Area'}` : 'Quick'} restock \u00b7 ${args.finishedLabel ? `finished ${args.finishedLabel}` : 'not finished'} \u00b7 ${args.dateLabel}${args.people.length ? ` \u00b7 ${args.people.join(', ')}` : ''}`);
  L.push(`Status: ${!args.finishedLabel ? 'In progress' : args.exceptionReason ? `Finished with exceptions (${args.exceptionReason})` : 'Complete'}`);
  if (args.completedBy) L.push(`Completed by: ${args.completedBy}`);

  const lines = collectionLines(collectPlacements(args.kind, args.placements, recordedAreas), items);
  const outcomes = stockOutcomes(lines, items, view.byId, !!view.department.noneOnDisplay);
  const group = (st: StockStatus, title: string) => {
    const g = outcomes.filter((o) => o.status === st);
    if (g.length) {
      L.push(''); L.push(`${title} (${g.length})`);
      for (const o of g) {
        L.push(`- ${outcomeLine(o)}${o.flagged ? ' [flagged]' : ''}`);
        if (o.affects.length && st === 'out') L.push(`    Set as sold out: ${o.affects.join(', ')}`);
      }
    }
  };
  if (!outcomes.length) { L.push(''); L.push('Nothing low or out of stock. Everything collected is back to target.'); }
  group('out', 'OUT OF STOCK');
  group('low', view.department.noneOnDisplay ? 'LOW STOCK' : 'RUNNING LOW');
  group('not_topped_up', 'COLLECTION INCOMPLETE (not a storeroom shortage)');

  const flaggedDone = lines.filter((l) => lineInfo(l, items).flagged && lineState(l, items) === 'done').map((l) => l.productName);
  if (flaggedDone.length) { L.push(''); L.push(`FLAGGED FOR MANAGER: ${flaggedDone.join(', ')}`); }

  // Only missing target counts: a blank "staff enter" product simply didn't need anything.
  const notChecked: string[] = [];
  if (asFull(args.kind)) {
    for (const { area, placements } of view.areas) {
      const st = areaStatus(recordedAreas.get(area.id), placements, items);
      if (st === 'skipped') notChecked.push(`${area.name} skipped (${args.skipReasons.get(area.id) || 'no reason'})`);
      else if (st !== 'complete') {
        const un = placements.filter((p) => isRequired(p) && !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).map((p) => p.productName);
        if (un.length) notChecked.push(`${area.name}: ${un.join(', ')}`);
      }
    }
  } else {
    const un = args.placements.filter((p) => isRequired(p) && !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).map((p) => p.productName);
    if (un.length) notChecked.push(un.join(', '));
  }
  if (notChecked.length) { L.push(''); L.push('NOT CHECKED'); L.push(...notChecked.map((s) => `- ${s}`)); }

  const collected = lines.flatMap((l) => {
    const got = lineGot(l, items);
    if (l.kind === 'task') return lineState(l, items) === 'done' ? [`${l.productName} (done)`] : [];
    return got > 0 ? [`${l.productName} ${formatQty(got, l.unitSingular, l.unitPlural)}`] : [];
  });
  L.push(''); L.push(`Collected: ${collected.join('; ') || 'Nothing'}`);
  return L.join('\n');
}
