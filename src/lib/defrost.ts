// Defrost Planner: the calculation. Pure and explainable, shared by the device and the server.
//
//   suggested = max(0, expected demand + adjustment + buffer − usable chilled − already thawing)
//   then rounded UP to the pack size, and raised to the minimum practical amount if above 0.
//
// Safety first: missing stock is never treated as 0, and if stock can't be thawed safely in
// time (or wouldn't still be usable at the service) a warning replaces the number.

export interface DefrostItem {
  id: string; departmentId: string; name: string; unitSingular: string; unitPlural: string;
  expectedDemand: number; weekdayDemand: Partial<Record<Weekday, number>>; buffer: number;
  packSize: number; minQty: number; thawMethod: string; thawHours: number | null;
  shelfLifeHours: number | null; safetyNotes: string; sortOrder: number;
}
export interface DefrostInput { chilled: number | null; thawing: number | null; adjust: number | null }
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_LABEL: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export type DefrostResult =
  | { status: 'incomplete'; missing: ('chilled' | 'thawing')[]; demand: number }
  | { status: 'no_thaw_time'; demand: number; raw: number }
  | { status: 'too_late'; demand: number; raw: number; readyAt: Date }
  | { status: 'expires'; demand: number; raw: number; usableUntil: Date }
  | { status: 'ok'; demand: number; raw: number; suggested: number; working: string; rounded: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => String(r2(n));

/** Expected demand for a service day: the weekday value if a manager set one, otherwise the default. */
export function demandFor(item: DefrostItem, day: Weekday): number {
  const v = item.weekdayDemand?.[day];
  return typeof v === 'number' && Number.isFinite(v) ? v : item.expectedDemand;
}

export function weekdayOf(isoDate: string): Weekday {
  return WEEKDAYS[(new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7];
}

export function suggestDefrost(item: DefrostItem, input: DefrostInput, ctx: { serviceDay: Weekday; now: Date; serviceStart: Date }): DefrostResult {
  const demand = r2(demandFor(item, ctx.serviceDay) + (input.adjust ?? 0));
  const missing = ([['chilled', input.chilled], ['thawing', input.thawing]] as const).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  if (missing.length) return { status: 'incomplete', missing: [...missing], demand };

  const raw = r2(Math.max(0, demand + item.buffer - (input.chilled as number) - (input.thawing as number)));
  // Nothing to defrost needs no timing check.
  if (raw > 0) {
    if (item.thawHours === null) return { status: 'no_thaw_time', demand, raw };
    const readyAt = new Date(ctx.now.getTime() + item.thawHours * 3_600_000);
    if (readyAt > ctx.serviceStart) return { status: 'too_late', demand, raw, readyAt };
    if (item.shelfLifeHours !== null) {
      const usableUntil = new Date(readyAt.getTime() + item.shelfLifeHours * 3_600_000);
      if (usableUntil < ctx.serviceStart) return { status: 'expires', demand, raw, usableUntil };
    }
  }

  let suggested = raw > 0 ? Math.ceil(r2(raw / item.packSize) - 1e-9) * item.packSize : 0;
  if (suggested > 0 && suggested < item.minQty) suggested = Math.ceil(r2(item.minQty / item.packSize) - 1e-9) * item.packSize;
  suggested = r2(suggested);
  const parts = [`${fmt(demandFor(item, ctx.serviceDay))} expected`];
  if (input.adjust) parts.push(`${input.adjust > 0 ? '+' : '−'} ${fmt(Math.abs(input.adjust))} adjustment`);
  if (item.buffer) parts.push(`+ ${fmt(item.buffer)} buffer`);
  parts.push(`− ${fmt(input.chilled as number)} chilled`, `− ${fmt(input.thawing as number)} thawing`);
  const working = `${parts.join(' ')} = ${fmt(raw)}${suggested !== raw ? ` → ${fmt(suggested)} (${item.minQty > raw && raw > 0 ? `minimum ${fmt(item.minQty)}` : `packs of ${fmt(item.packSize)}`})` : ''}`;
  return { status: 'ok', demand, raw, suggested, working, rounded: suggested !== raw };
}

/** The next service's date and start time for a given trading day (service is the following day). */
export function nextService(tradingDate: string, serviceTime: string, timeZone: string): { date: string; start: Date } {
  const d = new Date(`${tradingDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const date = d.toISOString().slice(0, 10);
  const [h, m] = (/^\d{1,2}:\d{2}$/.test(serviceTime) ? serviceTime : '11:00').split(':').map(Number);
  return { date, start: zonedTime(date, h, m, timeZone) };
}

/** The instant when it's h:m on `date` in `timeZone`. */
export function zonedTime(date: string, h: number, m: number, timeZone: string): Date {
  const guess = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(guess).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}
