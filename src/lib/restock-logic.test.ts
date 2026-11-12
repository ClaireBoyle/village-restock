import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import {
  EMPTY_ITEM, areaStatus, cardState, collectionLines, departmentView, exceptions, gotAllUpdates,
  gotFewerUpdates, groupByStoreroom, lineGot, lineState, needOf, summaryText, type AreaStatus, type ItemState,
} from './restock-logic';

// A tiny catalogue: Kitchen with Fridge 1 + Dry shelf; Bar fridge + Back shelf sharing one beer.
const cat: Catalogue = {
  version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5 },
  departments: [
    { id: 'k', name: 'Kitchen', shortName: 'Kitchen', groupLabel: '', theme: 'gold', icon: 'kitchen', description: '', sortOrder: 1 },
    { id: 'b', name: 'Bar', shortName: 'Bar', groupLabel: '', theme: 'gold', icon: 'bar', description: '', sortOrder: 2 },
  ],
  areas: [
    { id: 'f1', departmentId: 'k', name: 'Fridge 1', guideText: '', guidePhotoPath: null, sortOrder: 1 },
    { id: 'dry', departmentId: 'k', name: 'Dry shelf', guideText: '', guidePhotoPath: null, sortOrder: 2 },
    { id: 'bf', departmentId: 'b', name: 'Bar fridge', guideText: '', guidePhotoPath: null, sortOrder: 1 },
    { id: 'bs', departmentId: 'b', name: 'Back shelf', guideText: '', guidePhotoPath: null, sortOrder: 2 },
  ],
  locations: [
    { id: 'cool', name: 'Coolroom', sortOrder: 2 },
    { id: 'dryst', name: 'Dry Storage', sortOrder: 1 },
    { id: 'alc', name: 'Alcohol Storeroom', sortOrder: 3 },
  ],
  categories: [],
  products: [
    { id: 'tom', departmentId: 'k', categoryId: null, name: 'Tomatoes', unitSingular: 'tomato', unitPlural: 'tomatoes', method: 'par', allowDecimal: false, instructions: '', defaultLocationId: 'cool', sortOrder: 1 },
    { id: 'cloth', departmentId: 'k', categoryId: null, name: 'Cloths', unitSingular: 'pack', unitPlural: 'packs', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'dryst', sortOrder: 2 },
    { id: 'sauce', departmentId: 'k', categoryId: null, name: 'Sauce', unitSingular: 'bottle', unitPlural: 'bottles', method: 'par', allowDecimal: false, instructions: '', defaultLocationId: 'dryst', sortOrder: 3 },
    { id: 'beer', departmentId: 'b', categoryId: null, name: 'Pale Ale', unitSingular: 'bottle', unitPlural: 'bottles', method: 'par', allowDecimal: false, instructions: '', defaultLocationId: 'alc', sortOrder: 1 },
    { id: 'glass', departmentId: 'b', categoryId: null, name: 'Glasses', unitSingular: 'rack', unitPlural: 'racks', method: 'routine', allowDecimal: false, instructions: 'Refill the rack', defaultLocationId: 'alc', sortOrder: 2 },
  ],
  placements: [
    { id: 'p-tom', productId: 'tom', checkAreaId: 'f1', parLevel: 8, locationId: null, instructions: null, sortOrder: 1 },
    { id: 'p-cloth', productId: 'cloth', checkAreaId: 'dry', parLevel: null, locationId: null, instructions: null, sortOrder: 1 },
    { id: 'p-sauce', productId: 'sauce', checkAreaId: 'dry', parLevel: 4, locationId: null, instructions: null, sortOrder: 2 },
    { id: 'p-beer-f', productId: 'beer', checkAreaId: 'bf', parLevel: 12, locationId: null, instructions: null, sortOrder: 1 },
    { id: 'p-glass', productId: 'glass', checkAreaId: 'bf', parLevel: null, locationId: null, instructions: null, sortOrder: 2 },
    { id: 'p-beer-s', productId: 'beer', checkAreaId: 'bs', parLevel: 6, locationId: null, instructions: null, sortOrder: 1 },
  ],
};

