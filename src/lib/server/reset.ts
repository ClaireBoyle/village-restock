// Admin-only: reset a restock (or clear test activity) safely across every device.
//
// A reset deletes the restock row; its entries, area records and email go with it
// (foreign keys cascade) and its shortages are deleted explicitly. A small record is kept
// in restock_resets so that any device still holding the old restock, or changes queued
// for it while offline, is told "this was reset" and drops them. Nothing in the catalogue
// (products, photos, areas, storerooms, targets, settings) is touched.
import type postgres from 'postgres';
import { db } from './db';

type Tx = postgres.TransactionSql<Record<string, unknown>> | postgres.Sql<Record<string, unknown>>;

export type ResetKind = 'full' | 'quick' | 'area';
export interface ResetScope { departmentId: string; kind: ResetKind; tradingDate: string; areaId?: string | null; sessionIds?: string[] }
export interface ResetTarget {
  id: string; departmentId: string; departmentName: string; kind: ResetKind; areaName: string | null; tradingDate: string;
  status: string; startedAt: string; finishedAt: string | null; people: string[];
  entered: number; collected: number; shortages: number;
}

let ready: boolean | null = null;
/** Migration 010 adds the reset records. Until it runs, resets are refused (never half done). */
export async function resetsReady(tx: Tx = db()): Promise<boolean> {
  if (ready) return true;
  const [{ ok }] = await tx`select to_regclass('public.restock_resets') is not null and to_regclass('public.defrost_resets') is not null as ok`;
  ready = Boolean(ok);
  return ready;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

async function describe(where: postgres.PendingQuery<postgres.Row[]>): Promise<ResetTarget[]> {
  const rows = await db()`
    select s.id, s.department_id, d.name as department_name, s.kind, (to_jsonb(s)->>'area_name') as area_name, s.trading_date, s.status,
      s.started_at, s.finished_at, s.people,
      (select count(*) from session_items i where i.session_id = s.id
         and (i.current_qty is not null or i.requested_qty is not null or i.routine_choice is not null))::int as entered,
      (select count(*) from session_items i where i.session_id = s.id and i.collected_mode is not null)::int as collected,
      (select count(*) from shortages sh where sh.session_id = s.id)::int as shortages
    from restock_sessions s join departments d on d.id = s.department_id
    where ${where}
    order by s.trading_date desc, d.sort_order, s.started_at desc`;
  return rows.map((r) => ({
    id: String(r.id), departmentId: String(r.departmentId), departmentName: String(r.departmentName), kind: r.kind as ResetKind,
    areaName: (r.areaName as string) ?? null, tradingDate: day(r.tradingDate), status: String(r.status),
    startedAt: iso(r.startedAt)!, finishedAt: iso(r.finishedAt), people: (r.people as string[]) ?? [],
    entered: Number(r.entered), collected: Number(r.collected), shortages: Number(r.shortages),
  }));
}

/** What a reset of this scope would erase (for the confirmation). Only ever one department. */
export async function previewReset(scope: ResetScope): Promise<ResetTarget[]> {
  const sql = db();
  const area = scope.kind === 'area' ? sql`and (to_jsonb(s)->>'area_id') = ${scope.areaId ?? ''}` : sql``;
  const ids = scope.sessionIds?.length ? sql`and s.id in ${sql(scope.sessionIds)}` : scope.kind === 'quick' ? sql`and false` : sql``;
  return describe(sql`s.department_id = ${scope.departmentId} and s.trading_date = ${scope.tradingDate} and s.kind = ${scope.kind} ${area} ${ids}`);
}

/** Every restock in the last `days` days, for "Clear test activity". */
export async function listActivity(days = 60): Promise<ResetTarget[]> {
  const sql = db();
  return describe(sql`s.trading_date >= current_date - ${days}::int`);
}

export interface DefrostActivity { departmentId: string; departmentName: string; serviceDate: string; items: number; people: string[] }
export async function listDefrostActivity(days = 60): Promise<DefrostActivity[]> {
  const sql = db();
  const [{ has }] = await sql`select to_regclass('public.defrost_plans') is not null as has`;
  if (!has) return [];
  const rows = await sql`
    select p.department_id, d.name as department_name, p.service_date, p.people,
      (select count(*) from defrost_entries e where e.plan_id = p.id)::int as items
    from defrost_plans p join departments d on d.id = p.department_id
    where p.service_date >= current_date - ${days}::int order by p.service_date desc, d.sort_order`;
  return rows.map((r) => ({ departmentId: String(r.departmentId), departmentName: String(r.departmentName), serviceDate: day(r.serviceDate), items: Number(r.items), people: (r.people as string[]) ?? [] }));
}

/**
 * Reset these restocks. With `departmentId`, every one must belong to that department
 * (nothing else is touched if any doesn't). Returns how many were reset.
 */
export async function resetSessions(ids: string[], opts: { departmentId?: string; by: string | null }): Promise<number> {
  if (!ids.length) return 0;
  if (!(await resetsReady())) throw new Error('Run db/migrations/010_restock_resets.sql in Supabase first.');
  return db().begin(async (tx) => {
    await tx`set local lock_timeout = '8s'`;
    const rows = await tx`select id, department_id, kind, trading_date, (to_jsonb(restock_sessions)->>'area_id') as area_id
      from restock_sessions where id in ${tx(ids)} for update`;
    if (opts.departmentId && rows.some((r) => String(r.departmentId) !== opts.departmentId)) {
      throw new Error('Those restocks belong to another department. Nothing was reset.');
    }
    for (const r of rows) {
      await tx`insert into restock_resets (session_id, department_id, kind, trading_date, area_id, reset_by)
        values (${String(r.id)}, ${String(r.departmentId)}, ${String(r.kind)}, ${r.tradingDate as string}, ${(r.areaId as string) ?? null}, ${opts.by})
        on conflict (session_id) do update set reset_at = now(), reset_by = excluded.reset_by`;
    }
    const found = rows.map((r) => String(r.id));
    if (!found.length) return 0;
    // Shortages only point loosely at their restock, so remove them first; entries, areas and emails cascade.
    await tx`delete from shortages where session_id in ${tx(found)}`;
    await tx`delete from restock_sessions where id in ${tx(found)}`;
    return found.length;
  });
}

/** Clear Defrost Planner records for these department + service dates (test activity). */
export async function resetDefrost(pairs: { departmentId: string; serviceDate: string }[], by: string | null): Promise<number> {
  if (!pairs.length) return 0;
  if (!(await resetsReady())) throw new Error('Run db/migrations/010_restock_resets.sql in Supabase first.');
  return db().begin(async (tx) => {
    let n = 0;
    for (const p of pairs) {
      await tx`insert into defrost_resets (department_id, service_date, reset_by) values (${p.departmentId}, ${p.serviceDate}, ${by})
        on conflict (department_id, service_date) do update set reset_at = now(), reset_by = excluded.reset_by`;
      const del = await tx`delete from defrost_plans where department_id = ${p.departmentId} and service_date = ${p.serviceDate} returning id`;
      n += del.length;
    }
    return n;
  });
}

/** Recent resets, for devices to drop their old copies. */
export async function recentResets(days = 30): Promise<{ sessions: string[]; defrost: { departmentId: string; serviceDate: string; resetAt: string }[] }> {
  if (!(await resetsReady())) return { sessions: [], defrost: [] };
  const sql = db();
  const s = await sql`select session_id from restock_resets where reset_at > now() - make_interval(days => ${days})`;
  const d = await sql`select department_id, service_date, reset_at from defrost_resets where reset_at > now() - make_interval(days => ${days})`;
  return {
    sessions: s.map((r) => String(r.sessionId)),
    defrost: d.map((r) => ({ departmentId: String(r.departmentId), serviceDate: day(r.serviceDate), resetAt: iso(r.resetAt)! })),
  };
}

// ---------------------------------------------------------------------------
// Used by sync: is this restock (or a restock started before a reset of its scope) gone?
// ---------------------------------------------------------------------------
export async function sessionWasReset(tx: Tx, sessionId: string): Promise<boolean> {
  if (!(await resetsReady(tx))) return false;
  const [r] = await tx`select 1 from restock_resets where session_id = ${sessionId}`;
  return !!r;
}

/**
 * A restock started on a device BEFORE an admin reset the same department, kind, day (and area)
 * is old test work arriving late (e.g. from an offline device): it must not come back.
 */
export async function startedBeforeReset(tx: Tx, s: { departmentId: string; kind: ResetKind; tradingDate: string; areaId?: string | null; startedAt: string }): Promise<boolean> {
  if (s.kind === 'quick' || !(await resetsReady(tx))) return false;
  const area = s.kind === 'area' ? tx`and area_id = ${s.areaId ?? null}` : tx``;
  const [r] = await tx`select 1 from restock_resets where department_id = ${s.departmentId} and trading_date = ${s.tradingDate}
    and kind = ${s.kind} ${area} and reset_at >= ${s.startedAt} limit 1`;
  return !!r;
}

/** Defrost entries made before an admin cleared that department's service date. */
export async function defrostWasReset(tx: Tx, departmentId: string, serviceDate: string, at: string): Promise<boolean> {
  if (!(await resetsReady(tx))) return false;
  const [r] = await tx`select 1 from defrost_resets where department_id = ${departmentId} and service_date = ${serviceDate} and reset_at >= ${at}`;
  return !!r;
}
