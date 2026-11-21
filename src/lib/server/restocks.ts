// Reading restocks and shortages for managers.
import { db } from './db';
import { loadCatalogue } from './catalogue';
import { tradingDate } from '@/lib/restock-math';
import { departmentView, scopeView, summaryText, withSuggestions, type AreaStatus, type Conflict, type ItemState, type PlacementView } from '@/lib/restock-logic';

export async function serverToday(): Promise<string> {
  const rows = await db()`select key, value from app_settings where key in ('timezone', 'trading_day_cutoff_hour')`;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return tradingDate(new Date(), String(get('timezone') ?? 'Australia/Melbourne'), Number(get('trading_day_cutoff_hour') ?? 5));
}

/**
 * Restocks still open from an earlier trading day were never finished.
 * Mark them "unfinished" so managers can see them. Cheap; safe to call often.
 */
export async function markUnfinished(): Promise<void> {
  const today = await serverToday();
  await db()`update restock_sessions set status = 'unfinished' where status = 'open' and trading_date < ${today}`;
}

export interface RestockRow {
  id: string; departmentName: string; theme: string; kind: 'full' | 'quick' | 'area'; areaName: string | null; tradingDate: string; status: string;
  exceptionReason: string | null; people: string[]; startedAt: string; finishedAt: string | null;
  areasDone: number; areasTotal: number; itemsTouched: number; shortages: number; conflicts: number;
}

const dateStr = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export async function listRestocks(days = 14): Promise<RestockRow[]> {
  await markUnfinished();
  const rows = await db()`
    select s.id, d.name as department_name, d.theme, s.kind, (to_jsonb(s)->>'area_name') as area_name, s.trading_date, s.status, s.exception_reason, s.people,
      s.started_at, s.finished_at,
      (select count(*) from session_areas a where a.session_id = s.id and a.status in ('complete', 'skipped'))::int as areas_done,
      (select count(*) from check_areas ca where ca.department_id = s.department_id and ca.active)::int as areas_total,
      (select count(*) from session_items i where i.session_id = s.id)::int as items_touched,
      (select count(*) from shortages sh where sh.session_id = s.id)::int as shortages,
      (select count(*) from session_items i where i.session_id = s.id and i.conflict is not null)::int as conflicts
    from restock_sessions s join departments d on d.id = s.department_id
    where s.trading_date >= (current_date - ${days}::int)
      -- An area restock opened and left with nothing entered isn't worth listing.
      and not (s.kind = 'area' and s.status <> 'finished' and s.status <> 'finished_exceptions'
               and not exists (select 1 from session_items i where i.session_id = s.id))
    order by s.trading_date desc, d.sort_order, s.kind, s.started_at desc`;
  return rows.map((r) => ({ ...r, tradingDate: dateStr(r.tradingDate) })) as unknown as RestockRow[];
}

export interface ShortageRow {
  id: string; sessionId: string | null; departmentName: string; productName: string; unitPlural: string;
  shortfallQty: number; reason: string; flagged: boolean; reportedBy: string | null; status: 'open' | 'resolved';
  createdAt: string; resolvedAt: string | null; resolvedBy: string | null; resolutionNote: string | null; tradingDate: string | null;
  /** Candy Bar: none left on display either (Out of stock). Needs migration 013. */
  noneOnDisplay?: boolean;
  /** Gold Class Bar: out · low · unconfirmed (Top-up incomplete). Needs migration 020. */
  stockStatus?: 'out' | 'low' | 'unconfirmed' | null;
}

export async function listShortages(): Promise<ShortageRow[]> {
  const rows = await db()`
    select sh.*, d.name as department_name, s.trading_date
    from shortages sh join departments d on d.id = sh.department_id
    left join restock_sessions s on s.id = sh.session_id
    where sh.status = 'open' or sh.resolved_at > now() - interval '30 days'
    order by (sh.status = 'open') desc, sh.created_at desc`;
  return rows.map((r) => ({ ...r, tradingDate: r.tradingDate ? dateStr(r.tradingDate) : null })) as unknown as ShortageRow[];
}

export async function openShortageCount(): Promise<number> {
  const [{ n }] = await db()`select count(*)::int as n from shortages where status = 'open'`;
  return Number(n);
}

/** Everything about one restock, plus the same copyable summary staff see. */
export async function restockDetail(id: string) {
  const sql = db();
  const [s] = await sql`select s.*, d.name as department_name, d.theme from restock_sessions s join departments d on d.id = s.department_id where s.id = ${id}`;
  if (!s) return null;
  const areas = await sql`select * from session_areas where session_id = ${id}`;
  const items = await sql`select * from session_items where session_id = ${id} order by product_name`;
  const shortages = await sql`select * from shortages where session_id = ${id} order by product_name`;

  const cat = await loadCatalogue();
  const whole = departmentView(cat, String(s.departmentId));
  const view = whole && s.kind === 'area' ? scopeView(whole, (s.areaId as string) ?? null) : whole;
  const itemMap = new Map<string, ItemState>(items.map((r) => [String(r.placementId), {
    currentQty: r.currentQty as number | null, requestedQty: r.requestedQty as number | null,
    routineChoice: r.routineChoice as ItemState['routineChoice'], collectedMode: r.collectedMode as ItemState['collectedMode'],
    collectedQty: r.collectedQty as number | null, shortfallReason: r.shortfallReason as ItemState['shortfallReason'],
    flagged: Boolean(r.flagged), noneOnDisplay: Boolean(r.noneOnDisplay), refillStatus: (r.refillStatus as ItemState['refillStatus']) ?? null,
    upstairsQty: r.upstairsQty === null || r.upstairsQty === undefined ? null : Number(r.upstairsQty),
    noneLeftHere: Boolean(r.noneLeftHere), statusOverride: (r.statusOverride as ItemState['statusOverride']) ?? null,
    conflict: (r.conflict as Conflict | null) ?? null,
  }]));
  const recorded = new Map<string, AreaStatus>(areas.map((a) => [String(a.checkAreaId), a.status as AreaStatus]));
  const placements: PlacementView[] = view ? (s.kind !== 'quick' ? view.placements : view.placements.filter((p) => itemMap.has(p.placementId))) : [];
  const summary = view ? summaryText({
    departmentName: String(s.departmentName), kind: s.kind as 'full' | 'quick' | 'area',
    finishedLabel: s.finishedAt ? new Date(s.finishedAt as string).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: cat.settings.timeZone }).toLowerCase() : null,
    exceptionReason: (s.exceptionReason as string) ?? null, people: (s.people as string[]) ?? [], view, placements, recordedAreas: recorded,
    completedBy: (s.completedBy as string) ?? null,
    skipReasons: new Map(areas.map((a) => [String(a.checkAreaId), String(a.skipReason ?? '')])),
    items: withSuggestions(s.kind as 'full' | 'quick' | 'area', view, itemMap, recorded, s.forecastAdmits == null ? null : Number(s.forecastAdmits)),
    dateLabel: new Date(`${dateStr(s.tradingDate)}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
  }) : '';
  const session = { ...s, tradingDate: dateStr(s.tradingDate) } as Record<string, unknown> & { tradingDate: string; people: string[] };
  return { session, areas, items, shortages, summary, view, timeZone: cat.settings.timeZone };
}
