import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import {
  EMPTY_ITEM, collectPlacements, collectionLines, departmentView, gotAllUpdates, gotFewerUpdates, outcomeLine, restockOutcomes, shortageCount,
  summaryText, upstairsCheck, upstairsStatus, withSuggestions, type AreaStatus, type CollectionLine, type ItemState,
} from './restock-logic';
import { buildRestockEmail } from './server/email';

// Gold Class Bar, cut down: raspberry cordial at the bar's coffee cupboard and in the upstairs cupboard (both from
// downstairs); Heineken at the FOH beer fridge (grabbed from the BOH bar fridge) and in the BOH bar fridge.
const P = (id: string, name: string, unit: [string, string]) => ({ id, departmentId: 'gb', categoryId: null, name, unitSingular: unit[0], unitPlural: unit[1], method: 'manual' as const, allowDecimal: false, instructions: '', defaultLocationId: 'dry', sortOrder: 1, affects: [], photoPath: null });
const pl = (id: string, productId: string, checkAreaId: string, extra: Record<string, unknown> = {}) => ({ id, productId, checkAreaId, parLevel: null, locationId: null, instructions: null, sortOrder: 1, ...extra });
const A = (id: string, name: string, sortOrder: number) => ({ id, departmentId: 'gb', name, guideText: '', guidePhotoPath: null, sortOrder, parentAreaId: null, sectionMode: 'open' as const });
const cat: Catalogue = {
  version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [],
  departments: [{ id: 'gb', name: 'Gold Class Bar', shortName: 'Bar', groupLabel: '', theme: 'gold', icon: 'bar', description: '', sortOrder: 1, noneLeftCheck: true }],
  areas: [A('coffee', 'Coffee cupboard', 1), A('beerf', 'FOH beer fridge', 2), A('bohf', 'BOH bar fridge', 3), A('ups', 'Upstairs cupboards', 4)],
  locations: [{ id: 'dry', name: 'Dry storage', sortOrder: 1 }],
  categories: [],
  products: [P('rasp', 'Raspberry Cordial', ['bottle', 'bottles']), P('hei', 'Heineken', ['bottle', 'bottles'])],
  placements: [
    pl('rasp-bar', 'rasp', 'coffee'), pl('rasp-ups', 'rasp', 'ups'),
    pl('hei-foh', 'hei', 'beerf', { pickupAreaId: 'bohf' }), pl('hei-boh', 'hei', 'bohf'),
  ],
};
const view = departmentView(cat, 'gb')!;
const done: Map<string, AreaStatus> = new Map([['coffee', 'complete'], ['beerf', 'complete'], ['bohf', 'complete'], ['ups', 'complete']]);
const items = (o: Record<string, Partial<ItemState>>) => new Map(Object.entries(o).map(([k, v]) => [k, { ...EMPTY_ITEM, ...v }]));
const lineOf = (m: Map<string, ItemState>, name: string) => collectionLines(collectPlacements('full', view.placements, done), m).find((l) => l.productName === name)!;
const collect = (m: Map<string, ItemState>, line: CollectionLine, got: number) => {
  for (const u of got >= line.total ? gotAllUpdates(line) : gotFewerUpdates(line, got, 'insufficient', false)) m.set(u.placementId, { ...m.get(u.placementId)!, ...u.fields });
  return m;
};
const outcome = (m: Map<string, ItemState>, name = 'Raspberry Cordial') => restockOutcomes('full', view, view.placements, done, m).find((o) => o.productName === name)!;
// Needs 3 bottles: 2 at the bar's coffee cupboard and 1 in the upstairs cupboard.
const need3 = (barEmpty: boolean, upsEmpty: boolean) => items({ 'rasp-bar': { requestedQty: 2, noneLeftHere: barEmpty }, 'rasp-ups': { requestedQty: 1, noneLeftHere: upsEmpty } });

