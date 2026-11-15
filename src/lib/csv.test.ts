import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv, unsafe } from './csv';

describe('csv', () => {
  it('round-trips quotes, commas and line breaks', () => {
    const rows = [['Name', 'Notes'], ['Stone & Wood, Pacific', 'Say "hi"\nnext line'], ['Plain', '']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it('reads Excel files (BOM, CRLF, blank lines)', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n\r\n,\r\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });
  it('stops spreadsheet formulas and restores them on import', () => {
    const csv = toCsv([['=SUM(A1)', '-5', 'ok']]);
    expect(csv).toContain("'=SUM(A1)");
    const [r] = parseCsv(csv);
    expect(r.map(unsafe)).toEqual(['=SUM(A1)', '-5', 'ok']);
  });
  it('writes numbers and yes/no', () => {
    expect(toCsv([[1.5, true, false, null]])).toBe('﻿1.5,yes,no,\r\n');
  });
});
