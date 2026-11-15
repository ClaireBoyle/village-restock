import type postgres from 'postgres';
import { db } from './db';
import { loadCatalogue } from './catalogue';
import { queueRestockEmail } from './email';
import {
  CONFLICT_FIELDS, EMPTY_ITEM, activePlacements, areaStatus, isChecked, stockOutcomes, type Conflict, collectionLines, departmentView, exceptions, lineGot, lineInfo, lineState,
  type AreaStatus, type ItemState,
} from '@/lib/restock-logic';
import { opSchema, type ItemFields, type OpResult, type RemoteSession, type SyncOp } from '@/lib/sync-types';

type Tx = postgres.TransactionSql<Record<string, unknown>>;

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005);

class OpError extends Error {
  constructor(message: string, public permanent = true) { super(message); }
}

const COLUMN: Record<keyof ItemFields, string> = {
  currentQty: 'current_qty', requestedQty: 'requested_qty', routineChoice: 'routine_choice',
  collectedMode: 'collected_mode', collectedQty: 'collected_qty', shortfallReason: 'shortfall_reason', flagged: 'flagged',
};

/** Apply a batch of ops from one device, each on its own, in order. */
export async function applyOps(deviceId: string, rawOps: unknown[]): Promise<OpResult[]> {
  const results: OpResult[] = [];
  for (const raw of rawOps) {
    const parsed = opSchema.safeParse(raw);
    const opId = typeof (raw as { opId?: unknown })?.opId === 'string' ? (raw as { opId: string }).opId : 'unknown';
    if (!parsed.success) {
      results.push({ opId, ok: false, error: `Invalid change: ${parsed.error.issues[0]?.message ?? 'bad data'}`, permanent: true });
      continue;
    }
    results.push(await applyOne(deviceId, parsed.data));
  }
  return results;
}

async function applyOne(deviceId: string, op: SyncOp): Promise<OpResult> {
  try {
    return await db().begin(async (tx) => {
      // Already applied? Return what happened the first time.
      const [seen] = await tx`select result from sync_ops where op_id = ${op.opId}`;
      if (seen) return seen.result as OpResult;
      const extra = await apply(tx, op, deviceId);
      const result: OpResult = { opId: op.opId, ok: true, ...extra };
      await tx`insert into sync_ops (op_id, device_id, result) values (${op.opId}, ${deviceId}, ${tx.json(result)})`;
      return result;
    });
  } catch (e) {
    if (e instanceof OpError) return { opId: op.opId, ok: false, error: e.message, permanent: e.permanent };
    console.error('sync op failed', op.type, e);
    return { opId: op.opId, ok: false, error: 'Server error, will retry', permanent: false };
  }
}

async function addPerson(tx: Tx, sessionId: string, by: string | null) {
  if (!by) return;
  await tx`update restock_sessions set people = array_append(people, ${by}), updated_at = now()
    where id = ${sessionId} and not (${by} = any(people))`;
}

async function sessionRow(tx: Tx, id: string) {
  const [s] = await tx`select id, department_id, kind, status from restock_sessions where id = ${id} for update`;
  if (!s) throw new OpError('Restock not found on the server yet', false); // its start op may still be on its way
  return s;
}

