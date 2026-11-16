'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { TopBar } from '@/components/TopBar';
import { OfflineBanner, TopControls } from '@/components/restock/SyncControls';
import { useCatalogue } from '@/lib/client/use-catalogue';
import { useLive, useStaffName } from '@/lib/client/hooks';
import { localDb, type LocalDefrost } from '@/lib/client/local-db';
import { importRemoteDefrost, setDefrost } from '@/lib/client/defrost-store';
import { tradingDate } from '@/lib/restock-math';
import { nextService, suggestDefrost, weekdayOf, type DefrostItem, type DefrostResult } from '@/lib/defrost';
import type { DefrostFields } from '@/lib/sync-types';

const n2 = (v: number) => String(Math.round(v * 100) / 100);
const unit = (i: DefrostItem, v: number) => (v === 1 ? i.unitSingular : i.unitPlural);
const hrs = (h: number) => (h >= 48 && h % 24 === 0 ? `${h / 24} days` : `${n2(h)} h`);
const REASONS = ['Past its use-by', 'Not needed', 'Quality issue', 'Other'];

/**
 * Defrost Planner: what frozen stock to defrost for the next service.
 * An optional tool beside Kitchen Restock: no prerequisites, no sign-off.
 */
export function DefrostPlanner({ departmentId }: { departmentId: string }) {
  const router = useRouter();
  const { catalogue, checkedAt } = useCatalogue();
  const [who] = useStaffName();
  const dept = catalogue?.departments.find((d) => d.id === departmentId);
  const items = useMemo(() => (catalogue?.defrostItems ?? []).filter((i) => i.departmentId === departmentId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [catalogue, departmentId]);
  const tz = catalogue?.settings.timeZone ?? 'Australia/Melbourne';
  const today = catalogue ? tradingDate(new Date(), tz, catalogue.settings.cutoffHour) : null;
  const service = today && catalogue ? nextService(today, catalogue.settings.defrostServiceTime, tz) : null;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(t); }, []);

  const rows = useLive(async () => (service ? localDb().defrost.where('[departmentId+serviceDate]').equals([departmentId, service.date]).toArray() : []), [departmentId, service?.date], [] as LocalDefrost[]);
  useEffect(() => { if (service) void importRemoteDefrost(departmentId, service.date); }, [departmentId, service?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const gold = dept?.theme === 'gold';
  const back = () => (window.history.length > 1 ? router.back() : router.push(`/d/${departmentId}`));
  const serviceLabel = service ? `${service.start.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}, ${service.start.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz }).toLowerCase()}` : '';

  const results = items.map((i) => {
    const e = rows.find((r) => r.itemId === i.id);
    const r = service ? suggestDefrost(i, { chilled: e?.chilled ?? null, thawing: e?.thawing ?? null, adjust: e?.adjust ?? null }, { serviceDay: weekdayOf(service.date), now, serviceStart: service.start }) : null;
    return { i, e, r };
  });
  const toDefrost = results.filter((x) => x.r?.status === 'ok' && x.r.suggested > 0);
  const needCount = results.filter((x) => x.r?.status === 'incomplete').length;
  const warnings = results.filter((x) => x.r && ['too_late', 'expires', 'no_thaw_time'].includes(x.r.status)).length;

  return (
    <div className={`theme-navy ${gold ? 'theme-gold gc' : ''}`}>
      <TopBar title={dept?.name ?? 'Defrost Planner'} crumbs="Defrost Planner" right={<TopControls catalogueCheckedAt={checkedAt} />}
        logo={<button className="iconbtn" onClick={back} aria-label="Back"><Icon name="back" /></button>} />
      <OfflineBanner />
      <main className="wrap restock-main defrost">
        <section className="dp-sum" aria-labelledby="dp-h">
          <div className="dp-sum-top">
            <div>
              <p className="dp-eyebrow"><Icon name="clock" />For the next service &middot; {serviceLabel}</p>
              <h1 id="dp-h">Defrost Planner</h1>
            </div>
            <Link className="btn small" href={`/d/${departmentId}?mode=full&step=check`}><Icon name="list" />Kitchen Restock</Link>
          </div>
          {items.length === 0 ? <p className="dp-empty">No defrost items are set up yet. A manager can add them in Admin &rsaquo; Defrost Planner.</p> : (
            <>
              {toDefrost.length ? (
                <ul className="dp-list" aria-label="To defrost">
                  {toDefrost.map(({ i, r, e }) => r?.status === 'ok' ? (
                    <li key={i.id}><b>{n2(e?.defrost ?? r.suggested)}</b> {unit(i, e?.defrost ?? r.suggested)} <span>{i.name}</span>{e?.defrost !== null && e?.defrost !== undefined ? <em><Icon name="check" />recorded</em> : null}</li>
                  ) : null)}
                </ul>
              ) : <p className="dp-none"><Icon name="check" />{needCount === items.length ? 'Enter what’s in the fridge to get suggestions.' : 'Nothing needs defrosting so far.'}</p>}
              {needCount || warnings ? <p className="dp-flags">{needCount ? <span><Icon name="circle" />{needCount} need a count</span> : null}{warnings ? <span className="w"><Icon name="warn" />{warnings} need attention</span> : null}</p> : null}
            </>
          )}
        </section>

        <div className="dp-items">
          {results.map(({ i, e, r }) => (
            <DefrostRow key={i.id} item={i} entry={e} result={r} serviceLabel={serviceLabel}
              save={(f) => service && void setDefrost(departmentId, service.date, i.id, withSuggestion(i, e, f, service, now), who)} />
          ))}
        </div>
        <p className="meta dp-foot">Suggestions follow the approved thawing method and times set by managers. Never speed up thawing or thaw at room temperature.</p>
      </main>
    </div>
  );
}

/** Keep the suggestion that was shown alongside what staff entered (for Stock Insights). */
function withSuggestion(i: DefrostItem, e: LocalDefrost | undefined, f: DefrostFields, service: { date: string; start: Date }, now: Date): DefrostFields {
  const next = { chilled: e?.chilled ?? null, thawing: e?.thawing ?? null, adjust: e?.adjust ?? null, ...f };
  const r = suggestDefrost(i, { chilled: next.chilled ?? null, thawing: next.thawing ?? null, adjust: next.adjust ?? null }, { serviceDay: weekdayOf(service.date), now, serviceStart: service.start });
  return { ...f, suggested: r.status === 'ok' ? r.suggested : null };
}

function Num({ value, onChange, label, step = 1, allowNone }: { value: number | null; onChange: (v: number | null) => void; label: string; step?: number; allowNone?: boolean }) {
  const [text, setText] = useState(value === null ? '' : n2(value));
  useEffect(() => { setText(value === null ? '' : n2(value)); }, [value]);
  const commit = (v: number | null) => { setText(v === null ? '' : n2(v)); onChange(v); };
  return (
    <div className="dp-num">
      <span className="dp-lbl">{label}</span>
      <div className="pstep">
        {allowNone ? <button type="button" className={`pquick ${value === 0 ? 'on' : ''}`} aria-pressed={value === 0} onClick={() => commit(value === 0 ? null : 0)}>None</button> : null}
        <button type="button" onClick={() => commit(Math.max(0, (value ?? 0) - step))} aria-label={`${label}: less`}><Icon name="minus" /></button>
        <input className="qty-input" inputMode="decimal" value={text} placeholder="–" aria-label={label}
          onFocus={(e) => e.target.select()}
          onChange={(e) => { setText(e.target.value); const t = e.target.value.trim().replace(',', '.'); if (t === '') onChange(null); else if (/^\d+(\.\d+)?$/.test(t)) onChange(Number(t)); }} />
        <button type="button" onClick={() => commit((value ?? 0) + step)} aria-label={`${label}: more`}><Icon name="plus" /></button>
      </div>
    </div>
  );
}

function DefrostRow({ item, entry, result, serviceLabel, save }: {
  item: DefrostItem; entry: LocalDefrost | undefined; result: DefrostResult | null; serviceLabel: string; save: (f: DefrostFields) => void;
}) {
  const [more, setMore] = useState(false);
  const step = item.packSize >= 1 ? 1 : item.packSize;
  const st = !result ? 'none' : result.status === 'incomplete' ? 'none' : result.status === 'ok' ? (result.suggested > 0 ? 'warn' : 'ok') : 'bad';
  const thaw = [item.thawMethod || null, item.thawHours !== null ? `needs ${hrs(item.thawHours)}` : null, item.shelfLifeHours !== null ? `use within ${hrs(item.shelfLifeHours)} of thawing` : null].filter(Boolean).join(' · ');

  let outcome: React.ReactNode = null;
  if (result?.status === 'incomplete') outcome = <p className="dp-out none"><Icon name="circle" />Enter {result.missing.map((m) => (m === 'chilled' ? 'what’s usable in the fridge' : 'what’s already thawing')).join(' and ')} to get a suggestion.</p>;
  else if (result?.status === 'no_thaw_time') outcome = <p className="dp-out bad"><Icon name="warn" />About {n2(result.raw)} {unit(item, result.raw)} short, but no approved thaw time is set up. Check with a manager before defrosting.</p>;
  else if (result?.status === 'too_late') outcome = <p className="dp-out bad"><Icon name="warn" />About {n2(result.raw)} {unit(item, result.raw)} short, but it can&rsquo;t be safely thawed by {serviceLabel} ({item.thawMethod || 'approved method'} needs {hrs(item.thawHours ?? 0)}). Don&rsquo;t speed it up: tell the manager.</p>;
  else if (result?.status === 'expires') outcome = <p className="dp-out bad"><Icon name="warn" />If thawed now it would pass its usable life before {serviceLabel}. Don&rsquo;t defrost yet: check with a manager.</p>;
  else if (result?.status === 'ok') outcome = result.suggested > 0
    ? <div className="dp-out warn"><p><b>Defrost {n2(result.suggested)} {unit(item, result.suggested)}</b></p><small>{result.working}</small></div>
    : <div className="dp-out ok"><p><Icon name="check" />Nothing to defrost</p><small>{result.working}</small></div>;

  const suggested = result?.status === 'ok' ? result.suggested : null;
  return (
    <article className={`card dprow s-${st}`}>
      <div className="dp-head">
        <h3>{item.name}</h3>
        {thaw ? <p className="dp-thaw"><Icon name="clock" />{thaw}</p> : <p className="dp-thaw bad"><Icon name="warn" />No approved thawing method set up</p>}
        {item.safetyNotes ? <p className="pnote"><Icon name="info" /><span>{item.safetyNotes}</span></p> : null}
      </div>
      <div className="dp-inputs">
        <Num label="Usable in fridge" value={entry?.chilled ?? null} step={step} onChange={(v) => save({ chilled: v })} />
        <Num label="Thawing, ready in time" value={entry?.thawing ?? null} step={step} allowNone onChange={(v) => save({ thawing: v })} />
      </div>
      {outcome}
      {suggested !== null && suggested > 0 ? (
        <div className="dp-record">
          <Num label="Defrosting now" value={entry?.defrost ?? null} step={step} onChange={(v) => save({ defrost: v })} />
          {entry?.defrost === null || entry?.defrost === undefined
            ? <button type="button" className="btn good" onClick={() => save({ defrost: suggested })}><Icon name="check" />Use {n2(suggested)}</button>
            : <p className="dp-done"><Icon name="check" />Recorded</p>}
        </div>
      ) : null}
      <button type="button" className="linkbtn dp-more" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Less' : 'Adjust or report'}<Icon name={more ? 'up' : 'down'} /></button>
      {more ? (
        <div className="dp-extra">
          <div className="dp-adjust">
            <span className="dp-lbl">Busier or quieter than usual?</span>
            <div className="chips">
              {[-4, -2, 0, 2, 4].map((v) => <button key={v} type="button" className={`chip ${(entry?.adjust ?? 0) === v ? 'on' : ''}`} onClick={() => save({ adjust: v === 0 ? null : v })}>{v === 0 ? 'As usual' : `${v > 0 ? '+' : '−'}${Math.abs(v)}`}</button>)}
            </div>
          </div>
          <div className="dp-report">
            <span className="dp-lbl">From today&rsquo;s service (optional)</span>
            <button type="button" className={`flag ${entry?.ranOut ? 'on' : ''}`} aria-pressed={!!entry?.ranOut} onClick={() => save({ ranOut: !entry?.ranOut })}>
              <span className="box">{entry?.ranOut ? <Icon name="check" /> : null}</span>Ran out during service</button>
            <Num label={`Discarded (${item.unitPlural})`} value={entry?.discarded ?? null} step={step} onChange={(v) => save({ discarded: v, discardReason: v ? entry?.discardReason ?? null : null })} />
            {entry?.discarded ? <div className="chips">{REASONS.map((r) => <button key={r} type="button" className={`chip ${entry.discardReason === r ? 'on' : ''}`} onClick={() => save({ discardReason: r })}>{r}</button>)}</div> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
