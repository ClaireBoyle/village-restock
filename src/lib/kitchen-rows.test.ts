import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { collectPlacements, collectionLines, departmentView, exceptions, isChecked, pendingRefills, summaryText, EMPTY_ITEM, type ItemState } from './restock-logic';

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
  it('a tick records the task only: nothing collected, nothing assumed used', () => {
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
