// Restock calculations. Pure functions, shared by the device (offline) and the
// server (which re-checks everything it receives).

/** Round to 2 decimal places to avoid floating point noise (0.1 + 0.2). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Amount to collect for a par-level product.
 * - `current === null` means "not checked yet" (a blank box), NOT zero.
 * - Never negative: having more than the par level means collect 0.
 */
export function requiredForPar(par: number, current: number | null): number | null {
  if (current === null) return null;
  return Math.max(0, round2(par - current));
}

export type QuantityCheck = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * Validates what a staff member typed into a quantity box.
 * Blank stays blank (unchecked). Accepts "2,5" as 2.5 for convenience.
 */
export function parseQuantity(raw: string, opts: { allowDecimal: boolean; unitPlural: string; max?: number }): QuantityCheck {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  if (!/^\d*[.,]?\d+$|^\d+[.,]$/.test(text)) return { ok: false, message: 'Enter a number of 0 or more. Leave it blank if you haven’t checked.' };
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return { ok: false, message: 'Enter a number of 0 or more.' };
  if (!opts.allowDecimal && !Number.isInteger(value)) return { ok: false, message: `Whole ${opts.unitPlural} only, e.g. 3.` };
  if (value > (opts.max ?? 999)) return { ok: false, message: 'That number looks too high. Please check it.' };
  return { ok: true, value: round2(value) };
}

/** "1 bottle" / "2 bottles" / "2.5 kg". */
export function formatQty(n: number, unitSingular: string, unitPlural: string): string {
  const unit = n === 1 ? unitSingular : unitPlural;
  // A unit with its size ("1 kg bag"): "2 × 1 kg bags", not "2 1 kg bags".
  return `${round2(n)} ${/^\d/.test(unit) ? '× ' : ''}${unit}`;
}

/**
 * Trading day for a moment in time: restocks finished after midnight but
 * before the cutoff hour belong to the previous day's close.
 * Returns YYYY-MM-DD in the cinema's timezone.
 */
export function tradingDate(at: Date, timeZone = 'Australia/Melbourne', cutoffHour = 5): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
  if (get('hour') < cutoffHour) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}
