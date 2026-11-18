'use client';
// Defrost rows (Gold Class Kitchen → Defrost): where to grab it, where to look if that's empty,
// where it goes; tomorrow's admits (entered once); and what's already ready, for the suggestion.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { formatQty, parseQuantity, round2 } from '@/lib/restock-math';
import { defrostRowInfo, type DefrostSuggestion } from '@/lib/defrost-rows';
import type { ItemState, PlacementView } from '@/lib/restock-logic';

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(round2(n)));

/** Grab / If empty / Put, one short line each. */
export function DefrostNotes({ grab, fallback, put, className = '' }: { grab?: string | null; fallback?: string | null; put?: string | null; className?: string }) {
  if (!grab && !fallback && !put) return null;
  return (
    <dl className={`dnotes ${className}`}>
      {grab ? <div className="dn-grab"><dt><Icon name="pin" />Grab</dt><dd>{grab}</dd></div> : null}
      {fallback ? <div className="dn-fall"><dt><Icon name="next" />If empty</dt><dd>{fallback}</dd></div> : null}
      {put ? <div className="dn-put"><dt><Icon name="down" />Put</dt><dd>{put}</dd></div> : null}
    </dl>
  );
}

/**
 * A small number box kept as text while typing (so "1." isn't lost), saved once it's a valid number.
 * Blank = not entered, which is different from 0.
 */
export function NumberBox({ id, value, onCommit, label, allowDecimal = false, unitPlural, wait = 0, max = 999 }: {
  id: string; value: number | null; onCommit: (v: number | null) => void; label: string;
  allowDecimal?: boolean; unitPlural?: string;
  /** Wait this long after typing stops before saving (0 = save on every valid change). */
  wait?: number;
  /** Highest number accepted (default 999, as on every product). */
  max?: number;
}) {
  const [text, setText] = useState(fmt(value));
  const [err, setErr] = useState('');
  const focused = useRef(false);
  const timer = useRef<number | null>(null);
  const pending = useRef<{ v: number | null } | null>(null);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const flush = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (pending.current) { const { v } = pending.current; pending.current = null; if (v !== value) onCommit(v); }
  };
  const save = (v: number | null) => {
    if (!wait) { if (v !== value) onCommit(v); return; }
    pending.current = { v };
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, wait);
  };
  const onType = (raw: string) => {
    setText(raw);
    const r = parseQuantity(raw, { allowDecimal, unitPlural: unitPlural ?? 'numbers', max });
    if (!r.ok) { setErr(r.message); return; }
    setErr('');
    save(r.value);
  };
  return (
    <>
      <input className="qty-input nbox" id={id} type="text" inputMode={allowDecimal ? 'decimal' : 'numeric'} enterKeyHint="done"
        value={text} placeholder="–" autoComplete="off" aria-label={label} aria-invalid={err ? true : undefined}
        onFocus={(e) => { focused.current = true; e.target.select(); }}
        onBlur={() => { focused.current = false; flush(); setErr(''); setText(fmt(pending.current ? pending.current.v : value)); }}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); flush(); e.currentTarget.blur(); } }} />
      {err ? <span className="err nbox-err" role="alert">{err}</span> : null}
    </>
  );
}

/** Tomorrow's forecast Gold Class admits: entered once, used for every suggested amount. */
export function AdmitsBox({ admits, onSave, missing }: { admits: number | null; onSave: (v: number | null) => void; missing: number }) {
  return (
    <section className={`admits ${admits === null ? 'empty' : ''}`} aria-labelledby="admits-l">
      <label id="admits-l" htmlFor="admits-in"><b>Tomorrow&rsquo;s Gold Class admits</b>
        <small>{admits === null ? 'Enter the forecast once to get suggested amounts.' : missing ? `Count what's ready on ${missing} more item${missing === 1 ? '' : 's'} for a suggestion.` : 'Suggested amounts use this forecast.'}</small></label>
      <NumberBox id="admits-in" value={admits} onCommit={onSave} label="Tomorrow's forecast Gold Class admits" wait={700} max={9999} />
    </section>
  );
}

/**
 * One defrost item: how many to pull, or Not needed. Where to grab it, where to look if that's empty,
 * and where it goes are always on the row. With admits targets, staff also count what's already
 * ready or defrosting, and the amount to pull is suggested (they can change it).
 */
