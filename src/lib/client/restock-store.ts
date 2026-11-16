'use client';
// Every restock change goes through here. Each function saves to the device
// first, adds a matching op to the outbox in the SAME local transaction (so a
// change can never be saved without also being queued for upload), and then
// asks the sync engine to upload soon.
import type { ItemState } from '@/lib/restock-logic';
import { CONFLICT_FIELDS, EMPTY_ITEM } from '@/lib/restock-logic';
import type { RemoteSession, SyncOp } from '@/lib/sync-types';
import { localDb, type LocalArea, type LocalItem, type LocalSession } from './local-db';
import { requestSync, sendingUpTo } from './sync-engine';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type OpInput = DistributiveOmit<SyncOp, 'opId' | 'at' | 'by'>;

const now = () => new Date().toISOString();
const by = (name: string) => (name.trim() ? name.trim().slice(0, 30) : null);

export async function queue(op: OpInput, who: string) {
  const full = { ...op, opId: crypto.randomUUID(), at: now(), by: by(who) } as SyncOp;
  const db = localDb();
  // Fold rapid edits to the same product (e.g. tapping + three times) into one upload,
  // but never touch an op that is already being sent.
  if (full.type === 'item.set') {
    const last = await db.outbox.orderBy('seq').last();
    if (last && last.op.type === 'item.set' && (last.seq ?? 0) > sendingUpTo() && !last.op.resolve && !full.resolve
      && last.op.sessionId === full.sessionId && last.op.placementId === full.placementId) {
      // Keep the EARLIEST base: it's what the server last told us.
      const mergedBase = { ...full.base, ...last.op.base };
      await db.outbox.update(last.seq!, { op: { ...last.op, fields: { ...last.op.fields, ...full.fields }, base: mergedBase, at: full.at, by: full.by } });
      return;
    }
  }
  // Defrost entries: fold quick edits to the same item too.
  if (full.type === 'defrost.set') {
    const last = await db.outbox.orderBy('seq').last();
    if (last && last.op.type === 'defrost.set' && (last.seq ?? 0) > sendingUpTo()
      && last.op.departmentId === full.departmentId && last.op.serviceDate === full.serviceDate && last.op.itemId === full.itemId) {
      await db.outbox.update(last.seq!, { op: { ...last.op, fields: { ...last.op.fields, ...full.fields }, at: full.at, by: full.by } });
      return;
    }
  }
  await db.outbox.add({ opId: full.opId, sessionId: 'sessionId' in full ? full.sessionId : full.type === 'session.start' ? full.session.id : null, op: full, createdAt: full.at, attempts: 0 });
}

