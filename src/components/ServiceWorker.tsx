'use client';
import { useEffect } from 'react';

/** Registers the offline service worker (production only; dev reloads would fight it). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}

/** Ask the service worker to save every department page and photo for offline use. */
export async function warmOfflineCache(pages: string[], photos: string[]) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  reg?.active?.postMessage({ type: 'warm', pages, photos });
}
