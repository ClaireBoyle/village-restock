'use client';
// The device's own database (IndexedDB, via Dexie). Restock work is saved here
// FIRST, then uploaded by the sync engine. If the connection drops, nothing is
// lost: changes wait in the outbox until the server confirms them.
import Dexie, { type Table } from 'dexie';
import type { Catalogue } from '@/lib/catalogue-types';
import type { ItemState } from '@/lib/restock-logic';
import type { SyncOp } from '@/lib/sync-types';

interface KV { key: string; value: unknown }

export type SessionStatus = 'open' | 'finished' | 'finished_exceptions' | 'unfinished';

export interface LocalSession {
  id: string;
  departmentId: string;
  kind: 'full' | 'quick' | 'area';
  /** Area restocks: the one area this restock covers. */
  areaId?: string | null;
  tradingDate: string;
  status: SessionStatus;
  exceptionReason: string | null;
  people: string[];
  startedAt: string;
  finishedAt: string | null;
  /** Quick Restock: the products (placements) staff picked. */
  selected: string[];
  /** Comments for managers: a draft while open, then what was sent when finished. */
  note?: string | null;
  /** The area this device last had open. */
  curAreaId: string | null;
  updatedAt: string;
}

export interface LocalArea {
  sessionId: string;
  areaId: string;
  status: 'not_started' | 'complete' | 'skipped';
  skipReason: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface LocalItem extends ItemState {
  sessionId: string;
  placementId: string;
  /** The values last received from the server: sent with each change so clashes can be spotted. */
  base?: Partial<Pick<ItemState, 'currentQty' | 'requestedQty' | 'routineChoice'>>;
  updatedBy: string | null;
  updatedAt: string;
}

/** One Defrost Planner entry on this device. Blank (null) = not entered, never 0. */
export interface LocalDefrost {
  departmentId: string; serviceDate: string; itemId: string; planId: string;
  chilled: number | null; thawing: number | null; adjust: number | null; suggested: number | null; defrost: number | null;
  ranOut: boolean; discarded: number | null; discardReason: string | null;
  updatedBy: string | null; updatedAt: string;
}

export interface OutboxRow { seq?: number; opId: string; sessionId: string | null; op: SyncOp; createdAt: string; attempts: number }
export interface ProblemRow { seq?: number; opId: string; op: SyncOp; error: string; at: string }

class LocalDb extends Dexie {
  kv!: Table<KV, string>;
  sessions!: Table<LocalSession, string>;
  areas!: Table<LocalArea, [string, string]>;
  items!: Table<LocalItem, [string, string]>;
  outbox!: Table<OutboxRow, number>;
  problems!: Table<ProblemRow, number>;
  defrost!: Table<LocalDefrost, [string, string, string]>;
  constructor() {
    super('village-restock');
    this.version(1).stores({ kv: 'key' });
    this.version(2).stores({
      kv: 'key',
      sessions: 'id, departmentId, tradingDate, [departmentId+kind+tradingDate], status',
      areas: '[sessionId+areaId], sessionId',
      items: '[sessionId+placementId], sessionId',
      outbox: '++seq, opId, sessionId',
      problems: '++seq, opId',
    });
    this.version(3).stores({
      defrost: '[departmentId+serviceDate+itemId], [departmentId+serviceDate]',
    });
  }
}

let instance: LocalDb | null = null;
export function localDb(): LocalDb {
  return (instance ??= new LocalDb());
}

// ---------------------------------------------------------------------------
// Catalogue copy
// ---------------------------------------------------------------------------
export interface StoredCatalogue { catalogue: Catalogue; savedAt: string }

export async function readStoredCatalogue(): Promise<StoredCatalogue | null> {
  try {
    const row = await localDb().kv.get('catalogue');
    const stored = (row?.value as StoredCatalogue) ?? null;
    if (stored && !stored.catalogue.settings) stored.catalogue.settings = { timeZone: 'Australia/Melbourne', cutoffHour: 5, defrostServiceTime: '11:00' };
    if (stored) {
      stored.catalogue.settings.defrostServiceTime ??= '11:00';
      stored.catalogue.defrostItems ??= []; // saved before the Defrost Planner existed
    }
    return stored;
  } catch {
    return null; // private browsing or storage blocked: the app still works online
  }
}

export async function storeCatalogue(catalogue: Catalogue): Promise<StoredCatalogue> {
  const value: StoredCatalogue = { catalogue, savedAt: new Date().toISOString() };
  await localDb().kv.put({ key: 'catalogue', value });
  return value;
}

export async function touchCatalogueCheck(): Promise<string> {
  const at = new Date().toISOString();
  await localDb().kv.put({ key: 'catalogue_checked_at', value: at });
  return at;
}

export async function readCatalogueCheck(): Promise<string | null> {
  try {
    return ((await localDb().kv.get('catalogue_checked_at'))?.value as string) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Device identity and the optional staff name label
// ---------------------------------------------------------------------------
export async function deviceId(): Promise<string> {
  const row = await localDb().kv.get('device_id');
  if (row) return String(row.value);
  const id = crypto.randomUUID();
  await localDb().kv.put({ key: 'device_id', value: id });
  return id;
}

export async function getStaffName(): Promise<string> {
  try { return String((await localDb().kv.get('staff_name'))?.value ?? ''); } catch { return ''; }
}

export async function setStaffName(name: string): Promise<void> {
  await localDb().kv.put({ key: 'staff_name', value: name.trim().slice(0, 30) });
}

/** Ask the browser not to clear our data under storage pressure (iPadOS 17+). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
