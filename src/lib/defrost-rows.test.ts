import { describe, expect, it } from 'vitest';
import { cleanTargets, defrostRowInfo, defrostSuggestion, formatTargets, parseTargets, targetFor } from './defrost-rows';

const bases = { unitSingular: 'base', unitPlural: 'bases', readyTargets: [{ min: 0, max: 150, qty: 24 }, { min: 151, max: null, qty: 36 }] };
const beef = { unitSingular: 'bag', unitPlural: 'bags', readyUnitSingular: 'portion', readyUnitPlural: 'portions', readyPer: 8, readyTargets: [{ min: 0, max: null, qty: 40 }] };

describe('defrost rows: suggestions from tomorrow\'s admits', () => {
  it('target 24, 10 ready → 14 bases', () => {
    expect(defrostSuggestion(bases, 120, 10)?.qty).toBe(14);
    expect(defrostSuggestion(bases, 200, 10)?.qty).toBe(26);
  });
  it('never below 0: more ready than the target → nothing to pull', () => {
    expect(defrostSuggestion(bases, 120, 30)?.qty).toBe(0);
  });
  it('different units: counted in portions, pulled in 1 kg bags (rounded up)', () => {
    expect(defrostSuggestion(beef, 90, 12)?.qty).toBe(4); // 28 portions / 8 = 3.5 → 4 bags
    expect(defrostSuggestion(beef, 90, 40)?.qty).toBe(0);
  });
  it('no suggestion without admits, a ready count, a matching range or a conversion', () => {
    expect(defrostSuggestion(bases, null, 10)).toBeNull();
    expect(defrostSuggestion(bases, 120, null)).toBeNull();
    expect(defrostSuggestion({ ...bases, readyTargets: [{ min: 100, max: 150, qty: 24 }] }, 50, 10)).toBeNull();
    expect(defrostSuggestion({ ...beef, readyPer: null }, 90, 12)).toBeNull();
    expect(defrostRowInfo({ ...beef, readyPer: null }).canSuggest).toBe(false);
    expect(defrostRowInfo({ unitSingular: 'tub', unitPlural: 'tubs' }).canSuggest).toBe(false);
  });
  it('ranges: inclusive, "and above"', () => {
    expect(targetFor(bases.readyTargets, 150)?.qty).toBe(24);
    expect(targetFor(bases.readyTargets, 151)?.qty).toBe(36);
    expect(targetFor(bases.readyTargets, 9000)?.qty).toBe(36);
  });
  it('targets as admins type them, and back', () => {
    const r = parseTargets('151+: 36\n0-150: 24\n');
    expect(r).toEqual({ ok: true, targets: bases.readyTargets });
    expect(formatTargets(bases.readyTargets)).toBe('0-150: 24\n151+: 36');
    expect(parseTargets('0-150: 24\n100-200: 30').ok).toBe(false);
    expect(parseTargets('lots: 3').ok).toBe(false);
    expect(parseTargets('').ok && parseTargets('').ok).toBe(true);
  });
  it('stored targets that make no sense are dropped', () => {
    expect(cleanTargets([{ min: 0, qty: 5 }, { min: -1, qty: 2 }, { min: 10, max: 5, qty: 1 }, 'x'])).toEqual([{ min: 0, max: null, qty: 5 }]);
    expect(cleanTargets(null)).toEqual([]);
  });
});
