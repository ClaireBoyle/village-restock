import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { collectPlacements, collectionLines, departmentView, exceptions, prepFromStock, prepNeedText, EMPTY_ITEM, type ItemState } from './restock-logic';
import { prepLines, sortedItems, type PrepItem } from './prep';

// Kitchen walk-in: cut carrot (made in morning prep) next to brie (collected from downstairs).
const cat: Catalogue = {
  version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [],
  departments: [{ id: 'k', name: 'Gold Class Kitchen', shortName: 'Kitchen', groupLabel: '', theme: 'gold', icon: 'kitchen', description: '', sortOrder: 1 }],
  areas: [{ id: 'walk', departmentId: 'k', name: 'Walk in fridge', guideText: '', guidePhotoPath: null, sortOrder: 1 }],
  locations: [{ id: 'down', name: 'Walk in fridge(Downstairs)', sortOrder: 1 }],
  categories: [],
  products: [
    { id: 'carrot', departmentId: 'k', categoryId: null, name: 'Cut Carrot', unitSingular: 'tub', unitPlural: 'tubs', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 1, affects: [], photoPath: null },
    { id: 'brie', departmentId: 'k', categoryId: null, name: 'Brie', unitSingular: 'pack', unitPlural: 'packs', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 2, affects: [], photoPath: null },
  ],
  placements: [
    { id: 'p-carrot', productId: 'carrot', checkAreaId: 'walk', parLevel: null, locationId: null, instructions: null, sortOrder: 1, prepTaskId: 't-carrot' },
    { id: 'p-brie', productId: 'brie', checkAreaId: 'walk', parLevel: null, locationId: null, instructions: null, sortOrder: 2 },
  ],
  prepTasks: [{ id: 't-carrot', departmentId: 'k', group: 'vegetables', name: 'Cut carrots for Harvest Hommus', sortOrder: 1 }],
};
const view = departmentView(cat, 'k')!;
const items = (o: Record<string, Partial<ItemState>>) => new Map(Object.entries(o).map(([k, v]) => [k, { ...EMPTY_ITEM, ...v }]));
const none = new Map();

describe('stock made in morning prep', () => {
  const it2 = items({ 'p-carrot': { requestedQty: 2 }, 'p-brie': { requestedQty: 1 } });
  it('is never on the downstairs collection list (brie still is)', () => {
    const lines = collectionLines(collectPlacements('full', view.placements, none), it2);
    expect(lines.map((l) => l.productName)).toEqual(['Brie']);
  });
  it('is not outstanding work when finishing', () => {
    const ex = exceptions({ kind: 'full', view, placements: view.placements, recordedAreas: none, items: items({ 'p-carrot': { requestedQty: 2 } }) });
    expect(ex).toEqual([]);
  });
  it('an amount entered to prepare is the amount for its task', () => {
    const hints = prepFromStock('full', view.placements, none, it2);
    expect(hints.get('t-carrot')).toEqual([{ kind: 'need', text: '2 tubs', productName: 'Cut Carrot' }]);
    expect(prepNeedText(hints.get('t-carrot'))).toBe('2 tubs');
    expect(prepFromStock('full', view.placements, none, items({})).size).toBe(0);
  });
  it('stock on hand (a count) is context only: never an amount to prepare', () => {
    const counted = departmentView({ ...cat, products: cat.products.map((p) => (p.id === 'carrot' ? { ...p, method: 'par' as const } : p)),
      placements: cat.placements.map((pl) => (pl.id === 'p-carrot' ? { ...pl, parLevel: 4 } : pl)) }, 'k')!;
    const hints = prepFromStock('full', counted.placements, none, items({ 'p-carrot': { currentQty: 1 } }));
    expect(hints.get('t-carrot')).toEqual([{ kind: 'context', text: '1 tub on hand', productName: 'Cut Carrot' }]);
    expect(prepNeedText(hints.get('t-carrot'))).toBeNull();
  });
  it('a link to a task that is gone is ignored (collected as usual)', () => {
    const v = departmentView({ ...cat, prepTasks: [] }, 'k')!;
    expect(collectionLines(collectPlacements('full', v.placements, none), it2).map((l) => l.productName)).toEqual(['Cut Carrot', 'Brie']);
  });
});

describe('the handover', () => {
  const mk = (name: string, group: PrepItem['group'], extra: Partial<PrepItem> = {}): PrepItem => ({ id: name, taskId: null, group, name, qty: null, note: null, doneAt: null, doneBy: null, ...extra });
  it('lists tasks by group, then in the order chosen', () => {
    const list = [mk('Make tartare', 'sauces'), mk('Wipe the slicer', 'other'), mk('Cut radish for Harvest Hommus', 'vegetables'), mk('Portion defrosted pulled beef', 'proteins'), mk('Cut carrots for Harvest Hommus', 'vegetables')];
    expect(sortedItems(list).map((i) => i.name)).toEqual(['Cut radish for Harvest Hommus', 'Cut carrots for Harvest Hommus', 'Portion defrosted pulled beef', 'Make tartare', 'Wipe the slicer']);
  });
  it('one line per task with its amount and note; "No morning prep needed" when none', () => {
    expect(prepLines({ status: 'needed', items: [mk('Make tartare', 'sauces', { qty: '2 tubs', note: 'Use the new recipe' }), mk('Make burger sauce', 'sauces', { doneAt: 'x' })] }))
      .toEqual(['Make tartare · 2 tubs · Use the new recipe', 'Make burger sauce (done)']);
    expect(prepLines({ status: 'none', items: [] })).toEqual(['No morning prep needed']);
    expect(prepLines(null)).toEqual([]);
  });
});
