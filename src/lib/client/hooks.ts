'use client';
import { liveQuery } from 'dexie';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSyncStatus, startSyncEngine, subscribeSync, type SyncStatus } from './sync-engine';
import { getStaffName, setStaffName } from './local-db';

/** Re-runs a query on the device database whenever the data it reads changes. */
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
export function useStaffName(): [string, (n: string) => void] {
  const [name, setName] = useState('');
  useEffect(() => { void getStaffName().then(setName); }, []);
  return [name, (n: string) => { setName(n); void setStaffName(n); }];
}
