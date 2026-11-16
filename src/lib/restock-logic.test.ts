import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { activePlacements, areaNotes, isRequired, scopeView,
  EMPTY_ITEM, areaStatus, cardState, isChecked, collectionLines, departmentView, exceptions, gotAllUpdates,
  gotFewerUpdates, groupByStoreroom, lineGot, lineState, needOf, stockOutcomes, summaryText, type AreaStatus, type ItemState,
} from './restock-logic';

// A tiny catalogue: Kitchen with Fridge 1 + Dry shelf; Bar fridge + Back shelf sharing one beer.
const cat: Catalogue = {
  version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [],
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
    { id: 'tom', departmentId: 'k', categoryId: null, name: 'Tomatoes', unitSingular: 'tomato', unitPlural: 'tomatoes', method: 'par', allowDecimal: false, instructions: '', defaultLocationId: 'cool', sortOrder: 1, affects: [], photoPath: null },
    { id: 'cloth', departmentId: 'k', categoryId: null, name: 'Cloths', unitSingular: 'pack', unitPlural: 'packs', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'dryst', sortOrder: 2, affects: [], photoPath: null },
    { id: 'sauce', departmentId: 'k', categoryId: null, name: 'Sauce', unitSingular: 'bottle', unitPlural: 'bottles', method: 'par', allowDecimal: false, instructions: '', defaultLocationId: 'dryst', sortOrder: 3, affects: [], photoPath: null },
    { id: 'beer', departmentId: 'b', categoryId: null, name: 'Pale Ale', unitSingular: 'bottle', unitPlural: 'bottles', method: 'par', allowDecimal: false, instructions: '', defaultLocationId: 'alc', sortOrder: 1, affects: ['Pale Ale Tasting Paddle'], photoPath: null },
    { id: 'glass', departmentId: 'b', categoryId: null, name: 'Glasses', unitSingular: 'rack', unitPlural: 'racks', method: 'routine', allowDecimal: false, instructions: 'Refill the rack', defaultLocationId: 'alc', sortOrder: 2, affects: [], photoPath: null },
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

describe('clashes between two people', () => {
  const p = () => P(kitchen, 'p-tom');
  const clash = { field: 'currentQty' as const, theirs: 3, theirsBy: 'Jess', theirsAt: null, mine: 5, mineBy: 'Sam', mineAt: null };
  it('a product with two different counts is not checked and shows red', () => {
    expect(isChecked(p(), { ...EMPTY_ITEM, currentQty: 3, conflict: clash })).toBe(false);
    expect(cardState(p(), { ...EMPTY_ITEM, currentQty: 3, conflict: clash })).toBe('bad');
  });
  it('blocks a clean finish even if its area was marked complete', () => {
    const it = items({ 'p-tom': { currentQty: 8, conflict: clash }, 'p-cloth': { requestedQty: 0 }, 'p-sauce': { currentQty: 4 } });
    const ex = exceptions({ kind: 'full', view: kitchen, placements: kitchen.placements, recordedAreas: new Map([['f1', 'complete'], ['dry', 'complete']]), items: it });
    expect(ex.map((e) => e.text)).toEqual(['1 product needs a decision']);
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

describe('stock after the restock (what we are low on / out of)', () => {
  const base = items({ 'p-beer-f': { currentQty: 6 }, 'p-beer-s': { currentQty: 1 } });
  const line = collectionLines(bar.placements, base)[0];
  const apply = (ups: { placementId: string; fields: Partial<ItemState> }[]) => {
    const m = new Map(base);
    for (const u of ups) m.set(u.placementId, { ...m.get(u.placementId)!, ...u.fields });
    return m;
  };
  it('storeroom had none: out of stock, with what is left on the shelf', () => {
    const [o] = stockOutcomes([line], apply(gotFewerUpdates(line, 0, 'insufficient', false)), bar.byId);
    expect(o.status).toBe('out');
    expect([o.onShelf, o.target]).toEqual([7, 18]);
    expect(o.affects).toEqual(['Pale Ale Tasting Paddle']);
  });
  it('storeroom had some: running low', () => {
    const [o] = stockOutcomes([line], apply(gotFewerUpdates(line, 8, 'insufficient', true)), bar.byId);
    expect([o.status, o.got, o.short, o.onShelf, o.flagged]).toEqual(['low', 8, 3, 15, true]);
  });
  it('ran out of time: not topped up (not a storeroom shortage)', () => {
    const [o] = stockOutcomes([line], apply(gotFewerUpdates(line, 5, 'time', false)), bar.byId);
    expect(o.status).toBe('not_topped_up');
  });
  it('fully collected lines are not listed', () => {
    expect(stockOutcomes([line], apply(gotAllUpdates(line)), bar.byId)).toEqual([]);
  });
});

describe('finishing', () => {
  const recorded = (o: Record<string, AreaStatus>) => new Map(Object.entries(o));
  it('lists incomplete areas and uncollected items as exceptions', () => {
    const ex = exceptions({ kind: 'full', view: kitchen, placements: kitchen.placements, recordedAreas: recorded({}), items: items({ 'p-tom': { currentQty: 2 } }) });
    expect(ex.map((e) => e.text)).toEqual(['Dry shelf: 1 target count missing', '1 item not fully collected']);
  });
  it('exception-based: a blank "staff enter" product does not block finishing, a missing target count does', () => {
    // Cloths (staff enter) left blank, Sauce (target level) counted, Tomatoes counted and collected
    const base = items({ 'p-tom': { currentQty: 8 }, 'p-sauce': { currentQty: 4 } });
    expect(exceptions({ kind: 'full', view: kitchen, placements: kitchen.placements, recordedAreas: recorded({}), items: base })).toEqual([]);
    // Blank stays "not entered", different from 0 ("checked, nothing needed")
    const cloth = kitchen.byId.get('p-cloth')!;
    expect(isChecked(cloth, base.get('p-cloth') ?? EMPTY_ITEM)).toBe(false);
    expect(isChecked(cloth, { ...EMPTY_ITEM, requestedQty: 0 })).toBe(true);
    // Quick restock: a blank target-level product still needs a number
    const q = exceptions({ kind: 'quick', view: kitchen, placements: [kitchen.byId.get('p-sauce')!, cloth], recordedAreas: recorded({}), items: items({}) });
    expect(q.map((e) => e.text)).toEqual(['1 product without a number']);
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
    expect(text).toContain('RUNNING LOW (1)');
    expect(text).toContain('Tomatoes: only 4 tomatoes in the storeroom, short 2 tomatoes · 6 of 8 on the shelf');
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

describe('areaNotes', () => {
  const pv = (id: string, instructions: string, method: 'manual' | 'routine' = 'manual') => ({
    placementId: id, productId: id, areaId: 'a', areaName: 'Stand', productName: id, unitSingular: 'pack', unitPlural: 'packs',
    method, par: null, allowDecimal: false, locationId: null, locationName: null, instructions, categoryName: null, affects: [], photoPath: null, screenAreaId: 'a', optional: false,
  });
  it('shows text repeated on several products once for the area', () => {
    const general = 'Check both sides of the stand and enter the total.';
    const r = areaNotes([pv('a', general), pv('b', ` ${general}`), pv('c', general.toUpperCase()), pv('d', 'Keep away from heat lamp'), pv('e', '')]);
    expect(r.shared).toEqual([general]);
    expect([...r.own.entries()]).toEqual([['d', 'Keep away from heat lamp']]);
  });
  it('keeps product-specific notes on the product', () => {
    const r = areaNotes([pv('a', 'Rotate stock'), pv('b', 'Check use-by'), pv('c', '')]);
    expect(r.shared).toEqual([]);
    expect(r.own.size).toBe(2);
  });
  it('treats a note on every product of a small area as general', () => {
    const r = areaNotes([pv('a', 'Face forward'), pv('b', 'Face forward')]);
    expect(r.shared).toEqual(['Face forward']);
    expect(r.own.size).toBe(0);
  });
  it('never moves a routine task’s instruction (it is the task itself)', () => {
    const r = areaNotes([pv('a', 'Do it', 'routine'), pv('b', 'Do it', 'routine'), pv('c', 'Do it', 'routine')]);
    expect(r.shared).toEqual([]);
  });
});

describe('area sections (Back bench + Other FOH spirits + optional Spirits cupboard)', () => {
  const recorded = (o: Record<string, AreaStatus>) => new Map(Object.entries(o));
  const bar: Catalogue = {
    version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [],
    departments: [{ id: 'gb', name: 'Gold Class Bar', shortName: 'Bar', groupLabel: '', theme: 'gold', icon: 'bar', description: '', sortOrder: 1 }],
    areas: [
      { id: 'bench', departmentId: 'gb', name: 'Back bench', guideText: '', guidePhotoPath: null, sortOrder: 1 },
      { id: 'foh', departmentId: 'gb', name: 'Other FOH spirits', guideText: '', guidePhotoPath: null, sortOrder: 2, parentAreaId: 'bench', sectionMode: 'collapsed' },
      { id: 'cup', departmentId: 'gb', name: 'Spirits cupboard', guideText: '', guidePhotoPath: null, sortOrder: 3, parentAreaId: 'bench', sectionMode: 'optional' },
      { id: 'fridge', departmentId: 'gb', name: 'Bar fridge', guideText: '', guidePhotoPath: null, sortOrder: 4 },
    ],
    locations: [{ id: 'alc', name: 'Alcohol storeroom', sortOrder: 1 }],
    categories: [],
    products: [
      { id: 'jim', departmentId: 'gb', categoryId: null, name: 'Jim Beam', unitSingular: 'bottle', unitPlural: 'bottles', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'alc', sortOrder: 1, affects: [], photoPath: null },
      { id: 'gin', departmentId: 'gb', categoryId: null, name: 'Hendrick’s', unitSingular: 'bottle', unitPlural: 'bottles', method: 'manual', allowDecimal: false, instructions: '', defaultLocationId: 'alc', sortOrder: 2, affects: [], photoPath: null },
      { id: 'cpar', departmentId: 'gb', categoryId: null, name: 'Cupboard par item', unitSingular: 'bottle', unitPlural: 'bottles', method: 'par', allowDecimal: false, instructions: '', defaultLocationId: 'alc', sortOrder: 3, affects: [], photoPath: null },
    ],
    placements: [
      { id: 'jim-bench', productId: 'jim', checkAreaId: 'bench', parLevel: null, locationId: null, instructions: null, sortOrder: 1 },
      { id: 'gin-foh', productId: 'gin', checkAreaId: 'foh', parLevel: null, locationId: null, instructions: null, sortOrder: 1 },
      { id: 'jim-cup', productId: 'jim', checkAreaId: 'cup', parLevel: null, locationId: null, instructions: null, sortOrder: 1 },
      { id: 'cpar-cup', productId: 'cpar', checkAreaId: 'cup', parLevel: 6, locationId: null, instructions: null, sortOrder: 2 },
    ],
  };
  const v = departmentView(bar, 'gb')!;
  it('sections sit inside the Back bench screen, not as separate areas', () => {
    expect(v.areas.map((a) => a.area.name)).toEqual(['Back bench', 'Bar fridge']);
    const bench = v.areas[0];
    expect(bench.own.map((p) => p.productName)).toEqual(['Jim Beam']);
    expect(bench.sections.map((x) => [x.area.name, x.mode])).toEqual([['Other FOH spirits', 'collapsed'], ['Spirits cupboard', 'optional']]);
    expect(bench.placements.every((p) => p.screenAreaId === 'bench')).toBe(true);
  });
  it('the same product in Back bench and the cupboard is one collection line from the Alcohol storeroom', () => {
    const lines = collectionLines(v.placements, items({ 'jim-bench': { requestedQty: 2 }, 'jim-cup': { requestedQty: 3 } }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productName: 'Jim Beam', total: 5, locationName: 'Alcohol storeroom' });
    expect(lines[0].parts.map((x) => [x.areaName, x.need])).toEqual([['Back bench', 2], ['Spirits cupboard', 3]]);
  });
  it('the optional cupboard is never required, even for target-level products', () => {
    const cupPar = v.byId.get('cpar-cup')!;
    expect(cupPar.optional).toBe(true);
    expect(isRequired(cupPar)).toBe(false);
    expect(exceptions({ kind: 'full', view: v, placements: v.placements, recordedAreas: recorded({}), items: items({}) })).toEqual([]);
  });
  it('skipping Back bench also skips its sections', () => {
    expect(activePlacements('full', v.placements, recorded({ bench: 'skipped' })).map((p) => p.placementId)).toEqual([]);
  });
});


describe('area restocks (Candy Bar: each area on its own)', () => {
  const recorded = (o: Record<string, AreaStatus>) => new Map(Object.entries(o));
  const dry = scopeView(kitchen, 'dry');
  it('scopes the view, products and collection list to one area', () => {
    expect(dry.areas.map((a) => a.area.name)).toEqual(['Dry shelf']);
    expect(dry.placements.map((p) => p.productName)).toEqual(['Cloths', 'Sauce']);
    expect(dry.byId.has('p-tom')).toBe(false);
    const m = items({ 'p-tom': { currentQty: 2 }, 'p-cloth': { requestedQty: 3 } });
    expect(collectionLines(dry.placements, m).map((l) => l.productName)).toEqual(['Cloths']);
  });
  it('only that area\'s target counts and collecting count towards finishing', () => {
    // Fridge 1 untouched: not this restock's business
    const m = items({ 'p-sauce': { currentQty: 4 }, 'p-cloth': { requestedQty: 1, collectedMode: 'all', collectedQty: 1 } });
    expect(exceptions({ kind: 'area', view: dry, placements: dry.placements, recordedAreas: recorded({}), items: m })).toEqual([]);
    expect(exceptions({ kind: 'area', view: dry, placements: dry.placements, recordedAreas: recorded({}), items: items({}) }).map((e) => e.text))
      .toEqual(['Dry shelf: 1 target count missing']);
  });
  it('untouched staff-enter products are not "not checked" in the summary', () => {
    const m = items({ 'p-sauce': { currentQty: 4 } });
    const text = summaryText({ departmentName: 'Kitchen', kind: 'area', finishedLabel: '9:00 pm', exceptionReason: null, people: [],
      view: dry, placements: dry.placements, recordedAreas: recorded({}), skipReasons: new Map(), items: m, dateLabel: 'Mon 16 Nov' });
    expect(text).toContain('Dry shelf restock');
    expect(text).not.toContain('NOT CHECKED');
    expect(text).not.toContain('Cloths');
  });
  it('a storeroom reminder is available by storeroom', () => {
    const v = departmentView({ ...cat, locations: cat.locations.map((l) => (l.id === 'dryst' ? { ...l, collectNote: ' Use opened boxes first. ' } : l)) }, 'k')!;
    expect(v.locationNotes.get('dryst')).toBe('Use opened boxes first.');
    expect(v.locationNotes.has('cool')).toBe(false);
  });
});
