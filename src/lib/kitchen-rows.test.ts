import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { collectPlacements, collectionLines, defrostSource, departmentView, exceptions, isChecked, pendingRefills, stockOutcomes, storeLabel, summaryText, withSuggestions, EMPTY_ITEM, type ItemState } from './restock-logic';

// Freezer 2's arancini drawer (a refill) and its spare stock; a dessert on Defrost and on the walk-in's shelf.
const cat: Catalogue = {
  version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [],
  departments: [{ id: 'k', name: 'Gold Class Kitchen', shortName: 'Kitchen', groupLabel: '', theme: 'gold', icon: 'kitchen', description: '', sortOrder: 1 }],
  areas: [
    { id: 'def', departmentId: 'k', name: 'Defrost', guideText: '', guidePhotoPath: null, sortOrder: 1 },
    { id: 'f2', departmentId: 'k', name: 'Freezer 2', guideText: '', guidePhotoPath: null, sortOrder: 2 },
    { id: 'walk', departmentId: 'k', name: 'Walk in fridge', guideText: '', guidePhotoPath: null, sortOrder: 3 },
  ],
  locations: [{ id: 'down', name: 'Walk in freezer(Downstairs)', sortOrder: 1 }],
  categories: [],
  products: [
    { id: 'ara', departmentId: 'k', categoryId: null, name: 'Arancini', unitSingular: 'bag', unitPlural: 'bags', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 1, affects: [], photoPath: null },
    { id: 'brownie', departmentId: 'k', categoryId: null, name: 'Brownie', unitSingular: 'portion', unitPlural: 'portions', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 2, affects: [], photoPath: null },
  ],
  placements: [
    { id: 'drawer', productId: 'ara', checkAreaId: 'f2', parLevel: null, locationId: null, instructions: null, sortOrder: 1, refillSource: 'Spare arancini in Freezer 2, lower right' },
    { id: 'spare', productId: 'ara', checkAreaId: 'f2b', parLevel: null, locationId: null, instructions: null, sortOrder: 2 },
    { id: 'b-def', productId: 'brownie', checkAreaId: 'def', parLevel: null, locationId: null, instructions: null, sortOrder: 1, putNote: 'Upstairs walk-in fridge' },
    { id: 'b-walk', productId: 'brownie', checkAreaId: 'walk', parLevel: null, locationId: null, instructions: null, sortOrder: 1, linkedPlacementId: 'b-def' },
  ],
};
cat.areas.push({ id: 'f2b', departmentId: 'k', name: 'Freezer 2 · Check remaining spare stock', guideText: '', guidePhotoPath: null, sortOrder: 2, parentAreaId: 'f2' });
const view = departmentView(cat, 'k')!;
const items = (o: Record<string, Partial<ItemState>>) => new Map(Object.entries(o).map(([k, v]) => [k, { ...EMPTY_ITEM, ...v }]));
const none = new Map();
const list = (m: Map<string, ItemState>) => collectionLines(collectPlacements('full', view.placements, none), m).map((l) => `${l.productName} ${l.total}`);

describe('refill tasks', () => {
  it('Stocked or Needs stock records the drawer only: nothing collected, nothing assumed used', () => {
    for (const s of ['refilled', 'full', 'needs_stock'] as const) expect(list(items({ drawer: { refillStatus: s } }))).toEqual([]);
    expect(isChecked(view.byId.get('drawer')!, { ...EMPTY_ITEM, refillStatus: 'full' })).toBe(true);
    expect(isChecked(view.byId.get('drawer')!, EMPTY_ITEM)).toBe(false);
  });
  it('the spare stock check is the one requirement from downstairs (never doubled)', () => {
    expect(list(items({ drawer: { refillStatus: 'refilled' }, spare: { requestedQty: 2 } }))).toEqual(['Arancini 2']);
  });
  it('"Needs stock" is a refill still to do, not a shortage or outstanding collection', () => {
    const m = items({ drawer: { refillStatus: 'needs_stock' } });
    expect(pendingRefills('full', view.placements, none, m).map((p) => p.productName)).toEqual(['Arancini']);
    expect(exceptions({ kind: 'full', view, placements: view.placements, recordedAreas: none, items: m })).toEqual([]);
    const text = summaryText({ departmentName: 'Kitchen', kind: 'full', finishedLabel: null, exceptionReason: null, people: [], view, placements: view.placements,
      recordedAreas: none, skipReasons: new Map(), items: m, dateLabel: '' });
    expect(text).toContain('REFILLS STILL TO DO');
    expect(text).toContain('Arancini (from Spare arancini in Freezer 2, lower right)');
  });
});

describe('a row linked to Defrost', () => {
  it('holds no requirement of its own: the Defrost total is the one on the list', () => {
    expect(list(items({ 'b-def': { requestedQty: 3 } }))).toEqual(['Brownie 3']);
    // Even if something was saved on the linked row, it never adds a second requirement.
    expect(list(items({ 'b-def': { requestedQty: 3 }, 'b-walk': { requestedQty: 3 } }))).toEqual(['Brownie 3']);
  });
  it('a link to a row that isn\'t there is ignored', () => {
    const v = departmentView({ ...cat, placements: cat.placements.filter((p) => p.id !== 'b-def') }, 'k')!;
    expect(v.byId.get('b-walk')!.linkedPlacementId).toBeNull();
  });
});