describe('None left here (Gold Class Bar)', () => {
  it('both spots empty and 1 collected: Low stock · 2 bottles short', () => {
    const m = need3(true, true);
    const o = outcome(collect(m, lineOf(m, 'Raspberry Cordial'), 1));
    expect(o).toMatchObject({ status: 'low', short: 2, got: 1, upstairs: 'empty' });
    expect(outcomeLine(o)).toBe('Raspberry Cordial: Low stock · 2 bottles short (still available upstairs)');
  });

  it('both spots empty and none collected: Out of stock · 3 bottles short', () => {
    const m = need3(true, true);
    const o = outcome(collect(m, lineOf(m, 'Raspberry Cordial'), 0));
    expect(o).toMatchObject({ status: 'out', short: 3, got: 0 });
    expect(outcomeLine(o)).toBe('Raspberry Cordial: Out of stock · 3 bottles short (none upstairs or downstairs)');
  });

  it('an unticked box is not stock: none collected with one spot unreported is Top-up incomplete', () => {
    const m = need3(true, false);
    expect(outcome(collect(m, lineOf(m, 'Raspberry Cordial'), 0))).toMatchObject({ status: 'unconfirmed', short: 3, upstairs: 'unknown' });
    const n = need3(false, false);
    expect(outcome(collect(n, lineOf(n, 'Raspberry Cordial'), 0)).status).toBe('unconfirmed');
  });

  it('a spot that needed none (checked) is usable stock upstairs: Low stock · Still available', () => {
    const m = items({ 'rasp-bar': { requestedQty: 0 }, 'rasp-ups': { requestedQty: 3, noneLeftHere: true } });
    expect(outcome(collect(m, lineOf(m, 'Raspberry Cordial'), 0))).toMatchObject({ status: 'low', upstairs: 'stock' });
    // Left blank in an area that was never finished: unknown.
    const open = new Map(done); open.set('coffee', 'in_progress');
    const n = items({ 'rasp-ups': { requestedQty: 3, noneLeftHere: true } });
    expect(upstairsCheck('full', view.placements, open, n).get('rasp')).toBe('unknown');
    expect(upstairsCheck('full', view.placements, done, n).get('rasp')).toBe('stock');
  });

  it('stock grabbed for the bar is usable stock upstairs, even with both spots ticked', () => {
    const m = items({ 'hei-foh': { requestedQty: 6, noneLeftHere: true, collectedMode: 'partial', collectedQty: 2, shortfallReason: 'insufficient' }, 'hei-boh': { requestedQty: 12, noneLeftHere: true } });
    expect(upstairsCheck('full', view.placements, done, m).get('hei')).toBe('stock');
    m.set('hei-foh', { ...m.get('hei-foh')!, collectedQty: 0 });
    expect(upstairsCheck('full', view.placements, done, m).get('hei')).toBe('empty');
  });

  it('a full collection is not a shortage, and needs nothing else', () => {
    const m = need3(false, false);
    collect(m, lineOf(m, 'Raspberry Cordial'), 3);
    expect(restockOutcomes('full', view, view.placements, done, m)).toEqual([]);
  });

  it('staff can change it on Finish when none was collected; collected stock is always Low stock', () => {
    const m = need3(false, false);
    const line = lineOf(m, 'Raspberry Cordial');
    collect(m, line, 0);
    for (const p of line.parts) m.set(p.placementId, { ...m.get(p.placementId)!, statusOverride: 'out' });
    expect(outcome(m)).toMatchObject({ status: 'out', auto: 'unconfirmed', overridden: true });
    expect(upstairsStatus(1, 'empty', 'out')).toBe('low');
    expect(upstairsStatus(0, 'stock', 'unconfirmed')).toBe('unconfirmed');
  });

  it('lists out of stock first, counts every storeroom shortage, and the summary uses the same wording', () => {
    const m = items({ 'rasp-bar': { requestedQty: 3, noneLeftHere: true }, 'rasp-ups': { requestedQty: 0 }, 'hei-boh': { requestedQty: 12, noneLeftHere: true },
      'hei-foh': { requestedQty: 6, noneLeftHere: true, collectedMode: 'partial', collectedQty: 0, shortfallReason: 'insufficient' } });
    collect(m, lineOf(m, 'Raspberry Cordial'), 0);
    collect(m, lineOf(m, 'Heineken'), 0);
    expect(restockOutcomes('full', view, view.placements, done, m).map((o) => `${o.status} ${o.productName}`)).toEqual(['out Heineken', 'low Raspberry Cordial']);
    expect(shortageCount('full', view, m, done)).toBe(2);
    const text = summaryText({ departmentName: 'Gold Class Bar', kind: 'full', finishedLabel: '11:40 pm', exceptionReason: null, people: [], view, placements: view.placements,
      recordedAreas: done, skipReasons: new Map(), items: m, dateLabel: 'Sat 21 Nov' });
    expect(text).toContain('OUT OF STOCK (1)\n- Heineken: Out of stock · 12 bottles short');
    expect(text).toContain('LOW STOCK · STILL AVAILABLE (1)\n- Raspberry Cordial: Low stock · 3 bottles short (still available upstairs)');
  });

  it('other departments keep their rules (no upstairs checks)', () => {
    const plain = departmentView({ ...cat, departments: [{ ...cat.departments[0], noneLeftCheck: false }] }, 'gb')!;
    const m = need3(true, true);
    collect(m, lineOf(m, 'Raspberry Cordial'), 0);
    const [o] = restockOutcomes('full', plain, plain.placements, done, m);
    expect(o.status).toBe('out');
    expect(o.upstairs).toBeUndefined();
  });
});

