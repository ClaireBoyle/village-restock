'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { saveAreaOrder } from '@/app/actions/admin';

interface Item { id: string; productId: string; name: string; category: string | null; detail: string; heading: string | null }

/** One row of the list: a product, or a subheading that starts a group (a divider of its own). */
type Row = { kind: 'product'; key: string; item: Item } | { kind: 'head'; key: string; text: string };

/** Products with a heading become a heading row followed by the product. */
function toRows(input: Item[]): Row[] {
  // As staff see it: products above the first subheading are part of that first group.
  const f = input.findIndex((x) => x.heading?.trim());
  const items = f > 0 ? input.map((x, k) => (k === 0 ? { ...x, heading: input[f].heading } : k === f ? { ...x, heading: null } : x)) : input;
  const rows: Row[] = [];
  for (const it of items) {
    if (it.heading?.trim()) rows.push({ kind: 'head', key: `h-${it.id}`, text: it.heading.trim() });
    rows.push({ kind: 'product', key: it.id, item: it });
  }
  return rows;
}

/** Back to products: each product takes the heading row right above it (if any). Empty headings are dropped. */
function toItems(rows: Row[]): { ids: string[]; headings: Record<string, string | null> } {
  const ids: string[] = []; const headings: Record<string, string | null> = {};
  let pending: string | null = null;
  for (const r of rows) {
    if (r.kind === 'head') { pending = r.text.trim() || pending; continue; }
    ids.push(r.item.id); headings[r.item.id] = pending; pending = null;
  }
  return { ids, headings };
}

const sig = (rows: Row[]) => JSON.stringify(rows.map((r) => (r.kind === 'head' ? `#${r.text.trim()}` : r.key)));

/**
 * Drag the handle (works with a finger or a mouse) or use the arrows, then Save.
 * Subheadings are rows of their own: products move past them, and they stay where they're put.
 * Nothing changes for staff until Save is pressed.
 */
export function ArrangeList({ areaId, items: initial }: { areaId: string; items: Item[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [saved, setSaved] = useState<Row[]>(() => toRows(initial));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const list = useRef<HTMLOListElement>(null);
  const dirty = sig(rows) !== sig(saved);
  let n = 0; // product numbering skips headings

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    setRows((cur) => { const x = [...cur]; const [r] = x.splice(from, 1); x.splice(to, 0, r); return x; });
    setMsg(null);
  };
  const addHeading = (at: number) => { setRows((cur) => { const x = [...cur]; x.splice(at, 0, { kind: 'head', key: `h-new-${Date.now()}`, text: '' }); return x; }); setMsg(null); };
  const setText = (key: string, text: string) => { setRows((cur) => cur.map((r) => (r.key === key && r.kind === 'head' ? { ...r, text } : r))); setMsg(null); };
  const remove = (key: string) => { setRows((cur) => cur.filter((r) => r.key !== key)); setMsg(null); };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !list.current) return;
    const els = [...list.current.querySelectorAll<HTMLElement>('li[data-key]')];
    const from = rows.findIndex((r) => r.key === drag);
    let to = els.findIndex((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
    if (to === -1) to = els.length - 1;
    else if (to > from) to -= 1;
    move(from, to);
  };
  const save = () => start(async () => {
    const { ids, headings } = toItems(rows);
    const r = await saveAreaOrder(areaId, ids, headings);
    if (r?.error) setMsg({ ok: false, text: r.error });
    else {
      // Show what was saved (headings with no products under them are dropped).
      const clean = toRows(rows.flatMap((x) => (x.kind === 'product' ? [{ ...x.item, heading: headings[x.item.id] }] : [])));
      setRows(clean); setSaved(clean); setMsg({ ok: true, text: 'Order saved. Devices get it next time they connect.' }); router.refresh();
    }
  });

  if (initial.length === 0) return <section className="panel"><p className="meta">No products in this area yet.</p></section>;
  return (
    <section className="panel arrange">
      <ol ref={list} className="arr-list" onPointerMove={onPointerMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        {rows.map((r, i) => {
          const handle = (label: string) => (
            <button type="button" className="arr-handle" aria-label={`Drag ${label}`}
              onPointerDown={(e) => { e.preventDefault(); (e.currentTarget.closest('ol') as HTMLElement).setPointerCapture(e.pointerId); setDrag(r.key); }}>
              <Icon name="list" /></button>
          );
          const arrows = (label: string) => (
            <span className="move">
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${label} up`}><Icon name="up" /></button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === rows.length - 1} aria-label={`Move ${label} down`}><Icon name="down" /></button>
            </span>
          );
          if (r.kind === 'head') {
            const label = `subheading ${r.text || '(new)'}`;
            return (
              <li key={r.key} data-key={r.key} className={`arr-hrow ${drag === r.key ? 'dragging' : ''}`}>
                {handle(label)}
                <input value={r.text} maxLength={40} placeholder="Subheading, e.g. Beer, Cider & Hard Soda" aria-label="Subheading"
                  onChange={(e) => setText(r.key, e.target.value)} onPointerDown={(e) => e.stopPropagation()} autoFocus={!r.text && r.key.startsWith('h-new')} />
                {arrows(label)}
                <button type="button" className="iconbtn arr-hx" onClick={() => remove(r.key)} aria-label={`Remove ${label}`}><Icon name="x" /></button>
              </li>
            );
          }
          const it = r.item; n += 1;
          const headed = i > 0 && rows[i - 1].kind === 'head';
          return (
            <li key={r.key} data-key={r.key} data-id={it.id} className={drag === r.key ? 'dragging' : ''}>
              {handle(it.name)}
              <span className="arr-n tabular">{n}</span>
              <span className="arr-t"><b>{it.name}</b><small>{[it.category, it.detail].filter(Boolean).join(' · ')}</small></span>
              {arrows(it.name)}
              {headed ? null : <button type="button" className="btn small arr-hbtn" onClick={() => addHeading(i)} aria-label={`Add a subheading above ${it.name}`}><Icon name="tag" /><span className="lg">Subheading</span></button>}
              <Link className="btn small arr-edit" href={`/admin/products/${it.productId}`}>Edit</Link>
            </li>
          );
        })}
      </ol>
      <div className="arr-bar">
        {msg ? <p className={`meta ${msg.ok ? 'ok-text' : 'bad-text'}`} role="status">{msg.text}</p> : <p className="meta">{dirty ? 'Unsaved changes' : 'Drag the handle or use the arrows. Subheadings move like products.'}</p>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" disabled={!dirty || pending} onClick={() => { setRows(saved); setMsg(null); }}>Undo changes</button>
        <button type="button" className="btn primary" disabled={!dirty || pending} onClick={save}><Icon name="save" />{pending ? 'Saving…' : 'Save order'}</button>
      </div>
    </section>
  );
}
