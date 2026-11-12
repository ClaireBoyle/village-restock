'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalogue, CatalogueResponse } from '@/lib/catalogue-types';
import {
  readCatalogueCheck, readStoredCatalogue, requestPersistentStorage, storeCatalogue, touchCatalogueCheck,
} from './local-db';

export type Connection = 'checking' | 'online' | 'offline';

export interface CatalogueState {
  catalogue: Catalogue | null;
  /** When the catalogue on this device was last confirmed current with the server. */
  checkedAt: string | null;
  connection: Connection;
  error: string | null;
  refresh: () => Promise<void>;
}

const RECHECK_MS = 60_000;

/**
 * Shows the device's saved catalogue immediately, then asks the server whether
 * there's a newer one. States are only reported once they're true:
 * "online" means the server actually answered, not just that wifi is on.
 */
export function useCatalogue(): CatalogueState {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('checking');
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const since = versionRef.current ?? '';
      const res = await fetch(`/api/catalogue?since=${since}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server replied ${res.status}`);
      const body = (await res.json()) as CatalogueResponse;
      if (!body.unchanged) {
        const { unchanged: _u, ...fresh } = body;
        void _u;
        await storeCatalogue(fresh).catch(() => undefined);
        versionRef.current = fresh.version;
        setCatalogue(fresh);
      }
      setCheckedAt(await touchCatalogueCheck().catch(() => new Date().toISOString()));
      setConnection('online');
      setError(null);
    } catch {
      // Network failure or server unreachable: keep using the saved copy.
      setConnection('offline');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await readStoredCatalogue();
      if (!cancelled && stored) {
        versionRef.current = stored.catalogue.version;
        setCatalogue(stored.catalogue);
        setCheckedAt(await readCatalogueCheck());
      }
      void requestPersistentStorage();
      await refresh();
      if (!cancelled && !stored && versionRef.current === null) {
        setError('Product data hasn’t been downloaded to this device yet. Connect to Wi-Fi and try again.');
      }
    })();
    const onFocus = () => document.visibilityState === 'visible' && void refresh();
    const onOnline = () => void refresh();
    const onOffline = () => setConnection('offline');
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = window.setInterval(() => void refresh(), RECHECK_MS);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { catalogue, checkedAt, connection, error, refresh };
}
