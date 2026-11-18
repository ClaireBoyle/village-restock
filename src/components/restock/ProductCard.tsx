'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { cardState, isRequired, needOf, type ItemState, type PlacementView } from '@/lib/restock-logic';
import { formatQty, parseQuantity, round2 } from '@/lib/restock-math';

const fmt = (n: number | null) => (n === null ? '' : String(round2(n)));
const unit = (p: PlacementView, n: number | null) => (n === 1 ? p.unitSingular : p.unitPlural);

/** Enter on a number box moves straight to the next product, so a whole area can be typed in one go. */
function focusNext(from: HTMLInputElement) {
  const all = [...document.querySelectorAll<HTMLInputElement>('input.qty-input:not([readonly])')];
  const next = all[all.indexOf(from) + 1];
  if (next) { next.focus(); next.select(); next.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else from.blur();
}

/**
 * One product as a compact row: name, a one-line status, and the control for
 * its restock method. Blank = not checked yet; 0 = checked, nothing needed.
 * Typing is kept as text until it's a valid number, so a half-typed "2." is never lost.
 */
export function ProductRow({ p, item, onChange, showArea, onRemove, note, suggestedQty }: {
  p: PlacementView; item: ItemState; onChange: (fields: Partial<ItemState>, resolve?: boolean) => void;
  showArea?: boolean; onRemove?: () => void;
  /** Refill FOH: the amount suggested from what was grabbed for front of house (staff can change or remove it). */
  suggestedQty?: number;
  /** A note about this product only (general area notes are shown once at the top). */
  note?: string | null;
}) {
  const st = cardState(p, item);
  const refillTask = p.method === 'routine' && !!p.pickupAreaId;
  const need = needOf(p, item);
  const field: 'currentQty' | 'requestedQty' = p.method === 'par' ? 'currentQty' : 'requestedQty';
  const value = item[field];
  const [text, setText] = useState(fmt(value));
  const [err, setErr] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value]);

  const commit = (v: number | null) => { setErr(''); setText(fmt(v)); onChange({ [field]: v }); };
  const onType = (raw: string) => {
    setText(raw);
    const r = parseQuantity(raw, { allowDecimal: p.allowDecimal, unitPlural: p.unitPlural });
    if (!r.ok) { setErr(r.message); return; }
    setErr('');
    if (r.value !== value) onChange({ [field]: r.value });
  };
  const step = p.allowDecimal ? 0.5 : 1;
  // From blank, + gives 1 and − gives 0 (a quick way to say "none" / "empty").
  const bump = (dir: 1 | -1) => commit(Math.max(0, round2((value ?? 0) + dir * step)));
  // "Staff enter" products start as a single "+ Add". Once added, − steps down to 0 ("none needed"),
  // and − at 0 clears it back to untouched (blank = not entered, which is different from 0).
  const progressive = p.method === 'manual';
  const atZero = progressive && value === 0;
  // A suggested amount taken down to 0 is "removed"; the button beside it brings the suggestion back.
  const sug = suggestedQty !== undefined && suggestedQty > 0 ? suggestedQty : null;
  const c = item.conflict;
  // Exception-based products ("staff enter", routine tasks): a blank row is simply fine,
  // so it isn't shown as a job to do. Only target-level counts are required.
  const optional = !isRequired(p);
  const quiet = optional && st === 'none';

  // One line that says where this product stands, in words as well as colour.
  const target = p.method === 'par' && p.par !== null ? `Target ${round2(p.par)}` : null;
  let status: React.ReactNode;
  if (c) status = <><Icon name="warn" />Two different {p.method === 'routine' ? 'answers' : 'counts'}: choose below</>;
  else if (st === 'none') status = p.method === 'par' ? <>Not checked &middot; {target ?? 'no target set'}</> : <span className="sr-only">Not entered</span>;
  else if (progressive && (need ?? 0) > 0) status = <><b>{formatQty(need!, p.unitSingular, p.unitPlural)}</b><span>to collect</span></>;
  else if (progressive && sug) status = <><Icon name="check" />Removed: none needed</>;
  else if (progressive) status = <><Icon name="check" />None needed</>;
  // A container refilled from an upstairs spot (e.g. sugar, Flake): its instructions are on the Refill FOH list.
  else if (p.method === 'routine' && refillTask) status = item.routineChoice === 'needed' ? <><Icon name="up" />To grab upstairs</> : <><Icon name="check" />Not needed</>;
  else if (p.method === 'routine') status = item.routineChoice === 'needed' ? <><Icon name="up" />On the list</> : <><Icon name="check" />Not needed</>;
  else if ((need ?? 0) > 0) status = <>{target ? `${target} · ` : ''}<Icon name="up" /><b>{formatQty(need!, p.unitSingular, p.unitPlural)}</b><span className="lg">&nbsp;to collect</span></>;
  else status = <>{target ? `${target} · ` : ''}<Icon name="check" />{p.method === 'manual' ? 'None needed' : 'At target'}</>;

  const stepper = (
    <div className="pstep">
      {atZero && sug
        ? <button type="button" className="pclear" onClick={() => commit(null)} aria-label={`Back to the suggested ${round2(sug)} ${p.productName}`}><Icon name="reset" /></button>
        : atZero
        ? <button type="button" className="pclear" onClick={() => commit(null)} aria-label={`Clear ${p.productName}`}><Icon name="x" /></button>
        : <button type="button" onClick={() => bump(-1)} aria-label={`One less ${p.productName}`}><Icon name="minus" /></button>}
      <input className="qty-input" id={`q-${p.placementId}`} type="text" inputMode={p.allowDecimal ? 'decimal' : 'numeric'} enterKeyHint="next"
        value={text} placeholder="–" autoComplete="off" aria-describedby={`s-${p.placementId}`}
        aria-label={p.method === 'par' ? `${p.productName}: how many on the shelf` : `${p.productName}: how many needed`}
        onFocus={(e) => { focused.current = true; e.target.select(); }} onBlur={() => { focused.current = false; setText(fmt(value)); setErr(''); }}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(e.currentTarget); } }} />
      <button type="button" onClick={() => bump(1)} aria-label={`One more ${p.productName}`}><Icon name="plus" /></button>
    </div>
  );

  let controls: React.ReactNode = null;
  if (c) controls = null;
  else if (p.method === 'manual') {
    // Untouched: one compact Add. Leaving it alone already means nothing is needed.
    controls = value === null && !err
      ? <button type="button" className="padd" onClick={() => commit(1)}
          aria-label={`Add ${p.productName}`}><Icon name="plus" />Add</button>
      : stepper;
  } else if (p.method === 'par') {
    const full = value !== null && p.par !== null && value >= p.par;
    controls = <>
      <button type="button" className={`pquick ${full ? 'on' : ''}`} aria-pressed={full} disabled={p.par === null} onClick={() => commit(full ? null : p.par)}>Full</button>
      <div className="pcount"><span className="plabel" aria-hidden="true">On shelf</span>{stepper}</div>
    </>;
  } else {
    controls = (
      // One toggle: tap if the task is needed tonight; left alone it isn't.
      <div className="pseg" role="group" aria-label={refillTask ? `${p.productName}: needs refill?` : `${p.productName}: needed tonight?`}>
        <button type="button" className={item.routineChoice === 'needed' ? 'on warn' : ''} aria-pressed={item.routineChoice === 'needed'}
          onClick={() => onChange({ routineChoice: item.routineChoice === 'needed' ? null : 'needed' })}><Icon name={item.routineChoice === 'needed' ? 'check' : 'plus'} />{refillTask ? 'Needs refill' : 'Needed'}</button>
      </div>
    );
  }

  let clash: React.ReactNode = null;
  if (c) {
    const show = (v: number | string | null) => v === null ? 'blank'
      : typeof v === 'number' ? `${round2(v)} ${unit(p, v)}` : v === 'needed' ? 'Needed' : 'Not needed';
    const when = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : '');
    clash = (
      <div className="conflict" role="alert">
        <p><b>{c.theirsBy ?? 'Someone'}</b>: {show(c.theirs)}{c.theirsAt ? ` at ${when(c.theirsAt)}` : ''} &middot; <b>{c.mineBy ?? 'Someone else'}</b>: {show(c.mine)}{c.mineAt ? ` at ${when(c.mineAt)}` : ''}</p>
        <p className="meta">Neither was thrown away. Check {p.areaName} and choose the right one.</p>
        <div className="opts">
          {[c.theirs, c.mine].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
            <button key={String(v)} className="btn" onClick={() => onChange({ [c.field]: v } as Partial<ItemState>, true)}>Use {show(v)}</button>
          ))}
          <button className="btn" onClick={() => { onChange({ [c.field]: null } as Partial<ItemState>, true); window.setTimeout(() => document.getElementById(`q-${p.placementId}`)?.focus(), 50); }}>Recount</button>
        </div>
      </div>
    );
  }

  const routineText = p.method === 'routine' && !refillTask ? (p.instructions || 'Routine task') : null;
  return (
    <article className={`prow card s-${st} m-${p.method} ${quiet ? 'quiet' : ''} ${sug ? 'suggested' : ''}`} data-placement={p.placementId}>
      {/* A fixed photo slot, so adding a photo never moves anything. */}
      {p.photoPath ? <ProductThumb src={p.photoPath} name={p.productName} credit={p.photoCredit} className="pphoto" />
        : <span className="pphoto ph" aria-hidden="true"><Icon name="box" /></span>}
      <div className="pt">
        <h3>{p.productName}</h3>
        {quiet && !showArea ? <p className="ps" id={`s-${p.placementId}`}>{status}</p>
          : <p className="ps" id={`s-${p.placementId}`}>{showArea ? <span className="parea">{p.areaName}{quiet ? '' : ' · '}</span> : null}{status}</p>}
        {routineText ? <p className="pnote task"><Icon name="task" />{routineText}</p> : null}
        {note ? <button type="button" className={`pnote ${noteOpen ? 'open' : ''}`} onClick={() => setNoteOpen(!noteOpen)} aria-expanded={noteOpen}><Icon name="info" /><span>{note}</span></button> : null}
        {onRemove ? <button type="button" className="linkbtn premove" onClick={onRemove}>Remove from list</button> : null}
      </div>
      <div className="pc">{controls}</div>
      {err ? <p className="err pwide" role="alert">{err}</p> : null}
      {clash ? <div className="pwide">{clash}</div> : null}
    </article>
  );
}

/** Full-screen photo. Tap anywhere (or press Escape) to close. */
export function PhotoZoom({ src, title, onClose, credit }: { src: string; title: string; onClose: () => void; credit?: string | null }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="photo-zoom" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={title} />
      <p>{title}</p>
      {credit ? <small className="pz-credit">{credit}</small> : null}
      <button type="button" className="btn" onClick={onClose}><Icon name="x" />Close</button>
    </div>
  );
}

/** A product photo thumbnail; tap to see it full screen. Renders nothing if there's no photo. */
export function ProductThumb({ src, name, className = '', credit }: { src: string | null | undefined; name: string; className?: string; credit?: string | null }) {
  const [zoom, setZoom] = useState(false);
  if (!src) return null;
  return (
    <>
      <button type="button" className={`pthumb ${className}`} onClick={(e) => { e.stopPropagation(); setZoom(true); }} aria-label={`Show photo of ${name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" decoding="async" />
      </button>
      {zoom ? <PhotoZoom src={src} title={name} credit={credit} onClose={() => setZoom(false)} /> : null}
    </>
  );
}