const kitchen = departmentView(cat, 'k')!;
const bar = departmentView(cat, 'b')!;
const items = (o: Record<string, Partial<ItemState>>) => new Map(Object.entries(o).map(([k, v]) => [k, { ...EMPTY_ITEM, ...v }]));
const P = (v: typeof kitchen, id: string) => v.byId.get(id)!;

describe('department view', () => {
  it('lists areas in checking order with their products', () => {
    expect(kitchen.areas.map((a) => a.area.name)).toEqual(['Fridge 1', 'Dry shelf']);
    expect(kitchen.areas[1].placements.map((p) => p.productName)).toEqual(['Cloths', 'Sauce']);
    expect(P(kitchen, 'p-tom').locationName).toBe('Coolroom');
  });
});

describe('cards', () => {
  it('par: 2 of 8 needs 6 and shows amber; 10 of 8 shows green', () => {
    const p = P(kitchen, 'p-tom');
    expect(needOf(p, { ...EMPTY_ITEM, currentQty: 2 })).toBe(6);
    expect(cardState(p, { ...EMPTY_ITEM, currentQty: 2 })).toBe('warn');
    expect(cardState(p, { ...EMPTY_ITEM, currentQty: 10 })).toBe('ok');
  });
  it('blank is not checked (grey), 0 is checked', () => {
    const p = P(kitchen, 'p-tom');
    expect(cardState(p, EMPTY_ITEM)).toBe('none');
    expect(cardState(p, { ...EMPTY_ITEM, currentQty: 0 })).toBe('warn');
  });
  it('manual products use what staff ask for', () => {
    expect(needOf(P(kitchen, 'p-cloth'), { ...EMPTY_ITEM, requestedQty: 2 })).toBe(2);
    expect(cardState(P(kitchen, 'p-cloth'), { ...EMPTY_ITEM, requestedQty: 0 })).toBe('ok');
  });
});

describe('areas', () => {
  it('derives in progress from checked cards, and keeps complete/skipped', () => {
    const ps = kitchen.areas[1].placements;
    expect(areaStatus(undefined, ps, items({}))).toBe('not_started');
    expect(areaStatus(undefined, ps, items({ 'p-sauce': { currentQty: 1 } }))).toBe('in_progress');
    expect(areaStatus('complete', ps, items({}))).toBe('complete');
    expect(areaStatus('skipped', ps, items({}))).toBe('skipped');
  });
});

describe('collection list (brief scenario 6: grouped by storeroom)', () => {
  it('groups by storeroom in admin order and leaves out stocked items', () => {
    const it = items({ 'p-tom': { currentQty: 2 }, 'p-cloth': { requestedQty: 1 }, 'p-sauce': { currentQty: 4 } });
    const groups = groupByStoreroom(collectionLines(kitchen.placements, it), kitchen.locationOrder);
    expect(groups.map((g) => g.name)).toEqual(['Dry Storage', 'Coolroom']);
    expect(groups[0].lines.map((l) => [l.productName, l.total])).toEqual([['Cloths', 1]]);
    expect(groups[1].lines.map((l) => [l.productName, l.total])).toEqual([['Tomatoes', 6]]);
  });
  it('combines the same product from two areas, keeping each amount', () => {
    const it = items({ 'p-beer-f': { currentQty: 6 }, 'p-beer-s': { currentQty: 1 } });
    const lines = collectionLines(bar.placements, it);
    expect(lines).toHaveLength(1);
    expect(lines[0].total).toBe(11);
    expect(lines[0].parts.map((p) => [p.areaName, p.need])).toEqual([['Bar fridge', 6], ['Back shelf', 5]]);
  });
  it('routine tasks appear only when marked needed', () => {
    expect(collectionLines(bar.placements, items({ 'p-glass': { routineChoice: 'not_needed' } }))).toHaveLength(0);
    const l = collectionLines(bar.placements, items({ 'p-glass': { routineChoice: 'needed' } }));
    expect(l[0].kind).toBe('task');
  });
});

