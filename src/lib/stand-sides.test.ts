import { describe, expect, it } from 'vitest';
import type { Catalogue } from './catalogue-types';
import { EMPTY_ITEM, collectionLines, departmentView, gotAllUpdates, gotFewerSplitUpdates, isSideLine, lineGot, sideFillLists, sideShares, type ItemState } from './restock-logic';

// The Candy Bar confection stand with a Side A and a Side B section (same products), and the water stand above.
const A = (id: string, name: string, sortOrder: number, parentAreaId: string | null = null, sectionMode: 'open' | 'side' = 'open') =>
  ({ id, departmentId: 'c', name, guideText: '', guidePhotoPath: null, sortOrder, parentAreaId, sectionMode });
const P = (id: string, name: string) => ({ id, departmentId: 'c', categoryId: null, name, unitSingular: 'packet', unitPlural: 'packets', method: 'manual' as const, allowDecimal: false, instructions: '', defaultLocationId: 'dry', sortOrder: 1, affects: [], photoPath: null });
const pl = (id: string, productId: string, checkAreaId: string) => ({ id, productId, checkAreaId, parLevel: null, locationId: null, instructions: null, sortOrder: 1 });
const cat: Catalogue = {
  version: 1, generatedAt: '', settings: { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' }, defrostItems: [],
  departments: [{ id: 'c', name: 'Candy Bar', shortName: 'Candy', groupLabel: '', theme: 'village', icon: 'candy', description: '', sortOrder: 1 }],
  areas: [A('stand', 'Confection stand', 1), A('sa', 'Confection stand · Side A', 1, 'stand', 'side'), A('sb', 'Confection stand · Side B', 2, 'stand', 'side')],
  locations: [{ id: 'dry', name: 'Dry storage', sortOrder: 1 }],
  categories: [],
  products: [P('sn', 'Snickers Pods'), P('kk', 'Kit Kat'), P('w', 'Mount Franklin Still Water')],
  placements: [pl('w-stand', 'w', 'stand'), pl('sn-a', 'sn', 'sa'), pl('kk-a', 'kk', 'sa'), pl('sn-b', 'sn', 'sb'), pl('kk-b', 'kk', 'sb')],
};
const view = departmentView(cat, 'c')!;
const items = (o: Record<string, Partial<ItemState>>) => new Map(Object.entries(o).map(([k, v]) => [k, { ...EMPTY_ITEM, ...v }]));
const apply = (m: Map<string, ItemState>, ups: { placementId: string; fields: Partial<ItemState> }[]) => { for (const u of ups) m.set(u.placementId, { ...(m.get(u.placementId) ?? EMPTY_ITEM), ...u.fields }); return m; };

describe('a stand checked side by side', () => {
  it('sections are sides, with short names; the water stand is not a side', () => {
    expect(view.areas[0].sections.map((s) => `${s.mode} ${s.placements[0].side}`)).toEqual(['side Side A', 'side Side B']);
    expect(view.byId.get('w-stand')!.side ?? null).toBeNull();
  });

  it('collects each product once, the total with the split per side', () => {
    const m = items({ 'sn-a': { requestedQty: 3 }, 'sn-b': { requestedQty: 2 }, 'kk-b': { requestedQty: 1 }, 'w-stand': { requestedQty: 4 } });
    const ls = collectionLines(view.placements, m);
    const sn = ls.find((l) => l.productName === 'Snickers Pods')!;
    expect(sn.total).toBe(5);
    expect(isSideLine(sn)).toBe(true);
    expect(sideShares(sn, m).map((s) => `${s.side} ${s.requested}`)).toEqual(['Side A 3', 'Side B 2']);
    expect(isSideLine(ls.find((l) => l.productName.startsWith('Mount'))!)).toBe(false);
  });

  it('got fewer: staff choose where the units go (each side capped at what it asked for)', () => {
    const m = items({ 'sn-a': { requestedQty: 3 }, 'sn-b': { requestedQty: 2 } });
    const sn = collectionLines(view.placements, m).find((l) => l.productName === 'Snickers Pods')!;
    apply(m, gotFewerSplitUpdates(sn, new Map([['sn-a', 2], ['sn-b', 9]]), 'insufficient', false));
    expect(sideShares(sn, m).map((s) => `${s.side} ${s.collected}`)).toEqual(['Side A 2', 'Side B 2']);
    expect(lineGot(sn, m)).toBe(4);
  });

  it('Fill Side A / Fill Side B: only what each side needs; collected amounts once collected', () => {
    const m = items({ 'sn-a': { requestedQty: 3 }, 'sn-b': { requestedQty: 2 }, 'kk-b': { requestedQty: 1 } });
    const ls = collectionLines(view.placements, m);
    const fill = () => sideFillLists(ls, m).map((s) => `${s.side}: ${s.list.map((r) => `${r.qty} ${r.productName}${r.collected === null ? ' (to collect)' : ''}`).join(', ')}`);
    expect(fill()).toEqual(['Side A: 3 Snickers Pods (to collect)', 'Side B: 2 Snickers Pods (to collect), 1 Kit Kat (to collect)']);
    apply(m, gotAllUpdates(ls.find((l) => l.productName === 'Kit Kat')!));
    apply(m, gotFewerSplitUpdates(ls.find((l) => l.productName === 'Snickers Pods')!, new Map([['sn-a', 3], ['sn-b', 1]]), 'insufficient', false));
    expect(fill()).toEqual(['Side A: 3 Snickers Pods', 'Side B: 1 Snickers Pods, 1 Kit Kat']);
  });
});
