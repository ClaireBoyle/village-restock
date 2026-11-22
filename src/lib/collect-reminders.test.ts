import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { EMPTY_ITEM, collectPlacements, collectReminders, collectionLines, departmentView, gotAllUpdates, type AreaStatus, type ItemState } from './restock-logic';

// Gold Class Kitchen, cut down: burger patties in Freezer 1 (from downstairs, with what to take down), and pizza
// cheese as one prepared product in two places: frozen bags in Freezer 2 (a prep check), defrosted bags in the fridge
// (collected from Freezer 2, with where to reach).
const cat: Catalogue = {
  version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [],
  departments: [{ id: 'k', name: 'Gold Class Kitchen', shortName: 'Kitchen', groupLabel: '', theme: 'gold', icon: 'kitchen', description: '', sortOrder: 1 }],
  areas: [
    { id: 'f1', departmentId: 'k', name: 'Freezer 1', guideText: '', guidePhotoPath: null, sortOrder: 1 },
    { id: 'f2', departmentId: 'k', name: 'Freezer 2 · Check remaining spare stock', guideText: '', guidePhotoPath: null, sortOrder: 2 },
    { id: 'wf', departmentId: 'k', name: 'Walk in fridge · Fourth shelf', guideText: '', guidePhotoPath: null, sortOrder: 3 },
  ],
  locations: [{ id: 'down', name: 'Walk in freezer(Downstairs)', sortOrder: 3 }, { id: 'fz2', name: 'Freezer 2', sortOrder: 9 }],
  categories: [],
  prepTasks: [{ id: 't', departmentId: 'k', group: 'other', name: 'Portion pizza cheese into bags and freeze', sortOrder: 1, onChecklist: true }],
  products: [
    { id: 'pat', departmentId: 'k', categoryId: null, name: 'Beef Patties', unitSingular: 'tub', unitPlural: 'tubs', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 1, affects: [], photoPath: null,
      collectReminder: 'Take tubs and boxes for the burger patties' },
    { id: 'avo', departmentId: 'k', categoryId: null, name: 'Avocado (frozen)', unitSingular: 'pack', unitPlural: 'packs', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 2, affects: [], photoPath: null },
    { id: 'pz', departmentId: 'k', categoryId: null, name: 'Pizza cheese (portioned bags)', unitSingular: 'bag', unitPlural: 'bags', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'down', sortOrder: 3, affects: [], photoPath: null },
  ],
  placements: [
    { id: 'p-pat', productId: 'pat', checkAreaId: 'f1', parLevel: null, locationId: null, instructions: null, sortOrder: 1 },
    { id: 'p-avo', productId: 'avo', checkAreaId: 'f1', parLevel: null, locationId: null, instructions: null, sortOrder: 2 },
    { id: 'p-pz-frozen', productId: 'pz', checkAreaId: 'f2', parLevel: null, locationId: null, instructions: null, sortOrder: 1, prepTaskId: 't' },
    { id: 'p-pz-fridge', productId: 'pz', checkAreaId: 'wf', parLevel: null, locationId: 'fz2', instructions: null, sortOrder: 1, collectNote: 'Lower-right compartment, beside the zucchini wedges' },
  ],
} as unknown as Catalogue;
const view = departmentView(cat, 'k')!;
const items = (o: Record<string, Partial<ItemState>>) => new Map(Object.entries(o).map(([k, v]) => [k, { ...EMPTY_ITEM, ...v }]));
const done = new Map<string, AreaStatus>([['f1', 'complete'], ['f2', 'complete'], ['wf', 'complete']]);
const linesFor = (m: Map<string, ItemState>) => collectionLines(collectPlacements('full', view.placements, done), m);

describe('Collection list: what to take down', () => {
  it('Freezer 1 has enough patties: nothing to collect, no reminder', () => {
    const m = items({ 'p-avo': { requestedQty: 1 } });
    expect(collectReminders(linesFor(m), m)).toEqual([]);
  });

  it('patties needed from downstairs: the reminder, as written (no number when not confirmed)', () => {
    const m = items({ 'p-pat': { requestedQty: 2 }, 'p-avo': { requestedQty: 1 } });
    expect(collectReminders(linesFor(m), m)).toEqual([{ text: 'Take tubs and boxes for the burger patties', products: ['Beef Patties'] }]);
  });

  it('once the patties are collected, the reminder goes', () => {
    const m = items({ 'p-pat': { requestedQty: 2 } });
    const pat = linesFor(m).find((l) => l.productName === 'Beef Patties')!;
    for (const u of gotAllUpdates(pat)) m.set(u.placementId, { ...m.get(u.placementId)!, ...u.fields });
    expect(collectReminders(linesFor(m), m)).toEqual([]);
  });
});

describe('Pizza cheese: one prepared product in two places', () => {
  it('the fridge needs 3: one pickup of 3 bags from Freezer 2, with where to reach; the prep tick is not collected', () => {
    const m = items({ 'p-pz-fridge': { requestedQty: 3 }, 'p-pz-frozen': { requestedQty: 1 } });
    const pz = linesFor(m).filter((l) => l.productName === 'Pizza cheese (portioned bags)');
    expect(pz.map((l) => [l.total, l.unitPlural, l.locationName, l.collectNote, l.parts.map((p) => p.areaName)])).toEqual([
      [3, 'bags', 'Freezer 2', 'Lower-right compartment, beside the zucchini wedges', ['Walk in fridge · Fourth shelf']],
    ]);
  });

  it('Avocado (frozen): 1 pack from the downstairs walk-in freezer, for Freezer 1', () => {
    const m = items({ 'p-avo': { requestedQty: 1 } });
    expect(linesFor(m).map((l) => [l.productName, l.total, l.locationName, l.parts[0].areaName, l.collectNote ?? null])).toEqual([['Avocado (frozen)', 1, 'Walk in freezer(Downstairs)', 'Freezer 1', null]]);
  });
});