async function apply(tx: Tx, op: SyncOp, deviceId: string): Promise<{ mergedInto?: string; conflict?: boolean }> {
  switch (op.type) {
    case 'session.start': {
      const s = op.session;
      const [dept] = await tx`select id from departments where id = ${s.departmentId}`;
      if (!dept) throw new OpError('That department no longer exists');
      if (s.kind === 'full') {
        // One full restock per department per trading day: join the existing one.
        const [existing] = await tx`select id from restock_sessions
          where department_id = ${s.departmentId} and trading_date = ${s.tradingDate} and kind = 'full' and id <> ${s.id}`;
        if (existing) {
          await addPerson(tx, String(existing.id), op.by);
          return { mergedInto: String(existing.id) };
        }
      }
      await tx`insert into restock_sessions (id, department_id, kind, trading_date, started_at, people)
        values (${s.id}, ${s.departmentId}, ${s.kind}, ${s.tradingDate}, ${s.startedAt}, ${op.by ? [op.by] : []})
        on conflict (id) do nothing`;
      return {};
    }

    case 'item.set': {
      const s = await sessionRow(tx, op.sessionId);
      const [pl] = await tx`
        select pl.id, pl.check_area_id, pl.par_level, p.id as product_id, p.name, p.unit_singular, p.unit_plural, p.method,
               p.allow_decimal, coalesce(l1.name, l2.name) as location_name
        from product_placements pl join products p on p.id = pl.product_id
        left join storage_locations l1 on l1.id = pl.location_id
        left join storage_locations l2 on l2.id = p.default_location_id
        where pl.id = ${op.placementId} and p.department_id = ${String(s.departmentId)}`;
      const [existing] = await tx`select * from session_items where session_id = ${op.sessionId} and placement_id = ${op.placementId} for update`;
      if (!pl && !existing) throw new OpError('That product is no longer in this department');
      const f = op.fields;
      if (pl && !pl.allowDecimal) {
        for (const k of ['currentQty', 'requestedQty'] as const) {
          const v = f[k];
          if (v != null && !Number.isInteger(v)) throw new OpError(`Whole ${pl.unitPlural} only`);
        }
      }
      const round = (v: number | null | undefined) => (v == null ? v : Math.round(v * 100) / 100);
      const values: Record<string, unknown> = {};
      for (const [k, col] of Object.entries(COLUMN) as [keyof ItemFields, string][]) {
        if (k in f) values[col] = typeof f[k] === 'number' ? round(f[k] as number) : f[k];
      }
      // Two people disagreeing: this device changed a count from a value it saw,
      // but someone on ANOTHER device has since saved a different value. Keep
      // theirs, record both, and let a person choose. (Never silently overwrite.)
      let conflict: Conflict | null = null;
      if (existing && !op.resolve) {
        for (const field of CONFLICT_FIELDS) {
          if (!(field in f)) continue;
          const col = COLUMN[field];
          const server = existing[field] as number | string | null;
          const seen = op.base && field in op.base ? (op.base[field] as number | string | null) : null;
          const mine = f[field] as number | string | null;
          if (existing.updatedDevice !== deviceId && !same(server, seen) && !same(server, mine)) {
            conflict = { field, theirs: server, theirsBy: (existing.updatedBy as string) ?? null, theirsAt: existing.updatedAt ? new Date(existing.updatedAt as string).toISOString() : null, mine, mineBy: op.by, mineAt: op.at };
            delete values[col];
          }
        }
      }
      if (op.resolve) values.conflict = null;
      else if (conflict) values.conflict = tx.json(conflict as unknown as postgres.JSONValue) as unknown;
      if (!existing) {
        await tx`insert into session_items ${tx({
          session_id: op.sessionId, placement_id: op.placementId, product_id: String(pl.productId), check_area_id: String(pl.checkAreaId),
          product_name: String(pl.name), unit_singular: String(pl.unitSingular), unit_plural: String(pl.unitPlural), method: String(pl.method),
          par_level: pl.parLevel as number | null, location_name: (pl.locationName as string) ?? null,
          updated_by: op.by, updated_at: op.at, updated_device: deviceId, ...values,
        } as Record<string, postgres.ParameterOrJSON<never>>)}`;
      } else if (Object.keys(values).length) {
        const stamp = conflict && Object.keys(values).length === 1 ? {} : { updated_by: op.by, updated_at: op.at, updated_device: deviceId };
        await tx`update session_items set ${tx({ ...values, ...stamp } as Record<string, postgres.ParameterOrJSON<never>>)},
          version = version + 1 where session_id = ${op.sessionId} and placement_id = ${op.placementId}`;
      }
      await addPerson(tx, op.sessionId, op.by);
      return conflict ? { conflict: true } : {};
    }

    case 'area.set': {
      await sessionRow(tx, op.sessionId);
      if (op.status === 'skipped' && !op.skipReason) throw new OpError('A skipped area needs a reason');
      const [a] = await tx`select name from check_areas where id = ${op.areaId}`;
      if (!a) throw new OpError('That area no longer exists');
      await tx`insert into session_areas (session_id, check_area_id, area_name, status, skip_reason, updated_by, updated_at)
        values (${op.sessionId}, ${op.areaId}, ${String(a.name)}, ${op.status}, ${op.status === 'skipped' ? op.skipReason : null}, ${op.by}, ${op.at})
        on conflict (session_id, check_area_id) do update set status = excluded.status, skip_reason = excluded.skip_reason,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at, version = session_areas.version + 1`;
      await addPerson(tx, op.sessionId, op.by);
      return {};
    }

    case 'session.finish': {
      const s = await sessionRow(tx, op.sessionId);
      await finishSession(tx, { id: op.sessionId, departmentId: String(s.departmentId), kind: s.kind as 'full' | 'quick' }, op.exceptionReason, op.at, op.by, op.note ?? null);
      await addPerson(tx, op.sessionId, op.by);
      return {};
    }

    case 'session.reopen': {
      await sessionRow(tx, op.sessionId);
      await tx`update restock_sessions set status = 'open', finished_at = null, exception_reason = null where id = ${op.sessionId}`;
      await tx`delete from shortages where session_id = ${op.sessionId} and status = 'open'`;
      return {};
    }
  }
}