describe('Some left / None left (Gold Class Bar)', () => {
  // Maraschino Cherries in the upstairs walk-in fridge; Spiced Rum on the back bench, grabbed from the upstairs cupboard.
  const P2 = (id: string, name: string, unit: [string, string]) => ({ id, departmentId: 'gb', categoryId: null, name, unitSingular: unit[0], unitPlural: unit[1], method: 'manual' as const, allowDecimal: false, instructions: '', defaultLocationId: 'dry', sortOrder: 1, affects: [], photoPath: null });
  const cat2: Catalogue = {
    ...cat,
    areas: [A('bench', 'Back bench', 1), A('walk', 'Walk in fridge', 2), A('cup', 'Upstairs cupboards', 3)],
    products: [P2('mc', 'Maraschino Cherries', ['jar', 'jars']), P2('rum', 'Spiced Rum', ['bottle', 'bottles']), P2('lime', 'Limes', ['lime', 'limes'])],
    // (Limes are grabbed from the walk-in for the bench, so the walk-in is an upstairs stop, as on the live bar.)
    placements: [pl('mc-walk', 'mc', 'walk'), pl('rum-bench', 'rum', 'bench', { pickupAreaId: 'cup', pickupSuggest: true }), pl('rum-cup', 'rum', 'cup'),
      pl('lime-bench', 'lime', 'bench', { pickupAreaId: 'walk', pickupSuggest: true }), pl('lime-walk', 'lime', 'walk')],
  };
  const v2 = departmentView(cat2, 'gb')!;
  const all: Map<string, AreaStatus> = new Map([['bench', 'complete'], ['walk', 'complete'], ['cup', 'complete']]);
  const run = (m: Map<string, ItemState>, name: string) => {
    const it = withSuggestions('full', v2, m, all);
    const line = collectionLines(collectPlacements('full', v2.placements, all), it).find((l) => l.productName === name)!;
    for (const u of gotFewerUpdates(line, 0, 'insufficient', false)) it.set(u.placementId, { ...(it.get(u.placementId) ?? EMPTY_ITEM), ...u.fields });
    return restockOutcomes('full', v2, v2.placements, all, it).find((o) => o.productName === name)!;
  };

  it('Maraschino Cherries: an open jar upstairs, 1 extra requested (Some left), 0 downstairs → Low stock · 1 jar short · Still available upstairs', () => {
    const o = run(items({ 'mc-walk': { requestedQty: 1, leftHere: 'some' } }), 'Maraschino Cherries');
    expect(o).toMatchObject({ status: 'low', short: 1, availableAt: 'upstairs' });
    expect(outcomeLine(o)).toBe('Maraschino Cherries: Low stock · 1 jar short (still available upstairs)');
  });

  it('the last bottle moved to the bar: bench needs 3, 1 grabbed, cupboard empty, 0 downstairs → Low stock · 2 bottles short · Still available at the bar', () => {
    const o = run(items({ 'rum-bench': { requestedQty: 3, leftHere: 'none', collectedMode: 'partial', collectedQty: 1, shortfallReason: 'insufficient' }, 'rum-cup': { leftHere: 'none' } }), 'Spiced Rum');
    expect(o).toMatchObject({ status: 'low', short: 2, availableAt: 'bar' });
    expect(outcomeLine(o)).toBe('Spiced Rum: Low stock · 2 bottles short (still available at the bar)');
  });

  it('None left everywhere, nothing grabbed, 0 downstairs → Out of stock; nothing said → Top-up incomplete; all collected → not listed', () => {
    expect(run(items({ 'mc-walk': { requestedQty: 2, leftHere: 'none' } }), 'Maraschino Cherries')).toMatchObject({ status: 'out', short: 2 });
    expect(run(items({ 'mc-walk': { requestedQty: 2 } }), 'Maraschino Cherries')).toMatchObject({ status: 'unconfirmed', short: 2 });
    const m = items({ 'mc-walk': { requestedQty: 2, leftHere: 'some' } });
    const line = collectionLines(collectPlacements('full', v2.placements, all), m)[0];
    for (const u of gotAllUpdates(line)) m.set(u.placementId, { ...m.get(u.placementId)!, ...u.fields });
    expect(restockOutcomes('full', v2, v2.placements, all, m)).toEqual([]);
  });
});