describe('collecting (brief scenario 7: fewer than requested)', () => {
  const it0 = items({ 'p-beer-f': { currentQty: 6 }, 'p-beer-s': { currentQty: 1 } });
  const line = collectionLines(bar.placements, it0)[0];
  const apply = (base: Map<string, ItemState>, ups: { placementId: string; fields: Partial<ItemState> }[]) => {
    const m = new Map(base);
    for (const u of ups) m.set(u.placementId, { ...m.get(u.placementId)!, ...u.fields });
    return m;
  };
  it('got all marks the line done', () => {
    const m = apply(it0, gotAllUpdates(line));
    expect(lineState(line, m)).toBe('done');
    expect(lineGot(line, m)).toBe(11);
  });
  it('got fewer shares the amount across areas in order, and needs a reason', () => {
    const ups = gotFewerUpdates(line, 8, null, false);
    expect(ups.map((u) => u.fields.collectedQty)).toEqual([6, 2]);
    const m = apply(it0, ups);
    expect(lineGot(line, m)).toBe(8);
    expect(lineState(line, m)).toBe('part');
    expect(lineState(line, apply(it0, gotFewerUpdates(line, 8, 'insufficient', false)))).toBe('short');
  });
});

describe('finishing', () => {
  const recorded = (o: Record<string, AreaStatus>) => new Map(Object.entries(o));
  it('lists incomplete areas and uncollected items as exceptions', () => {
    const ex = exceptions({ kind: 'full', view: kitchen, placements: kitchen.placements, recordedAreas: recorded({}), items: items({ 'p-tom': { currentQty: 2 } }) });
    expect(ex.map((e) => e.text)).toEqual(['Fridge 1 not complete', 'Dry shelf not complete', '1 item not fully collected']);
  });
  it('a confirmed storeroom shortage is not an exception (scenario 8 is reported, not blocked)', () => {
    const base = items({ 'p-tom': { currentQty: 2 }, 'p-cloth': { requestedQty: 0 }, 'p-sauce': { currentQty: 4 } });
    const line = collectionLines(kitchen.placements, base)[0];
    const m = new Map(base);
    for (const u of gotFewerUpdates(line, 4, 'insufficient', false)) m.set(u.placementId, { ...m.get(u.placementId)!, ...u.fields });
    const ex = exceptions({ kind: 'full', view: kitchen, placements: kitchen.placements, recordedAreas: recorded({ f1: 'complete', dry: 'complete' }), items: m });
    expect(ex).toEqual([]);
    const text = summaryText({ departmentName: 'Kitchen', kind: 'full', finishedLabel: '11:40 pm', exceptionReason: null, people: ['Sam'],
      view: kitchen, placements: kitchen.placements, recordedAreas: recorded({ f1: 'complete', dry: 'complete' }), skipReasons: new Map(), items: m, dateLabel: 'Thu 12 Nov' });
    expect(text).toContain('Tomatoes: short 2 tomatoes (needed 6, got 4)');
    expect(text).toContain('Status: Complete');
  });
  it('quick restock only needs its own list (scenario 9)', () => {
    const quick = [P(kitchen, 'p-tom')];
    expect(exceptions({ kind: 'quick', view: kitchen, placements: quick, recordedAreas: recorded({}), items: items({}) })[0].text)
      .toBe('1 product without a number');
    const done = items({ 'p-tom': { currentQty: 8 } });
    expect(exceptions({ kind: 'quick', view: kitchen, placements: quick, recordedAreas: recorded({}), items: done })).toEqual([]);
  });
  it('skipped areas are left out of collecting and reported', () => {
    const ex = exceptions({ kind: 'full', view: kitchen, placements: kitchen.placements, recordedAreas: recorded({ f1: 'skipped', dry: 'complete' }),
      items: items({ 'p-tom': { currentQty: 0 }, 'p-cloth': { requestedQty: 0 }, 'p-sauce': { currentQty: 4 } }) });
    expect(ex.map((e) => e.text)).toEqual(['Fridge 1 skipped']);
  });
});
