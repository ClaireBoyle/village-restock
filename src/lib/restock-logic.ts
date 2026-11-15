// The rules of a restock, as pure functions shared by the device and the server.
// No storage, no React: easy to test and to reason about.
import type { Catalogue, CatArea, CatDepartment, RestockMethod } from './catalogue-types';
import { formatQty, requiredForPar, round2 } from './restock-math';

export type ShortReason = 'insufficient' | 'access' | 'time' | 'other';
export type AreaStatus = 'not_started' | 'in_progress' | 'complete' | 'skipped';
export type CardState = 'none' | 'ok' | 'warn' | 'bad';

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
  ['insufficient', 'Confirmed: not enough in the storeroom'],
  ['access', 'Couldn’t access the stock'],
  ['time', 'Interrupted or ran out of time'],
  ['other', 'Other'],
];
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
  photoPath: string | null;
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
  /** Set when two people entered different counts; cleared when someone chooses. */
  conflict?: Conflict | null;
}

export const EMPTY_ITEM: ItemState = {
  currentQty: null, requestedQty: null, routineChoice: null,
  collectedMode: null, collectedQty: null, shortfallReason: null, flagged: false, conflict: null,
};

export interface DepartmentView {
  department: CatDepartment;
  areas: { area: CatArea; placements: PlacementView[] }[];
  placements: PlacementView[];
  byId: Map<string, PlacementView>;
  locationOrder: Map<string, number>;
}

/** Arrange a department's catalogue area by area, in staff checking order. */
export function departmentView(cat: Catalogue, departmentId: string): DepartmentView | null {
  const department = cat.departments.find((d) => d.id === departmentId);
  if (!department) return null;
  const products = new Map(cat.products.map((p) => [p.id, p]));
  const locations = new Map(cat.locations.map((l) => [l.id, l]));
  const categories = new Map(cat.categories.map((c) => [c.id, c.name]));
  const areas = cat.areas
    .filter((a) => a.departmentId === departmentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((area) => {
      const placements = cat.placements
        .filter((pl) => pl.checkAreaId === area.id && products.get(pl.productId)?.departmentId === departmentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((pl): PlacementView => {
          const p = products.get(pl.productId)!;
          const locId = pl.locationId ?? p.defaultLocationId;
          return {
            placementId: pl.id, productId: p.id, areaId: area.id, areaName: area.name, productName: p.name,
            unitSingular: p.unitSingular, unitPlural: p.unitPlural, method: p.method,
            par: pl.parLevel, allowDecimal: p.allowDecimal, locationId: locId,
            locationName: locId ? locations.get(locId)?.name ?? null : null,
            instructions: pl.instructions ?? p.instructions,
            categoryName: p.categoryId ? categories.get(p.categoryId) ?? null : null,
            affects: p.affects ?? [],
            photoPath: p.photoPath ?? null,
          };
        });
      return { area, placements };
    });
  const placements = areas.flatMap((a) => a.placements);
  return {
    department, areas, placements,
    byId: new Map(placements.map((p) => [p.placementId, p])),
    locationOrder: new Map(cat.locations.map((l, i) => [l.id, l.sortOrder * 1000 + i])),
  };
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
        unitPlural: p.unitPlural, locationId: p.locationId, locationName, total: 0, instructions: p.instructions,
        parts: [{ placementId: p.placementId, areaName: p.areaName, need: 0 }],
      });
      continue;
    }
    const need = needOf(p, i);
    if (!need) continue;
    const key = `${p.productId}|${p.locationId ?? ''}`;
    const line = map.get(key) ?? {
      key, kind: 'qty' as const, productName: p.productName, unitSingular: p.unitSingular, unitPlural: p.unitPlural,
      locationId: p.locationId, locationName, total: 0, instructions: p.instructions, parts: [],
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
  return { reason: first.shortfallReason, flagged: first.flagged, anyPartial: modes.includes('partial'), allAll: modes.every((m) => m === 'all') };
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
    fields: { collectedMode: 'all', collectedQty: line.kind === 'task' ? null : p.need, shortfallReason: null, flagged: false },
  }));
}

/**
 * Changes to record "got fewer": the collected amount is shared out across the
 * line's areas in list order, so each area knows how much it actually received.
 */
export function gotFewerUpdates(line: CollectionLine, got: number, reason: ShortReason | null, flagged: boolean) {
  let left = Math.max(0, Math.min(got, line.total));
  return line.parts.map((p) => {
    const share = round2(Math.min(left, p.need));
    left = round2(left - share);
    return { placementId: p.placementId, fields: { collectedMode: 'partial' as const, collectedQty: share, shortfallReason: reason, flagged } };
  });
}

