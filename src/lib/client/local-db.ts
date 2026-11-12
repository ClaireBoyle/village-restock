'use client';
// The device's own database (IndexedDB, via Dexie). It keeps a copy of the
// catalogue so the app can run without a connection. Phase 2 adds restock
// sessions and the outbox of changes waiting to sync.
import Dexie, { type Table } from 'dexie';
import type { Catalogue } from '@/lib/catalogue-types';

interface KV { key: string; value: unknown }

class LocalDb extends Dexie {
  kv!: Table<KV, string>;
  constructor() {
    super('village-restock');
    this.version(1).stores({ kv: 'key' });
  }
}

let instance: LocalDb | null = null;
function localDb(): LocalDb {
  return (instance ??= new LocalDb());
}

export interface StoredCatalogue { catalogue: Catalogue; savedAt: string }

export async function readStoredCatalogue(): Promise<StoredCatalogue | null> {
  try {
    const row = await localDb().kv.get('catalogue');
    return (row?.value as StoredCatalogue) ?? null;
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

/** Ask the browser not to clear our data under storage pressure (iPadOS 17+). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
