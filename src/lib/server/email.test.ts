import { describe, expect, it } from 'vitest';
import { buildRestockEmail } from './email';
import type { StockOutcome } from '@/lib/restock-logic';

const o = (p: Partial<StockOutcome>): StockOutcome => ({
  productName: 'X', unitSingular: 'bag', unitPlural: 'bags', status: 'low', needed: 3, got: 1, short: 2,
  onShelf: 3, target: 5, reason: 'insufficient', flagged: false, affects: [], ...p,
});

describe('manager email', () => {
  it('leads with out of stock (with menu items to mark sold out) then running low', () => {
    const m = buildRestockEmail({
      departmentName: 'Gold Class Kitchen', finishedLabel: 'Sun 15 Nov, 11:42 pm', people: ['Sam'], exceptionReason: null, notChecked: [], link: null,
      outcomes: [o({ productName: 'Coleslaw', status: 'out', got: 0, short: 3, affects: ['Golden Harvest Burger'] }), o({ productName: 'Fries' })],
    });
    expect(m.subject).toBe('Gold Class Kitchen restock: 1 out of stock, 1 running low');
    expect(m.text).toContain('OUT OF STOCK (1)\n- Coleslaw: none left in the storeroom (3 of 5 on the shelf)\n  Set as sold out: Golden Harvest Burger');
    expect(m.text).toContain('RUNNING LOW (1)\n- Fries: storeroom had 1, short 2 bags');
    expect(m.html).toContain('Set as sold out: <b>Golden Harvest Burger</b>');
    expect(m.text.indexOf('OUT OF STOCK')).toBeLessThan(m.text.indexOf('RUNNING LOW'));
  });
  it('says so plainly when nothing is low', () => {
    const m = buildRestockEmail({ departmentName: 'Bar', finishedLabel: 'now', people: [], exceptionReason: null, notChecked: [], link: null, outcomes: [] });
    expect(m.subject).toBe('Bar restock: all stocked');
    expect(m.text).toContain('Nothing low or out of stock.');
  });
  it('escapes names in the HTML', () => {
    const m = buildRestockEmail({ departmentName: 'A<b>', finishedLabel: 'now', people: [], exceptionReason: null, notChecked: [], link: null, outcomes: [] });
    expect(m.html).toContain('A&lt;b&gt;');
  });
});
