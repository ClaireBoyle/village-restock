import type postgres from 'postgres';
import { prepLines, type PrepGroup } from '@/lib/prep';
import { db } from './db';
import { loadCatalogue } from './catalogue';
import { queueRestockEmail } from './email';
import {
  CONFLICT_FIELDS, EMPTY_ITEM, areaStatus, pendingRefills, isChecked, isRequired, stockOutcomes, type Conflict, collectionLines, collectPlacements, withSuggestions, departmentView, exceptions, lineGot, lineInfo, lineState,
  scopeView, type AreaStatus, type ItemState, type SessionKind,
} from '@/lib/restock-logic';
import { defrostWasReset, sessionWasReset, startedBeforeReset } from './reset';
import { opSchema, type ItemFields, type OpResult, type RemoteSession, type SyncOp } from '@/lib/sync-types';

type Tx = postgres.TransactionSql<Record<string, unknown>>;

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005);

class OpError extends Error {
  constructor(message: string, public permanent = true, public reset = false) { super(message); }
}
const RESET = 'An admin reset this restock. It has been cleared from this device.';

const COLUMN: Record<keyof ItemFields, string> = {
  currentQty: 'current_qty', requestedQty: 'requested_qty', routineChoice: 'routine_choice',
  collectedMode: 'collected_mode', collectedQty: 'collected_qty', shortfallReason: 'shortfall_reason', flagged: 'flagged',
  noneOnDisplay: 'none_on_display', refillStatus: 'refill_status',
};

/** Migration 018 adds refill tasks. */
let hasRefill = false;
async function refillReady(tx: Tx) {
  if (!hasRefill) hasRefill = (await tx`select 1 from information_schema.columns where table_name = 'session_items' and column_name = 'refill_status'`).length > 0;
  return hasRefill;
}

/** Migration 013 adds "None on display". Remembered once it's there (it's never taken away). */
let hasNoneOnDisplay = false;
async function noneOnDisplayReady(tx: Tx) {
  if (!hasNoneOnDisplay) {
    hasNoneOnDisplay = (await tx`select 1 from information_schema.columns where table_name = 'session_items' and column_name = 'none_on_display'`).length > 0;
  }
  return hasNoneOnDisplay;
}

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
      // A stuck connection holding a lock must not freeze every upload: give up quickly and retry later.
      await tx`set local lock_timeout = '4s'`;
      await tx`set local statement_timeout = '15s'`;
      // Already applied? Return what happened the first time.
      const [seen] = await tx`select result from sync_ops where op_id = ${op.opId}`;
      if (seen) return seen.result as OpResult;
      const extra = await apply(tx, op, deviceId);
      const result: OpResult = { opId: op.opId, ok: true, ...extra };
      await tx`insert into sync_ops (op_id, device_id, result) values (${op.opId}, ${deviceId}, ${tx.json(result)})`;
      return result;
    });
  } catch (e) {
    if (e instanceof OpError) return { opId: op.opId, ok: false, error: e.message, permanent: e.permanent, ...(e.reset ? { reset: true } : {}) };
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
  const [s] = await tx`select id, department_id, kind, status, (to_jsonb(restock_sessions)->>'area_id') as area_id from restock_sessions where id = ${id} for update`;
  if (!s) {
    // Reset by an admin: never let late changes bring it back.
    if (await sessionWasReset(tx, id)) throw new OpError(RESET, true, true);
    throw new OpError('Restock not found on the server yet', false); // its start op may still be on its way
  }
  return s;
}