function addPerson(s: LocalSession, who: string): string[] {
  const n = by(who);
  return n && !s.people.includes(n) ? [...s.people, n] : s.people;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function findFullSession(departmentId: string, tradingDate: string) {
  return localDb().sessions.where('[departmentId+kind+tradingDate]').equals([departmentId, 'full', tradingDate]).first();
}

export async function findOpenQuickSession(departmentId: string) {
  const all = await localDb().sessions.where('departmentId').equals(departmentId).toArray();
  return all.filter((s) => s.kind === 'quick' && s.status === 'open').sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

/**
 * Open tonight's full restock for a department. If another device already
 * started it (and we're online), join that one so everyone works on the same list.
 */
export async function openFullSession(departmentId: string, tradingDate: string, who: string): Promise<LocalSession> {
  const local = await findFullSession(departmentId, tradingDate);
  if (local) return local;
  try {
    const res = await fetch(`/api/sessions?date=${tradingDate}`, { cache: 'no-store' });
    if (res.ok) {
      const { sessions } = (await res.json()) as { sessions: RemoteSession[] };
      const remote = sessions.find((s) => s.departmentId === departmentId && s.kind === 'full');
      if (remote) {
        await importRemote(remote);
        const s = (await localDb().sessions.get(remote.id))!;
        if (by(who) && !s.people.includes(by(who)!)) await localDb().sessions.update(s.id, { people: addPerson(s, who) });
        return (await localDb().sessions.get(remote.id))!;
      }
    }
  } catch { /* offline: start locally, the server will join them up later */ }
  return startSession(departmentId, 'full', tradingDate, who);
}

/** Area restocks open tonight for one area: on this device, newest first. */
export async function findOpenAreaSession(departmentId: string, areaId: string, tradingDate: string) {
  const all = await localDb().sessions.where('departmentId').equals(departmentId).toArray();
  return all.filter((s) => s.kind === 'area' && s.areaId === areaId && s.status === 'open' && s.tradingDate === tradingDate)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

/**
 * Open an area restock (e.g. Candy Bar's confection stand). Carries on with an unfinished one
 * from tonight, on this device or (when online) one another device started, or starts a new one.
 * Finished ones are never reused: restocking the same area again later is a new restock.
 */
export async function openAreaSession(departmentId: string, areaId: string, tradingDate: string, who: string): Promise<LocalSession> {
  const local = await findOpenAreaSession(departmentId, areaId, tradingDate);
  if (local) return local;
  try {
    const res = await fetch(`/api/sessions?date=${tradingDate}`, { cache: 'no-store' });
    if (res.ok) {
      const { sessions } = (await res.json()) as { sessions: RemoteSession[] };
      // Only a restock with something entered is worth carrying on; an empty one is just started again.
      const remote = sessions.filter((s) => s.departmentId === departmentId && s.kind === 'area' && s.areaId === areaId && s.status === 'open' && s.items.length)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (remote && !(await localDb().sessions.get(remote.id))) {
        await importRemote(remote);
        const s = (await localDb().sessions.get(remote.id))!;
        if (by(who) && !s.people.includes(by(who)!)) await localDb().sessions.update(s.id, { people: addPerson(s, who) });
        return (await localDb().sessions.get(remote.id))!;
      }
    }
  } catch { /* offline: start one on this device */ }
  return startSession(departmentId, 'area', tradingDate, who, areaId);
}

export async function startSession(departmentId: string, kind: LocalSession['kind'], tradingDate: string, who: string, areaId: string | null = null): Promise<LocalSession> {
  const s: LocalSession = {
    id: crypto.randomUUID(), departmentId, kind, areaId: kind === 'area' ? areaId : null, tradingDate, status: 'open', exceptionReason: null,
    people: by(who) ? [by(who)!] : [], startedAt: now(), finishedAt: null, selected: [], curAreaId: null, updatedAt: now(),
  };
  const db = localDb();
  await db.transaction('rw', db.sessions, db.outbox, async () => {
    await db.sessions.add(s);
    await queue({ type: 'session.start', session: { id: s.id, departmentId, kind, tradingDate, startedAt: s.startedAt, ...(kind === 'area' ? { areaId } : {}) } }, who);
  });
  requestSync();
  return s;
}

/** Device-only details (which area is open, the quick list). Not uploaded. */
export async function updateLocalSession(id: string, changes: Partial<Pick<LocalSession, 'curAreaId' | 'selected' | 'note'>>) {
  await localDb().sessions.update(id, changes);
}

// ---------------------------------------------------------------------------
// Products and areas
// ---------------------------------------------------------------------------
/**
 * Record changes to products. `resolve` is used when a person chooses between
 * two clashing counts: it applies their choice and clears the clash.
 */
export async function setItems(sessionId: string, updates: { placementId: string; fields: Partial<ItemState> }[], who: string, resolve = false) {
  const db = localDb();
  await db.transaction('rw', db.items, db.sessions, db.outbox, async () => {
    for (const u of updates) {
      const key: [string, string] = [sessionId, u.placementId];
      const existing = await db.items.get(key);
      const { conflict: _c, ...fields } = u.fields;
      void _c;
      const next: LocalItem = {
        ...EMPTY_ITEM, ...existing, ...fields, conflict: resolve ? null : existing?.conflict ?? null,
        sessionId, placementId: u.placementId, updatedBy: by(who), updatedAt: now(),
      };
      await db.items.put(next);
      const base: Record<string, unknown> = {};
      for (const f of CONFLICT_FIELDS) if (f in fields) base[f] = existing?.base?.[f] ?? null;
      await queue({ type: 'item.set', sessionId, placementId: u.placementId, fields, base, ...(resolve ? { resolve: true } : {}) }, who);
    }
    const s = await db.sessions.get(sessionId);
    if (s) await db.sessions.update(sessionId, { people: addPerson(s, who), updatedAt: now() });
  });
  requestSync();
}

export async function setArea(sessionId: string, areaId: string, status: LocalArea['status'], skipReason: string | null, who: string) {
  const db = localDb();
  await db.transaction('rw', db.areas, db.sessions, db.outbox, async () => {
    await db.areas.put({ sessionId, areaId, status, skipReason: status === 'skipped' ? skipReason : null, updatedBy: by(who), updatedAt: now() });
    await queue({ type: 'area.set', sessionId, areaId, status, skipReason: status === 'skipped' ? skipReason : null }, who);
    const s = await db.sessions.get(sessionId);
    if (s) await db.sessions.update(sessionId, { people: addPerson(s, who), updatedAt: now() });
  });
  requestSync();
}

export async function finishSession(sessionId: string, exceptionReason: string | null, who: string, note: string | null = null) {
  const db = localDb();
  await db.transaction('rw', db.sessions, db.outbox, async () => {
    const s = await db.sessions.get(sessionId);
    if (!s) return;
    await db.sessions.update(sessionId, {
      status: exceptionReason ? 'finished_exceptions' : 'finished', exceptionReason, finishedAt: now(), people: addPerson(s, who), updatedAt: now(), note,
    });
    await queue({ type: 'session.finish', sessionId, exceptionReason, note }, who);
  });
  requestSync();
}

export async function reopenSession(sessionId: string, who: string) {
  const db = localDb();
  await db.transaction('rw', db.sessions, db.outbox, async () => {
    await db.sessions.update(sessionId, { status: 'open', exceptionReason: null, finishedAt: null, updatedAt: now() });
    await queue({ type: 'session.reopen', sessionId }, who);
  });
  requestSync();
}

// ---------------------------------------------------------------------------
// Bringing in other devices' work
// ---------------------------------------------------------------------------
/**
 * Copy a session from the server onto this device. Anything this device has
 * changed but not yet uploaded is kept, so local work is never overwritten
 * by older server data.
 */
export async function importRemote(remote: RemoteSession) {
  const db = localDb();
  await db.transaction('rw', db.sessions, db.items, db.areas, db.outbox, async () => {
    const pending = await db.outbox.where('sessionId').equals(remote.id).toArray();
    const pendingItems = new Set(pending.flatMap((r) => (r.op.type === 'item.set' ? [r.op.placementId] : [])));
    const pendingAreas = new Set(pending.flatMap((r) => (r.op.type === 'area.set' ? [r.op.areaId] : [])));
    const pendingSession = pending.some((r) => r.op.type === 'session.finish' || r.op.type === 'session.reopen');

    const existing = await db.sessions.get(remote.id);
    const status = remote.status === 'unfinished' ? 'unfinished' : remote.status;
    await db.sessions.put({
      id: remote.id, departmentId: remote.departmentId, kind: remote.kind, areaId: remote.areaId ?? existing?.areaId ?? null, tradingDate: remote.tradingDate,
      status: pendingSession && existing ? existing.status : status,
      exceptionReason: pendingSession && existing ? existing.exceptionReason : remote.exceptionReason,
      people: [...new Set([...(existing?.people ?? []), ...remote.people])],
      startedAt: remote.startedAt, finishedAt: pendingSession && existing ? existing.finishedAt : remote.finishedAt,
      // Keep a comment being typed here; otherwise take the server's.
      note: pendingSession && existing ? existing.note ?? null : remote.note ?? existing?.note ?? null,
      selected: existing?.selected ?? [], curAreaId: existing?.curAreaId ?? null, updatedAt: remote.updatedAt,
    });
    for (const it of remote.items) {
      if (pendingItems.has(it.placementId)) continue;
      const { placementId, updatedBy, updatedAt, ...fields } = it;
      const base = { currentQty: fields.currentQty, requestedQty: fields.requestedQty, routineChoice: fields.routineChoice };
      await db.items.put({ ...EMPTY_ITEM, ...fields, base, sessionId: remote.id, placementId, updatedBy, updatedAt });
    }
    for (const a of remote.areas) {
      if (pendingAreas.has(a.areaId)) continue;
      await db.areas.put({
        sessionId: remote.id, areaId: a.areaId, status: a.status === 'in_progress' ? 'not_started' : a.status,
        skipReason: a.skipReason, updatedBy: a.updatedBy, updatedAt: a.updatedAt,
      });
    }
  });
}

/**
 * Two devices started tonight's full restock while one was offline. The server
 * keeps the first one; move this device's work across to it.
 */
export async function mergeSessionInto(fromId: string, intoId: string) {
  if (fromId === intoId) return;
  const db = localDb();
  await db.transaction('rw', db.sessions, db.items, db.areas, db.outbox, async () => {
    const from = await db.sessions.get(fromId);
    if (!from) return;
    const into = await db.sessions.get(intoId);
    if (!into) await db.sessions.put({ ...from, id: intoId });
    else await db.sessions.update(intoId, { people: [...new Set([...into.people, ...from.people])], curAreaId: into.curAreaId ?? from.curAreaId });
    for (const it of await db.items.where('sessionId').equals(fromId).toArray()) {
      await db.items.put({ ...it, sessionId: intoId });
    }
    for (const a of await db.areas.where('sessionId').equals(fromId).toArray()) {
      await db.areas.put({ ...a, sessionId: intoId });
    }
    await db.items.where('sessionId').equals(fromId).delete();
    await db.areas.where('sessionId').equals(fromId).delete();
    for (const row of await db.outbox.where('sessionId').equals(fromId).toArray()) {
      const op = { ...row.op, sessionId: intoId } as SyncOp;
      await db.outbox.update(row.seq!, { sessionId: intoId, op });
    }
    await db.sessions.delete(fromId);
  });
}

// ---------------------------------------------------------------------------
// Admin resets
// ---------------------------------------------------------------------------
export const RESET_NOTICE_KEY = 'reset-notice';
/** Ids of restocks reset recently, so lists fetched earlier from the server can hide them at once. */
export const RESET_IDS_KEY = 'reset-ids';
async function rememberReset(ids: string[]) {
  const db = localDb();
  const cur = ((await db.kv.get(RESET_IDS_KEY))?.value as string[] | undefined) ?? [];
  const next = [...new Set([...cur, ...ids])].slice(-500);
  if (next.length !== cur.length) await db.kv.put({ key: RESET_IDS_KEY, value: next });
}
const opSessionId = (op: SyncOp) => ('sessionId' in op ? op.sessionId : op.type === 'session.start' ? op.session.id : null);

/**
 * An admin reset this restock: remove it from this device with everything entered and every
 * change still waiting to upload, so nothing can bring it back. `notice` leaves a short
 * message for whoever uses this device next.
 */
export async function purgeSession(id: string, notice = true) {
  const db = localDb();
  await rememberReset([id]);
  await db.transaction('rw', [db.sessions, db.items, db.areas, db.outbox, db.problems, db.kv], async () => {
    const s = await db.sessions.get(id);
    const queued = await db.outbox.where('sessionId').equals(id).count();
    const entered = await db.items.where('sessionId').equals(id).count();
    if (!s && !queued && !entered) return;
    await db.items.where('sessionId').equals(id).delete();
    await db.areas.where('sessionId').equals(id).delete();
    await db.outbox.where('sessionId').equals(id).delete();
    for (const p of await db.problems.toArray()) if (opSessionId(p.op) === id) await db.problems.delete(p.seq!);
    await db.sessions.delete(id);
    if (notice && (entered || queued || s?.status === 'open')) await db.kv.put({ key: RESET_NOTICE_KEY, value: { at: now(), departmentId: s?.departmentId ?? null } });
  });
}

/** Defrost Planner records an admin cleared: drop this device's copy (only what was entered before the clear). */
export async function purgeDefrost(departmentId: string, serviceDate: string, resetAt: string) {
  const db = localDb();
  await db.transaction('rw', [db.defrost, db.outbox, db.problems, db.kv], async () => {
    const rows = await db.defrost.where('[departmentId+serviceDate]').equals([departmentId, serviceDate]).toArray();
    for (const r of rows) if (!r.updatedAt || r.updatedAt <= resetAt) await db.defrost.delete([departmentId, serviceDate, r.itemId]);
    for (const o of await db.outbox.toArray()) {
      if (o.op.type === 'defrost.set' && o.op.departmentId === departmentId && o.op.serviceDate === serviceDate && o.op.at <= resetAt) await db.outbox.delete(o.seq!);
    }
    for (const p of await db.problems.toArray()) {
      if (p.op.type === 'defrost.set' && p.op.departmentId === departmentId && p.op.serviceDate === serviceDate) await db.problems.delete(p.seq!);
    }
  });
}

/** Apply the server's list of recent resets to this device. */
export async function applyResets(r: { sessions: string[]; defrost: { departmentId: string; serviceDate: string; resetAt: string }[] }) {
  const db = localDb();
  const ids = new Set(r.sessions);
  await rememberReset(r.sessions);
  const local = new Set([...(await db.sessions.toArray()).map((s) => s.id), ...(await db.outbox.toArray()).map((o) => opSessionId(o.op)).filter(Boolean) as string[]]);
  for (const id of local) if (ids.has(id)) await purgeSession(id);
  for (const d of r.defrost) {
    if (await db.defrost.where('[departmentId+serviceDate]').equals([d.departmentId, d.serviceDate]).count()) await purgeDefrost(d.departmentId, d.serviceDate, d.resetAt);
  }
}
