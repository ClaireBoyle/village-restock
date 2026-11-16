// Manager Stock Insights: patterns in restocking and defrosting history.
//
// Read-only and explainable: every signal says why it appeared. It never orders stock,
// changes targets or edits defrost settings; those stay management decisions.
//
// Data used (nothing is invented):
//  - session_items: what was needed (staff-entered amount, or target − count using the
//    target saved with the restock), what was collected, and why not (reason).
//  - defrost_entries: optional "ran out" and "discarded" records from the Defrost Planner.
// A restock request is NOT treated as sales or consumption.
import { db, getSetting } from './db';
import { serverToday } from './restocks';

export interface InsightSettings { windowDays: number; shortageDays: number; turnoverDays: number; defrostDays: number; wasteDays: number }
export const DEFAULT_SETTINGS: InsightSettings = { windowDays: 7, shortageDays: 3, turnoverDays: 5, defrostDays: 3, wasteDays: 2 };

export async function insightSettings(): Promise<InsightSettings> {
  const n = async (k: string, d: number) => {
    const v = Number(await getSetting<number>(k, d));
    return Number.isFinite(v) && v > 0 ? Math.round(v) : d;
  };
  return {
    windowDays: await n('insights_window_days', 7), shortageDays: await n('insights_shortage_days', 3),
    turnoverDays: await n('insights_turnover_days', 5), defrostDays: await n('insights_defrost_days', 3), wasteDays: await n('insights_waste_days', 2),
  };
}

