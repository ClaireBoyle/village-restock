// The rules of a restock, as pure functions shared by the device and the server.
// No storage, no React: easy to test and to reason about.
import type { Catalogue, CatArea, CatDepartment, RestockMethod } from './catalogue-types';
import { formatQty, requiredForPar, round2 } from './restock-math';

export type ShortReason = 'insufficient' | 'access' | 'time' | 'other';
export type AreaStatus = 'not_started' | 'in_progress' | 'complete' | 'skipped';
export type CardState = 'none' | 'ok' | 'warn';
export type LineState = 'todo' | 'done' | 'part' | 'short';

export const SHORT_REASONS: [ShortReason, string][] = [
  ['insufficient', 'Confirmed: not enough in the storeroom'],
  ['access', 'Couldn’t access the stock'],
  ['time', 'Interrupted or ran out of time'],
  ['other', 'Other'],
];
export const SKIP_REASONS = ['Being cleaned or defrosted', 'Another staff member is doing it', 'Ran out of time', 'Not in use tonight'];
export const EXCEPTION_REASONS = ['Ran out of time before close', 'Stock or area unavailable', 'Supervisor approved', 'Other'];

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
}

export const EMPTY_ITEM: ItemState = {
  currentQty: null, requestedQty: null, routineChoice: null,
  collectedMode: null, collectedQty: null, shortfallReason: null, flagged: false,
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
  if (p.method === 'par') return i.currentQty !== null;
  if (p.method === 'manual') return i.requestedQty !== null;
  return i.routineChoice !== null;
}

/** none = not checked (grey) · warn = something to collect (amber) · ok = stocked (green). */
export function cardState(p: PlacementView, i: ItemState): CardState {
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
 * shortage is NOT an exception: it's a recorded outcome supervisors act on.
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

/** The plain-text summary staff copy for supervisors. */
export function summaryText(args: {
  departmentName: string; kind: 'full' | 'quick'; finishedLabel: string | null; exceptionReason: string | null;
  people: string[]; view: DepartmentView; placements: PlacementView[]; recordedAreas: Map<string, AreaStatus>;
  skipReasons: Map<string, string>; items: Map<string, ItemState>; dateLabel: string;
}): string {
  const { view, items, recordedAreas } = args;
  const L: string[] = [];
  L.push(`VILLAGE RESTOCK: ${args.departmentName}`);
  L.push(`${args.kind === 'full' ? 'Full' : 'Quick'} restock · ${args.finishedLabel ? `finished ${args.finishedLabel}` : 'not finished'} · ${args.dateLabel}`);
  L.push(`Status: ${!args.finishedLabel ? 'In progress' : args.exceptionReason ? `Finished with exceptions (${args.exceptionReason})` : 'Complete'}`);
  if (args.people.length) L.push(`Staff: ${args.people.join(', ')}`);
  if (args.kind === 'full') {
    const st = view.areas.map(({ area, placements }) => ({ area, s: areaStatus(recordedAreas.get(area.id), placements, items) }));
    L.push('');
    L.push(`Areas complete: ${st.filter((x) => x.s === 'complete').map((x) => x.area.name).join(', ') || 'None'}`);
    const sk = st.filter((x) => x.s === 'skipped');
    if (sk.length) L.push(`Skipped: ${sk.map((x) => `${x.area.name} (${args.skipReasons.get(x.area.id) ?? 'no reason'})`).join(', ')}`);
    const open = st.filter((x) => x.s === 'not_started' || x.s === 'in_progress');
    if (open.length) L.push(`Not finished: ${open.map((x) => x.area.name).join(', ')}`);
  }
  const lines = collectionLines(activePlacements(args.kind, args.placements, recordedAreas), items);
  const shorts: string[] = [], flagged: string[] = [], notCollected: string[] = [], collected: string[] = [];
  for (const l of lines) {
    const st = lineState(l, items), info = lineInfo(l, items), got = lineGot(l, items);
    if (l.kind === 'task') { (st === 'done' ? collected : notCollected).push(`${l.productName}${st === 'done' ? ' (done)' : ': task not done'}`); continue; }
    if (got > 0) collected.push(`${l.productName} ${formatQty(got, l.unitSingular, l.unitPlural)}`);
    if (st === 'short' && info.reason === 'insufficient') shorts.push(`${l.productName}: short ${formatQty(round2(l.total - got), l.unitSingular, l.unitPlural)} (needed ${l.total}, got ${got})`);
    else if (st !== 'done') notCollected.push(`${l.productName}: ${formatQty(round2(l.total - got), l.unitSingular, l.unitPlural)} not collected`);
    if (info.flagged) flagged.push(l.productName);
  }
  L.push('');
  L.push(`CONFIRMED SHORTAGES (${shorts.length})`);
  L.push(...(shorts.length ? shorts.map((s) => `- ${s}`) : ['- None']));
  if (flagged.length) { L.push(''); L.push('FLAGGED FOR SUPERVISOR'); L.push(...flagged.map((s) => `- ${s}`)); }
  const unchecked = args.placements.filter((p) => recordedAreas.get(p.areaId) !== 'skipped' && !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM));
  if (notCollected.length || unchecked.length) {
    L.push(''); L.push('UNFINISHED');
    L.push(...notCollected.map((s) => `- ${s}`));
    if (unchecked.length) L.push(`- Not checked: ${unchecked.map((p) => p.productName).join(', ')}`);
  }
  L.push(''); L.push(`Collected: ${collected.join('; ') || 'Nothing'}`);
  return L.join('\n');
}
