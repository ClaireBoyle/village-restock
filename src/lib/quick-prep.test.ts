import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { EMPTY_ITEM, collectionLines, departmentView, isChecked, isQuickPick, needOf, quickPlacements, type ItemState } from './restock-logic';
import { checklistGroups, type PrepTask } from './prep';

const cat: Catalogue = {
  version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [],
  departments: [{ id: 'k', name: 'Kitchen', shortName: 'Kitchen', groupLabel: '', theme: 'gold', icon: 'kitchen', description: '', sortOrder: 1 }],
  areas: [{ id: 'f1', departmentId: 'k', name: 'Freezer 1', guideText: '', guidePhotoPath: null, sortOrder: 1 }],
  locations: [{ id: 'down', name: 'Downstairs', sortOrder: 1 }],
  categories: [],
  products: [
    { id: 'ice', departmentId: 'k', categoryId: null, name: 'Vanilla Ice Cream', unitSingular: 'tub', unitPlural: 'tubs', method: 'par', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 1, affects: [], photoPath: null },
    { id: 'fries', departmentId: 'k', categoryId: null, name: 'Fries', unitSingular: 'bag', unitPlural: 'bags', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 2, affects: [], photoPath: null },
    { id: 'ara', departmentId: 'k', categoryId: null, name: 'Arancini', unitSingular: 'bag', unitPlural: 'bags', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 3, affects: [], photoPath: null },
  ],
  placements: [
    { id: 'p-ice', productId: 'ice', checkAreaId: 'f1', parLevel: 2, locationId: null, instructions: null, sortOrder: 1 },
    { id: 'p-fries', productId: 'fries', checkAreaId: 'f1', parLevel: null, locationId: null, instructions: null, sortOrder: 2 },
    { id: 'p-drawer', productId: 'ara', checkAreaId: 'f1', parLevel: null, locationId: null, instructions: null, sortOrder: 3, refillSource: 'Spare arancini' },
  ],
};
const view = departmentView(cat, 'k')!;
const items = (o: Record<string, Partial<ItemState>>) => new Map(Object.entries(o).map(([k, v]) => [k, { ...EMPTY_ITEM, ...v }]));

describe('Quick Restock: amount in each product row', () => {
  it('above zero is on the list, in the order added; zero or blank is off', () => {
    const m = items({ 'p-ice': { requestedQty: 2 }, 'p-fries': { requestedQty: 5 } });
    expect(quickPlacements(view, m, ['p-fries', 'p-ice']).map((p) => p.placementId)).toEqual(['p-fries', 'p-ice']);
    // Another device (nothing in its own order): the same list, as listed.
    expect(quickPlacements(view, m, []).map((p) => p.placementId)).toEqual(['p-ice', 'p-fries']);
    m.set('p-fries', { ...EMPTY_ITEM, requestedQty: null });
    expect(quickPlacements(view, m, ['p-fries', 'p-ice']).map((p) => p.placementId)).toEqual(['p-ice']);
  });

  it('a target-level product takes the amount needed directly (no shelf count) and is collected', () => {
    const p = view.byId.get('p-ice')!;
    const m = items({ 'p-ice': { requestedQty: 3 } });
    expect(needOf(p, m.get('p-ice')!)).toBe(3);
    expect(isChecked(p, m.get('p-ice')!)).toBe(true);
    expect(collectionLines([p], m).map((l) => `${l.total} ${l.unitPlural}`)).toEqual(['3 tubs']);
    // The full restock's shelf count still works as before.
    expect(needOf(p, { ...EMPTY_ITEM, currentQty: 0 })).toBe(2);
  });

  it('refill tasks are not picked by amount', () => {
    expect(view.placements.filter(isQuickPick).map((p) => p.productName)).toEqual(['Vanilla Ice Cream', 'Fries']);
    expect(quickPlacements(view, items({ 'p-drawer': { requestedQty: 2 } }), ['p-drawer'])).toEqual([]);
  });
});

describe('Prep checklist groups', () => {
  const t = (id: string, name: string, sortOrder: number, extra: Partial<PrepTask> = {}): PrepTask => ({ id, departmentId: 'k', group: 'sauces', name, sortOrder, onChecklist: true, ...extra });
  it('groups jobs by shelf in task order, with their short names; only jobs on the checklist', () => {
    const g = checklistGroups([
      t('a', 'Cut carrots for Harvest Hommus', 1, { group: 'vegetables', checklistGroup: 'Cut veg for Harvest Hommus', checklistName: 'Carrot' }),
      t('b', 'Portion BBQ sauce', 6, { checklistGroup: 'Portion sauces', checklistName: 'BBQ sauce' }),
      t('c', 'Make burger sauce', 11, { checklistGroup: 'Make sauces', checklistName: 'Burger sauce' }),
      t('d', 'Portion tomato sauce', 8, { checklistGroup: 'Portion sauces', checklistName: 'Tomato sauce' }),
      t('e', 'Portion lamb', 16, { group: 'proteins', onChecklist: false }),
      t('f', 'Make gravy', 20),
    ]);
    expect(g.map((x) => `${x.name}: ${x.tasks.map((y) => y.label).join(', ')}`)).toEqual([
      'Cut veg for Harvest Hommus: Carrot', 'Portion sauces: BBQ sauce, Tomato sauce', 'Make sauces: Burger sauce', 'Sauces: Make gravy',
    ]);
  });
});
