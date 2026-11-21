'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { EMPTY_ITEM, areaNotes, collectionLines, isQuickPick, quickNeed, type ItemState, type PlacementView } from '@/lib/restock-logic';
import { formatQty, parseQuantity, round2 } from '@/lib/restock-math';
import { setItems, updateLocalSession } from '@/lib/client/restock-store';
import { ProductThumb } from './ProductCard';
import { Dock, initials } from './shared';
import type { RestockCtx } from './RestockApp';

/**
 * Quick Restock: pick just what's running low, no full inspection. Every product row takes the amount
 * straight away (+ for one, or type a bigger number); above zero it's on Your list, zero takes it off.
 * Same in every department.
 */
export function QuickStep({ ctx }: { ctx: RestockCtx }) {
  const { view, session, items, who, placements } = ctx;
  const [q, setQ] = useState('');
  const [by, setBy] = useState<'area' | 'cat'>('area');
  const [chip, setChip] = useState('all');

  const chips = useMemo(() => by === 'area'
    ? view.areas.map(({ area }) => [area.id, area.name] as const)
    : [...new Set(view.placements.filter(isQuickPick).map((p) => p.categoryName).filter(Boolean) as string[])].map((c) => [c, c] as const), [by, view]);

  const query = q.trim().toLowerCase();
  const results = view.placements.filter((p) => {
    if (!isQuickPick(p)) return false;
    if (query) return `${p.productName} ${p.areaName} ${p.categoryName ?? ''}`.toLowerCase().includes(query);
    if (chip === 'all') return true;
    return by === 'area' ? p.screenAreaId === chip : p.categoryName === chip;
  });
  // One area chosen: its instructions once, above its products (e.g. "Walk both sides. Enter the total needed.").
  const area = by === 'area' && chip !== 'all' && !query ? view.areas.find((a) => a.area.id === chip) : undefined;
  const notes = useMemo(() => areaNotes(area ? area.placements.filter(isQuickPick) : results), [area, results]);
  const guide = area ? [area.area.guideText.trim(), ...(area.area.guideText.trim() ? [] : notes.shared)].filter(Boolean) : [];

  /** Save the amount: above zero puts it on Your list (kept in the order added), zero or blank takes it off. */
  const save = (p: PlacementView, fields: Partial<ItemState>) => {
    const on = isOn(p, { ...(items.get(p.placementId) ?? EMPTY_ITEM), ...fields });
    const has = session.selected.includes(p.placementId);
    if (on && !has) void updateLocalSession(session.id, { selected: [...session.selected, p.placementId] });
    if (!on && has) void updateLocalSession(session.id, { selected: session.selected.filter((x) => x !== p.placementId) });
    void setItems(session.id, [{ placementId: p.placementId, fields }], who);
  };
  const remove = (p: PlacementView) => save(p, p.method === 'routine' ? { routineChoice: null } : { requestedQty: null });
  const lines = collectionLines(placements, items);

  return (
    <>
      <main className="wrap restock-main">
        {ctx.header}
        <div className="quick">
          <section className="qpanel" aria-label="Pick products">
            <label className="search" htmlFor="qsearch"><Icon name="search" />
              <input id="qsearch" type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
            <div className="segb" role="group" aria-label="Browse by">
              <button className={by === 'area' ? 'on' : ''} onClick={() => { setBy('area'); setChip('all'); }}>By area</button>
              <button className={by === 'cat' ? 'on' : ''} onClick={() => { setBy('cat'); setChip('all'); }}>By category</button>
            </div>
            <div className="chips">
              {[['all', 'All'] as const, ...chips].map(([v, l]) => <button key={v} className={`chip ${chip === v && !query ? 'on' : ''}`} onClick={() => { setChip(v); setQ(''); }}>{l}</button>)}
            </div>
            {guide.length ? <p className="aguide-line q-guide"><Icon name="info" /><span>{guide.join(' ')}</span></p> : null}
            {results.length === 0 ? <p className="empty">{query ? <>No products match &ldquo;{q}&rdquo;. Try a shorter word.</> : 'No products here.'}</p> : (
              <div className="qlist">
                {results.map((p) => <QuickRow key={p.placementId} p={p} item={items.get(p.placementId) ?? EMPTY_ITEM} showArea={!area}
                  note={notes.own.get(p.placementId)} onChange={(f) => save(p, f)} />)}
              </div>
            )}
          </section>
          <section className="picked" aria-label="Your list">
            <h2 style={{ fontSize: 22 }}>Your list ({placements.length})</h2>
            {placements.length === 0 ? <div className="empty"><b>Your list is empty.</b><br />Tap <b>+</b> or type how many you need on anything that&rsquo;s running low.</div> : (
              <div className="qlist q-picked">
                {placements.map((p) => <QuickRow key={p.placementId} p={p} item={items.get(p.placementId) ?? EMPTY_ITEM} showArea
                  onChange={(f) => save(p, f)} onRemove={() => remove(p)} />)}
              </div>
            )}
          </section>
        </div>
      </main>
      <Dock icon="list" title={`${placements.length} on your list · ${lines.length} to collect`} sub={placements.length ? 'Ready to collect' : 'Enter what you need to start'}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        <button className="btn primary big" onClick={() => ctx.go('collect')} disabled={!lines.length}><span className="lg">Collection list</span><span className="sm">Collect</span><Icon name="next" /></button>
      </Dock>
    </>
  );
}

