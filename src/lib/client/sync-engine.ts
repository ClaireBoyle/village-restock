'use client';
// Uploads the outbox to the server and reports an HONEST status:
//   "online"   only after the server actually answered,
//   "pending"  = changes saved on this device that the server hasn't confirmed,
//   "problems" = changes the server refused (kept, never silently dropped).
import type { OpResult, RemoteSession, SyncResponse } from '@/lib/sync-types';
import { deviceId, localDb } from './local-db';
import { importRemote, mergeSessionInto } from './restock-store';

export interface SyncStatus {
  connection: 'unknown' | 'online' | 'offline';
  pending: number;
  problems: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

let status: SyncStatus = { connection: 'unknown', pending: 0, problems: 0, syncing: false, lastSyncAt: null, lastError: null };
const listeners = new Set<() => void>();
const emit = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};
export const getSyncStatus = () => status;
export const subscribeSync = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

const BATCH = 50;
let running: Promise<void> | null = null;
let timer: number | null = null;
let inFlightMax = 0;
/** Ops with seq <= this are being sent right now and must not be edited. */
export const sendingUpTo = () => inFlightMax;

async function refreshCounts() {
  try {
    const db = localDb();
    emit({ pending: await db.outbox.count(), problems: await db.problems.count() });
  } catch { /* storage unavailable */ }
}

/** Ask for an upload soon. Many quick edits share one request. */
export function requestSync(delay = 600) {
  void refreshCounts();
  if (typeof window === 'undefined') return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => { timer = null; void syncNow(); }, delay);
}

/** Upload everything waiting, then bring in other devices' changes. */
export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    emit({ syncing: true });
    try {
      await push();
      await pull();
      emit({ connection: 'online', lastSyncAt: new Date().toISOString(), lastError: null });
    } catch (e) {
      const offline = e instanceof TypeError || (e as Error)?.name === 'AbortError';
      emit({ connection: offline ? 'offline' : status.connection, lastError: offline ? null : (e as Error).message });
    } finally {
      inFlightMax = 0;
      await refreshCounts();
      emit({ syncing: false });
      running = null;
    }
  })();
  return running;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`The server replied ${res.status}. Changes are safe on this device and will be retried.`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(t);
  }
}

async function push() {
  const db = localDb();
  const device = await deviceId();
  for (;;) {
    const batch = await db.outbox.orderBy('seq').limit(BATCH).toArray();
    if (!batch.length) {
      // Nothing to send: still confirm we can reach the server.
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) throw new Error('Server not reachable');
      return;
    }
    inFlightMax = batch[batch.length - 1].seq!;
    const { results } = await post<SyncResponse>('/api/sync', { deviceId: device, ops: batch.map((r) => r.op) });
    emit({ connection: 'online' });
    const byId = new Map<string, OpResult>(results.map((r) => [r.opId, r]));
    let stop = false;
    for (const row of batch) {
      const r = byId.get(row.opId);
      if (!r) { stop = true; break; }
      if (r.ok) {
        await db.outbox.delete(row.seq!);
        if (r.mergedInto && row.op.type === 'session.start') await mergeSessionInto(row.op.session.id, r.mergedInto);
      } else if (r.permanent) {
        // Refused for good (e.g. product removed): keep it where staff/admin can see it.
        await db.transaction('rw', db.outbox, db.problems, async () => {
          await db.problems.add({ opId: row.opId, op: row.op, error: r.error, at: new Date().toISOString() });
          await db.outbox.delete(row.seq!);
        });
      } else {
        await db.outbox.update(row.seq!, { attempts: row.attempts + 1 });
        stop = true; // keep order: try again next round
        break;
      }
    }
    inFlightMax = 0;
    await refreshCounts();
    if (stop) return;
  }
}

/** Bring in other devices' work on tonight's open restocks held on this device. */
async function pull() {
  const db = localDb();
  const open = (await db.sessions.toArray()).filter((s) => s.kind === 'full' && s.status === 'open');
  for (const s of open) {
    const res = await fetch(`/api/sessions/${s.id}`, { cache: 'no-store' });
    if (res.status === 404) continue; // not uploaded yet
    if (!res.ok) throw new Error(`The server replied ${res.status}`);
    await importRemote((await res.json()) as RemoteSession);
  }
}

let started = false;
/** Start background syncing: on load, every 20 s, when the device comes back online or to the front. */
export function startSyncEngine() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void refreshCounts();
  requestSync(100);
  window.setInterval(() => void syncNow(), 20_000);
  window.addEventListener('online', () => requestSync(100));
  window.addEventListener('offline', () => emit({ connection: 'offline' }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(100); });
}
