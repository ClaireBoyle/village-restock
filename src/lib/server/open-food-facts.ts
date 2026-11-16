// Product photos from Open Food Facts (openfoodfacts.org): a free, public product database.
// Its photos are licensed CC BY-SA, so they may be used with a credit, which we store and show.
// Searches run on the server (admin only); a chosen photo is copied into our own photo store
// so it works offline and doesn't depend on their site.
const API = () => (process.env.OFF_API_BASE || 'https://world.openfoodfacts.org').replace(/\/$/, '');
/** Hosts we'll download photos from (nothing else, so this can't be used to fetch arbitrary URLs). */
const IMAGE_HOSTS = () => (process.env.OFF_IMAGE_HOSTS || 'images.openfoodfacts.org,static.openfoodfacts.org').split(',').map((h) => h.trim()).filter(Boolean);
const UA = 'VillageRestock/1.0 (internal stock tool)';

export interface PhotoCandidate { code: string; name: string; brand: string; thumb: string; image: string; australian: boolean; page: string }

export async function searchOpenFoodFacts(query: string): Promise<{ ok: true; results: PhotoCandidate[] } | { ok: false; error: string }> {
  const q = query.trim().slice(0, 80);
  if (!q) return { ok: true, results: [] };
  const url = `${API()}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24`
    + '&fields=code,product_name,product_name_en,brands,image_front_small_url,image_front_url,countries_tags';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000), cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `Open Food Facts replied ${res.status}. Try again in a minute.` };
    const body = (await res.json()) as { products?: Record<string, unknown>[] };
    const results = (body.products ?? [])
      .filter((p) => typeof p.image_front_url === 'string' && isAllowedImage(String(p.image_front_url)))
      .map((p) => ({
        code: String(p.code ?? ''), name: String(p.product_name_en || p.product_name || ''), brand: String(p.brands ?? '').split(',')[0].trim(),
        thumb: String(p.image_front_small_url || p.image_front_url), image: String(p.image_front_url),
        australian: Array.isArray(p.countries_tags) && (p.countries_tags as string[]).includes('en:australia'),
        page: `https://world.openfoodfacts.org/product/${encodeURIComponent(String(p.code ?? ''))}`,
      }))
      .filter((p) => p.name);
    // Australian products first: those are the packs staff will actually see.
    results.sort((a, b) => Number(b.australian) - Number(a.australian));
    return { ok: true, results: results.slice(0, 12) };
  } catch {
    return { ok: false, error: 'Couldn’t reach Open Food Facts. Check the connection and try again.' };
  }
}

export function isAllowedImage(url: string): boolean {
  try {
    const u = new URL(url);
    const hostOk = IMAGE_HOSTS().some((h) => u.host === h);
    return hostOk && (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host)));
  } catch { return false; }
}

/** Download a chosen Open Food Facts photo (only from their image hosts). */
export async function downloadOffImage(url: string): Promise<{ bytes: Uint8Array } | { error: string }> {
  if (!isAllowedImage(url)) return { error: 'That photo isn’t from Open Food Facts.' };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error' });
    if (!res.ok) return { error: `Couldn’t download the photo (${res.status}).` };
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > 3_000_000) return { error: 'That photo is too large.' };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 3_000_000) return { error: 'That photo is too large.' };
    return { bytes: buf };
  } catch {
    return { error: 'Couldn’t download the photo. Try again.' };
  }
}