/** On Your list: an amount above zero, or a task marked needed. */
const isOn = (p: PlacementView, i: ItemState) => (p.method === 'routine' ? i.routineChoice === 'needed' : (quickNeed(p, i) ?? 0) > 0);

/** Enter on a number moves to the next product's number, so a whole shelf can be typed in one go. */
function focusNext(from: HTMLInputElement) {
  const all = [...document.querySelectorAll<HTMLInputElement>('.qpanel input.q-num')];
  const next = all[all.indexOf(from) + 1];
  if (next) { next.focus(); next.select(); next.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else from.blur();
}

/** One product: name, where it is, and + / the number needed with its unit (or Needed, for a task). */
function QuickRow({ p, item, onChange, showArea, note, onRemove }: {
  p: PlacementView; item: ItemState; onChange: (f: Partial<ItemState>) => void; showArea: boolean; note?: string; onRemove?: () => void;
}) {
  const value = quickNeed(p, item);
  const [text, setText] = useState(value ? String(round2(value)) : '');
  const [err, setErr] = useState('');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ? String(round2(value)) : ''); }, [value]);
  const step = p.allowDecimal ? 0.5 : 1;
  // Zero is "not needed": off the list, so the box goes back to blank.
  const commit = (v: number | null) => { setErr(''); const n = v && v > 0 ? round2(v) : null; setText(n ? String(n) : ''); onChange({ requestedQty: n }); };
  const onType = (raw: string) => {
    setText(raw);
    const r = parseQuantity(raw, { allowDecimal: p.allowDecimal, unitPlural: p.unitPlural });
    if (!r.ok) { setErr(r.message); return; }
    setErr('');
    const n = r.value && r.value > 0 ? r.value : null;
    if (n !== value) onChange({ requestedQty: n });
  };
  const on = isOn(p, item);
  const unit = (value ?? 0) === 1 ? p.unitSingular : p.unitPlural;
  const sub = [showArea ? p.areaName : null, p.method === 'par' && p.par !== null ? `Target ${formatQty(p.par, p.unitSingular, p.unitPlural)}` : null].filter(Boolean).join(' · ');
  const id = `qn-${p.placementId}${onRemove ? '-l' : ''}`;

  return (
    <div className={`qrow ${on ? 'on' : ''}`} data-placement={p.placementId}>
      {p.photoPath ? <ProductThumb src={p.photoPath} name={p.productName} credit={p.photoCredit} className="q-photo" /> : <div className="thumb" aria-hidden="true">{initials(p.productName)}</div>}
      <div className="t">
        <b>{p.productName}</b>
        {sub ? <small>{sub}</small> : null}
        {note ? <small className="q-note">{note}</small> : null}
        {onRemove ? <button type="button" className="linkbtn q-remove" onClick={onRemove}>Remove</button> : null}
        {err ? <small className="err" role="alert">{err}</small> : null}
      </div>
      {p.method === 'routine' ? (
        <button type="button" className={`btn q-task ${on ? 'good' : ''}`} aria-pressed={on} onClick={() => onChange({ routineChoice: on ? null : 'needed' })}>
          {on ? <><Icon name="check" />Needed</> : <><Icon name="plus" />Needed</>}</button>
      ) : (
        <div className="q-amt">
          <div className="pstep q-step">
            {/* − only once it's on the list; its space is kept so the numbers line up down the list. */}
            <button type="button" className={on ? '' : 'q-hide'} tabIndex={on ? 0 : -1} aria-hidden={!on} disabled={!on}
              onClick={() => commit((value ?? 0) - step)} aria-label={`One less ${p.productName}`}><Icon name="minus" /></button>
            <input id={id} className="qty-input q-num" type="text" inputMode={p.allowDecimal ? 'decimal' : 'numeric'} enterKeyHint="next" autoComplete="off" placeholder="–"
              value={text} aria-label={`${p.productName}${showArea ? ` (${p.areaName})` : ''}: how many ${p.unitPlural} needed`}
              onFocus={(e) => { focused.current = true; e.target.select(); }}
              onBlur={() => { focused.current = false; setText(value ? String(round2(value)) : ''); setErr(''); }}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(e.currentTarget); } }} />
            <button type="button" onClick={() => commit((value ?? 0) + step)} aria-label={`Add one ${p.unitSingular} of ${p.productName}`}><Icon name="plus" /></button>
          </div>
          <span className="q-unit" aria-hidden="true">{unit}</span>
        </div>
      )}
    </div>
  );
}

