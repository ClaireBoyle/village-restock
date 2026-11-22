import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { activePlacements, areaNotes, isRequired, scopeView, outcomeLine, shortageCount, shortStatus, collectPlacements, phaseAreas, refillLines, suggestions, usesRefill, withSuggestions,
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
  it('a recorded "couldn\'t access stock" result does not block finishing and is not a stock shortage', () => {
    const base = items({ 'p-tom': { currentQty: 2 }, 'p-cloth': { requestedQty: 0 }, 'p-sauce': { currentQty: 4 } });
    const line = collectionLines(kitchen.placements, base)[0];
    const m = new Map(base);
    for (const u of gotFewerUpdates(line, 1, 'access', false)) m.set(u.placementId, { ...m.get(u.placementId)!, ...u.fields });
    expect(exceptions({ kind: 'full', view: kitchen, placements: kitchen.placements, recordedAreas: recorded({ f1: 'complete', dry: 'complete' }), items: m })).toEqual([]);
    const o = stockOutcomes(collectionLines(kitchen.placements, m), m, kitchen.byId);
    expect(o.map((x) => x.status)).toEqual(['not_topped_up']);
    // Fewer collected but not confirmed yet: still outstanding, and never a shortage on its own
    const n = new Map(base);
    for (const u of gotFewerUpdates(line, 1, null, false)) n.set(u.placementId, { ...n.get(u.placementId)!, ...u.fields });
    expect(exceptions({ kind: 'full', view: kitchen, placements: kitchen.placements, recordedAreas: recorded({ f1: 'complete', dry: 'complete' }), items: n }).map((e) => e.kind)).toEqual(['collect']);
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

describe('Refill FOH: grab upstairs for front of house, then replace it from downstairs', () => {
  const recorded = (o: Record<string, AreaStatus>) => new Map(Object.entries(o));
  const P = (id: string, name: string, unit: [string, string], loc: string) => ({ id, departmentId: 'gb', categoryId: null, name, unitSingular: unit[0], unitPlural: unit[1], method: 'manual' as const, allowDecimal: false, instructions: '', defaultLocationId: loc, sortOrder: 1, affects: [], photoPath: null });
  const pl = (id: string, productId: string, checkAreaId: string, extra: Record<string, unknown> = {}) => ({ id, productId, checkAreaId, parLevel: null, locationId: null, instructions: null, sortOrder: 1, ...extra });
  const A = (id: string, name: string, sortOrder: number, parentAreaId: string | null = null) => ({ id, departmentId: 'gb', name, guideText: '', guidePhotoPath: null, sortOrder, parentAreaId, sectionMode: 'open' as const });
  const bar: Catalogue = {
    ...cat,
    departments: [{ id: 'gb', name: 'Gold Class Bar', shortName: 'Bar', groupLabel: '', theme: 'gold', icon: 'bar', description: '', sortOrder: 1 }],
    areas: [A('bohf', 'BOH bar fridge', 1), A('ups', 'Upstairs cupboards', 2), A('wine', 'Wine cupboard', 3, 'ups'), A('beerf', 'FOH beer fridge', 4), A('bench', 'Back bench', 5)],
    locations: [{ id: 'alc', name: 'Alcohol storeroom', sortOrder: 1 }, { id: 'wif', name: 'Walk in fridge(Downstairs)', sortOrder: 2 }],
    products: [P('shz', 'Red Claw Shiraz', ['bottle', 'bottles'], 'alc'), P('hei', 'Heineken', ['pack', 'packs'], 'alc'), P('spk', 'Sparkling 330ml', ['bottle', 'bottles'], 'wif'),
      P('cur', 'Curatif Negroni', ['bottle', 'bottles'], 'alc'), P('syr', 'Vanilla Syrup', ['bottle', 'bottles'], 'alc')],
    placements: [
      pl('hei-boh', 'hei', 'bohf'), pl('spk-boh', 'spk', 'bohf'), pl('shz-wine', 'shz', 'wine'),
      pl('hei-foh', 'hei', 'beerf', { pickupAreaId: 'bohf', unitSingular: 'bottle', unitPlural: 'bottles' }),
      pl('spk-foh', 'spk', 'beerf', { pickupAreaId: 'bohf', pickupSuggest: true }),
      pl('cur-foh', 'cur', 'beerf'),
      pl('shz-bench', 'shz', 'bench', { pickupAreaId: 'wine', pickupSuggest: true }),
      pl('syr-bench', 'syr', 'bench'),
    ],
  };
  const v = departmentView(bar, 'gb')!;
  it('splits the screens into front of house and the upstairs pickup spots', () => {
    expect(usesRefill('full', v)).toBe(true);
    expect(usesRefill('quick', v)).toBe(false);
    expect(phaseAreas(v, 'foh').map((a) => a.area.name)).toEqual(['FOH beer fridge', 'Back bench']);
    expect(phaseAreas(v, 'boh').map((a) => a.area.name)).toEqual(['BOH bar fridge', 'Upstairs cupboards']);
    expect(v.byId.get('hei-foh')).toMatchObject({ unitPlural: 'bottles', pickupAreaName: 'BOH bar fridge', pickupSuggest: false });
    expect(v.byId.get('hei-boh')!.unitPlural).toBe('packs');
  });
  it('lists upstairs pickups on Refill FOH by spot, and keeps them off the downstairs list', () => {
    const m = items({ 'hei-foh': { requestedQty: 3 }, 'shz-bench': { requestedQty: 1, collectedMode: 'all', collectedQty: 1 }, 'cur-foh': { requestedQty: 2 }, 'syr-bench': { requestedQty: 1 } });
    const r = refillLines('full', v.placements, recorded({}), m);
    expect(groupByStoreroom(r, v.pickupOrder).map((g) => [g.name, g.lines.map((l) => `${l.total} ${l.unitPlural} ${l.productName}`)]))
      .toEqual([['BOH bar fridge', ['3 bottles Heineken']], ['Wine cupboard', ['1 bottles Red Claw Shiraz']]]);
    const down = collectionLines(collectPlacements('full', v.placements, recorded({})), withSuggestions('full', v, m, recorded({})));
    // Curatif and syrups straight from downstairs; the Shiraz taken upstairs is suggested for the Wine cupboard; beers are not.
    expect(down.map((l) => [l.productName, l.total, l.parts[0].areaName])).toEqual([['Red Claw Shiraz', 1, 'Wine cupboard'], ['Curatif Negroni', 2, 'FOH beer fridge'], ['Vanilla Syrup', 1, 'Back bench']]);
  });
  it('the suggestion stands until staff change it; what they leave is final', () => {
    const base = { 'shz-bench': { requestedQty: 1, collectedMode: 'all' as const, collectedQty: 1 }, 'spk-foh': { requestedQty: 4, collectedMode: 'all' as const, collectedQty: 4 } };
    expect([...suggestions('full', v, items(base), recorded({}))]).toEqual([['spk-boh', { qty: 4, from: [{ areaName: 'FOH beer fridge', need: 4 }] }], ['shz-wine', { qty: 1, from: [{ areaName: 'Back bench', need: 1 }] }]]);
    const kept = withSuggestions('full', v, items(base), recorded({}));
    expect(kept.get('shz-wine')!.requestedQty).toBe(1);
    // Changed to 3: 3 in total (not 1 + 3). Removed: 0.
    expect(withSuggestions('full', v, items({ ...base, 'shz-wine': { requestedQty: 3 } }), recorded({})).get('shz-wine')!.requestedQty).toBe(3);
    expect(withSuggestions('full', v, items({ ...base, 'shz-wine': { requestedQty: 0 } }), recorded({})).get('shz-wine')!.requestedQty).toBe(0);
    // A skipped front-of-house area suggests nothing.
    expect(suggestions('full', v, items(base), recorded({ bench: 'skipped' })).has('shz-wine')).toBe(false);
  });
  it('Shiraz: what was grabbed upstairs is replaced; what the bar still needs when the cupboard runs short comes from downstairs', () => {
    const sug = (shz: Partial<ItemState>) => suggestions('full', v, items({ 'shz-bench': { requestedQty: 2, ...shz } }), recorded({})).get('shz-wine')?.qty ?? null;
    expect(sug({})).toBeNull(); // not ticked on Collect upstairs yet
    expect(sug({ collectedMode: 'all', collectedQty: 2 })).toBe(2);
    expect(sug({ collectedMode: 'partial', collectedQty: 1, shortfallReason: 'insufficient' })).toBe(1); // only 1 in the cupboard: the bench still needs 1
    expect(sug({ collectedMode: 'partial', collectedQty: 0, shortfallReason: 'insufficient' })).toBe(2); // none in the cupboard: the bench still needs both
    expect(sug({ requestedQty: 3, collectedMode: 'partial', collectedQty: 1, shortfallReason: 'insufficient' })).toBe(2); // the last bottle taken: 2 more
    // Took 1 → 1 suggested; changed to 3 → 3 on the downstairs list; removed → off the list.
    const one = items({ 'shz-bench': { requestedQty: 1, collectedMode: 'all', collectedQty: 1 } });
    const down = (m: Map<string, ItemState>) => collectionLines(collectPlacements('full', v.placements, recorded({})), withSuggestions('full', v, m, recorded({})))
      .filter((l) => l.productName === 'Red Claw Shiraz').map((l) => l.total);
    expect(down(one)).toEqual([1]);
    expect(down(new Map([...one, ['shz-wine', { ...EMPTY_ITEM, requestedQty: 3 }]]))).toEqual([3]);
    expect(down(new Map([...one, ['shz-wine', { ...EMPTY_ITEM, requestedQty: 0 }]]))).toEqual([]);
  });
  it('beer singles and packs never merge, and quick restocks keep the plain list', () => {
    const m = items({ 'hei-foh': { requestedQty: 3 }, 'hei-boh': { requestedQty: 1 } });
    const q = collectionLines(collectPlacements('quick', v.placements, recorded({})), m);
    expect(q.map((l) => `${l.total} ${l.unitPlural}`)).toEqual(['1 packs', '3 bottles']);
    expect(collectionLines(collectPlacements('full', v.placements, recorded({})), m).map((l) => `${l.total} ${l.unitPlural}`)).toEqual(['1 packs']);
  });
  it('the summary only reports the downstairs run', () => {
    const m = withSuggestions('full', v, items({ 'shz-bench': { requestedQty: 1, collectedMode: 'all', collectedQty: 1 }, 'hei-foh': { requestedQty: 2 } }), recorded({}));
    expect(exceptions({ kind: 'full', view: v, placements: v.placements, recordedAreas: recorded({}), items: m }).map((e) => e.detail)).toEqual(['Red Claw Shiraz']);
  });
});

describe('None on display (Candy Bar): short is Low stock, even at zero', () => {
  const line = collectionLines(kitchen.placements, items({ 'p-cloth': { requestedQty: 4 } }))[0];
  const m = (fields: Partial<ItemState>) => items({ 'p-cloth': { requestedQty: 4, ...fields } });
  const confirmZero = (none: boolean) => Object.fromEntries(gotFewerUpdates(line, 0, 'insufficient', false, none).map((u) => [u.placementId, { requestedQty: 4, ...u.fields }]));
  it('collected zero: Low stock, short 4 (not Out of stock) until "None on display"', () => {
    const low = stockOutcomes([line], items(confirmZero(false)), kitchen.byId, true)[0];
    expect(low).toMatchObject({ status: 'low', got: 0, short: 4, noneOnDisplay: false });
    expect(outcomeLine(low)).toBe('Cloths: none collected, short 4 packs');
    const out = stockOutcomes([line], items(confirmZero(true)), kitchen.byId, true)[0];
    expect(out).toMatchObject({ status: 'out', noneOnDisplay: true });
    expect(outcomeLine(out)).toContain('none on display');
  });
  it('collected some: Low stock with how many short', () => {
    const u = Object.fromEntries(gotFewerUpdates(line, 1, 'insufficient', false, true).map((x) => [x.placementId, { requestedQty: 4, ...x.fields }]));
    // "None on display" only applies at zero: collecting 1 clears it.
    expect(u['p-cloth'].noneOnDisplay).toBe(false);
    expect(stockOutcomes([line], items(u), kitchen.byId, true)[0]).toMatchObject({ status: 'low', got: 1, short: 3 });
  });
  it('other departments keep "none collected = Out of stock"', () => {
    expect(stockOutcomes([line], items(confirmZero(false)), kitchen.byId)[0].status).toBe('out');
    expect(shortStatus(0, false, false)).toBe('out');
    expect(shortStatus(0, false, true)).toBe('low');
    expect(shortStatus(0, true, true)).toBe('out');
  });
  it('got all or undo clears it', () => {
    expect(gotAllUpdates(line)[0].fields.noneOnDisplay).toBe(false);
    expect(m({}).get('p-cloth')!.noneOnDisplay).toBe(false);
  });
});

describe('shortageCount: the Review screen\'s "Stock shortages", for the home screen', () => {
  const recorded = (o: Record<string, AreaStatus>) => new Map(Object.entries(o));
  it('counts confirmed out / low lines only', () => {
    const base = items({ 'p-tom': { currentQty: 2 }, 'p-sauce': { currentQty: 1 }, 'p-cloth': { requestedQty: 2 } });
    expect(shortageCount('full', kitchen, base, recorded({}))).toBe(0);
    const lines = collectionLines(kitchen.placements, base);
    const tom = lines.find((l) => l.productName === 'Tomatoes')!, sauce = lines.find((l) => l.productName === 'Sauce')!, cloth = lines.find((l) => l.productName === 'Cloths')!;
    const m = new Map(base);
    for (const u of [...gotFewerUpdates(tom, 0, 'insufficient', false), ...gotFewerUpdates(sauce, 1, 'insufficient', false), ...gotFewerUpdates(cloth, 1, 'time', false)]) m.set(u.placementId, { ...m.get(u.placementId)!, ...u.fields });
    // Tomatoes out, Sauce low; Cloths "interrupted" is collection incomplete, not a shortage.
    expect(shortageCount('full', kitchen, m, recorded({}))).toBe(2);
  });
});
