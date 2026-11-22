import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { EMPTY_ITEM, collectionLines, departmentView, lineGroups, type ItemState } from './restock-logic';

const base = { version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [] };
const prod = (id: string, name: string, categoryId: string | null) => ({ id, departmentId: 'd', categoryId, name, unitSingular: 'bottle', unitPlural: 'bottles', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'store', sortOrder: 1, affects: [], photoPath: null });
const items = (ids: string[]) => new Map(ids.map((id) => [id, { ...EMPTY_ITEM, requestedQty: 1 } as ItemState]));

describe('Collection list groups: by type', () => {
  const cat = {
    ...base,
    departments: [{ id: 'd', name: 'Gold Class Bar', shortName: 'Bar', groupLabel: '', theme: 'gold', icon: 'bar', description: '', sortOrder: 1, collectGroup: 'type' }],
    areas: [{ id: 'bench', departmentId: 'd', name: 'Back bench', guideText: '', guidePhotoPath: null, sortOrder: 1 }],
    locations: [{ id: 'store', name: 'Alcohol storeroom', sortOrder: 1 }],
    categories: [
      { id: 'beer', departmentId: 'd', name: 'Beer', sortOrder: 1, collectGroup: 'Beer, cider & hard soda' },
      { id: 'red', departmentId: 'd', name: 'Red Wine', sortOrder: 2, collectGroup: 'Wine' },
      { id: 'vodka', departmentId: 'd', name: 'Vodka', sortOrder: 3, collectGroup: 'Spirits' },
      { id: 'white', departmentId: 'd', name: 'White Wine', sortOrder: 4, collectGroup: 'Wine' },
      { id: 'rum', departmentId: 'd', name: 'Rum', sortOrder: 5, collectGroup: 'Spirits' },
      { id: 'syr', departmentId: 'd', name: 'Syrups', sortOrder: 6 },
    ],
    products: [prod('a', 'Bacardi', 'rum'), prod('b', 'Sauvignon Blanc', 'white'), prod('c', 'Grey Goose', 'vodka'), prod('e', 'Shiraz', 'red'), prod('f', 'Vanilla Syrup', 'syr'), prod('g', 'Napkins', null)],
    placements: ['a', 'b', 'c', 'e', 'f', 'g'].map((p, i) => ({ id: `p-${p}`, productId: p, checkAreaId: 'bench', parLevel: null, locationId: null, instructions: null, sortOrder: i })),
  } as unknown as Catalogue;
  const view = departmentView(cat, 'd')!;
  it('broader types in category order; each category together inside; untyped last as Other', () => {
    const lines = collectionLines(view.placements, items(view.placements.map((p) => p.placementId)));
    expect(lineGroups(lines, view, 'type').map((g) => [g.label, g.lines.map((l) => l.productName)])).toEqual([
      ['Wine', ['Shiraz', 'Sauvignon Blanc']],
      ['Spirits', ['Grey Goose', 'Bacardi']],
      ['Syrups', ['Vanilla Syrup']],
      ['Other', ['Napkins']],
    ]);
  });
});

describe('Collection list groups: by where it is going', () => {
  const cat = {
    ...base,
    departments: [{ id: 'd', name: 'Gold Class Kitchen', shortName: 'Kitchen', groupLabel: '', theme: 'gold', icon: 'kitchen', description: '', sortOrder: 1, collectGroup: 'area' }],
    areas: [
      { id: 'def', departmentId: 'd', name: 'Defrost', guideText: '', guidePhotoPath: null, sortOrder: 1 },
      { id: 'f1', departmentId: 'd', name: 'Freezer 1', guideText: '', guidePhotoPath: null, sortOrder: 2 },
      { id: 'f1ur', departmentId: 'd', name: 'Freezer 1 · Upper right', guideText: '', guidePhotoPath: null, sortOrder: 3, parentAreaId: 'f1' },
      { id: 'f2', departmentId: 'd', name: 'Freezer 2', guideText: '', guidePhotoPath: null, sortOrder: 4 },
    ],
    locations: [{ id: 'store', name: 'Walk in freezer(Downstairs)', sortOrder: 1 }],
    categories: [],
    products: [prod('pat', 'Beef Patties', null), prod('fries', 'Fries', null), prod('cake', 'Basque Cheesecake', null)],
    placements: [
      { id: 'p-fries', productId: 'fries', checkAreaId: 'f2', parLevel: null, locationId: null, instructions: null, sortOrder: 1 },
      { id: 'p-pat', productId: 'pat', checkAreaId: 'f1ur', parLevel: null, locationId: null, instructions: null, sortOrder: 1 },
      { id: 'p-cake', productId: 'cake', checkAreaId: 'def', parLevel: null, locationId: null, instructions: null, sortOrder: 1, putNote: 'Upstairs walk-in fridge' },
    ],
  } as unknown as Catalogue;
  const view = departmentView(cat, 'd')!;
  it('in walk order: To defrost, then For each freezer (a compartment counts for its freezer)', () => {
    const lines = collectionLines(view.placements, items(['p-fries', 'p-pat', 'p-cake']));
    expect(lineGroups(lines, view, 'area').map((g) => [g.label, g.areaName, g.lines.map((l) => l.productName)])).toEqual([
      ['To defrost', 'Defrost', ['Basque Cheesecake']],
      ['For Freezer 1', 'Freezer 1', ['Beef Patties']],
      ['For Freezer 2', 'Freezer 2', ['Fries']],
    ]);
  });
});
