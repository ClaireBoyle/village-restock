'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import {
  EMPTY_ITEM, SKIP_REASONS, type ItemState, activePlacements, areaNotes, areaStatus, collectionLines, isChecked, isRequired, needOf,
} from '@/lib/restock-logic';
import { setArea, setItems, updateLocalSession } from '@/lib/client/restock-store';
import { localDb } from '@/lib/client/local-db';
import { PhotoZoom, ProductRow } from './ProductCard';
import { AREA_BADGE, Badge, Dock, Ring, plural, timeOf } from './shared';
import type { RestockCtx } from './RestockApp';

/** Remember, per area and per device, whether staff opened the full area guide (it starts as a two-line preview). */
function useGuideOpen(areaId: string): [boolean, (o: boolean) => void] {
  const key = `vr-guide-open-${areaId}`;
  const [open, setOpen] = useState(false);
  useEffect(() => { try { setOpen(localStorage.getItem(key) === '1'); } catch { setOpen(false); } }, [key]);
  return [open, (o: boolean) => { setOpen(o); try { if (o) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* private mode */ } }];
}

/** Full Restock: area by area, in the order staff physically walk them. */
export function CheckStep({ ctx }: { ctx: RestockCtx }) {
  const { view, session, items, areaRecords, recorded, who } = ctx;
  const [skipOpen, setSkipOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [review, setReview] = useState(false);
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({}); // sections expanded/collapsed on this screen // the "N to collect" list above the bottom bar
  // The kitchen reminder can be hidden for this restock (remembered on this device).
  const remKey = `vr-kreminder-${session.id}`;
  const [reminderHidden, setReminderHidden] = useState(false);
  useEffect(() => { try { setReminderHidden(localStorage.getItem(remKey) === '1'); } catch { /* private mode */ } }, [remKey]);
  const hideReminder = () => { setReminderHidden(true); try { localStorage.setItem(remKey, '1'); } catch { /* private mode */ } };
  const chk = (p: { placementId: string } & Parameters<typeof isChecked>[0]) => isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM);
  const statusOf = (areaId: string) => areaStatus(recorded.get(areaId), view.areas.find((a) => a.area.id === areaId)!.placements, items);
  const firstOpen = view.areas.find(({ area }) => !['complete', 'skipped'].includes(statusOf(area.id)))?.area.id;
  const curId = view.areas.some((a) => a.area.id === session.curAreaId) ? session.curAreaId! : firstOpen ?? view.areas[0]?.area.id;
  const cur = view.areas.find((a) => a.area.id === curId);
  const [guideOpen, setGuideOpen] = useGuideOpen(cur?.area.id ?? 'none');

  const goArea = (id: string) => { setSkipOpen(false); void updateLocalSession(session.id, { curAreaId: id }); window.scrollTo({ top: 0 }); };
  if (!cur) return <main className="wrap restock-main">{ctx.header}<div className="banner s-none"><Icon name="info" /><div><b>This department has no areas yet</b><p>An admin can add them in Admin.</p></div></div></main>;

  // Stay on this area after completing or skipping it, so staff see the confirmation and choose where to go next.
  const pin = () => { if (session.curAreaId !== cur.area.id) void updateLocalSession(session.id, { curAreaId: cur.area.id }); };
  const st = statusOf(cur.area.id);
  const rec = areaRecords.get(cur.area.id);
  const done = cur.placements.filter(chk).length;
  const left = cur.placements.length - done;
  // Exception-based: only missing target counts matter; a blank "staff enter" product just didn't need anything.
  const reqLeft = cur.placements.filter((p) => isRequired(p) && !chk(p)).length;
  const next = view.areas.find(({ area }) => area.id !== cur.area.id && !['complete', 'skipped'].includes(statusOf(area.id)));
  const active = activePlacements('full', view.placements, recorded);
  const lines = collectionLines(active, items);
  // What to show as progress. Target-level products need a count; everything else is exception-based,
  // so we count what was entered rather than "checked".
  const progressOf = (ps: typeof active) => {
    const req = ps.filter(isRequired);
    return { req: req.length, counted: req.filter(chk).length, entered: ps.filter((p) => !isRequired(p) && chk(p)).length };
  };
  const areaLabel = (ps: typeof active, short = false) => {
    const g = progressOf(ps);
    if (g.req) return short ? `${g.counted}/${g.req}` : `${g.counted} of ${g.req} counted${g.entered ? ` · ${g.entered} entered` : ''}`;
    return g.entered || !short ? `${g.entered} entered` : '';
  };
  const all = progressOf(active);

  const notes = areaNotes(cur.placements);
  const hasGuide = !!(cur.area.guideText || cur.area.guidePhotoPath || notes.shared.length);

  // Save a product. If that was the last unchecked product in the area, the
  // area completes by itself (only on that change, so a reopened area isn't
  // snapped shut again while staff edit it).
  const onItem = async (p: (typeof cur.placements)[number], fields: Partial<ItemState>, resolve?: boolean) => {
    // Read the latest saved values from the device (not this screen's last render), so two quick
    // taps in a row can't each miss the other and leave a fully checked area open.
    const fresh = async () => new Map((await localDb().items.where('sessionId').equals(session.id).toArray()).map((r) => [r.placementId, { ...EMPTY_ITEM, ...r }]));
    const allChecked = (m: Map<string, ItemState>) => cur.placements.every((x) => isChecked(x, m.get(x.placementId) ?? EMPTY_ITEM));
    const before = allChecked(await fresh());
    await setItems(session.id, [{ placementId: p.placementId, fields }], who, resolve);
    const after = allChecked(await fresh());
    const rec = await localDb().areas.get([session.id, cur.area.id]);
    const closed = rec?.status === 'complete' || rec?.status === 'skipped';
    if (!before && after && !closed) { pin(); await setArea(session.id, cur.area.id, 'complete', null, who); }
  };
  // Same product already entered elsewhere on this screen (e.g. Back bench) → say so in the cupboard, to avoid double-counting.
  const alsoEntered = (p: (typeof cur.placements)[number]) => {
    if (!p.optional) return null;
    const others = cur.placements.filter((x) => x.productId === p.productId && x.placementId !== p.placementId)
      .map((x) => ({ x, need: needOf(x, items.get(x.placementId) ?? EMPTY_ITEM) })).filter((o) => (o.need ?? 0) > 0);
    return others.length ? `Already ${others.map((o) => `${Math.round(o.need! * 100) / 100} for ${o.x.areaName}`).join(', ')}` : null;
  };
  const renderRow = (p: (typeof cur.placements)[number]) => (
    <ProductRow key={p.placementId} p={p} item={items.get(p.placementId) ?? EMPTY_ITEM} note={alsoEntered(p) ?? notes.own.get(p.placementId)}
      onChange={(fields, resolve) => void onItem(p, fields, resolve)} />
  );
  const reopen = () => { pin(); void setArea(session.id, cur.area.id, 'not_started', null, who); };
  const firstUnchecked = () => {
    const p = cur.placements.find((x) => !chk(x));
    const row = p && document.querySelector<HTMLElement>(`[data-placement="${p.placementId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.querySelector<HTMLElement>('input.qty-input, .pseg button')?.focus({ preventScroll: true });
  };

  const nextBtn = next
    ? <button className="btn primary" onClick={() => goArea(next.area.id)}>Next: {next.area.name}<Icon name="next" /></button>
    : <button className="btn primary" onClick={() => ctx.go('collect')}>Collection list<Icon name="next" /></button>;

  return (
    <>
      <main className="wrap restock-main">
      {ctx.header}
      {ctx.hasDefrost && !reminderHidden ? (
        <aside className="kreminder" aria-label="Kitchen reminder">
          <Icon name="clock" />
          <p><b>Kitchen reminder:</b> Remember to check what needs defrosting for the next service and refill the freezer containers. You can use the Defrost Planner at any time.</p>
          <span className="kr-acts"><Link className="linkbtn" href={`/d/${view.department.id}/defrost`}>Open Defrost Planner<Icon name="next" /></Link></span>
          <button className="iconbtn kr-x" onClick={hideReminder} aria-label="Hide reminder"><Icon name="x" /></button>
        </aside>
      ) : null}
      <div className="chk-layout">
        <nav className="rail" aria-label="Areas">
          {view.areas.map(({ area, placements }) => {
            const s = statusOf(area.id), r = areaRecords.get(area.id);
            const g = progressOf(placements);
            const pct = s === 'complete' || s === 'skipped' ? 1 : g.req ? g.counted / g.req : 0;
            const sub = s === 'skipped' ? `Skipped${r?.skipReason ? ` · ${r.skipReason}` : ''}` : s === 'complete' ? 'Complete' : areaLabel(placements);
            return (
              <button key={area.id} className={`area-btn s-${AREA_BADGE[s]} ${area.id === cur.area.id ? 'cur' : ''}`} onClick={() => goArea(area.id)} aria-current={area.id === cur.area.id ? 'true' : undefined}>
                <Ring pct={pct} st={AREA_BADGE[s]} /><span className="t"><b>{area.name}</b><small className="lg">{sub}</small><small className="sm">{s === 'complete' ? 'Done' : s === 'skipped' ? 'Skipped' : areaLabel(placements, true)}</small></span>
              </button>
            );
          })}
        </nav>

        <section className="area" aria-labelledby="area-name">
          <div className="area-head">
            <div className="ah-t">
              <h2 id="area-name">{cur.area.name}</h2>
              <p className="ah-sub">
                {st === 'complete' ? <Badge st="ok">Complete</Badge> : st === 'skipped' ? <Badge st="skip" icon="skip">Skipped</Badge> : null}
                <span>{areaLabel(cur.placements)}</span>
              </p>
            </div>
            <div className="acts">
              {reqLeft > 0 && done > 0 && st !== 'skipped' ? <button className="btn small" onClick={firstUnchecked}><Icon name="down" /><span className="lg">Next to count</span><span className="sm">Next</span></button> : null}
              {st !== 'complete' && st !== 'skipped' ? <button className="btn small" onClick={() => setSkipOpen(true)}><Icon name="skip" />Skip</button> : null}
            </div>
          </div>

          {skipOpen ? (
            <div className="skip-panel"><b>Why are you skipping {cur.area.name}?</b>
              <div className="chips">{SKIP_REASONS.map((r) => <button key={r} className="chip" onClick={() => { pin(); void setArea(session.id, cur.area.id, 'skipped', r, who); setSkipOpen(false); }}>{r}</button>)}</div>
              <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setSkipOpen(false)}>Cancel</button></div>
          ) : null}

          {hasGuide ? (
            // Area instructions, once: a two-line preview that opens with a tap (remembered per area on this device).
            <section className={`aguide ${guideOpen ? 'open' : ''}`}>
              {cur.area.guidePhotoPath ? (
                <button className="ag-photo" onClick={() => setZoom(true)} aria-label={`Show photo of ${cur.area.name} fully stocked`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cur.area.guidePhotoPath} alt="" />
                </button>
              ) : <Icon name="info" />}
              <button className="ag-text" onClick={() => setGuideOpen(!guideOpen)} aria-expanded={guideOpen} aria-label={guideOpen ? 'Show less of the area guide' : 'Show all of the area guide'}>
                {cur.area.guideText ? cur.area.guideText.split(/\n+/).map((t, i) => <span key={i}>{t}</span>) : null}
                {notes.shared.map((t) => <span key={t}>{t}</span>)}
              </button>
              <button className="ag-more linkbtn" onClick={() => setGuideOpen(!guideOpen)} tabIndex={-1} aria-hidden="true">{guideOpen ? 'Less' : 'More'}</button>
            </section>
          ) : null}
          {zoom && cur.area.guidePhotoPath ? <PhotoZoom src={cur.area.guidePhotoPath} title={`${cur.area.name} fully stocked`} onClose={() => setZoom(false)} /> : null}

          <div className="prows">
            {cur.placements.length === 0 ? <p className="meta">No products in this area yet.</p> : null}
            {cur.own.map(renderRow)}
          </div>

          {cur.sections.map((sec) => {
            const enteredHere = sec.placements.filter(chk).length;
            const open = openSecs[sec.area.id] ?? (sec.mode === 'open' || enteredHere > 0);
            return (
              <section key={sec.area.id} className={`psec ${sec.mode} ${open ? 'open' : ''}`}>
                <button type="button" className="psec-h" onClick={() => setOpenSecs((o) => ({ ...o, [sec.area.id]: !open }))} aria-expanded={open}>
                  <span className="psec-t"><b>{sec.area.name}</b>{sec.mode === 'optional' ? <span className="psec-tag">Optional</span> : null}</span>
                  <small>{enteredHere ? `${enteredHere} entered` : `${sec.placements.length} product${sec.placements.length === 1 ? '' : 's'}`}</small>
                  <Icon name={open ? 'up' : 'down'} />
                </button>
                {open ? (
                  <>
                    {sec.mode === 'optional' ? <p className="psec-hint"><Icon name="info" /><span>Only add <b>extra</b> stock this needs from downstairs. Anything already entered above is already on the collection list.</span></p>
                      : sec.area.guideText ? <p className="psec-hint"><Icon name="info" /><span>{sec.area.guideText}</span></p> : null}
                    <div className="prows">{sec.placements.map(renderRow)}</div>
                  </>
                ) : null}
              </section>
            );
          })}

          {st === 'skipped' ? (
            <div className="banner s-skip area-end"><Icon name="skip" /><div><b>{cur.area.name} skipped</b><p>{rec?.skipReason}{rec?.updatedBy ? ` · ${rec.updatedBy}` : ''} {timeOf(rec?.updatedAt)}</p></div>
              <button className="btn" onClick={() => void setArea(session.id, cur.area.id, 'not_started', null, who)}>Undo skip</button>{nextBtn}</div>
          ) : st === 'complete' ? (
            <div className="banner s-ok area-end">
              <button className="banner-toggle" onClick={reopen} aria-label={`${cur.area.name} complete. Tap to reopen it`}>
                <Icon name="check" /><span><b>{cur.area.name} complete</b><p>{rec?.updatedBy ? `${rec.updatedBy}, ` : ''}{timeOf(rec?.updatedAt)} &middot; <u>Tap to reopen</u></p></span>
              </button>{nextBtn}</div>
          ) : reqLeft ? (
            <div className="banner s-none area-end"><Icon name="circle" /><div><b>{reqLeft} target {reqLeft === 1 ? 'count' : 'counts'} still needed</b><p>Count what&rsquo;s on the shelf, or tap Full.</p></div>
              <button className="btn" onClick={firstUnchecked}>Go to the first one</button>
              <button className="btn area-skip-end" onClick={() => { setSkipOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="skip" />Skip area</button></div>
          ) : (
            // Nothing required is missing: just a quiet pointer to the next area (no sign-off needed).
            <div className="area-end area-next">
              <p className="meta">{left ? <>Only enter products that need restocking. {plural(left, 'product')} left blank (recorded as not entered).</> : 'Everything here has an answer.'}</p>
              {/* Optional: lets a reopened area count as done again. Never required to finish. */}
              {!left ? <button className="btn small" onClick={() => { pin(); void setArea(session.id, cur.area.id, 'complete', null, who); }}><Icon name="check" />Mark {cur.area.name} complete</button> : null}
              {nextBtn}
            </div>
          )}
        </section>
      </div>
      </main>
      <Dock icon="list" progress={all.req ? all.counted / all.req : undefined}
        above={review && lines.length ? (
          <div className="entered" id="entered-list">
            <ul>{lines.map((l) => (
              <li key={l.key}><button onClick={() => { const pl = l.parts[0]; setReview(false); const vp = view.byId.get(pl.placementId); if (vp?.optional) setOpenSecs((o) => ({ ...o, [vp.areaId]: true })); goArea(vp?.screenAreaId ?? cur.area.id);
                window.setTimeout(() => document.querySelector(`[data-placement="${pl.placementId}"]`)?.scrollIntoView({ block: 'center' }), 120); }}>
                <b>{l.kind === 'task' ? '✓' : Math.round(l.total * 100) / 100}</b><span>{l.photoPath ? <img className="en-photo" src={l.photoPath} alt="" loading="lazy" /> /* eslint-disable-line @next/next/no-img-element */ : null}{l.productName}</span><small>{l.parts.map((x) => x.areaName).join(', ')}</small>
              </button></li>
            ))}</ul>
          </div>
        ) : null}
        title={<>{all.req ? `${all.counted} of ${all.req} counted` : `${all.entered} entered`}<span className="dock-sep"> &middot; </span>
          <button type="button" className="dock-2 dock-review" onClick={() => setReview(!review)} disabled={!lines.length} aria-expanded={review} aria-controls="entered-list">
            {lines.length} to collect{lines.length ? <Icon name={review ? 'down' : 'up'} /> : null}</button></>}
        sub={next && st === 'complete' ? `Next area: ${next.area.name}` : undefined}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        <button className="btn primary big" onClick={() => ctx.go('collect')}><span className="lg">Collection list</span><span className="sm">Collect</span><Icon name="next" /></button>
      </Dock>
    </>
  );
}
