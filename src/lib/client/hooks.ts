'use client';
import { liveQuery } from 'dexie';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSyncStatus, startSyncEngine, subscribeSync, type SyncStatus } from './sync-engine';
import { getStaffName, localDb, setStaffName } from './local-db';

/** Re-runs a query on the device database whenever the data it reads changes. */
/** Restocks an admin reset (hide them from lists fetched before the reset). */
export function useResetIds(): Set<string> {
  const ids = useLive(async () => ((await localDb().kv.get('reset-ids'))?.value as string[] | undefined) ?? [], [], [] as string[]);
  return new Set(ids);
}

export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: () => undefined });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

const serverStatus: SyncStatus = { connection: 'unknown', pending: 0, problems: 0, syncing: false, lastSyncAt: null, lastError: null };

export function useSyncStatus(): SyncStatus {
  useEffect(() => startSyncEngine(), []);
  return useSyncExternalStore(subscribeSync, getSyncStatus, () => serverStatus);
}

/** The optional first name or initials shown next to work done on this device. */
// Every screen part that shows or records the name updates together.
const NAME_EVENT = 'vr-staff-name';
export function useStaffName(): [string, (n: string) => void] {
  const [name, setName] = useState('');
  useEffect(() => {
    void getStaffName().then(setName);
    const on = (e: Event) => setName((e as CustomEvent<string>).detail);
    window.addEventListener(NAME_EVENT, on);
    return () => window.removeEventListener(NAME_EVENT, on);
  }, []);
  return [name, (n: string) => {
    setName(n);
    void setStaffName(n);
    window.dispatchEvent(new CustomEvent(NAME_EVENT, { detail: n }));
  }];
}
