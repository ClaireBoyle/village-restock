'use client';
// Morning prep handover: saved on the device first and queued for upload in the same local
// transaction (like restock changes), so it works with no connection. Tracked apart from the
// restock: nothing here touches the restock's products, areas or status.
import type { PrepItem, PrepTask } from '@/lib/prep';
import type { PrepHandoverResponse } from '@/app/api/prep/route';
import { localDb, type LocalPrep } from './local-db';
import { queue } from './restock-store';
import { requestSync, sendingUpTo } from './sync-engine';

const by = (who: string) => who.trim().slice(0, 30) || null;

/** The closing team's answer: tasks needed (with optional amounts and notes), "No morning prep needed", or cleared (null). */
export async function setPrep(session: { id: string; departmentId: string; tradingDate: string }, status: 'needed' | 'none' | null, items: PrepItem[], who: string) {
  const db = localDb();
  const list = status === 'needed' ? items : [];
  await db.transaction('rw', db.prep, db.outbox, async () => {
    if (status === null) await db.prep.delete(session.id);
    else {
      const cur = await db.prep.get(session.id);
      // Done marks belong to the morning team: keep them on tasks that are still there.
      const done = new Map((cur?.items ?? []).map((i) => [i.id, i]));
      await db.prep.put({
        ...cur, sessionId: session.id, departmentId: session.departmentId, tradingDate: session.tradingDate, status,
        items: list.map((i) => ({ ...i, doneAt: done.get(i.id)?.doneAt ?? null, doneBy: done.get(i.id)?.doneBy ?? null })),
        updatedBy: by(who), updatedAt: new Date().toISOString(),
      });
    }
    const op = { type: 'prep.set' as const, sessionId: session.id, status, items: list.map(({ id, taskId, group, name, qty, note }) => ({ id, taskId, group, name, qty, note })) };
    // Many quick taps share one upload: replace a waiting (not yet sending) list for this restock.
    const last = await db.outbox.orderBy('seq').last();
    if (last && last.op.type === 'prep.set' && last.op.sessionId === session.id && (last.seq ?? 0) > sendingUpTo()) {
      await db.outbox.update(last.seq!, { op: { ...last.op, ...op, at: new Date().toISOString(), by: by(who) } });
    } else await queue(op, who);
  });
  requestSync();
}

/** The morning team marks a task Done (or undoes it). */
export async function setPrepDone(sessionId: string, itemId: string, done: boolean, who: string) {
  const db = localDb();
  await db.transaction('rw', db.prep, db.outbox, async () => {
    const cur = await db.prep.get(sessionId);
    if (!cur) return;
    const at = new Date().toISOString();
    await db.prep.put({ ...cur, items: cur.items.map((i) => (i.id === itemId ? { ...i, doneAt: done ? at : null, doneBy: done ? by(who) : null } : i)) });
    await queue({ type: 'prep.done', sessionId, itemId, done }, who);
  });
  requestSync();
}

/** Bring in handovers from other devices (e.g. last night's, for the morning team), keeping anything not yet uploaded from here. */
export async function importRemotePrep(departmentId: string, since: string) {
  const res = await fetch(`/api/prep?dept=${departmentId}&since=${since}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return;
  const body = (await res.json()) as PrepHandoverResponse;
  const db = localDb();
  await db.transaction('rw', db.prep, db.outbox, async () => {
    const waiting = await db.outbox.toArray();
    for (const h of body.handovers) {
      const pendingList = waiting.some((r) => r.op.type === 'prep.set' && r.op.sessionId === h.sessionId);
      const pendingDone = new Set(waiting.flatMap((r) => (r.op.type === 'prep.done' && r.op.sessionId === h.sessionId ? [r.op.itemId] : [])));
      const cur = await db.prep.get(h.sessionId);
      if (pendingList && cur) { await db.prep.put({ ...cur, restockStatus: h.restockStatus }); continue; }
      const mine = new Map((cur?.items ?? []).map((i) => [i.id, i]));
      await db.prep.put({ ...h, items: h.items.map((i) => (pendingDone.has(i.id) && mine.get(i.id) ? { ...i, doneAt: mine.get(i.id)!.doneAt, doneBy: mine.get(i.id)!.doneBy } : i)) } satisfies LocalPrep);
    }
  });
}

/**
 * A prep-made row on the stock check (e.g. vodka sauce "2 tubs for morning prep"): its task is added
 * to the handover with that amount. Changing or clearing the amount follows along, unless staff
 * have since changed the task's amount themselves (then theirs stays).
 */
export async function applyStockPrep(session: { id: string; departmentId: string; tradingDate: string }, task: PrepTask, now: string | null, was: string | null, who: string) {
  const cur = await localDb().prep.get(session.id);
  let items = cur?.status === 'needed' ? cur.items : [];
  const it = items.find((i) => i.taskId === task.id);
  if (now) {
    if (it) {
      if (it.qty && it.qty !== was) return; // staff wrote their own amount
      items = items.map((i) => (i === it ? { ...i, qty: now } : i));
    } else items = [...items, { id: crypto.randomUUID(), taskId: task.id, group: task.group, name: task.name, qty: now, note: null, doneAt: null, doneBy: null }];
    await setPrep(session, 'needed', items, who);
  } else if (it && it.qty === was && !it.note) {
    items = items.filter((i) => i !== it);
    await setPrep(session, items.length ? 'needed' : null, items, who);
  }
}