export type Kind = 'recurring_shortage' | 'outpacing' | 'not_collected' | 'high_turnover' | 'defrost_shortfall' | 'over_defrost';
export interface DayRow { date: string; requested: number; collected: number | null; reason: string | null }
export interface Insight {
  kind: Kind; severity: 'attention' | 'watch' | 'info';
  product: string; department: string; unit: string;
  days: number; restockDays: number; requested: number; collected: number;
  why: string; action: string; history: DayRow[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export async function stockInsights(s: InsightSettings) {
  const sql = db();
  const today = await serverToday();
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (s.windowDays - 1));
  const since = from.toISOString().slice(0, 10);

  // One row per product per trading day, across all of that day's restocks (full and quick).
  const rows = await sql`
    with lines as (
      select s.trading_date::text as day, s.department_id, d.name as department, i.product_id, i.product_name, i.unit_plural,
        case when i.method = 'manual' then i.requested_qty
             when i.method = 'par' and i.par_level is not null and i.current_qty is not null then greatest(i.par_level - i.current_qty, 0)
        end as requested,
        i.collected_mode, i.collected_qty, i.shortfall_reason
      from session_items i
      join restock_sessions s on s.id = i.session_id
      join departments d on d.id = s.department_id
      where s.trading_date >= ${since} and s.trading_date <= ${today} and i.method <> 'routine'
    )
    select day, department_id, department, product_id, max(product_name) as product, max(unit_plural) as unit,
      sum(requested) as requested,
      sum(case when collected_mode = 'all' then requested when collected_mode = 'partial' then collected_qty end) as collected,
      bool_or(shortfall_reason = 'insufficient' and collected_mode = 'partial') as insufficient,
      bool_or(shortfall_reason in ('access', 'time') and collected_mode = 'partial') as other_reason
    from lines where requested > 0
    group by day, department_id, department, product_id`;
  const restockDays = await sql`select department_id, count(distinct trading_date)::int as n from restock_sessions
    where trading_date >= ${since} and trading_date <= ${today} group by department_id`;
  const daysFor = (dept: string) => Number(restockDays.find((r) => r.departmentId === dept)?.n ?? 0);

  type Agg = { product: string; department: string; deptId: string; unit: string; days: DayRow[]; short: number; other: number; requested: number; collected: number };
  const byProduct = new Map<string, Agg>();
  for (const r of rows) {
    const k = String(r.productId);
    const a = byProduct.get(k) ?? { product: String(r.product), department: String(r.department), deptId: String(r.departmentId), unit: String(r.unit), days: [], short: 0, other: 0, requested: 0, collected: 0 };
    const req = Number(r.requested), col = r.collected === null ? null : Number(r.collected);
    a.days.push({ date: String(r.day), requested: req, collected: col, reason: r.insufficient ? 'Not enough in storeroom' : r.otherReason ? 'Not collected (time or access)' : null });
    if (r.insufficient) a.short++;
    if (r.otherReason) a.other++;
    a.requested += req;
    a.collected += col ?? 0;
    byProduct.set(k, a);
  }

  const out: Insight[] = [];
  for (const a of byProduct.values()) {
    a.days.sort((x, y) => y.date.localeCompare(x.date));
    const needed = a.days.length;
    const rd = daysFor(a.deptId);
    const base = { product: a.product, department: a.department, unit: a.unit, restockDays: rd, requested: r1(a.requested), collected: r1(a.collected), history: a.days.slice(0, 10) };
    const highTurnover = needed >= s.turnoverDays;
    if (a.short >= s.shortageDays) {
      const shortDays = a.days.filter((d) => d.reason === 'Not enough in storeroom').map((d) => dayLabel(d.date));
      out.push({ ...base, kind: 'recurring_shortage', severity: 'attention', days: a.short,
        why: `Not enough in the storeroom on ${a.short} separate days in the last ${s.windowDays} (${shortDays.join(', ')}). Staff confirmed the shortage each time.${highTurnover ? ` It was also needed on ${needed} of ${rd} restock days.` : ''}`,
        action: `Review ordering quantities, supplier delivery timing and recent demand for ${a.product}.` });
    } else if (highTurnover && a.short > 0) {
      out.push({ ...base, kind: 'outpacing', severity: 'watch', days: needed,
        why: `Needed on ${needed} of ${rd} restock days, and the storeroom ran short ${a.short === 1 ? 'once' : `${a.short} times`}.`,
        action: `Demand may be outpacing orders. Check that the order quantity covers a typical week.` });
    } else if (highTurnover) {
      out.push({ ...base, kind: 'high_turnover', severity: 'info', days: needed,
        why: `Needed on ${needed} of ${rd} restock days (about ${r1(a.requested / needed)} ${a.unit} each time), with no storeroom shortages.`,
        action: 'High turnover, not a problem on its own. Worth keeping enough backstock and checking the target level suits the space.' });
    }
    if (a.other >= s.shortageDays) {
      out.push({ ...base, kind: 'not_collected', severity: 'info', days: a.other,
        why: `Not fully collected on ${a.other} days because of time or access, not because the storeroom was short.`,
        action: 'Not a stock problem. Check whether the collection run or storeroom access is getting in the way.' });
    }
  }

  // Defrost Planner records (only what staff actually recorded).
  const [{ has }] = await sql`select to_regclass('public.defrost_entries') is not null as has`;
  if (has) {
    const df = await sql`
      select e.item_id, max(e.item_name) as item, d.name as department, max(i.unit_plural) as unit,
        count(distinct p.service_date) filter (where e.ran_out)::int as ran_out_days,
        count(distinct p.service_date) filter (where coalesce(e.discarded_qty, 0) > 0)::int as waste_days,
        coalesce(sum(e.discarded_qty), 0) as discarded, coalesce(sum(e.defrost_qty), 0) as defrosted,
        array_agg(distinct p.service_date::text) filter (where e.ran_out) as ran_out_dates,
        array_agg(distinct p.service_date::text) filter (where coalesce(e.discarded_qty, 0) > 0) as waste_dates
      from defrost_entries e join defrost_plans p on p.id = e.plan_id join departments d on d.id = p.department_id
      left join defrost_items i on i.id = e.item_id
      where p.service_date >= ${since}::date and p.service_date <= ${today}::date + 1
      group by e.item_id, d.name`;
    for (const r of df) {
      const base = { product: String(r.item), department: String(r.department), unit: String(r.unit ?? ''), restockDays: 0, requested: 0, collected: 0, history: [] as DayRow[] };
      if (Number(r.ranOutDays) >= s.defrostDays) {
        out.push({ ...base, kind: 'defrost_shortfall', severity: 'attention', days: Number(r.ranOutDays),
          why: `Recorded as running out during service on ${r.ranOutDays} days (${(r.ranOutDates as string[]).sort().map(dayLabel).join(', ')}).`,
          action: 'Not enough was defrosted in time. Review its defrost target and timing (this is separate from storeroom stock).' });
      }
      if (Number(r.wasteDays) >= s.wasteDays) {
        out.push({ ...base, kind: 'over_defrost', severity: 'watch', days: Number(r.wasteDays), requested: r1(Number(r.defrosted)), collected: r1(Number(r.discarded)),
          why: `${r1(Number(r.discarded))} ${r.unit ?? ''} recorded as discarded on ${r.wasteDays} days (${(r.wasteDates as string[]).sort().map(dayLabel).join(', ')}), out of ${r1(Number(r.defrosted))} recorded as defrosted.`,
          action: 'Possible over-defrosting. Review the expected demand and buffer, and the days it happens on.' });
      }
    }
  }

  const order: Record<Insight['severity'], number> = { attention: 0, watch: 1, info: 2 };
  out.sort((a, b) => order[a.severity] - order[b.severity] || b.days - a.days || a.product.localeCompare(b.product));

  // 14-day trend: products short in the storeroom, per day.
  const t0 = new Date(`${today}T12:00:00Z`); t0.setUTCDate(t0.getUTCDate() - 13);
  const trendRows = await sql`
    select s.trading_date::text as day,
      count(distinct i.product_id) filter (where i.shortfall_reason = 'insufficient' and i.collected_mode = 'partial')::int as short,
      count(distinct s.id)::int as restocks
    from restock_sessions s left join session_items i on i.session_id = s.id
    where s.trading_date >= ${t0.toISOString().slice(0, 10)} and s.trading_date <= ${today}
    group by s.trading_date`;
  const trend = Array.from({ length: 14 }, (_, k) => {
    const d = new Date(t0); d.setUTCDate(t0.getUTCDate() + k);
    const day = d.toISOString().slice(0, 10);
    const r = trendRows.find((x) => x.day === day);
    return { day, label: dayLabel(day), short: Number(r?.short ?? 0), restocks: Number(r?.restocks ?? 0) };
  });
  return { insights: out, trend, since, today, products: byProduct.size };
}