/**
 * Finish a restock. The server re-checks the work itself: if anything is
 * outstanding it is recorded as "finished with exceptions" even if the device
 * said otherwise. Shortages (confirmed or flagged) are written for managers.
 */
let hasNoteColumn: boolean | null = null;
/** Migration 004 adds finish_note; until it's run, comments still go in the email. */
async function noteColumn(tx: Tx): Promise<boolean> {
  if (hasNoteColumn === null) {
    const r = await tx`select 1 from information_schema.columns where table_name = 'restock_sessions' and column_name = 'finish_note'`;
    hasNoteColumn = r.length > 0;
  }
  return hasNoteColumn;
}

async function finishSession(tx: Tx, s: { id: string; departmentId: string; kind: 'full' | 'quick' }, reason: string | null, at: string, by: string | null, note: string | null) {
  const comment = note?.trim() ? note.trim() : null;
  const cat = await loadCatalogue();
  const view = departmentView(cat, s.departmentId);
  const rows = await tx`select * from session_items where session_id = ${s.id}`;
  const areaRows = await tx`select check_area_id, status from session_areas where session_id = ${s.id}`;
  const items = new Map<string, ItemState>(rows.map((r) => [String(r.placementId), {
    currentQty: r.currentQty as number | null, requestedQty: r.requestedQty as number | null,
    routineChoice: r.routineChoice as ItemState['routineChoice'], collectedMode: r.collectedMode as ItemState['collectedMode'],
    collectedQty: r.collectedQty as number | null, shortfallReason: r.shortfallReason as ItemState['shortfallReason'], flagged: Boolean(r.flagged),
    conflict: (r.conflict as Conflict | null) ?? null,
  }]));
  const recorded = new Map<string, AreaStatus>(areaRows.map((r) => [String(r.checkAreaId), r.status as AreaStatus]));

  let status: 'finished' | 'finished_exceptions' = reason ? 'finished_exceptions' : 'finished';
  let finalReason = reason;
  if (view) {
    // Quick restocks cover only the products staff touched.
    const placements = s.kind === 'full' ? view.placements : view.placements.filter((p) => items.has(p.placementId));
    const ex = exceptions({ kind: s.kind, view, placements, recordedAreas: recorded, items });
    if (ex.length && !reason) { status = 'finished_exceptions'; finalReason = 'Finished with outstanding work'; }

    await tx`delete from shortages where session_id = ${s.id} and status = 'open'`;
    for (const line of collectionLines(activePlacements(s.kind, placements, recorded), items)) {
      if (line.kind !== 'qty') continue;
      const st = lineState(line, items), info = lineInfo(line, items);
      const short = Math.round((line.total - lineGot(line, items)) * 100) / 100;
      if (!(st === 'short' || info.flagged) || short <= 0) continue;
      if (info.reason !== 'insufficient' && !info.flagged) continue; // only confirmed shortages, or ones flagged for a manager
      const productId = view.byId.get(line.parts[0].placementId)?.productId ?? null;
      await tx`insert into shortages (session_id, department_id, product_id, product_name, unit_plural, shortfall_qty, reason, flagged, reported_by)
        values (${s.id}, ${s.departmentId}, ${productId}, ${line.productName}, ${line.unitPlural}, ${short}, ${info.reason ?? 'other'}, ${info.flagged}, ${by})`;
    }
  }
  await tx`update restock_sessions set status = ${status}, exception_reason = ${finalReason}, finished_at = ${at} where id = ${s.id}`;
  if (await noteColumn(tx)) await tx`update restock_sessions set finish_note = ${comment} where id = ${s.id}`;

  // Full restocks: queue the manager email in this same transaction.
  if (s.kind === 'full' && view) {
    const [row] = await tx`select people from restock_sessions where id = ${s.id}`;
    const [dept] = await tx`select name from departments where id = ${s.departmentId}`;
    const notChecked: string[] = [];
    for (const { area, placements: ps } of view.areas) {
      const st = areaStatus(recorded.get(area.id), ps, items);
      if (st === 'skipped') {
        const [a] = await tx`select skip_reason from session_areas where session_id = ${s.id} and check_area_id = ${area.id}`;
        notChecked.push(`${area.name} skipped (${a?.skipReason ?? 'no reason'})`);
      } else if (st !== 'complete') {
        const un = ps.filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).map((p) => p.productName);
        if (un.length) notChecked.push(`${area.name}: ${un.join(', ')}`);
      }
    }
    const lines = collectionLines(activePlacements('full', view.placements, recorded), items);
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    await queueRestockEmail(tx, s.id, at, {
      departmentName: String(dept?.name ?? view.department.name),
      finishedLabel: `${new Date(at).toLocaleDateString('en-AU', { timeZone: cat.settings.timeZone, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')}, ${new Date(at).toLocaleTimeString('en-AU', { timeZone: cat.settings.timeZone, hour: 'numeric', minute: '2-digit' }).toLowerCase()}`,
      people: (row?.people as string[]) ?? [], exceptionReason: finalReason,
      outcomes: stockOutcomes(lines, items, view.byId), notChecked, note: comment,
      link: host ? `https://${host}/admin/restocks/${s.id}` : null,
    });
  }
}

