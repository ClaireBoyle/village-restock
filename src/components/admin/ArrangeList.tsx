'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { saveAreaOrder } from '@/app/actions/admin';

interface Item { id: string; productId: string; name: string; category: string | null; detail: string; heading: string | null }

/**
 * Drag the handle (works with a finger or a mouse) or use the arrows, then Save.
 * Nothing changes for staff until Save is pressed.
 */
export function ArrangeList({ areaId, items: initial }: { areaId: string; items: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const list = useRef<HTMLOListElement>(null);
  const sig = (xs: Item[]) => JSON.stringify(xs.map((i) => [i.id, i.heading?.trim() || null]));
  const dirty = sig(items) !== sig(saved);
  const setHeading = (id: string, heading: string | null) => { setItems((cur) => cur.map((x) => (x.id === id ? { ...x, heading } : x))); setMsg(null); };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    setItems((cur) => { const n = [...cur]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; });
    setMsg(null);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>('li[data-id]')];
    const from = items.findIndex((i) => i.id === drag);
    let to = rows.findIndex((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
    if (to === -1) to = rows.length - 1;
    else if (to > from) to -= 1;
    move(from, to);
  };
  const save = () => start(async () => {
    const r = await saveAreaOrder(areaId, items.map((i) => i.id), Object.fromEntries(items.map((i) => [i.id, i.heading?.trim() || null])));
    if (r?.error) setMsg({ ok: false, text: r.error });
    else { setSaved(items); setMsg({ ok: true, text: 'Order saved. Devices get it next time they connect.' }); router.refresh(); }
  });

  if (items.length === 0) return <section className="panel"><p className="meta">No products in this area yet.</p></section>;
  return (
    <section className="panel arrange">
      <ol ref={list} className="arr-list" onPointerMove={onPointerMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        {items.map((it, i) => (
          <li key={it.id} data-id={it.id} className={`${drag === it.id ? 'dragging' : ''} ${it.heading !== null ? 'has-head' : ''}`}>
            {it.heading !== null ? (
              <span className="arr-head">
                <input value={it.heading} maxLength={40} placeholder="Subheading, e.g. Beer, Cider & Hard Soda" aria-label={`Subheading above ${it.name}`}
                  onChange={(e) => setHeading(it.id, e.target.value)} onPointerDown={(e) => e.stopPropagation()} />
                <button type="button" className="linkbtn" onClick={() => setHeading(it.id, null)} aria-label={`Remove the subheading above ${it.name}`}><Icon name="x" /></button>
              </span>
            ) : null}
            <button type="button" className="arr-handle" aria-label={`Drag ${it.name}`}
              onPointerDown={(e) => { e.preventDefault(); (e.currentTarget.closest('ol') as HTMLElement).setPointerCapture(e.pointerId); setDrag(it.id); }}>
              <Icon name="list" /></button>
            <span className="arr-n tabular">{i + 1}</span>
            <span className="arr-t"><b>{it.name}</b><small>{[it.category, it.detail].filter(Boolean).join(' · ')}</small></span>
            <span className="move">
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${it.name} up`}><Icon name="up" /></button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label={`Move ${it.name} down`}><Icon name="down" /></button>
            </span>
            {it.heading === null ? <button type="button" className="btn small arr-hbtn" onClick={() => setHeading(it.id, '')} aria-label={`Add a subheading above ${it.name}`}><Icon name="tag" /><span className="lg">Subheading</span></button> : null}
            <Link className="btn small arr-edit" href={`/admin/products/${it.productId}`}>Edit</Link>
          </li>
        ))}
      </ol>
      <div className="arr-bar">
        {msg ? <p className={`meta ${msg.ok ? 'ok-text' : 'bad-text'}`} role="status">{msg.text}</p> : <p className="meta">{dirty ? 'Unsaved changes' : 'Drag the handle or use the arrows.'}</p>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" disabled={!dirty || pending} onClick={() => { setItems(saved); setMsg(null); }}>Undo changes</button>
        <button type="button" className="btn primary" disabled={!dirty || pending} onClick={save}><Icon name="save" />{pending ? 'Saving…' : 'Save order'}</button>
      </div>
    </section>
  );
}
