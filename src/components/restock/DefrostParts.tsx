'use client';
// Defrost rows (Gold Class Kitchen → Defrost): where to grab it, where to look if that's empty,
// where it goes; tomorrow's admits (entered once); and what's already ready, for the suggestion.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { formatQty, parseQuantity, round2 } from '@/lib/restock-math';
import { defrostRowInfo, type DefrostSuggestion } from '@/lib/defrost-rows';
import { defrostSource, needOf, pullState, storeLabel, type ItemState, type PlacementView } from '@/lib/restock-logic';

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

/** "Downstairs walk-in freezer" and "Downstairs walk in freezer" are the same place. */
export const sameText = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Source → destination in one line (e.g. "Freezer 1 · Lower left → Upstairs walk-in fridge"). */
export function DefrostRouteLine({ p, from }: { p: PlacementView; from?: string }) {
  const src = from ?? defrostSource(p);
  return <p className="dr-route"><span className="dr-src">{src}</span>{p.putNote ? <><span className="dr-arrow" aria-label="to">&rarr;</span><span className="dr-dest">{p.putNote}</span></> : null}</p>;
}

/** A "Check … first" note: said first, in bold, with a warning sign. */
export const isCheckNote = (n: string | null | undefined) => !!n && /^check\b/i.test(n);

/** Source → destination, with a "Check … first" note above it and any other detail below. */
export function DefrostRoute({ p, from }: { p: PlacementView; from?: string }) {
  const check = isCheckNote(p.grabNote);
  return (
    <>
      {check ? <p className="dr-detail dr-check"><Icon name="warn" />{p.grabNote}</p> : null}
      <DefrostRouteLine p={p} from={from} />
      {p.grabNote && !check ? <p className="dr-detail">{p.grabNote}</p> : null}
    </>
  );
}

/** The unit beside the number: "tubs", or "× 1 kg bag" for a unit with its size. */
export function unitText(p: PlacementView, v: number | null) {
  const u = v === 1 ? p.unitSingular : p.unitPlural;
  return /^\d/.test(u) ? `× ${u}` : u;
}

/** "Bags to pull · 8 portions each": what the amount counts, beside it. */
function amountLabel(p: PlacementView, pickup: boolean) {
  const info = defrostRowInfo(p);
  const unit = p.unitPlural.charAt(0).toUpperCase() + p.unitPlural.slice(1);
  const each = p.readyPer && p.readyPer !== 1 && info.readyPlural && info.readyPlural !== p.unitPlural ? ` · ${round2(p.readyPer)} ${info.readyPlural} each` : '';
  return `${unit} to ${pickup ? 'pull' : 'defrost'}${each}`;
}

/**
 * One defrost item: name, any "check first" note, where it's from and where it goes, then the amount (− / + always
 * there, blank until set) beside "Not needed". Setting an amount means it needs defrosting; it's marked Pulled only
 * once it's been moved (on "Pull for defrost" below). With admits targets, what's already ready gives a suggestion.
 * compact: one line in a list whose route is shown once above it (e.g. the desserts).
 */
