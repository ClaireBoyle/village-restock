// Defrost rows in a restock (Gold Class Kitchen → Defrost): the suggestion from tomorrow's admits.
//
//   target     = the ready-stock target for the admits range tomorrow's forecast falls in
//   suggestion = ceil(max(0, target − already ready or defrosting) / ready units per pulled unit)
//
// e.g. target 24 bases, 10 ready → pull 14 bases; target 40 portions, 12 ready, 8 portions a bag → 4 bags.
// No target for that range, no ready count, or different units with no conversion → no suggestion:
// staff enter the amount to pull themselves (or Not needed).
import type { ReadyTarget } from './catalogue-types';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ready-stock targets as stored, kept only where they make sense, lowest range first. */
export function cleanTargets(v: unknown): ReadyTarget[] {
  if (!Array.isArray(v)) return [];
  const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN);
  return v.flatMap((t) => {
    if (!t || typeof t !== 'object') return [];
    const o = t as Record<string, unknown>;
    const min = num(o.min), qty = num(o.qty);
    const max = o.max === null || o.max === undefined || o.max === '' ? null : num(o.max);
    if (!Number.isFinite(min) || min < 0 || !Number.isFinite(qty) || qty < 0 || (max !== null && (!Number.isFinite(max) || max < min))) return [];
    return [{ min: Math.round(min), max: max === null ? null : Math.round(max), qty: r2(qty) }];
  }).sort((a, b) => a.min - b.min);
}

/** The target for this many admits, or null when no range covers it. */
export function targetFor(targets: ReadyTarget[] | undefined, admits: number | null | undefined): ReadyTarget | null {
  if (!targets?.length || admits === null || admits === undefined || !Number.isFinite(admits)) return null;
  return targets.find((t) => admits >= t.min && (t.max === null || admits <= t.max)) ?? null;
}

export interface DefrostRowInfo {
  /** Unit staff count what's ready in (the pulled unit when there's no separate one). */
  readySingular: string; readyPlural: string;
  /** Ready units per pulled unit, or null when the units differ and no conversion is set. */
  per: number | null;
  /** The row can suggest an amount (it has targets and a way to convert). */
  canSuggest: boolean;
}

export function defrostRowInfo(p: { unitSingular: string; unitPlural: string; readyUnitSingular?: string | null; readyUnitPlural?: string | null; readyPer?: number | null; readyTargets?: ReadyTarget[] }): DefrostRowInfo {
  const own = !!(p.readyUnitSingular?.trim() && p.readyUnitPlural?.trim()) && p.readyUnitPlural!.trim().toLowerCase() !== p.unitPlural.toLowerCase();
  const per = !own ? 1 : p.readyPer && p.readyPer > 0 ? p.readyPer : null;
  return {
    readySingular: own ? p.readyUnitSingular!.trim() : p.unitSingular, readyPlural: own ? p.readyUnitPlural!.trim() : p.unitPlural,
    per, canSuggest: !!p.readyTargets?.length && per !== null,
  };
}

export interface DefrostSuggestion { qty: number; target: number; ready: number; per: number; range: ReadyTarget }

/** What to pull, from tomorrow's admits and what's already ready (in the ready unit). */
export function defrostSuggestion(
  p: Parameters<typeof defrostRowInfo>[0], admits: number | null | undefined, ready: number | null | undefined,
): DefrostSuggestion | null {
  const info = defrostRowInfo(p);
  if (!info.canSuggest || ready === null || ready === undefined) return null;
  const range = targetFor(p.readyTargets, admits);
  if (!range) return null;
  const short = Math.max(0, r2(range.qty - ready));
  // (short > 0 only: ceil(0 − tiny) would be −0)
  const qty = short > 0 ? Math.ceil(r2(short / info.per!) - 1e-9) : 0;
  return { qty, target: range.qty, ready, per: info.per!, range };
}

/** Targets as admins type them, one range per line: "0-150: 24", "151+: 36" (admits: ready target). */
export function formatTargets(targets: ReadyTarget[]): string {
  return targets.map((t) => `${t.min}${t.max === null ? '+' : `-${t.max}`}: ${t.qty}`).join('\n');
}

export function parseTargets(text: string): { ok: true; targets: ReadyTarget[] } | { ok: false; message: string } {
  const out: ReadyTarget[] = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s*(?:(\+)|[-–]\s*(\d+))\s*(?:admits)?\s*[:=]\s*(\d+(?:[.,]\d+)?)$/i);
    if (!m) return { ok: false, message: `"${line}" isn't a target. Use one range per line, e.g. 0-150: 24 or 151+: 36.` };
    const min = Number(m[1]), max = m[2] ? null : Number(m[3]), qty = Number(m[4].replace(',', '.'));
    if (max !== null && max < min) return { ok: false, message: `"${line}": the range goes from low to high, e.g. 0-150.` };
    if (min > 9999 || (max ?? 0) > 9999 || qty > 9999) return { ok: false, message: `"${line}": that number looks too high.` };
    out.push({ min, max, qty });
  }
  out.sort((a, b) => a.min - b.min);
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    if (prev.max === null || out[i].min <= prev.max) return { ok: false, message: 'Two admits ranges overlap. Give each number of admits one target.' };
  }
  if (out.length > 12) return { ok: false, message: 'Use at most 12 ranges.' };
  return { ok: true, targets: out };
}