export function DefrostRow({ p, item, rawQty, suggestion, admits, onChange, photo }: {
  p: PlacementView; item: ItemState;
  /** What staff entered themselves (null = untouched, so a suggestion stands). */
  rawQty: number | null;
  suggestion?: DefrostSuggestion;
  admits: number | null;
  onChange: (fields: Partial<ItemState>, resolve?: boolean) => void;
  photo: React.ReactNode;
}) {
  const info = defrostRowInfo(p);
  const v = item.requestedQty;
  const q = (n: number) => formatQty(n, p.unitSingular, p.unitPlural);
  const rq = (n: number) => formatQty(n, info.readySingular, info.readyPlural);
  const c = item.conflict;
  const st = c ? 'bad' : v === null ? 'none' : v > 0 ? 'warn' : 'ok';
  const set = (n: number | null) => onChange({ requestedQty: n });
  const step = p.allowDecimal ? 0.5 : 1;
  const changed = suggestion && rawQty !== null && rawQty !== suggestion.qty;

  let status: React.ReactNode;
  if (c) status = <><Icon name="warn" />Two different amounts: choose below</>;
  else if (v === null) status = info.canSuggest && admits === null ? <>Enter tomorrow&rsquo;s admits above for a suggestion</>
    : info.canSuggest && item.currentQty === null ? <>Count what&rsquo;s ready for a suggestion</>
    : <span className="sr-only">Not entered</span>;
  else if (v > 0) status = <><Icon name="up" /><b>Pull {q(v)}</b>{suggestion && rawQty === null ? <span>&nbsp;· suggested</span> : null}</>;
  else status = <><Icon name="check" />{suggestion && rawQty === null ? 'Nothing to pull: enough is ready' : 'Not needed'}</>;

  // How the suggestion was worked out, in one line (e.g. "Target 24 for 81–160 admits − 10 ready = 14").
  let working: string | null = null;
  if (suggestion) {
    const r = suggestion.range;
    const range = r.max === null ? `${r.min}+ admits` : `${r.min}–${r.max} admits`;
    const short = Math.max(0, round2(suggestion.target - suggestion.ready));
    working = `Target ${rq(suggestion.target)} for ${range} − ${round2(suggestion.ready)} ready = ${rq(short)}`
      + (suggestion.per !== 1 ? ` → ${q(suggestion.qty)} (${round2(suggestion.per)} ${info.readyPlural} each)` : '')
      + (changed ? ` · suggested ${round2(suggestion.qty)}` : '');
  } else if (info.canSuggest && admits !== null && item.currentQty !== null) {
    working = `No target set for ${admits} admits: enter the amount to pull.`;
  }

  let controls: React.ReactNode;
  if (c) controls = null;
  else if (v === null) {
    controls = (
      <div className="dr-pick">
        <button type="button" className="padd" onClick={() => set(1)} aria-label={`Pull ${p.productName}`}><Icon name="plus" />Pull</button>
        <button type="button" className="pnn" onClick={() => set(0)} aria-label={`${p.productName}: not needed`}>Not needed</button>
      </div>
    );
  } else {
    controls = (
      <div className="dr-pick">
        <div className="pstep">
          {v === 0 && rawQty !== null
            ? <button type="button" className="pclear" onClick={() => set(null)} aria-label={suggestion ? `Back to the suggested ${round2(suggestion.qty)} ${p.productName}` : `Clear ${p.productName}`}><Icon name={suggestion ? 'reset' : 'x'} /></button>
            : <button type="button" onClick={() => set(Math.max(0, round2(v - step)))} disabled={v === 0} aria-label={`One less ${p.productName}`}><Icon name="minus" /></button>}
          <NumberBox id={`q-${p.placementId}`} value={v} onCommit={set} label={`${p.productName}: how many to pull`} allowDecimal={p.allowDecimal} unitPlural={p.unitPlural} />
          <button type="button" onClick={() => set(round2(v + step))} aria-label={`One more ${p.productName}`}><Icon name="plus" /></button>
        </div>
        {v > 0 ? <button type="button" className="pnn small" onClick={() => set(0)} aria-label={`${p.productName}: not needed`}>Not needed</button> : null}
        {changed ? <button type="button" className="linkbtn dr-back" onClick={() => set(null)}>Use suggested {round2(suggestion!.qty)}</button> : null}
      </div>
    );
  }

  return (
    <article className={`prow card drow s-${st} m-manual ${v === null && !c ? 'quiet' : ''} ${suggestion ? 'suggested' : ''}`} data-placement={p.placementId}>
      {photo}
      <div className="pt">
        <h3>{p.productName}</h3>
        <p className="ps" id={`s-${p.placementId}`}>{status}</p>
      </div>
      <div className="pc">{controls}</div>
      <div className="pwide dr-body">
        <DefrostNotes grab={p.grabNote} fallback={p.fallbackNote} put={p.putNote} />
        {info.canSuggest ? (
          <div className="dr-ready">
            <label htmlFor={`r-${p.placementId}`}>Already ready or defrosting for tomorrow</label>
            <span className="dr-rbox"><NumberBox id={`r-${p.placementId}`} value={item.currentQty} onCommit={(n) => onChange({ currentQty: n })}
              label={`${p.productName}: ${info.readyPlural} already ready or defrosting`} allowDecimal={p.allowDecimal} unitPlural={info.readyPlural} wait={500} />
              <small>{info.readyPlural}</small></span>
          </div>
        ) : null}
        {working ? <p className="dr-work">{working}</p> : null}
      </div>
    </article>
  );
}