export function DefrostRow({ p, item, rawQty, suggestion, admits, onChange, photo, pickup, compact = false }: {
  p: PlacementView; item: ItemState;
  /** What staff entered themselves (null = untouched, so a suggestion stands). */
  rawQty: number | null;
  suggestion?: DefrostSuggestion;
  admits: number | null;
  onChange: (fields: Partial<ItemState>, resolve?: boolean) => void;
  /** The product photo, if there is one (no placeholder). */
  photo: React.ReactNode;
  /** Pulled from an upstairs freezer (vs collected from downstairs with the collection list). */
  pickup: boolean;
  /** One line in a list that shares one route (shown above the list). */
  compact?: boolean;
}) {
  const info = defrostRowInfo(p);
  const v = item.requestedQty;
  const q = (n: number) => formatQty(n, p.unitSingular, p.unitPlural);
  const rq = (n: number) => formatQty(n, info.readySingular, info.readyPlural);
  const c = item.conflict;
  const ps = pullState(p, item);
  const st = c ? 'bad' : v === null ? 'none' : v > 0 ? (pickup && ps.state === 'pulled' ? 'ok' : 'warn') : 'ok';
  // Quick taps on + / − count from the last amount set, not the one on screen (it's saved a moment later).
  const last = useRef(v);
  useEffect(() => { last.current = v; }, [v]);
  const set = (n: number | null) => { last.current = n; onChange({ requestedQty: n }); };
  const step = p.allowDecimal ? 0.5 : 1;
  const bump = (d: 1 | -1) => { const cur = last.current; set(cur === null ? (d > 0 ? step : null) : Math.max(0, round2(cur + d * step))); };
  const changed = suggestion && rawQty !== null && rawQty !== suggestion.qty;

  // Said only when it adds something: the amount and Not needed are already in view.
  let status: React.ReactNode = null;
  if (c) status = <><Icon name="warn" />Two different amounts: choose below</>;
  else if (v === null) status = info.canSuggest && admits === null ? <>Enter tomorrow&rsquo;s admits for a suggestion</>
    : info.canSuggest && item.currentQty === null ? <>Count what&rsquo;s ready for a suggestion</> : null;
  else if (v > 0 && pickup && ps.state === 'pulled') status = <><Icon name="check" />Pulled {q(v)}</>;
  else if (v > 0 && pickup && ps.state === 'short') status = <><Icon name="warn" />{ps.pulled ? <>Pulled {round2(ps.pulled)} of {q(v)}</> : <>Not upstairs</>} &middot; {round2(ps.rest)} from downstairs</>;
  else if (v > 0 && suggestion && rawQty === null) status = <><b>{q(v)}</b><span>&nbsp;suggested</span></>;
  else if (v === 0 && suggestion && rawQty === null) status = <><Icon name="check" />Enough is ready</>;
  const srStatus = v === null ? 'Not reviewed' : v > 0 ? `${q(v)} to ${pickup ? 'pull' : 'defrost'}` : 'Not needed';

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
    working = `No target set for ${admits} admits: set the amount.`;
  }

  // The amount (− / + always there; blank until set) and Not needed. Not needed chosen: just that, filled in.
  const controls = c ? null : (
    <div className="dr-acts">
      {v === 0 ? null : (
        <div className="pstep dr-step">
          <button type="button" onClick={() => bump(-1)} disabled={v === null} aria-label={`One less ${p.productName}`}><Icon name="minus" /></button>
          <span className="dr-qty"><NumberBox id={`q-${p.placementId}`} value={v} onCommit={set} label={`${p.productName}: amount to defrost`} allowDecimal={p.allowDecimal} unitPlural={p.unitPlural} /></span>
          <button type="button" onClick={() => bump(1)} aria-label={`One more ${p.productName}`}><Icon name="plus" /></button>
        </div>
      )}
      {v === 0 ? null : <span className="dr-unit">{unitText(p, v)}</span>}
      {v === 0 ? null : <span className="dr-sep" aria-hidden="true" />}
      <button type="button" className={`dr-b dr-nn ${v === 0 ? 'on' : ''}`} aria-pressed={v === 0}
        onClick={() => set(v === 0 ? null : 0)} aria-label={v === 0 ? `${p.productName}: not needed (tap to undo)` : `${p.productName}: not needed`}>
        {v === 0 ? <Icon name="check" /> : null}Not needed</button>
      {changed ? <button type="button" className="linkbtn dr-back" onClick={() => set(null)}>Use suggested {round2(suggestion!.qty)}</button> : null}
    </div>
  );

  if (compact) {
    // What to check here, said once (e.g. "Check portioned beef first"): the row's own instruction, or a check note.
    const note = p.instructions?.trim() || (isCheckNote(p.grabNote) ? p.grabNote : null);
    return (
      <article className={`drow2 dline s-${st} ${v === null && !c ? 'quiet' : ''} ${v !== null && v > 0 ? 'has-qty' : ''}`} data-placement={p.placementId}>
        <div className="dl-t">
          <h3>{p.productName}</h3>
          {note ? <p className="dr-detail dr-check"><Icon name="warn" />{note}</p> : null}
          <p className="ps" id={`s-${p.placementId}`}>{status ?? <span className="sr-only">{srStatus}</span>}</p>
          {info.canSuggest ? (
            <div className="dr-ready">
              <label htmlFor={`r-${p.placementId}`}>Ready or defrosting</label>
              <span className="dr-rbox"><NumberBox id={`r-${p.placementId}`} value={item.currentQty} onCommit={(n) => onChange({ currentQty: n })}
                label={`${p.productName}: ${info.readyPlural} already ready or defrosting`} allowDecimal={p.allowDecimal} unitPlural={info.readyPlural} wait={500} />
                <small>{info.readyPlural}</small></span>
            </div>
          ) : null}
          {working ? <p className="dr-work">{working}</p> : null}
        </div>
        {controls}
      </article>
    );
  }
  return (
    <article className={`drow2 s-${st} ${v === null && !c ? 'quiet' : ''} ${suggestion ? 'suggested' : ''}`} data-placement={p.placementId}>
      <div className="dr-head">
        {photo}
        <div className="dr-t">
          <h3>{p.productName}</h3>
          <p className="ps" id={`s-${p.placementId}`}>{status ?? <span className="sr-only">{srStatus}</span>}</p>
        </div>
      </div>
      <div className="dr-info"><DefrostRoute p={p} /></div>
      {c ? null : <div className="dr-ctl"><span className="dr-lab">{amountLabel(p, pickup)}</span>{controls}</div>}
      {info.canSuggest ? (
        <div className="dr-ready">
          <label htmlFor={`r-${p.placementId}`}>Already ready or defrosting for tomorrow</label>
          <span className="dr-rbox"><NumberBox id={`r-${p.placementId}`} value={item.currentQty} onCommit={(n) => onChange({ currentQty: n })}
            label={`${p.productName}: ${info.readyPlural} already ready or defrosting`} allowDecimal={p.allowDecimal} unitPlural={info.readyPlural} wait={500} />
            <small>{info.readyPlural}</small></span>
        </div>
      ) : null}
      {working ? <p className="dr-work">{working}</p> : null}
    </article>
  );
}

