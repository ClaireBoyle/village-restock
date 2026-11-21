'use client';
// Prep checklist: saved on the device first and queued for upload in the same local transaction (like
// restock changes), so it works with no connection, and shared with other devices on the same service.
import type { PrepCheck } from '@/lib/prep';
import type { PrepCheckFields } from '@/lib/sync-types';
import type { PrepChecksResponse } from '@/app/api/prep/checks/route';
import { localDb } from './local-db';
import { queue } from './restock-store';
import { requestSync } from './sync-engine';

const by = (who: string) => who.trim().slice(0, 30) || null;
const BLANK = { status: null, morning: false, note: null, morningDoneAt: null, morningDoneBy: null } as const;

/** One job's check for a service: Ready / Needs prep / Unchecked, Leave for morning, a note, or the morning team's Done. */
export async function setPrepCheck(departmentId: string, tradingDate: string, taskId: string, fields: PrepCheckFields, who: string) {
  const db = localDb();
  const at = new Date().toISOString();
  await db.transaction('rw', db.prepChecks, db.outbox, async () => {
    const cur = await db.prepChecks.get([departmentId, tradingDate, taskId]);
    const next: PrepCheck = { ...BLANK, ...cur, departmentId, tradingDate, taskId, updatedBy: by(who), updatedAt: at };
    if ('status' in fields) next.status = fields.status ?? null;
    if ('morning' in fields) next.morning = !!fields.morning;
    if ('note' in fields) next.note = fields.note?.trim() || null;
    if ('morningDone' in fields) { next.morningDoneAt = fields.morningDone ? at : null; next.morningDoneBy = fields.morningDone ? by(who) : null; }
    await db.prepChecks.put(next);
    await queue({ type: 'prepcheck.set', departmentId, tradingDate, taskId, fields }, who);
  });
  requestSync();
}

/**
 * Bring in what other devices checked from a trading day on, keeping anything not yet uploaded from here.
 * Returns false when the server doesn't have the checklist yet (migration 021), null when offline.
 */
export async function importRemotePrepChecks(departmentId: string, since: string): Promise<boolean | null> {
  const res = await fetch(`/api/prep/checks?dept=${departmentId}&since=${since}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json()) as PrepChecksResponse;
  if (!body.ready) return false;
  const db = localDb();
  await db.transaction('rw', db.prepChecks, db.outbox, async () => {
    const pending = new Set((await db.outbox.toArray()).flatMap((r) => (r.op.type === 'prepcheck.set' && r.op.departmentId === departmentId ? [`${r.op.tradingDate}|${r.op.taskId}`] : [])));
    for (const c of body.checks) {
      if (pending.has(`${c.tradingDate}|${c.taskId}`)) continue;
      await db.prepChecks.put(c);
    }
  });
  return true;
}
