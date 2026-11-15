// Village Restock service worker: lets the app open and work with no connection.
//
//  - Pages (home, each department): try the network first (so staff always get
//    the latest version), fall back to the copy saved on this device.
//  - App code, fonts and icons: saved once, served from the device.
//  - Reference photos: saved once, served from the device.
//  - Admin pages and the API (except photos): never saved; always live.
//
// Restock entries are NOT handled here: they're saved in the device database
// (IndexedDB) and uploaded by the app's own sync engine.
const VERSION = 'v4';
const PAGES = `vr-pages-${VERSION}`;
const STATIC = `vr-static-${VERSION}`;
const PHOTOS = `vr-photos-${VERSION}`;
const KEEP = [PAGES, STATIC, PHOTOS];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGES);
    await cachePage(cache, '/').catch(() => undefined);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('vr-') && !KEEP.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

const isPage = (url) => url.pathname === '/' || /^\/d\/[0-9a-f-]{36}$/i.test(url.pathname);
const isStatic = (url) => url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.ico';
const isPhoto = (url) => /^\/api\/photos\/[0-9a-f-]{36}$/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    if (!isPage(url)) return; // admin etc.: always live
    event.respondWith(pageResponse(req, url));
    return;
  }
  // In-app page changes (React Server Components data). With no connection,
  // answer with a plain error: Next.js then does a full page load instead,
  // which is served from the device above.
  if (url.searchParams.has('_rsc') || req.headers.get('RSC') === '1') {
    if (isPage(url)) event.respondWith(withTimeout(fetch(req), NETWORK_TIMEOUT_MS).catch(() => new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })));
    return;
  }
  if (isStatic(url)) { event.respondWith(cacheFirst(STATIC, req)); return; }
  if (isPhoto(url)) { event.respondWith(cacheFirst(PHOTOS, req)); return; }
});

async function pageResponse(req, url) {
  const cache = await caches.open(PAGES);
  const key = url.pathname; // ignore ?mode=… — the app reads it from the address itself
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
    if (res.ok && res.type === 'basic') {
      await cache.put(key, res.clone());
      void cacheAssets(await res.clone().text());
    }
    return res;
  } catch {
    return (await cache.match(key)) || offlinePage();
  }
}

async function cacheFirst(name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  if (name === STATIC) void trim(cache, 400);
  return res;
}

async function cachePage(cache, path) {
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) return;
  await cache.put(path, res.clone());
  await cacheAssets(await res.text());
}

/** Save the scripts and styles a page needs, so it can start with no connection. */
async function cacheAssets(html) {
  const cache = await caches.open(STATIC);
  const urls = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)].map((m) => m[0]))];
  await Promise.all(urls.map(async (u) => {
    if (await cache.match(u)) return;
    try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch { /* try again next time */ }
  }));
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function offlinePage() {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Village Restock</title>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#F7F8FB;color:#17213B;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center">
<div><h1 style="font-size:22px">No connection</h1><p>This page hasn't been saved on this device yet.<br>Connect to Wi-Fi and open the app once, then it will work offline.</p>
<p><a href="/" style="color:#2446B8;font-weight:600">Go to the home screen</a></p></div></body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 });
}

// The app asks for every department page (and photos) to be saved ahead of
// time, so staff can open any department even if the Wi-Fi drops later.
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'warm') return;
  event.waitUntil((async () => {
    const pages = await caches.open(PAGES);
    for (const p of msg.pages || []) {
      if (typeof p === 'string' && isPage(new URL(p, self.location.origin))) await cachePage(pages, p).catch(() => undefined);
    }
    const photos = await caches.open(PHOTOS);
    const wanted = new Set();
    for (const p of msg.photos || []) {
      if (typeof p !== 'string' || !isPhoto(new URL(p, self.location.origin))) continue;
      wanted.add(new URL(p, self.location.origin).href);
      if (!(await photos.match(p))) { try { const r = await fetch(p); if (r.ok) await photos.put(p, r); } catch { /* later */ } }
    }
    // Drop photos that are no longer used.
    if (msg.photos) for (const k of await photos.keys()) if (!wanted.has(k.url)) await photos.delete(k);
  })());
});