describe('defrost pulls', () => {
  const dcat: Catalogue = {
    ...cat,
    areas: [...cat.areas, { id: 'f1', departmentId: 'k', name: 'Freezer 1', guideText: '', guidePhotoPath: null, sortOrder: 0 },
      { id: 'f1ll', departmentId: 'k', name: 'Freezer 1 · Lower left', guideText: '', guidePhotoPath: null, sortOrder: 1, parentAreaId: 'f1' }],
    locations: [...cat.locations, { id: 'f1s', name: 'Freezer 1', sortOrder: 2 }],
    products: [...cat.products, { id: 'base', departmentId: 'k', categoryId: null, name: '9" Pizza Bases', unitSingular: 'base', unitPlural: 'bases', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 3, affects: [], photoPath: null }],
    placements: [...cat.placements,
      { id: 'pz-def', productId: 'base', checkAreaId: 'def', parLevel: null, locationId: 'f1s', instructions: null, sortOrder: 2, putNote: 'Upstairs walk-in fridge', pickupAreaId: 'f1ll', pickupSuggest: true },
      { id: 'pz-f1', productId: 'base', checkAreaId: 'f1ll', parLevel: null, locationId: null, instructions: null, sortOrder: 1 }],
  };
  const v = departmentView(dcat, 'k')!;
  // As the app counts them: with suggestions (what's set to defrost is suggested for the freezer's top-up).
  const lines = (m: Map<string, ItemState>, view = v) => collectionLines(collectPlacements('full', view.placements, none), withSuggestions('full', view, m, none)).map((l) => `${l.productName} ${l.total} ${l.locationName}`);
  it('setting an amount puts the same amount on the freezer\'s stock list straight away (to replace from downstairs)', () => {
    expect(lines(items({ 'pz-def': { requestedQty: 5 } }))).toEqual(['9" Pizza Bases 5 Walk in freezer(Downstairs)']);
    expect(lines(items({ 'pz-def': { requestedQty: 5, upstairsQty: 5 } }))).toEqual(['9" Pizza Bases 5 Walk in freezer(Downstairs)']);
    expect(lines(items({ 'pz-def': { requestedQty: 0 } }))).toEqual([]);
  });
  it('not enough upstairs: the rest of the defrost comes from downstairs too, and the freezer still gets the full amount back', () => {
    const m = items({ 'pz-def': { requestedQty: 5, upstairsQty: 2 } });
    // Both from the downstairs walk-in freezer: one line of 8 (3 to defrost + 5 back into the freezer).
    expect(lines(m)).toEqual(['9" Pizza Bases 8 Walk in freezer(Downstairs)']);
  });
  it('none upstairs, same storeroom: one line, "2 to defrost" and "2 back into Freezer 1"', () => {
    const fv = departmentView({ ...dcat, placements: dcat.placements.map((p) => (p.id === 'pz-def' ? { ...p, fallbackLocationId: 'down' } : p)) }, 'k')!;
    const m = withSuggestions('full', fv, items({ 'pz-def': { requestedQty: 2, upstairsQty: 0 } }), none);
    const ls = collectionLines(collectPlacements('full', fv.placements, none), m);
    expect(ls.map((l) => `${l.productName} ${l.total} ${l.locationName}`)).toEqual(['9" Pizza Bases 4 Walk in freezer(Downstairs)']);
    expect(ls[0].parts.map((p) => `${p.need} ${p.label}`)).toEqual(['2 to defrost → Upstairs walk-in fridge', '2 back into Freezer 1 · Lower left']);
    // Pulled after all: just the 2 back into the freezer.
    const pulled = withSuggestions('full', fv, items({ 'pz-def': { requestedQty: 2, upstairsQty: 2 } }), none);
    expect(collectionLines(collectPlacements('full', fv.placements, none), pulled).map((l) => `${l.total} ${l.parts.map((p) => p.label ?? p.areaName).join('+')}`)).toEqual(['2 Freezer 1 · Lower left']);
  });
  it('an empty upstairs compartment is not a shortage; only collecting less downstairs is', () => {
    const empty = items({ 'pz-def': { requestedQty: 5, upstairsQty: 0 } });
    expect(stockOutcomes(collectionLines(collectPlacements('full', v.placements, none), empty), empty, v.byId).filter((o) => o.status !== 'not_topped_up')).toEqual([]);
    const short = items({ 'pz-def': { requestedQty: 5, upstairsQty: 0, collectedMode: 'partial', collectedQty: 1, shortfallReason: 'insufficient' } });
    expect(stockOutcomes(collectionLines(collectPlacements('full', v.placements, none), short), short, v.byId).map((o) => `${o.status} ${o.short}`)).toEqual(['low 4']);
  });
  it('labels: freezer spot, or a tidy storeroom name', () => {
    expect(defrostSource(v.byId.get('pz-def')!)).toBe('Freezer 1 · Lower left');
    expect(storeLabel('Walk in freezer(Downstairs)')).toBe('Downstairs walk-in freezer');
  });
});
