'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EMPTY_ITEM, SKIP_REASONS, type ItemState, activePlacements, areaStatus, collectionLines, isChecked,
} from '@/lib/restock-logic';
import { setArea, setItems, updateLocalSession } from '@/lib/client/restock-store';
import { ProductCard } from './ProductCard';
import { AREA_BADGE, AREA_LABEL, Badge, Dock, Ring, plural, timeOf } from './shared';
import type { RestockCtx } from './RestockApp';

/** Full Restock: area by area, any order. */
export function CheckStep({ ctx }: { ctx: RestockCtx }) {
  const { view, session, items, areaRecords, recorded, who } = ctx;
  const [skipOpen, setSkipOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const statusOf = (areaId: string) => areaStatus(recorded.get(areaId), view.areas.find((a) => a.area.id === areaId)!.placements, items);
  const firstOpen = view.areas.find(({ area }) => !['complete', 'skipped'].includes(statusOf(area.id)))?.area.id;
  const curId = view.areas.some((a) => a.area.id === session.curAreaId) ? session.curAreaId! : firstOpen ?? view.areas[0]?.area.id;
  const cur = view.areas.find((a) => a.area.id === curId);

  const goArea = (id: string) => { setSkipOpen(false); void updateLocalSession(session.id, { curAreaId: id }); window.scrollTo({ top: 0 }); };
  if (!cur) return <main className="wrap restock-main">{ctx.header}<div className="banner s-none"><Icon name="info" /><div><b>This department has no areas yet</b><p>An admin can add them in Admin.</p></div></div></main>;

  // Stay on this area after completing or skipping it, so staff see the confirmation and choose where to go next.
  const pin = () => { if (session.curAreaId !== cur.area.id) void updateLocalSession(session.id, { curAreaId: cur.area.id }); };
  const st = statusOf(cur.area.id);
  const rec = areaRecords.get(cur.area.id);
  const done = cur.placements.filter((p) => isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).length;
  const unchecked = cur.placements.filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM));
  const next = view.areas.find(({ area }) => area.id !== cur.area.id && !['complete', 'skipped'].includes(statusOf(area.id)));
  const lines = collectionLines(activePlacements('full', view.placements, recorded), items);
  const stores = new Set(lines.map((l) => l.locationId)).size;
  const allUnchecked = activePlacements('full', view.placements, recorded).filter((p) => !isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).length;
  const areasDone = view.areas.filter(({ area }) => ['complete', 'skipped'].includes(statusOf(area.id))).length;

  // Save a product. If that was the last unchecked product in the area, the
  // area completes by itself (only on that change, so a reopened area isn't
  // snapped shut again while staff edit it).
  const onItem = async (p: (typeof cur.placements)[number], fields: Partial<ItemState>, resolve?: boolean) => {
    const before = cur.placements.every((x) => isChecked(x, items.get(x.placementId) ?? EMPTY_ITEM));
    const old = items.get(p.placementId) ?? EMPTY_ITEM;
    const updated: ItemState = { ...old, ...fields, conflict: resolve ? null : old.conflict ?? null };
    const after = cur.placements.every((x) => isChecked(x, x.placementId === p.placementId ? updated : items.get(x.placementId) ?? EMPTY_ITEM));
    await setItems(session.id, [{ placementId: p.placementId, fields }], who, resolve);
    if (!before && after && st !== 'complete' && st !== 'skipped') { pin(); await setArea(session.id, cur.area.id, 'complete', null, who); }
  };
  const reopen = () => { pin(); void setArea(session.id, cur.area.id, 'not_started', null, who); };

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
            const n = placements.filter((p) => isChecked(p, items.get(p.placementId) ?? EMPTY_ITEM)).length;
            const pct = s === 'complete' || s === 'skipped' ? 1 : placements.length ? n / placements.length : 0;
            const sub = s === 'skipped' ? `Skipped · ${r?.skipReason ?? ''}` : s === 'complete' ? `Complete${r?.updatedBy ? ` · ${r.updatedBy}` : ''} ${timeOf(r?.updatedAt)}` : `${n} of ${placements.length} checked`;
            return (
              <button key={area.id} className={`area-btn s-${AREA_BADGE[s]} ${area.id === cur.area.id ? 'cur' : ''}`} onClick={() => goArea(area.id)} aria-current={area.id === cur.area.id ? 'true' : undefined}>
                <Ring pct={pct} st={AREA_BADGE[s]} /><span className="t"><b>{area.name}</b><small>{sub}</small></span>
              </button>
            );
          })}
          <p className="rail-sum"><b>{areasDone} of {view.areas.length} areas</b> done &middot; any order</p>
        </nav>

        <section className="area">
          <div className="area-head">
            <div><h2>{cur.area.name}</h2>
              <div className="sub"><Badge st={AREA_BADGE[st]}>{AREA_LABEL[st]}</Badge><span><b>{done} of {cur.placements.length}</b> checked</span></div></div>
            <div className="acts">
              {cur.area.guideText || cur.area.guidePhotoPath ? <button className="guide-toggle" onClick={() => setGuideOpen((o) => !o)} aria-expanded={guideOpen}><Icon name="camera" />{guideOpen ? 'Hide guide' : 'Stocking guide'}</button> : null}
              {st !== 'complete' && st !== 'skipped' ? <button className="btn" onClick={() => setSkipOpen(true)}><Icon name="skip" />Skip area</button> : null}
            </div>
          </div>

          {skipOpen ? (
            <div className="skip-panel"><b>Why are you skipping {cur.area.name}?</b>
              <div className="chips">{SKIP_REASONS.map((r) => <button key={r} className="chip" onClick={() => { pin(); void setArea(session.id, cur.area.id, 'skipped', r, who); setSkipOpen(false); }}>{r}</button>)}</div>
              <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setSkipOpen(false)}>Cancel</button></div>
          ) : null}
          {guideOpen && (cur.area.guideText || cur.area.guidePhotoPath) ? (
            <div className="guide" style={{ gridTemplateColumns: cur.area.guidePhotoPath && cur.area.guideText ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {cur.area.guidePhotoPath ? <img className="guide-photo" src={cur.area.guidePhotoPath} alt={`${cur.area.name} fully stocked`} /> : null}
              {cur.area.guideText ? <div><p>{cur.area.guideText}</p></div> : null}
            </div>
          ) : null}

          <div className="cards">
            {cur.placements.length === 0 ? <p className="meta">No products in this area yet.</p> : null}
            {cur.placements.map((p) => (
              <ProductCard key={p.placementId} p={p} item={items.get(p.placementId) ?? EMPTY_ITEM}
                onChange={(fields, resolve) => void onItem(p, fields, resolve)} />
            ))}
          </div>

          {st === 'skipped' ? (
            <div className="banner s-skip"><Icon name="skip" /><div><b>{cur.area.name} skipped</b><p>{rec?.skipReason}{rec?.updatedBy ? ` · ${rec.updatedBy}` : ''} {timeOf(rec?.updatedAt)}</p></div>
              <button className="btn" onClick={() => void setArea(session.id, cur.area.id, 'not_started', null, who)}>Undo skip</button>{nextBtn}</div>
          ) : st === 'complete' ? (
            <div className="banner s-ok">
              <button className="banner-toggle" onClick={reopen} aria-label={`${cur.area.name} complete. Tap to reopen it`}>
                <Icon name="check" /><span><b>{cur.area.name} complete</b><p>{rec?.updatedBy ? `${rec.updatedBy}, ` : ''}{timeOf(rec?.updatedAt)} &middot; <u>Tap to reopen</u></p></span>
              </button>{nextBtn}</div>
          ) : unchecked.length ? (
            <div className="banner s-none"><Icon name="circle" /><div><b>{unchecked.length} still to check:</b> {unchecked.map((p) => p.productName).join(', ')}</div><button className="btn" disabled>Mark area complete</button></div>
          ) : (
            <button className="btn good big wide" onClick={() => { pin(); void setArea(session.id, cur.area.id, 'complete', null, who); }}><Icon name="check" />Mark {cur.area.name} complete</button>
          )}
        </section>
      </div>
      </main>
      <Dock icon="list" title={`To collect: ${plural(lines.length, 'item')} · ${plural(stores, 'storeroom')}`} sub={allUnchecked ? `${plural(allUnchecked, 'product')} not checked yet` : 'Everything checked'}>
        <button className="btn" onClick={ctx.saveAndExit}><Icon name="save" />Save and exit</button>
        <button className="btn primary big" onClick={() => ctx.go('collect')} disabled={!lines.length}>Collection list<Icon name="next" /></button>
      </Dock>
    </>
  );
}
