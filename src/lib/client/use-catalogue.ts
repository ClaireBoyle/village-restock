'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalogue, CatalogueResponse } from '@/lib/catalogue-types';
import {
  readCatalogueCheck, readStoredCatalogue, requestPersistentStorage, storeCatalogue, touchCatalogueCheck,
} from './local-db';
import { warmOfflineCache } from '@/components/ServiceWorker';

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
  const revRef = useRef('');

  const refresh = useCallback(async () => {
    try {
      const since = versionRef.current ?? '';
      const res = await fetch(`/api/catalogue?since=${since}&rev=${encodeURIComponent(revRef.current)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server replied ${res.status}`);
      const body = (await res.json()) as CatalogueResponse;
      if (!body.unchanged) {
        const { unchanged: _u, ...fresh } = body;
        void _u;
        await storeCatalogue(fresh).catch(() => undefined);
        versionRef.current = fresh.version;
        revRef.current = fresh.rev ?? '';
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
        revRef.current = stored.catalogue.rev ?? '';
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

  // Once online with a catalogue: save every department page and photo for offline use.
  const warmed = useRef<number | null>(null);
  useEffect(() => {
    if (!catalogue || connection !== 'online' || warmed.current === catalogue.version) return;
    warmed.current = catalogue.version;
    const photos = [...catalogue.products.map((p) => p.photoPath), ...catalogue.areas.map((a) => a.guidePhotoPath)].filter((p): p is string => !!p);
    const defrostDepts = new Set((catalogue.defrostItems ?? []).map((i) => i.departmentId));
    void warmOfflineCache(['/', ...catalogue.departments.map((d) => `/d/${d.id}`), ...[...defrostDepts].map((id) => `/d/${id}/defrost`)], photos);
  }, [catalogue, connection]);

  return { catalogue, checkedAt, connection, error, refresh };
}
