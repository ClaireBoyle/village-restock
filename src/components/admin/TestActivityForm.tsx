'use client';
import { useState } from 'react';
import { ActionForm, SubmitButton } from './ActionForm';
import { clearTestActivity } from '@/app/actions/admin';
import type { DefrostActivity, ResetTarget } from '@/lib/server/reset';

const KIND = { full: 'Full restock', quick: 'Quick restock', area: 'Area restock' } as const;
const STATUS: Record<string, string> = { open: 'In progress', finished: 'Finished', finished_exceptions: 'Finished with exceptions', unfinished: 'Never finished' };

/** Review test records, tick the ones to clear, confirm. Nothing is ticked to start with. */
export function TestActivityForm({ restocks, defrost, timeZone, disabled }: { restocks: ResetTarget[]; defrost: DefrostActivity[]; timeZone: string; disabled: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<Set<string>>(new Set());
  const [sure, setSure] = useState(false);
  const flip = (set: Set<string>, v: string) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone }).toLowerCase() : '');
  const days = [...new Set(restocks.map((r) => r.tradingDate))];
  const total = picked.size + plans.size;

  return (
    <ActionForm action={clearTestActivity} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ marginRight: 'auto' }}>Restocks ({restocks.length})</h2>
        <button type="button" className="btn small" onClick={() => setPicked(new Set(restocks.map((r) => r.id)))} disabled={!restocks.length}>Select all</button>
        <button type="button" className="btn small" onClick={() => setPicked(new Set())} disabled={!picked.size}>Select none</button>
      </div>
      {restocks.length === 0 ? <p className="meta">No restocks in the last 60 days.</p> : null}
      {days.map((d) => (
        <div key={d} className="rows">
          <p className="eyebrow" style={{ margin: '6px 0 2px' }}>{day(d)}</p>
          {restocks.filter((r) => r.tradingDate === d).map((r) => (
            <label key={r.id} className={`row ${picked.has(r.id) ? 'picked' : ''}`} style={{ cursor: 'pointer' }}>
              <input type="checkbox" name="session" value={r.id} checked={picked.has(r.id)} onChange={() => setPicked(flip(picked, r.id))} style={{ width: 22, height: 22, flex: 'none' }} />
              <div className="grow">
                <div className="title">{r.departmentName} &middot; {r.kind === 'area' ? `${r.areaName ?? 'Area'} restock` : KIND[r.kind]}</div>
                <div className="meta">{STATUS[r.status] ?? r.status} &middot; started {time(r.startedAt)}{r.finishedAt ? `, finished ${time(r.finishedAt)}` : ''} &middot; {r.entered} entered, {r.collected} collected{r.shortages ? `, ${r.shortages} shortage${r.shortages === 1 ? '' : 's'}` : ''}{r.people.length ? ` · ${r.people.join(', ')}` : ''}</div>
              </div>
            </label>
          ))}
        </div>
      ))}

      {defrost.length ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <h2 style={{ marginRight: 'auto' }}>Defrost Planner records ({defrost.length})</h2>
            <button type="button" className="btn small" onClick={() => setPlans(new Set(defrost.map((p) => `${p.departmentId}|${p.serviceDate}`)))}>Select all</button>
            <button type="button" className="btn small" onClick={() => setPlans(new Set())} disabled={!plans.size}>Select none</button>
          </div>
          <div className="rows">
            {defrost.map((p) => {
              const k = `${p.departmentId}|${p.serviceDate}`;
              return (
                <label key={k} className="row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" name="defrost" value={k} checked={plans.has(k)} onChange={() => setPlans(flip(plans, k))} style={{ width: 22, height: 22, flex: 'none' }} />
                  <div className="grow"><div className="title">{p.departmentName} &middot; service on {day(p.serviceDate)}</div>
                    <div className="meta">{p.items} item{p.items === 1 ? '' : 's'} recorded{p.people.length ? ` · ${p.people.join(', ')}` : ''}</div></div>
                </label>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="banner s-bad"><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <b>{total ? `${total} record${total === 1 ? '' : 's'} selected. Clearing can’t be undone.` : 'Tick the test records to clear.'}</b>
        <label className="check"><input type="checkbox" name="understand" checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand the selected records will be permanently removed</label>
      </div></div>
      <div><SubmitButton className="btn danger big" pendingText="Clearing…">{`Clear ${total || ''} selected`.replace('  ', ' ')}</SubmitButton></div>
      {disabled ? <p className="meta">Not available until the database update has been run.</p> : null}
    </ActionForm>
  );
}
