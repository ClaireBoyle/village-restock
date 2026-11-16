import { describe, expect, it } from 'vitest';
import { nextService, suggestDefrost, weekdayOf, zonedTime, type DefrostItem } from './defrost';

const item = (o: Partial<DefrostItem> = {}): DefrostItem => ({
  id: 'x', departmentId: 'k', name: 'Ingredient X', unitSingular: 'portion', unitPlural: 'portions',
  expectedDemand: 24, weekdayDemand: {}, buffer: 4, packSize: 1, minQty: 0, thawMethod: 'Coolroom',
  thawHours: 12, shelfLifeHours: 72, safetyNotes: '', sortOrder: 1, ...o,
});
const now = new Date('2026-11-15T12:00:00Z');                // 11 pm Melbourne
const ctx = { serviceDay: 'mon' as const, now, serviceStart: new Date('2026-11-16T00:00:00Z') }; // 11 am next day

describe('suggestDefrost', () => {
  it('the brief example: 24 + 4 − 10 − 4 = 14', () => {
    const r = suggestDefrost(item(), { chilled: 10, thawing: 4, adjust: null }, ctx);
    expect(r).toMatchObject({ status: 'ok', suggested: 14 });
    if (r.status === 'ok') expect(r.working).toBe('24 expected + 4 buffer − 10 chilled − 4 thawing = 14');
  });
  it('never below zero', () => {
    expect(suggestDefrost(item(), { chilled: 40, thawing: 0, adjust: null }, ctx)).toMatchObject({ status: 'ok', suggested: 0 });
  });
  it('missing stock is never treated as 0', () => {
    expect(suggestDefrost(item(), { chilled: null, thawing: 4, adjust: null }, ctx)).toMatchObject({ status: 'incomplete', missing: ['chilled'] });
    expect(suggestDefrost(item(), { chilled: 3, thawing: null, adjust: null }, ctx)).toMatchObject({ status: 'incomplete', missing: ['thawing'] });
  });
  it('rounds up to the pack size and respects the minimum', () => {
    expect(suggestDefrost(item({ packSize: 6 }), { chilled: 10, thawing: 4, adjust: null }, ctx)).toMatchObject({ suggested: 18, rounded: true });
    expect(suggestDefrost(item({ minQty: 10 }), { chilled: 26, thawing: 0, adjust: null }, ctx)).toMatchObject({ suggested: 10 });
    const r = suggestDefrost(item({ packSize: 0.5 }), { chilled: 10.2, thawing: 4, adjust: null }, ctx);
    expect(r).toMatchObject({ suggested: 14 });
  });
  it('uses a weekday value and the staff adjustment', () => {
    const r = suggestDefrost(item({ weekdayDemand: { mon: 30 } }), { chilled: 10, thawing: 4, adjust: 2 }, ctx);
    expect(r).toMatchObject({ status: 'ok', suggested: 22 });
    if (r.status === 'ok') expect(r.working).toContain('+ 2 adjustment');
  });
  it('warns instead of suggesting when it cannot thaw safely in time', () => {
    expect(suggestDefrost(item({ thawHours: 24 }), { chilled: 10, thawing: 4, adjust: null }, ctx)).toMatchObject({ status: 'too_late', raw: 14 });
  });
  it('warns when thawed stock would expire before the service', () => {
    expect(suggestDefrost(item({ thawHours: 2, shelfLifeHours: 4 }), { chilled: 10, thawing: 4, adjust: null }, ctx)).toMatchObject({ status: 'expires' });
  });
  it('asks for a thaw time when none is set up', () => {
    expect(suggestDefrost(item({ thawHours: null }), { chilled: 10, thawing: 4, adjust: null }, ctx)).toMatchObject({ status: 'no_thaw_time' });
  });
  it('nothing to defrost needs no timing check', () => {
    expect(suggestDefrost(item({ thawHours: null }), { chilled: 40, thawing: 0, adjust: null }, ctx)).toMatchObject({ status: 'ok', suggested: 0 });
  });
});

describe('service timing', () => {
  it('next service is the following day at the set local time', () => {
    const s = nextService('2026-11-15', '11:00', 'Australia/Melbourne');
    expect(s.date).toBe('2026-11-16');
    expect(s.start.toISOString()).toBe('2026-11-16T00:00:00.000Z'); // 11 am AEDT = 00:00 UTC
    expect(weekdayOf('2026-11-16')).toBe('mon');
  });
  it('handles winter time', () => {
    expect(zonedTime('2026-07-01', 11, 0, 'Australia/Melbourne').toISOString()).toBe('2026-07-01T01:00:00.000Z');
  });
});