// ---------------------------------------------------------------------------
// Reading sessions (handover between devices, home screen status)
// ---------------------------------------------------------------------------
function toRemote(s: Record<string, unknown>, areas: Record<string, unknown>[], items: Record<string, unknown>[]): RemoteSession {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: String(s.id), departmentId: String(s.departmentId), kind: s.kind as 'full' | 'quick',
    tradingDate: s.tradingDate instanceof Date ? s.tradingDate.toISOString().slice(0, 10) : String(s.tradingDate).slice(0, 10),
    status: s.status as RemoteSession['status'], exceptionReason: (s.exceptionReason as string) ?? null, note: (s.finishNote as string) ?? null,
    people: (s.people as string[]) ?? [], startedAt: iso(s.startedAt)!, finishedAt: iso(s.finishedAt), updatedAt: iso(s.updatedAt)!,
    areas: areas.map((a) => ({ areaId: String(a.checkAreaId), status: a.status as RemoteSession['areas'][number]['status'], skipReason: (a.skipReason as string) ?? null, updatedBy: (a.updatedBy as string) ?? null, updatedAt: iso(a.updatedAt)! })),
    items: items.map((r) => ({
      placementId: String(r.placementId), updatedBy: (r.updatedBy as string) ?? null, updatedAt: iso(r.updatedAt)!,
      currentQty: (r.currentQty as number) ?? null, requestedQty: (r.requestedQty as number) ?? null,
      routineChoice: (r.routineChoice as 'needed' | 'not_needed') ?? null, collectedMode: (r.collectedMode as 'all' | 'partial') ?? null,
      collectedQty: (r.collectedQty as number) ?? null, shortfallReason: (r.shortfallReason as RemoteSession['items'][number]['shortfallReason']) ?? null,
      flagged: Boolean(r.flagged), conflict: (r.conflict as Conflict | null) ?? null,
    })),
  };
}

export async function getSession(id: string): Promise<RemoteSession | null> {
  const sql = db();
  const [s] = await sql`select * from restock_sessions where id = ${id}`;
  if (!s) return null;
  const areas = await sql`select * from session_areas where session_id = ${id}`;
  const items = await sql`select * from session_items where session_id = ${id}`;
  return toRemote(s, areas, items);
}

/** Full restocks for one trading day, with their areas and items, for every department. */
export async function sessionsForDay(tradingDate: string): Promise<RemoteSession[]> {
  const sql = db();
  const sessions = await sql`select * from restock_sessions where trading_date = ${tradingDate} and kind = 'full'`;
  if (!sessions.length) return [];
  const ids = sessions.map((s) => String(s.id));
  const areas = await sql`select * from session_areas where session_id in ${sql(ids)}`;
  const items = await sql`select * from session_items where session_id in ${sql(ids)}`;
  return sessions.map((s) => toRemote(s, areas.filter((a) => a.sessionId === s.id), items.filter((i) => i.sessionId === s.id)));
}

export { EMPTY_ITEM };
