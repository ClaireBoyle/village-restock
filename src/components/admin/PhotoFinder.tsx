'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { findProductPhotos, setPhoto, chooseOpenFoodFactsPhoto as saveOffPhoto } from '@/app/actions/admin';
import { shrink } from './PhotoField';

export interface PhotoProduct { id: string; name: string; photo: string | null; credit: string | null; area: string }
interface Candidate { code: string; name: string; brand: string; thumb: string; image: string; australian: boolean; page: string }
type Found = { query: string; loading: boolean; error?: string; results: Candidate[] };

/**
 * Product photos for one department, in walking order. "Find photo" searches Open Food Facts
 * (public, CC BY-SA); a person picks the right pack. "Upload" takes your own photo instead.
 */
export function PhotoFinder({ products }: { products: PhotoProduct[] }) {
  const router = useRouter();
  const [found, setFound] = useState<Record<string, Found>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [bulk, setBulk] = useState(false);
  const [, start] = useTransition();
  const missing = products.filter((p) => !p.photo);

  const search = async (id: string, query: string) => {
    setFound((f) => ({ ...f, [id]: { query, loading: true, results: f[id]?.results ?? [] } }));
    const r = await findProductPhotos(query);
    setFound((f) => ({ ...f, [id]: r.ok ? { query, loading: false, results: r.results } : { query, loading: false, error: r.error, results: [] } }));
  };
  const findAll = async () => {
    setBulk(true);
    for (const p of missing) { if (!found[p.id]) await search(p.id, p.name); }
    setBulk(false);
  };
  const use = (p: PhotoProduct, c: Candidate) => {
    setBusy(p.id);
    start(async () => {
      const r = await saveOffPhoto(p.id, c.image, c.code);
      setBusy(null);
      setMsg((m) => ({ ...m, [p.id]: r?.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved' } }));
      if (!r?.error) { setFound((f) => { const n = { ...f }; delete n[p.id]; return n; }); router.refresh(); }
    });
  };
  const upload = async (p: PhotoProduct, file: File | undefined) => {
    if (!file) return;
    setBusy(p.id);
    try {
      const blob = await shrink(file);
      const fd = new FormData(); fd.set('kind', 'product'); fd.set('id', p.id); fd.set('photo', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      const r = await setPhoto(undefined, fd);
      setMsg((m) => ({ ...m, [p.id]: r?.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved' } }));
      if (!r?.error) router.refresh();
    } catch { setMsg((m) => ({ ...m, [p.id]: { ok: false, text: 'That file couldn’t be read as a photo.' } })); }
    setBusy(null);
  };

  return (
    <>
      <div className="pf-bar">
        <p className="meta"><b>{products.length - missing.length} of {products.length}</b> products have a photo.</p>
        {missing.length ? <button className="btn primary" disabled={bulk} onClick={() => void findAll()}><Icon name="search" />{bulk ? 'Searching…' : `Find photos for the ${missing.length} without one`}</button> : null}
      </div>
      <div className="pf-grid">
        {products.map((p) => {
          const f = found[p.id];
          return (
            <article key={p.id} className={`pf-card ${f ? 'open' : ''}`}>
              <div className="pf-top">
                <div className={`pf-img ${p.photo ? '' : 'empty'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.photo ? <img src={p.photo} alt="" loading="lazy" /> : <Icon name="camera" />}
                </div>
                <div className="pf-t">
                  <b>{p.name}</b>
                  <small>{p.area}</small>
                  {p.credit ? <small className="pf-credit">{p.credit}</small> : null}
                  {msg[p.id] ? <small className={msg[p.id].ok ? 'ok-text' : 'bad-text'}>{msg[p.id].text}</small> : null}
                  <div className="pf-acts">
                    <button className="btn small" disabled={busy === p.id} onClick={() => (f ? setFound((x) => { const n = { ...x }; delete n[p.id]; return n; }) : void search(p.id, p.name))}>
                      <Icon name="search" />{f ? 'Close' : p.photo ? 'Find another' : 'Find photo'}</button>
                    <label className={`btn small ${busy === p.id ? 'disabled' : ''}`}><Icon name="camera" />Upload
                      <input type="file" accept="image/*" hidden onChange={(e) => { void upload(p, e.target.files?.[0]); e.target.value = ''; }} /></label>
                  </div>
                </div>
              </div>
              {f ? (
                <div className="pf-results">
                  <form className="pf-search" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get('q'); void search(p.id, String(q ?? '')); }}>
                    <input name="q" defaultValue={f.query} aria-label={`Search Open Food Facts for ${p.name}`} />
                    <button className="btn small">Search</button>
                  </form>
                  {f.loading ? <p className="meta">Searching Open Food Facts…</p>
                    : f.error ? <p className="meta bad-text">{f.error}</p>
                    : f.results.length === 0 ? <p className="meta">No photos found. Try a shorter name (e.g. just the brand and product), or upload your own.</p>
                    : (
                      <ul>{f.results.map((c) => (
                        <li key={c.code + c.image}>
                          <button className="pf-cand" disabled={busy === p.id} onClick={() => use(p, c)} title={`Use this photo for ${p.name}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                            <span>{c.name}</span><small>{c.brand}{c.australian ? ' · AU' : ''}</small>
                          </button>
                        </li>
                      ))}</ul>
                    )}
                  <p className="pf-src">Photos from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a>, CC BY-SA. Check it&rsquo;s the same pack staff will see.</p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
