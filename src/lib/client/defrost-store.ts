'use client';
// Defrost Planner entries: saved on the device first and queued for upload in the same
// local transaction (like restock changes), so it works with no connection.
import type { DefrostFields } from '@/lib/sync-types';
import { localDb, type LocalDefrost } from './local-db';
import { queue } from './restock-store';
import { requestSync } from './sync-engine';

const EMPTY: Omit<LocalDefrost, 'departmentId' | 'serviceDate' | 'itemId' | 'planId'> = {
  chilled: null, thawing: null, adjust: null, suggested: null, defrost: null, ranOut: false, discarded: null, discardReason: null, updatedBy: null, updatedAt: '',
};

/** The plan id for a department's service date on this device (created on first use). */
export async function planIdFor(departmentId: string, serviceDate: string): Promise<string> {
  const db = localDb();
  const any = await db.defrost.where('[departmentId+serviceDate]').equals([departmentId, serviceDate]).first();
  if (any) return any.planId;
  const key = `defrost-plan-${departmentId}-${serviceDate}`;
  const row = await db.kv.get(key);
  if (row?.value) return String(row.value);
  const id = crypto.randomUUID();
  await db.kv.put({ key, value: id });
  return id;
}

export async function setDefrost(departmentId: string, serviceDate: string, itemId: string, fields: DefrostFields, who: string) {
  const db = localDb();
  const planId = await planIdFor(departmentId, serviceDate);
  await db.transaction('rw', db.defrost, db.outbox, async () => {
    const cur = await db.defrost.get([departmentId, serviceDate, itemId]);
    await db.defrost.put({ ...EMPTY, ...cur, ...fields, departmentId, serviceDate, itemId, planId,
      updatedBy: who.trim() || null, updatedAt: new Date().toISOString() } as LocalDefrost);
    await queue({ type: 'defrost.set', planId, departmentId, serviceDate, itemId, fields }, who);
  });
  requestSync();
}

/** Bring in what other devices entered for this service, keeping anything not yet uploaded from here. */
export async function importRemoteDefrost(departmentId: string, serviceDate: string) {
  const res = await fetch(`/api/defrost?dept=${departmentId}&date=${serviceDate}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return;
  const body = (await res.json()) as { plan: { id: string } | null; entries: (Omit<LocalDefrost, 'departmentId' | 'serviceDate' | 'planId'>)[] };
  if (!body.plan) return;
  const db = localDb();
  await db.transaction('rw', db.defrost, db.outbox, db.kv, async () => {
    const pending = new Set((await db.outbox.toArray()).flatMap((r) => (r.op.type === 'defrost.set' && r.op.departmentId === departmentId && r.op.serviceDate === serviceDate ? [r.op.itemId] : [])));
    await db.kv.put({ key: `defrost-plan-${departmentId}-${serviceDate}`, value: body.plan!.id });
    for (const e of body.entries) {
      if (pending.has(e.itemId)) continue;
      await db.defrost.put({ ...EMPTY, ...e, departmentId, serviceDate, planId: body.plan!.id });
    }
  });
}
