'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EMPTY_ITEM, SKIP_REASONS, type ItemState, activePlacements, areaNotes, areaStatus, collectionLines, isChecked,
} from '@/lib/restock-logic';
import { setArea, setItems, updateLocalSession } from '@/lib/client/restock-store';
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
  const next = view.areas.find(({ area }) => area.id !== cur.area.id && !['complete', 'skipped'].includes(statusOf(area.id)));
  const active = activePlacements('full', view.placements, recorded);
  const lines = collectionLines(active, items);
  const checkedAll = active.filter(chk).length;
  const notes = areaNotes(cur.placements);
  const hasGuide = !!(cur.area.guideText || cur.area.guidePhotoPath || notes.shared.length);

  // Save a product. If that was the last unchecked product in the area, the
  // area completes by itself (only on that change, so a reopened area isn't
  // snapped shut again while staff edit it).
  const onItem = async (p: (typeof cur.placements)[number], fields: Partial<ItemState>, resolve?: boolean) => {
    const before = cur.placements.every(chk);
    const old = items.get(p.placementId) ?? EMPTY_ITEM;
    const updated: ItemState = { ...old, ...fields, conflict: resolve ? null : old.conflict ?? null };
    const after = cur.placements.every((x) => isChecked(x, x.placementId === p.placementId ? updated : items.get(x.placementId) ?? EMPTY_ITEM));
    await setItems(session.id, [{ placementId: p.placementId, fields }], who, resolve);
    if (!before && after && st !== 'complete' && st !== 'skipped') { pin(); await setArea(session.id, cur.area.id, 'complete', null, who); }
  };
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
      <div className="chk-layout">
        <nav className="rail" aria-label="Areas">
          {view.areas.map(({ area, placements }) => {
            const s = statusOf(area.id), r = areaRecords.get(area.id);
            const n = placements.filter(chk).length;
            const pct = s === 'complete' || s === 'skipped' ? 1 : placements.length ? n / placements.length : 0;
            const sub = s === 'skipped' ? `Skipped${r?.skipReason ? ` · ${r.skipReason}` : ''}` : s === 'complete' ? 'Complete' : `${n} of ${placements.length} checked`;
            return (
              <button key={area.id} className={`area-btn s-${AREA_BADGE[s]} ${area.id === cur.area.id ? 'cur' : ''}`} onClick={() => goArea(area.id)} aria-current={area.id === cur.area.id ? 'true' : undefined}>
                <Ring pct={pct} st={AREA_BADGE[s]} /><span className="t"><b>{area.name}</b><small className="lg">{sub}</small><small className="sm">{s === 'complete' ? 'Done' : s === 'skipped' ? 'Skipped' : `${n}/${placements.length}`}</small></span>
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
                <span><b>{done} of {cur.placements.length}</b> checked{left && st !== 'skipped' ? <> &middot; {left} left</> : null}</span>
              </p>
            </div>
            <div className="acts">
              {left > 0 && done > 0 && st !== 'skipped' ? <button className="btn small" onClick={firstUnchecked}><Icon name="down" /><span className="lg">Next unchecked</span><span className="sm">Next</span></button> : null}
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
            {cur.placements.map((p) => (
              <ProductRow key={p.placementId} p={p} item={items.get(p.placementId) ?? EMPTY_ITEM} note={notes.own.get(p.placementId)}
                onChange={(fields, resolve) => void onItem(p, fields, resolve)} />
            ))}
          </div>

          {st === 'skipped' ? (
            <div className="banner s-skip area-end"><Icon name="skip" /><div><b>{cur.area.name} skipped</b><p>{rec?.skipReason}{rec?.updatedBy ? ` · ${rec.updatedBy}` : ''} {timeOf(rec?.updatedAt)}</p></div>
              <button className="btn" onClick={() => void setArea(session.id, cur.area.id, 'not_started', null, who)}>Undo skip</button>{nextBtn}</div>
          ) : st === 'complete' ? (
            <div className="banner s-ok area-end">
              <button className="banner-toggle" onClick={reopen} aria-label={`${cur.area.name} complete. Tap to reopen it`}>
                <Icon name="check" /><span><b>{cur.area.name} complete</b><p>{rec?.updatedBy ? `${rec.updatedBy}, ` : ''}{timeOf(rec?.updatedAt)} &middot; <u>Tap to reopen</u></p></span>
              </button>{nextBtn}</div>
          ) : left ? (
            <div className="banner s-none area-end"><Icon name="circle" /><div><b>{plural(left, 'product')} still to check</b><p>Blank means not checked yet. Enter 0 or tap None if nothing is needed.</p></div>
              <button className="btn" onClick={firstUnchecked}>Go to the first one</button>
              <button className="btn area-skip-end" onClick={() => { setSkipOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="skip" />Skip area</button></div>
          ) : (
            <button className="btn good big wide" onClick={() => { pin(); void setArea(session.id, cur.area.id, 'complete', null, who); }}><Icon name="check" />Mark {cur.area.name} complete</button>
          )}
        </section>
      </div>
      </main>
      <Dock icon="list" progress={active.length ? checkedAll / active.length : 0} title={<>{checkedAll} of {active.length} checked<span className="dock-sep"> &middot; </span><span className="dock-2">{lines.length} to collect</span></>}
        sub={next && st === 'complete' ? `Next area: ${next.area.name}` : undefined}>
        <button className="btn save-exit" onClick={ctx.saveAndExit} aria-label="Save and exit"><Icon name="save" /><span className="lg">Save and exit</span><span className="sm">Save &amp; exit</span></button>
        <button className="btn primary big" onClick={() => ctx.go('collect')}><span className="lg">Collection list</span><span className="sm">Collect</span><Icon name="next" /></button>
      </Dock>
    </>
  );
}