/**
 * Pull for defrost: what to grab from the upstairs freezers, in walking order (Freezer 1, then Freezer 2), grouped
 * by compartment, each with where it goes. Pulled = moved. Not enough upstairs = what was there; the rest goes on
 * the collection list from downstairs (an empty compartment is never a shortage by itself). What's defrosted
 * straight from downstairs (e.g. the desserts) is on the collection list, not here.
 */
export function DefrostPullList({ rows, walkOrder, onChange }: {
  rows: { p: PlacementView; item: ItemState; pickup: boolean }[];
  /** Compartments in walking order (by area id). */
  walkOrder: Map<string, number>;
  onChange: (p: PlacementView, f: Partial<ItemState>) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const needed = rows.filter((r) => (needOf(r.p, r.item) ?? 0) > 0);
  const list = needed.filter((r) => r.pickup);
  const downstairs = needed.filter((r) => !r.pickup);
  if (!list.length && !downstairs.length) return null;
  const spotOf = (r: (typeof list)[number]) => r.p.pickupAreaId ?? '';
  const spots = [...new Set(list.map(spotOf))].sort((a, b) => (walkOrder.get(a) ?? 1e9) - (walkOrder.get(b) ?? 1e9));
  const pickups = list;
  const done = pickups.filter((r) => pullState(r.p, r.item).state !== 'todo').length;
  const confirm = (r: (typeof list)[number]) => {
    const n = draft.trim() === '' ? NaN : Number(draft.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return;
    const need = needOf(r.p, r.item) ?? 0;
    onChange(r.p, { upstairsQty: Math.min(round2(n), need) });
    setEditing(null);
  };
  return (
    <section className="grab pull dpull" aria-labelledby="pull-h">
      <h3 className="sec-title" id="pull-h"><Icon name="up" />Pull for defrost{pickups.length ? <small>{done} of {pickups.length} pulled</small> : null}</h3>
      <p className="grab-hint">Freezer 1, then Freezer 2. Tap <b>Pulled</b> once it&rsquo;s moved; <b>Not upstairs</b> or <b>Only some</b> puts the rest on the collection list.</p>
      {spots.map((g) => {
        const gl = list.filter((r) => spotOf(r) === g);
        return (
          <div key={g} className="grab-group">
            <h4 className="phead">{defrostSource(gl[0].p)}</h4>
            <ul className="dp-lines">{gl.map((r) => {
              const ps = pullState(r.p, r.item);
              const q = (n: number) => formatQty(n, r.p.unitSingular, r.p.unitPlural);
              const spot = r.p.grabNote && !isCheckNote(r.p.grabNote) ? r.p.grabNote : null;
              return (
                <li key={r.p.placementId} className={`dp-line s-${!r.pickup ? (r.item.collectedMode ? 'ok' : 'none') : ps.state === 'pulled' ? 'ok' : ps.state === 'short' ? 'warn' : 'none'}`} data-line={r.p.productName}>
                  <div className="dp-main">
                    <span className="dp-amt"><b>{round2(ps.need)}</b><small>{ps.need === 1 ? r.p.unitSingular : r.p.unitPlural}</small></span>
                    <span className="dp-t"><b>{r.p.productName}</b>
                      <small><span className="dp-to">&rarr; {r.p.putNote ?? 'its destination'}</span>{spot ? <span className="dp-spot">{spot}</span> : null}</small></span>
                  </div>
                  {!r.pickup ? (
                    <p className="dp-state">{r.item.collectedMode ? <><Icon name="check" />Collected</> : 'Collect it from the collection list'}</p>
                  ) : editing === r.p.placementId ? (
                    <div className="dp-edit">
                      <label htmlFor={`up-${r.p.placementId}`}>How many were upstairs?</label>
                      <input id={`up-${r.p.placementId}`} className="nbox" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') confirm(r); }} aria-label={`${r.p.productName}: how many were upstairs, of ${round2(ps.need)}`} />
                      <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                      <button type="button" className="btn primary" onClick={() => confirm(r)} disabled={draft.trim() === ''}>Confirm</button>
                    </div>
                  ) : ps.state === 'todo' ? (
                    <div className="dp-acts">
                      <button type="button" className="dr-b dp-none" onClick={() => onChange(r.p, { upstairsQty: 0 })} aria-label={`Not upstairs: ${r.p.productName}`}>Not upstairs</button>
                      <button type="button" className="dr-b dp-few" onClick={() => { setEditing(r.p.placementId); setDraft(''); }} aria-label={`Only some upstairs: ${r.p.productName}`}>Only some</button>
                      <button type="button" className="dr-b dp-ok" onClick={() => onChange(r.p, { upstairsQty: ps.need })} aria-label={`Pulled ${round2(ps.need)} ${r.p.productName}`}><Icon name="check" />Pulled</button>
                    </div>
                  ) : (
                    <div className="dp-done">
                      {ps.state === 'pulled' ? <p className="dp-state"><Icon name="check" />Pulled</p> : (
                        <div className="dp-short">
                          <p className="dp-state"><Icon name="warn" />{ps.pulled ? <>Pulled {round2(ps.pulled)} &middot; {q(ps.rest)} more</> : <>Not upstairs &middot; all {q(ps.rest)}</>} from {storeLabel(r.p.fallbackLocationName ?? r.p.locationName)} (on the collection list)</p>
                          {r.p.fallbackNote && !sameText(r.p.fallbackNote, storeLabel(r.p.fallbackLocationName ?? r.p.locationName)) ? <p className="dr-detail">{r.p.fallbackNote}</p> : null}
                        </div>
                      )}
                      <button type="button" className="linkbtn" onClick={() => onChange(r.p, { upstairsQty: null })}>Undo</button>
                    </div>
                  )}
                </li>
              );
            })}</ul>
          </div>
        );
      })}
      {downstairs.length ? (
        <p className="dp-down"><Icon name="list" /><span><b>{downstairs.length === 1 ? downstairs[0].p.productName : `${downstairs.length} more`}</b> {downstairs.length === 1 ? 'is' : 'are'} defrosted straight from downstairs: on the collection list{downstairs.length > 1 ? ` (${downstairs.map((r) => r.p.productName).join(', ')})` : ''}.</span></p>
      ) : null}
    </section>
  );
}

