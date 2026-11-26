import { describe, expect, it } from 'vitest';
import { EMPTY_ITEM, restockStarted } from './restock-logic';

describe('restockStarted: opened is not started until something is entered', () => {
  it('nothing entered, no areas done: not started', () => {
    expect(restockStarted([])).toBe(false);
    expect(restockStarted([{ ...EMPTY_ITEM }, { ...EMPTY_ITEM }], ['not_started', 'in_progress', null])).toBe(false);
  });
  it('any amount, count, tick or collection: started', () => {
    for (const f of [{ requestedQty: 0 }, { requestedQty: 2 }, { currentQty: 5 }, { routineChoice: 'needed' as const }, { collectedMode: 'all' as const },
      { refillStatus: 'needs_stock' as const }, { upstairsQty: 1 }, { leftHere: 'none' as const }, { noneLeftHere: true }, { noneOnDisplay: true }]) {
      expect(restockStarted([{ ...EMPTY_ITEM }, { ...EMPTY_ITEM, ...f }])).toBe(true);
    }
  });
  it('an area marked done or skipped: started', () => {
    expect(restockStarted([], ['complete'])).toBe(true);
    expect(restockStarted([], ['skipped'])).toBe(true);
  });
});