async function apply(tx: Tx, op: SyncOp, deviceId: string): Promise<{ mergedInto?: string; conflict?: boolean }> {
  switch (op.type) {
    case 'session.start': {
      const s = op.session;
      // An old copy of a reset restock, or one started before a reset of the same restock (e.g. offline): drop it.
      if (await sessionWasReset(tx, s.id) || await startedBeforeReset(tx, { ...s, areaId: s.areaId ?? null })) throw new OpError(RESET, true, true);
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
      if (s.kind === 'area') {
        const [area] = await tx`select name from check_areas where id = ${s.areaId!} and department_id = ${s.departmentId}`;
        if (!area) throw new OpError('That area no longer exists');
        // Needs migration 009 (kind 'area' and the area columns). Until then, retry later rather than lose it.
        const [{ ok }] = await tx`select exists (select 1 from information_schema.columns where table_name = 'restock_sessions' and column_name = 'area_id') as ok`;
        if (!ok) throw new OpError('The server needs a database update (009_area_restocks.sql)', false);
        await tx`insert into restock_sessions (id, department_id, kind, trading_date, started_at, people, area_id, area_name)
          values (${s.id}, ${s.departmentId}, 'area', ${s.tradingDate}, ${s.startedAt}, ${op.by ? [op.by] : []}, ${s.areaId!}, ${String(area.name)})
          on conflict (id) do nothing`;
        return {};
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
      // Before migration 013: a cleared "None on display" is simply not stored; a set one waits for the update.
      if ('refillStatus' in f && !(await refillReady(tx))) {
        if (f.refillStatus) throw new OpError('The server needs a database update (018_refills_and_linked_rows.sql)', false);
        delete f.refillStatus;
      }
      if ('noneOnDisplay' in f && !(await noneOnDisplayReady(tx))) {
        if (f.noneOnDisplay) throw new OpError('The server needs a database update (013_none_on_display.sql)', false);
        delete f.noneOnDisplay;
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
      await finishSession(tx, { id: op.sessionId, departmentId: String(s.departmentId), kind: s.kind as SessionKind, areaId: (s.areaId as string) ?? null }, op.exceptionReason, op.at, op.by, op.note ?? null,
        op.completedBy?.trim() || op.by || null);
      await addPerson(tx, op.sessionId, op.by);
      return {};
    }

    case 'prep.set': {
      const s = await sessionRow(tx, op.sessionId);
      // Needs migration 017. Until then, keep it on the device and retry later rather than lose it.
      if (!(await prepTables(tx))) throw new OpError('The server needs a database update (017_morning_prep.sql)', false);
      if (op.status === null) { await tx`delete from prep_handovers where session_id = ${op.sessionId}`; return {}; }
      const [row] = await tx`select trading_date from restock_sessions where id = ${op.sessionId}`;
      await tx`insert into prep_handovers (session_id, department_id, trading_date, status, updated_by, updated_at)
        values (${op.sessionId}, ${String(s.departmentId)}, ${row.tradingDate as string}, ${op.status}, ${op.by}, ${op.at})
        on conflict (session_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at`;
      const items = op.status === 'none' ? [] : op.items;
      const ids = items.map((i) => i.id);
      if (ids.length) await tx`delete from prep_handover_items where session_id = ${op.sessionId} and not (id in ${tx(ids)})`;
      else await tx`delete from prep_handover_items where session_id = ${op.sessionId}`;
      // A task id from an old checklist that no longer exists is kept as typed text.
      const taskIds = [...new Set(items.flatMap((i) => (i.taskId ? [i.taskId] : [])))];
      const known = new Set((taskIds.length ? await tx`select id from prep_tasks where id in ${tx(taskIds)}` : []).map((r) => String(r.id)));
      for (const [n, i] of items.entries()) {
        const taskId = i.taskId && known.has(i.taskId) ? i.taskId : null;
        // Done marks are the morning team's: kept when the closing team edits the list.
        await tx`insert into prep_handover_items (id, session_id, task_id, grp, name, qty, note, sort_order, updated_at)
          values (${i.id}, ${op.sessionId}, ${taskId}, ${i.group}, ${i.name}, ${i.qty || null}, ${i.note || null}, ${n}, ${op.at})
          on conflict (id) do update set task_id = excluded.task_id, grp = excluded.grp, name = excluded.name, qty = excluded.qty,
            note = excluded.note, sort_order = excluded.sort_order, updated_at = excluded.updated_at
          where prep_handover_items.session_id = ${op.sessionId}`;
      }
      return {};
    }

    case 'prep.done': {
      await sessionRow(tx, op.sessionId);
      if (!(await prepTables(tx))) throw new OpError('The server needs a database update (017_morning_prep.sql)', false);
      const r = await tx`update prep_handover_items set done_at = ${op.done ? op.at : null}, done_by = ${op.done ? op.by : null}, updated_at = now()
        where id = ${op.itemId} and session_id = ${op.sessionId} returning id`;
      // The list may still be on its way from the closing team's device: try again shortly.
      if (!r.length) throw new OpError('That prep task isn’t on the server yet', false);
      return {};
    }

    case 'session.admits': {
      await sessionRow(tx, op.sessionId);
      // Needs migration 016. Until then, keep it on the device and retry later rather than lose it.
      if (!(await admitsColumn(tx))) throw new OpError('The server needs a database update (016_defrost_rows.sql)', false);
      await tx`update restock_sessions set forecast_admits = ${op.admits}, updated_at = now() where id = ${op.sessionId}`;
      await addPerson(tx, op.sessionId, op.by);
      return {};
    }

    case 'session.reopen': {
      await sessionRow(tx, op.sessionId);
      await tx`update restock_sessions set status = 'open', finished_at = null, exception_reason = null where id = ${op.sessionId}`;
      await tx`delete from shortages where session_id = ${op.sessionId} and status = 'open'`;
      return {};
    }

    case 'defrost.set': {
      if (await defrostWasReset(tx, op.departmentId, op.serviceDate, op.at)) throw new OpError('An admin cleared this Defrost Planner record.', true, true);
      const [item] = await tx`select name from defrost_items where id = ${op.itemId} and department_id = ${op.departmentId}`;
      if (!item) throw new OpError('That defrost item no longer exists');
      // Two devices may start the same night's plan: there is only ever one per department and date.
      const [plan] = await tx`insert into defrost_plans (id, department_id, service_date, people)
        values (${op.planId}, ${op.departmentId}, ${op.serviceDate}, ${op.by ? [op.by] : []})
        on conflict (department_id, service_date) do update set updated_at = now(),
          people = case when ${op.by}::text is null or ${op.by}::text = any(defrost_plans.people) then defrost_plans.people else array_append(defrost_plans.people, ${op.by}::text) end
        returning id`;
      const f = op.fields;
      const has = (k: keyof typeof f) => Object.prototype.hasOwnProperty.call(f, k);
      await tx`insert into defrost_entries (plan_id, item_id, item_name, updated_by, updated_at) values (${plan.id}, ${op.itemId}, ${String(item.name)}, ${op.by}, ${op.at})
        on conflict (plan_id, item_id) do nothing`;
      await tx`update defrost_entries set
          chilled_qty = ${has('chilled') ? f.chilled ?? null : tx`chilled_qty`},
          thawing_qty = ${has('thawing') ? f.thawing ?? null : tx`thawing_qty`},
          adjust_qty = ${has('adjust') ? f.adjust ?? null : tx`adjust_qty`},
          suggested_qty = ${has('suggested') ? f.suggested ?? null : tx`suggested_qty`},
          defrost_qty = ${has('defrost') ? f.defrost ?? null : tx`defrost_qty`},
          ran_out = ${has('ranOut') ? Boolean(f.ranOut) : tx`ran_out`},
          discarded_qty = ${has('discarded') ? f.discarded ?? null : tx`discarded_qty`},
          discard_reason = ${has('discardReason') ? f.discardReason ?? null : tx`discard_reason`},
          updated_by = ${op.by}, updated_at = ${op.at}
        where plan_id = ${plan.id} and item_id = ${op.itemId}`;
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
let hasCompletedBy = false;
async function completedByColumn(tx: Tx): Promise<boolean> {
  if (!hasCompletedBy) {
    hasCompletedBy = (await tx`select 1 from information_schema.columns where table_name = 'restock_sessions' and column_name = 'completed_by'`).length > 0;
  }
  return hasCompletedBy;
}

let hasPrep = false;
async function prepTables(tx: Tx): Promise<boolean> {
  if (!hasPrep) hasPrep = !!(await tx`select to_regclass('public.prep_handover_items') is not null as ok`)[0]?.ok;
  return hasPrep;
}

let hasAdmits = false;
async function admitsColumn(tx: Tx): Promise<boolean> {
  if (!hasAdmits) {
    hasAdmits = (await tx`select 1 from information_schema.columns where table_name = 'restock_sessions' and column_name = 'forecast_admits'`).length > 0;
  }
  return hasAdmits;
}

async function noteColumn(tx: Tx): Promise<boolean> {
  if (hasNoteColumn === null) {
    const r = await tx`select 1 from information_schema.columns where table_name = 'restock_sessions' and column_name = 'finish_note'`;
    hasNoteColumn = r.length > 0;
  }
  return hasNoteColumn;
}

async function finishSession(tx: Tx, s: { id: string; departmentId: string; kind: SessionKind; areaId: string | null }, reason: string | null, at: string, by: string | null, note: string | null, completedBy: string | null = null) {
  const comment = note?.trim() ? note.trim() : null;
  const cat = await loadCatalogue();
  const whole = departmentView(cat, s.departmentId);
  // An area restock covers just its area (and that area's sections).
  const view = whole && s.kind === 'area' ? scopeView(whole, s.areaId) : whole;
  const rows = await tx`select * from session_items where session_id = ${s.id}`;
  const areaRows = await tx`select check_area_id, status from session_areas where session_id = ${s.id}`;
  const raw = new Map<string, ItemState>(rows.map((r) => [String(r.placementId), {
    currentQty: r.currentQty as number | null, requestedQty: r.requestedQty as number | null,
    routineChoice: r.routineChoice as ItemState['routineChoice'], collectedMode: r.collectedMode as ItemState['collectedMode'],
    collectedQty: r.collectedQty as number | null, shortfallReason: r.shortfallReason as ItemState['shortfallReason'], flagged: Boolean(r.flagged), noneOnDisplay: Boolean(r.noneOnDisplay),
    refillStatus: (r.refillStatus as ItemState['refillStatus']) ?? null,
    conflict: (r.conflict as Conflict | null) ?? null,
  }]));
  const recorded = new Map<string, AreaStatus>(areaRows.map((r) => [String(r.checkAreaId), r.status as AreaStatus]));
  // Refill FOH: what was grabbed upstairs counts as suggested for that spot until staff changed it.
  // Defrost rows: what's suggested from tomorrow's admits counts too, until staff changed it.
  const [adm] = await tx`select (to_jsonb(rs)->>'forecast_admits')::int as admits from restock_sessions rs where id = ${s.id}`;
  const items = view ? withSuggestions(s.kind, view, raw, recorded, (adm?.admits as number | null) ?? null) : raw;

  let status: 'finished' | 'finished_exceptions' = reason ? 'finished_exceptions' : 'finished';
  let finalReason = reason;
  if (view) {
    // Quick restocks cover only the products staff touched.
    const placements = s.kind !== 'quick' ? view.placements : view.placements.filter((p) => items.has(p.placementId));
    const ex = exceptions({ kind: s.kind, view, placements, recordedAreas: recorded, items });
    if (ex.length && !reason) { status = 'finished_exceptions'; finalReason = 'Finished with outstanding work'; }

    await tx`delete from shortages where session_id = ${s.id} and status = 'open'`;
    for (const line of collectionLines(collectPlacements(s.kind, placements, recorded), items)) {
      if (line.kind !== 'qty') continue;
      const st = lineState(line, items), info = lineInfo(line, items);
      const short = Math.round((line.total - lineGot(line, items)) * 100) / 100;
      if (!(st === 'short' || info.flagged) || short <= 0) continue;
      if (info.reason !== 'insufficient' && !info.flagged) continue; // only confirmed shortages, or ones flagged for a manager
      const productId = view.byId.get(line.parts[0].placementId)?.productId ?? null;
      const [row] = await tx`insert into shortages (session_id, department_id, product_id, product_name, unit_plural, shortfall_qty, reason, flagged, reported_by)
        values (${s.id}, ${s.departmentId}, ${productId}, ${line.productName}, ${line.unitPlural}, ${short}, ${info.reason ?? 'other'}, ${info.flagged}, ${by}) returning id`;
      if (info.noneOnDisplay && lineGot(line, items) === 0 && await noneOnDisplayReady(tx)) await tx`update shortages set none_on_display = true where id = ${row.id}`;
    }
  }
  await tx`update restock_sessions set status = ${status}, exception_reason = ${finalReason}, finished_at = ${at} where id = ${s.id}`;
  if (await noteColumn(tx)) await tx`update restock_sessions set finish_note = ${comment} where id = ${s.id}`;
  // "Completed by" (migration 015): kept on the finished restock.
  if (await completedByColumn(tx)) await tx`update restock_sessions set completed_by = ${completedBy?.slice(0, 40) ?? null} where id = ${s.id}`;

  // Full and area restocks: queue the manager email in this same transaction.
  if (s.kind !== 'quick' && view) {
    const [row] = await tx`select people from restock_sessions where id = ${s.id}`;
    const [dept] = await tx`select name, coalesce((to_jsonb(departments)->>'email_every_restock')::boolean, false) as email_every_restock
      from departments where id = ${s.departmentId}`;
    const notChecked: string[] = [];
    for (const { area, placements: ps } of view.areas) {
      const st = areaStatus(recorded.get(area.id), ps, items);
      if (st === 'skipped') {
        const [a] = await tx`select skip_reason from session_areas where session_id = ${s.id} and check_area_id = ${area.id}`;
        notChecked.push(`${area.name} skipped (${a?.skipReason ?? 'no reason'})`);
      } else if (st !== 'complete') {
        // Only missing target counts: blank "staff enter" products just didn't need anything.
        const un = ps.filter((p) => isRequired(p) && !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).map((p) => p.productName);
        if (un.length) notChecked.push(`${area.name}: ${un.join(', ')}`);
      }
    }
    const lines = collectionLines(collectPlacements(s.kind, view.placements, recorded), items);
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    // Kitchen: the morning prep handover (already uploaded: it's queued before the finish).
    let prep: string[] = [];
    if (await prepTables(tx)) {
      const [h] = await tx`select status from prep_handovers where session_id = ${s.id}`;
      const its = h ? await tx`select grp, name, qty, note, done_at from prep_handover_items where session_id = ${s.id} order by sort_order` : [];
      prep = prepLines(h ? { status: h.status as 'needed' | 'none', items: its.map((r) => ({ id: '', taskId: null, group: r.grp as PrepGroup, name: String(r.name), qty: (r.qty as string) ?? null, note: (r.note as string) ?? null, doneAt: r.doneAt ? String(r.doneAt) : null, doneBy: null })) } : null);
    }
    await queueRestockEmail(tx, s.id, at, {
      departmentName: `${String(dept?.name ?? view.department.name)}${s.kind === 'area' && view.areas[0] ? ` · ${view.areas[0].area.name}` : ''}`,
      finishedLabel: `${new Date(at).toLocaleDateString('en-AU', { timeZone: cat.settings.timeZone, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')}, ${new Date(at).toLocaleTimeString('en-AU', { timeZone: cat.settings.timeZone, hour: 'numeric', minute: '2-digit' }).toLowerCase()}`,
      people: (row?.people as string[]) ?? [], exceptionReason: finalReason,
      areaRestock: s.kind === 'area', completedBy, lowStockWording: !!view.department.noneOnDisplay,
      outcomes: stockOutcomes(lines, items, view.byId, !!view.department.noneOnDisplay), notChecked, note: comment, prep,
      refills: pendingRefills(s.kind, view.placements, recorded, items).map((p) => p.productName),
      link: host ? `https://${host}/admin/restocks/${s.id}` : null,
    }, Boolean(dept?.emailEveryRestock));
  }
}

// ---------------------------------------------------------------------------
// Reading sessions (handover between devices, home screen status)
// ---------------------------------------------------------------------------
function toRemote(s: Record<string, unknown>, areas: Record<string, unknown>[], items: Record<string, unknown>[]): RemoteSession {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: String(s.id), departmentId: String(s.departmentId), kind: s.kind as RemoteSession['kind'], areaId: (s.areaId as string) ?? null,
    tradingDate: s.tradingDate instanceof Date ? s.tradingDate.toISOString().slice(0, 10) : String(s.tradingDate).slice(0, 10),
    status: s.status as RemoteSession['status'], exceptionReason: (s.exceptionReason as string) ?? null, note: (s.finishNote as string) ?? null,
    completedBy: (s.completedBy as string) ?? null,
    forecastAdmits: s.forecastAdmits === null || s.forecastAdmits === undefined ? null : Number(s.forecastAdmits),
    people: (s.people as string[]) ?? [], startedAt: iso(s.startedAt)!, finishedAt: iso(s.finishedAt), updatedAt: iso(s.updatedAt)!,
    areas: areas.map((a) => ({ areaId: String(a.checkAreaId), status: a.status as RemoteSession['areas'][number]['status'], skipReason: (a.skipReason as string) ?? null, updatedBy: (a.updatedBy as string) ?? null, updatedAt: iso(a.updatedAt)! })),
    items: items.map((r) => ({
      placementId: String(r.placementId), updatedBy: (r.updatedBy as string) ?? null, updatedAt: iso(r.updatedAt)!,
      currentQty: (r.currentQty as number) ?? null, requestedQty: (r.requestedQty as number) ?? null,
      routineChoice: (r.routineChoice as 'needed' | 'not_needed') ?? null, collectedMode: (r.collectedMode as 'all' | 'partial') ?? null,
      collectedQty: (r.collectedQty as number) ?? null, shortfallReason: (r.shortfallReason as RemoteSession['items'][number]['shortfallReason']) ?? null,
      flagged: Boolean(r.flagged), noneOnDisplay: Boolean(r.noneOnDisplay), refillStatus: (r.refillStatus as RemoteSession['items'][number]['refillStatus']) ?? null,
      conflict: (r.conflict as Conflict | null) ?? null,
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

/** Full and area restocks for one trading day, with their areas and items, for every department. */
export async function sessionsForDay(tradingDate: string): Promise<RemoteSession[]> {
  const sql = db();
  const sessions = await sql`select * from restock_sessions where trading_date = ${tradingDate} and kind in ('full', 'area') order by started_at`;
  if (!sessions.length) return [];
  const ids = sessions.map((s) => String(s.id));
  const areas = await sql`select * from session_areas where session_id in ${sql(ids)}`;
  const items = await sql`select * from session_items where session_id in ${sql(ids)}`;
  return sessions.map((s) => toRemote(s, areas.filter((a) => a.sessionId === s.id), items.filter((i) => i.sessionId === s.id)));
}

export { EMPTY_ITEM };