export function clearCollectedUpdates(line: CollectionLine) {
  return line.parts.map((p) => ({
    placementId: p.placementId,
    fields: { collectedMode: null, collectedQty: null, shortfallReason: null, flagged: false } as Partial<ItemState>,
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
  kind: 'full' | 'quick';
  view: DepartmentView;
  placements: PlacementView[];          // what this session covers (all, or the quick list)
  recordedAreas: Map<string, AreaStatus>;
  items: Map<string, ItemState>;
}): Exception[] {
  const { kind, view, placements, recordedAreas, items } = args;
  const out: Exception[] = [];
  if (kind === 'full') {
    for (const { area, placements: ps } of view.areas) {
      const st = areaStatus(recordedAreas.get(area.id), ps, items);
      const done = ps.filter((p) => isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).length;
      if (st === 'skipped') out.push({ kind: 'area', status: st, text: `${area.name} skipped`, detail: '', areaId: area.id });
      else if (st !== 'complete') out.push({ kind: 'area', status: st, text: `${area.name} not complete`, detail: `${done} of ${ps.length} checked`, areaId: area.id });
    }
  } else {
    const un = placements.filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM));
    if (un.length) out.push({ kind: 'unchecked', status: 'not_started', text: `${un.length} product${un.length === 1 ? '' : 's'} without a number`, detail: un.map((p) => p.productName).join(', ') });
  }
  const covered = activePlacements(kind, placements, recordedAreas);
  const clashes = covered.filter((p) => items.get(p.placementId)?.conflict);
  if (clashes.length) out.push({ kind: 'unchecked', status: 'not_started', text: `${clashes.length} product${clashes.length === 1 ? ' needs' : 's need'} a decision`, detail: `Two different counts: ${clashes.map((p) => p.productName).join(', ')}`, areaId: clashes[0].areaId });
  const outstanding = collectionLines(covered, items).filter((l) => {
    const st = lineState(l, items);
    return st === 'todo' || st === 'part' || (st === 'short' && lineInfo(l, items).reason !== 'insufficient');
  });
  if (outstanding.length) {
    out.push({ kind: 'collect', status: 'warn', text: `${outstanding.length} item${outstanding.length === 1 ? '' : 's'} not fully collected`, detail: outstanding.map((l) => l.productName).join(', ') });
  }
  return out;
}

/** Placements that still count: skipped areas are left out of collecting. */
export function activePlacements(kind: 'full' | 'quick', placements: PlacementView[], recordedAreas: Map<string, AreaStatus>) {
  return kind === 'full' ? placements.filter((p) => recordedAreas.get(p.areaId) !== 'skipped') : placements;
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
}

/**
 * One entry per product that is still below target after collecting:
 *   out           the storeroom had none (confirmed),
 *   low           the storeroom only had some (confirmed),
 *   not_topped_up not collected for another reason (time, access, not done).
 * Worst first: out, then low, then not topped up.
 */
export function stockOutcomes(lines: CollectionLine[], items: Map<string, ItemState>, byId: Map<string, PlacementView>): StockOutcome[] {
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
      status: confirmed ? (got === 0 ? 'out' : 'low') : 'not_topped_up',
      needed: l.total, got, short, onShelf, target, reason: info.reason, flagged: info.flagged,
      affects: byId.get(l.parts[0].placementId)?.affects ?? [],
    });
  }
  const rank: Record<StockStatus, number> = { out: 0, low: 1, not_topped_up: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.productName.localeCompare(b.productName));
}

export function outcomeLine(o: StockOutcome): string {
  const q = (n: number) => formatQty(n, o.unitSingular, o.unitPlural);
  const shelf = o.onShelf !== null && o.target !== null ? ` \u00b7 ${round2(o.onShelf)} of ${round2(o.target)} on the shelf` : '';
  if (o.status === 'out') return `${o.productName}: none in the storeroom (needed ${q(o.needed)})${shelf}`;
  if (o.status === 'low') return `${o.productName}: only ${q(o.got)} in the storeroom, short ${q(o.short)}${shelf}`;
  const why = o.reason === 'time' ? 'ran out of time' : o.reason === 'access' ? 'couldn\u2019t access the stock' : o.reason === 'other' ? 'other reason' : 'not collected';
  return `${o.productName}: ${q(o.short)} not topped up (${why})${shelf}`;
}

/** The plain-text summary staff copy for managers. Leads with what we're low on or out of. */
export function summaryText(args: {
  departmentName: string; kind: 'full' | 'quick'; finishedLabel: string | null; exceptionReason: string | null;
  people: string[]; view: DepartmentView; placements: PlacementView[]; recordedAreas: Map<string, AreaStatus>;
  skipReasons: Map<string, string>; items: Map<string, ItemState>; dateLabel: string;
}): string {
  const { view, items, recordedAreas } = args;
  const L: string[] = [];
  L.push(`VILLAGE RESTOCK: ${args.departmentName}`);
  L.push(`${args.kind === 'full' ? 'Full' : 'Quick'} restock \u00b7 ${args.finishedLabel ? `finished ${args.finishedLabel}` : 'not finished'} \u00b7 ${args.dateLabel}${args.people.length ? ` \u00b7 ${args.people.join(', ')}` : ''}`);
  L.push(`Status: ${!args.finishedLabel ? 'In progress' : args.exceptionReason ? `Finished with exceptions (${args.exceptionReason})` : 'Complete'}`);

  const lines = collectionLines(activePlacements(args.kind, args.placements, recordedAreas), items);
  const outcomes = stockOutcomes(lines, items, view.byId);
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
  group('low', 'RUNNING LOW');
  group('not_topped_up', 'NOT TOPPED UP');

  const flaggedDone = lines.filter((l) => lineInfo(l, items).flagged && lineState(l, items) === 'done').map((l) => l.productName);
  if (flaggedDone.length) { L.push(''); L.push(`FLAGGED FOR MANAGER: ${flaggedDone.join(', ')}`); }

  const notChecked: string[] = [];
  if (args.kind === 'full') {
    for (const { area, placements } of view.areas) {
      const st = areaStatus(recordedAreas.get(area.id), placements, items);
      if (st === 'skipped') notChecked.push(`${area.name} skipped (${args.skipReasons.get(area.id) || 'no reason'})`);
      else if (st !== 'complete') {
        const un = placements.filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).map((p) => p.productName);
        if (un.length) notChecked.push(`${area.name}: ${un.join(', ')}`);
      }
    }
  } else {
    const un = args.placements.filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).map((p) => p.productName);
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
