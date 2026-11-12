import { describe, expect, it } from 'vitest';
import { formatQty, parseQuantity, requiredForPar, tradingDate } from './restock-math';

describe('requiredForPar (brief test scenarios 1-3)', () => {
  it('2 tomatoes against a par of 8 needs 6', () => {
    expect(requiredForPar(8, 2)).toBe(6);
  });
  it('10 tomatoes against a par of 8 needs 0, never negative', () => {
    expect(requiredForPar(8, 10)).toBe(0);
  });
  it('a blank quantity is unchecked, not zero', () => {
    expect(requiredForPar(8, null)).toBeNull();
    expect(requiredForPar(8, 0)).toBe(8);
  });
  it('handles decimals without floating point noise', () => {
    expect(requiredForPar(2.5, 1.5)).toBe(1);
    expect(requiredForPar(0.3, 0.1)).toBe(0.2);
  });
});

describe('parseQuantity', () => {
  const whole = { allowDecimal: false, unitPlural: 'bottles' };
  const dec = { allowDecimal: true, unitPlural: 'kg' };
  it('keeps blank as unchecked', () => expect(parseQuantity('  ', whole)).toEqual({ ok: true, value: null }));
  it('accepts whole numbers', () => expect(parseQuantity('7', whole)).toEqual({ ok: true, value: 7 }));
  it('rejects negatives and text', () => {
    expect(parseQuantity('-1', whole).ok).toBe(false);
    expect(parseQuantity('abc', whole).ok).toBe(false);
  });
  it('rejects decimals for whole-unit products', () => {
    const r = parseQuantity('2.5', whole);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Whole bottles');
  });
  it('accepts decimals and a comma separator where allowed', () => {
    expect(parseQuantity('2,5', dec)).toEqual({ ok: true, value: 2.5 });
    expect(parseQuantity('.5', dec)).toEqual({ ok: true, value: 0.5 });
  });
  it('flags implausibly large numbers', () => expect(parseQuantity('5000', whole).ok).toBe(false));
});

describe('formatQty', () => {
  it('uses singular and plural units', () => {
    expect(formatQty(1, 'bottle', 'bottles')).toBe('1 bottle');
    expect(formatQty(6, 'tomato', 'tomatoes')).toBe('6 tomatoes');
  });
});

describe('tradingDate', () => {
  it('a close finishing at 12:30 am belongs to the previous trading day', () => {
    // 12:30 am Friday 13 Nov in Melbourne (AEDT, UTC+11) = 13:30 UTC Thursday 12 Nov
    expect(tradingDate(new Date('2026-11-12T13:30:00Z'))).toBe('2026-11-12');
  });
  it('after the 5 am cutoff it is the new day', () => {
    // 6:00 am Friday 13 Nov Melbourne = 19:00 UTC Thursday
    expect(tradingDate(new Date('2026-11-12T19:00:00Z'))).toBe('2026-11-13');
  });
  it('an 8 pm restock is the same day', () => {
    expect(tradingDate(new Date('2026-11-12T09:00:00Z'))).toBe('2026-11-12');
  });
});
