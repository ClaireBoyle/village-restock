// Small, dependency-free CSV reader/writer (RFC 4180), Excel-friendly.

/** Read CSV text into rows of cells. Handles quotes, commas and line breaks inside quotes, and Excel's BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', i = 0, quoted = false;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1; continue;
    }
    cell += c; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // Drop completely empty lines (Excel adds them).
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const needsQuotes = /[",\r\n]/;
/** Cells that start with = + - @ are prefixed with ' so spreadsheets don't run them as formulas. */
function safe(v: string) {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  const out = rows.map((r) => r.map((v) => {
    const t = v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : safe(String(v));
    return needsQuotes.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join(','));
  return '﻿' + out.join('\r\n') + '\r\n';
}

/** Undo the ' added by toCsv to formula-like cells. */
export function unsafe(v: string): string {
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}