describe('manager email (Gold Class Bar wording)', () => {
  it('Out of stock, Low stock · Still available, and Top-up incomplete', () => {
    const m = need3(true, true);
    collect(m, lineOf(m, 'Raspberry Cordial'), 1);
    const h = items({ 'hei-boh': { requestedQty: 12 }, 'hei-foh': { requestedQty: 6 } });
    collect(h, collectionLines(collectPlacements('full', view.placements, done), h).find((l) => l.productName === 'Heineken')!, 0);
    const outcomes = [...restockOutcomes('full', view, view.placements, done, m), ...restockOutcomes('full', view, view.placements, done, h)];
    const e = buildRestockEmail({ departmentName: 'Gold Class Bar', finishedLabel: 'Sat 21 Nov, 11:40 pm', people: [], exceptionReason: null, outcomes, notChecked: [], link: null, lowStockWording: true });
    expect(e.subject).toBe('Gold Class Bar restock Sat 21 Nov, 11:40 pm: 1 low stock, 1 top-up incomplete');
    expect(e.text).toContain('LOW STOCK · STILL AVAILABLE (1)\n- Raspberry Cordial: Low stock · 2 bottles short · Still available upstairs');
    expect(e.text).toContain('TOP-UP INCOMPLETE (1)\n- Heineken: Top-up incomplete · 12 bottles short · Upstairs stock not confirmed');
    expect(e.html).toContain('Top-up incomplete (1)');
    const out = need3(true, true);
    collect(out, lineOf(out, 'Raspberry Cordial'), 0);
    const e2 = buildRestockEmail({ departmentName: 'Gold Class Bar', finishedLabel: 'x', people: [], exceptionReason: null, outcomes: restockOutcomes('full', view, view.placements, done, out), notChecked: [], link: null });
    expect(e2.text).toContain('OUT OF STOCK (1)\n- Raspberry Cordial: Out of stock · 3 bottles short · None left upstairs or downstairs');
  });
});
