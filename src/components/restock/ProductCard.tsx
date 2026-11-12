'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { cardState, needOf, type ItemState, type PlacementView } from '@/lib/restock-logic';
import { parseQuantity, round2 } from '@/lib/restock-math';
import { Badge, initials } from './shared';

const fmt = (n: number | null) => (n === null ? '' : String(round2(n)));
const unit = (p: PlacementView, n: number | null) => (n === 1 ? p.unitSingular : p.unitPlural);

/**
 * One product, everything at a glance: target, what's here now, what to collect.
 * Typing is kept as text until it's a valid number, so a half-typed "2." is never lost.
 */
export function ProductCard({ p, item, onChange, showArea, onRemove }: {
  p: PlacementView; item: ItemState; onChange: (fields: Partial<ItemState>) => void; showArea?: boolean; onRemove?: () => void;
}) {
  const st = cardState(p, item);
  const need = needOf(p, item);
  const field: 'currentQty' | 'requestedQty' = p.method === 'par' ? 'currentQty' : 'requestedQty';
  const value = item[field];
  const [text, setText] = useState(fmt(value));
  const [err, setErr] = useState('');
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
  // From blank, + gives 1 and - gives 0 (a quick way to say "empty").
  const bump = (dir: 1 | -1) => commit(Math.max(0, round2((value ?? 0) + dir * step)));

  const badge =
    st === 'none' ? <Badge st="none">Not checked</Badge>
    : p.method === 'routine' ? (st === 'warn' ? <Badge st="warn">On list</Badge> : <Badge st="ok">Not needed</Badge>)
    : (need ?? 0) > 0 ? <Badge st="warn">Collect {round2(need!)}</Badge>
    : <Badge st="ok">{p.method === 'manual' ? 'None needed' : 'Stocked'}</Badge>;

  const stepper = (
    <div className="stepper">
      <button type="button" onClick={() => bump(-1)} aria-label={`One less ${p.productName}`}><Icon name="minus" /></button>
      <input className="qty-input" id={`q-${p.placementId}`} type="text" inputMode={p.allowDecimal ? 'decimal' : 'numeric'}
        value={text} placeholder="–" autoComplete="off" aria-describedby={`e-${p.placementId}`}
        onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setText(fmt(value)); setErr(''); }}
        onChange={(e) => onType(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <button type="button" onClick={() => bump(1)} aria-label={`One more ${p.productName}`}><Icon name="plus" /></button>
    </div>
  );

  const collect = (
    <div className={`qs c ${need === null ? '' : need > 0 ? 's-warn' : 's-ok'}`}>
      {need === null
        ? <><span className="lbl">Collect</span><span className="big">&ndash;</span><span className="unit">{p.method === 'par' ? 'Enter count' : 'Enter need'}</span></>
        : need > 0
          ? <><span className="lbl"><Icon name="up" />Collect</span><span className="big" key={need} style={{ display: 'inline-block', animation: 'bump .26s ease-out' }}>{round2(need)}</span><span className="unit">{unit(p, need)}</span></>
          : <><span className="lbl"><Icon name="check" />Collect</span><span className="big">0</span><span className="unit">{p.method === 'par' ? 'At target' : 'None'}</span></>}
    </div>
  );

  let body: React.ReactNode;
  if (p.method === 'par') {
    const pct = value === null || !p.par ? 0 : Math.min(100, (value / p.par) * 100);
    body = (
      <div className="c-grid">
        <div className="qs t"><span className="lbl">Target</span><span className="big">{p.par === null ? '–' : round2(p.par)}</span><span className="unit">{unit(p, p.par)}</span>
          <div className={`tbar s-${st}`} role="img" aria-label={value === null ? 'Not checked yet' : `${fmt(value)} of ${fmt(p.par)} ${p.unitPlural}`}><i style={{ width: `${pct}%` }} /></div></div>
        <div className="qs h"><label className="lbl" htmlFor={`q-${p.placementId}`}>Have now</label>{stepper}
          <div className="shortcuts">
            <button type="button" className={value === 0 ? 'on' : ''} onClick={() => commit(0)}>Empty</button>
            <button type="button" className={value !== null && value === p.par ? 'on' : ''} onClick={() => commit(p.par)}><Icon name="check" />Full</button>
            <button type="button" className="x" disabled={value === null} onClick={() => commit(null)} aria-label={`Clear ${p.productName}`}><Icon name="x" /></button>
          </div></div>
        {collect}
      </div>
    );
  } else if (p.method === 'manual') {
    body = (
      <div className="c-grid manual">
        <div className="qs h"><label className="lbl" htmlFor={`q-${p.placementId}`}>Need</label>{stepper}
          <div className="shortcuts">
            {[0, 1, 2, 3].map((v) => <button type="button" key={v} className={value === v ? 'on' : ''} onClick={() => commit(v)}>{v === 0 ? 'None' : v}</button>)}
            <button type="button" className="x" disabled={value === null} onClick={() => commit(null)} aria-label={`Clear ${p.productName}`}><Icon name="x" /></button>
          </div></div>
        {collect}
      </div>
    );
  } else {
    body = (
      <div className="routine"><span className="lbl"><Icon name="task" />Routine task</span><p className="r-text">{p.instructions || 'Restock as usual.'}</p>
        <div className="shortcuts">
          <button type="button" className={item.routineChoice === 'needed' ? 'on' : ''} onClick={() => onChange({ routineChoice: item.routineChoice === 'needed' ? null : 'needed' })}><Icon name="up" />Needed</button>
          <button type="button" className={item.routineChoice === 'not_needed' ? 'on' : ''} onClick={() => onChange({ routineChoice: item.routineChoice === 'not_needed' ? null : 'not_needed' })}>Not needed tonight</button>
        </div></div>
    );
  }

  return (
    <article className={`card s-${st}`} data-placement={p.placementId}>
      <div className="c-head">
        <div className="thumb" aria-hidden="true">{initials(p.productName)}</div>
        <div className="c-title"><h3>{p.productName}</h3><p className="meta">{showArea ? `${p.areaName} · ` : ''}From <b>{p.locationName ?? 'no storeroom set'}</b></p></div>
        {badge}
      </div>
      {body}
      {err ? <p className="err" id={`e-${p.placementId}`} role="alert">{err}</p> : null}
      {p.method !== 'routine' && p.instructions ? <p className="note"><Icon name="info" /><span>{p.instructions}</span></p> : null}
      {onRemove ? <button type="button" className="linkbtn removebtn" onClick={onRemove}>Remove from list</button> : null}
    </article>
  );
}
