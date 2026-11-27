'use client';
// Morning prep handover. On the Finish screen the closing team ticks what the morning team needs
// to prep (grouped, several at once, optional amount and note each, plus tasks typed in), or says
// "No morning prep needed". On the Kitchen screen the morning team marks each task Done.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { PREP_GROUPS, PREP_KINDS, prepGroupLabel, prepKind, sortedItems, type PrepGroup, type PrepItem, type PrepTask } from '@/lib/prep';
import { localDb, type LocalPrep } from '@/lib/client/local-db';
import { useLive } from '@/lib/client/hooks';
import { importRemotePrep, setPrepDone } from '@/lib/client/prep-store';
import { importRemotePrepChecks, setPrepCheck } from '@/lib/client/prep-check-store';
import type { PrepCheck } from '@/lib/prep';

import { timeOf } from './shared';


/** A text box that keeps what's typed and saves when staff leave it (or press Enter). */
function SaveText({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value); }, [value]);
  const save = () => { if (text.trim() !== value.trim()) onSave(text.trim()); };
  return <input {...rest} value={text} onChange={(e) => setText(e.target.value)}
    onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; save(); }}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); e.currentTarget.blur(); } }} />;
}

export function MorningPrepPicker({ tasks, handover, onSave, leftForMorning = [], notPrepped = [] }: {
  tasks: PrepTask[]; handover: LocalPrep | undefined;
  onSave: (status: 'needed' | 'none' | null, items: PrepItem[]) => void;
  /** Jobs already left for morning on tonight's Prep checklist (they're on the handover too). */
  leftForMorning?: string[];
  /** Tonight's Prep checklist: marked Needs prep and not done yet. Offered here as one-tap adds. */
  notPrepped?: PrepTask[];
}) {
  // Shown straight away (a tick never waits for the device's database), then saved.
  const [local, setLocal] = useState<{ status: 'needed' | 'none' | null; items: PrepItem[] }>({ status: handover?.status ?? null, items: handover?.items ?? [] });
  const savedAt = handover?.updatedAt ?? '';
  // Take in what's saved (or came from another device), but never an older save over a newer tap.
  const lastTap = useRef(0);
  useEffect(() => {
    if (savedAt && Date.parse(savedAt) < lastTap.current) return;
    setLocal({ status: handover?.status ?? null, items: handover?.status === 'needed' ? handover.items : [] });
  }, [savedAt, !handover]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSaveNow = (st: 'needed' | 'none' | null, list: PrepItem[]) => {
    lastTap.current = Date.now();
    setLocal({ status: st, items: st === 'needed' ? list : [] }); onSave(st, list);
  };
  const status = local.status;
  const items = status === 'needed' ? local.items : [];
  const byTask = new Map(items.filter((i) => i.taskId).map((i) => [i.taskId!, i]));
  const typed = items.filter((i) => !i.taskId);
  const [other, setOther] = useState('');
  const save = (next: PrepItem[]) => onSaveNow(next.length ? 'needed' : null, next);
  const toggle = (t: PrepTask) => {
    const cur = byTask.get(t.id);
    if (cur) { save(items.filter((i) => i.id !== cur.id)); return; }
    save([...items, { id: crypto.randomUUID(), taskId: t.id, group: t.group, name: t.name, qty: null, note: null, doneAt: null, doneBy: null }]);
  };
  const edit = (id: string, fields: Partial<PrepItem>) => save(items.map((i) => (i.id === id ? { ...i, ...fields } : i)));
  const addOther = () => {
    const name = other.trim().slice(0, 80);
    if (!name) return;
    save([...items, { id: crypto.randomUUID(), taskId: null, group: 'other', name, qty: null, note: null, doneAt: null, doneBy: null }]);
    setOther('');
  };
  const extra = (i: PrepItem) => (
    <div className="prep-extra">
      <SaveText className="prep-note" aria-label={`${i.name}: note (optional)`} placeholder="Note (optional)" maxLength={200} value={i.note ?? ''} onSave={(v) => edit(i.id, { note: v || null })} />
    </div>
  );
  // "Other" tasks (e.g. Make GC seasoning) go in the one Other group, with anything typed in.
  const groups = PREP_GROUPS.filter(([g]) => g !== 'other').map(([g, label]) => ({ g, label, tasks: tasks.filter((t) => t.group === g) })).filter((x) => x.tasks.length);
  const otherTasks = tasks.filter((t) => t.group === 'other');
  const taskRow = (t: PrepTask) => {
    const it = byTask.get(t.id);
    return (
      <div key={t.id} className={`prep-row ${it ? 'on' : ''}`} data-task={t.name}>
        <label className="prep-pick">
          <input type="checkbox" checked={!!it} onChange={() => toggle(t)} />
          <span><b>{t.name}</b></span>
          {it ? <em className="prep-tag">Needs prep</em> : null}
        </label>
        {it ? extra(it) : null}
      </div>
    );
  };

  return (
    <section className={`prep ${status ? '' : 'unanswered'}`} aria-labelledby="prep-h" id="morning-prep">
      <h3 id="prep-h"><Icon name="clock" />Morning prep needed</h3>
      <p className="prep-hint">Tick everything the morning team needs to prep. Add a note if needed. Choosing tasks only updates this handover, not the restock.</p>
      {notPrepped.some((t) => !byTask.has(t.id)) ? (
        <div className="prep-carry" role="group" aria-label="Still not prepped tonight">
          <p><Icon name="warn" /><span><b>Still not prepped tonight</b> (from the Prep checklist). Add to the morning list?</span></p>
          <div className="prep-carry-btns">
            {notPrepped.filter((t) => !byTask.has(t.id)).map((t) => (
              <button key={t.id} type="button" className="chip" onClick={() => toggle(t)} aria-label={`Add to morning prep: ${t.name}`}><Icon name="plus" />{t.checklistName?.trim() || t.name}</button>
            ))}
            {notPrepped.filter((t) => !byTask.has(t.id)).length > 1 ? (
              <button type="button" className="chip prep-carry-all" onClick={() => save([...items, ...notPrepped.filter((t) => !byTask.has(t.id)).map((t) => ({ id: crypto.randomUUID(), taskId: t.id, group: t.group, name: t.name, qty: null, note: null, doneAt: null, doneBy: null }))])}>
                <Icon name="plus" />Add all</button>
            ) : null}
          </div>
        </div>
      ) : null}
      {leftForMorning.length ? <p className="prep-left"><Icon name="info" /><span>Already left for morning on the Prep checklist: <b>{leftForMorning.join(', ')}</b></span></p> : null}
      <button type="button" className={`prep-none ${status === 'none' ? 'on' : ''}`} aria-pressed={status === 'none'}
        onClick={() => onSaveNow(status === 'none' ? null : 'none', [])}>
        <Icon name={status === 'none' ? 'check' : 'circle'} />No morning prep needed</button>
      {groups.map(({ g, label, tasks: ts }) => (
        <fieldset key={g} className="prep-group">
          <legend>{label}</legend>
          {ts.map(taskRow)}
        </fieldset>
      ))}
      <fieldset className="prep-group">
        <legend>Other</legend>
        {otherTasks.map(taskRow)}
        {typed.map((it) => (
          <div key={it.id} className="prep-row on" data-task={it.name}>
            <label className="prep-pick">
              <input type="checkbox" checked onChange={() => save(items.filter((i) => i.id !== it.id))} />
              <span><b>{it.name}</b></span><em className="prep-tag">Needs prep</em>
            </label>
            {extra(it)}
          </div>
        ))}
        <div className="prep-add">
          <input id="prep-other" type="text" maxLength={80} placeholder="Add another task" value={other} aria-label="Add another morning prep task"
            onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } }} />
          <button type="button" className="btn" onClick={addOther} disabled={!other.trim()}><Icon name="plus" />Add</button>
        </div>
      </fieldset>
      <PrepSummary handover={status ? { ...(handover ?? { sessionId: '', departmentId: '', tradingDate: '', updatedBy: null, updatedAt: '' }), status, items } : undefined} />
    </section>
  );
}

/** The handover as the morning team will see it (shown before finishing, and after). */
export function PrepSummary({ handover, title = 'Handover for the morning team' }: { handover: LocalPrep | undefined; title?: string }) {
  return (
    <div className={`prep-sum ${handover ? '' : 'empty'}`} aria-live="polite">
      <h4>{title}</h4>
      {!handover ? <p className="prep-missing"><Icon name="warn" />Not answered yet: tick what&rsquo;s needed, or <b>No morning prep needed</b>.</p>
        : handover.status === 'none' ? <p><Icon name="check" />No morning prep needed</p>
        : <GroupedList items={handover.items} />}
    </div>
  );
}

function GroupedList({ items, render }: { items: PrepItem[]; render?: (i: PrepItem) => React.ReactNode }) {
  const list = sortedItems(items);
  const groups = [...new Set(list.map((i) => i.group))] as PrepGroup[];
  return (
    <>{groups.map((g) => (
      <div key={g} className="prep-sum-g"><h5>{prepGroupLabel(g)}</h5>
        <ul>{list.filter((i) => i.group === g).map((i) => (
          <li key={i.id} data-prep={i.name}>{render ? render(i) : <span><b>{i.name}</b>{i.note ? <small>{i.note}</small> : null}</span>}</li>
        ))}</ul>
      </div>
    ))}</>
  );
}

/**
 * Open or folded, remembered on this device (true = open). Read straight away: the card only shows once this
 * device's handover has loaded, never in the server's first render, so there's no flash of the wrong state.
 */
function useFold(key: string, start = true): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try { const v = typeof window === 'undefined' ? null : localStorage.getItem(key); return v === null ? start : v === '1'; } catch { return start; }
  });
  return [open, (v: boolean) => { setOpen(v); try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private mode */ } }];
}

/**
 * Kitchen screen: last night's handover for the morning team, each task marked Done on its own. Split by the kind
 * of job (Portioning · Cutting · Sauces · Other). The card starts folded; each section folds on its own (remembered
 * on this device).
 */
export function MorningPrepCard({ handover, dateLabel, onDone, sub, foldKey = 'vr-prep' }: { handover: LocalPrep; dateLabel: string; onDone: (itemId: string, done: boolean) => void;
  /** Where it came from, when not only the close (e.g. jobs left for morning on the Prep checklist). */
  sub?: string;
  /** Where the sections' open / folded choices are kept on this device (per department). */
  foldKey?: string }) {
  // The card starts folded each time the screen opens (one line: "Morning prep · 1 of 4 done"); tap to open it.
  const [open, setOpen] = useState(false);
  if (handover.status === 'none') {
    return <section className="prep-card none" aria-label="Morning prep"><Icon name="check" /><div><b>No morning prep needed</b><small>From the {dateLabel} close</small></div></section>;
  }
  const done = handover.items.filter((i) => i.doneAt).length;
  const list = sortedItems(handover.items);
  const sections = PREP_KINDS.map(([k, label]) => ({ k, label, items: list.filter((i) => prepKind(i) === k) })).filter((x) => x.items.length);
  return (
    <section className={`prep-card ${done === handover.items.length ? 'all-done' : ''} ${open ? '' : 'folded'}`} aria-labelledby="prep-card-h">
      <button type="button" className="pc-head" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="prep-card-body">
        <h2 id="prep-card-h"><Icon name="clock" />Morning prep</h2>
        <span className="pc-n">{done} of {handover.items.length} done</span>
        <Icon name={open ? 'up' : 'down'} />
      </button>
      {open ? (
        <div id="prep-card-body" className="pc-body">
          <p className="pc-sub">{sub ?? <>From the {dateLabel} close{handover.updatedBy ? ` · ${handover.updatedBy}` : ''}</>}</p>
          {sections.map((x) => <PrepSection key={x.k} label={x.label} items={x.items} onDone={onDone} foldKey={`${foldKey}-${x.k}`} />)}
        </div>
      ) : null}
    </section>
  );
}

/** One kind of job (e.g. Cutting), with how many are done; folds away on its own. */
function PrepSection({ label, items, onDone, foldKey }: { label: string; items: PrepItem[]; onDone: (itemId: string, done: boolean) => void; foldKey: string }) {
  const [open, setOpen] = useFold(foldKey);
  const done = items.filter((i) => i.doneAt).length;
  return (
    <div className={`pc-sec ${open ? '' : 'folded'} ${done === items.length ? 'all-done' : ''}`} data-prep-kind={label}>
      <button type="button" className="pc-sec-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>{label}</b>
        <span className="pc-sec-n">{done === items.length ? <><Icon name="check" />{items.length}</> : `${done} of ${items.length}`}</span>
        <Icon name={open ? 'up' : 'down'} />
      </button>
      {open ? (
        <ul>{items.map((i) => (
          <li key={i.id} data-prep={i.name}>
            <div className={`pc-row ${i.doneAt ? 'done' : ''}`}>
              <span className="pc-t"><b>{i.name}</b>{i.note ? <small>{i.note}</small> : null}
                {i.doneAt ? <small className="pc-by">Done{i.doneBy ? ` · ${i.doneBy}` : ''} {timeOf(i.doneAt)}</small> : null}</span>
              {i.doneAt
                ? <button type="button" className="btn small pc-undo" onClick={() => onDone(i.id, false)} aria-label={`Undo done: ${i.name}`}>Undo</button>
                : <button type="button" className="btn small good pc-done" onClick={() => onDone(i.id, true)} aria-label={`Done: ${i.name}`}><Icon name="check" />Done</button>}
            </div>
          </li>
        ))}</ul>
      ) : null}
    </div>
  );
}

/**
 * The Kitchen screen's handover for the morning team: the latest one from a finished restock
 * (last night's, or tonight's once the closing team finishes), plus jobs left for morning on the
 * Prep checklist that service. Brought in from the server so any device sees it, and kept on this
 * device for when there's no connection.
 */
export function MorningPrepHome({ departmentId, today, who, tasks = [] }: { departmentId: string; today: string; who: string; tasks?: PrepTask[] }) {
  const since = shiftDay(today, -1);
  useEffect(() => { void importRemotePrep(departmentId, since); void importRemotePrepChecks(departmentId, since); }, [departmentId, since]);
  const rows = useLive(async () => {
    const list = await localDb().prep.where('departmentId').equals(departmentId).toArray();
    const sessions = new Map((await localDb().sessions.bulkGet(list.map((h) => h.sessionId))).filter(Boolean).map((s) => [s!.id, s!.status]));
    return list.filter((h) => h.tradingDate >= since)
      .filter((h) => /^finished/.test(sessions.get(h.sessionId) ?? h.restockStatus ?? ''))
      .sort((a, b) => b.tradingDate.localeCompare(a.tradingDate) || b.updatedAt.localeCompare(a.updatedAt));
  }, [departmentId, since], [] as LocalPrep[]);
  const left = useLive(async () => (await localDb().prepChecks.where('departmentId').equals(departmentId).toArray()).filter((c) => c.morning && c.tradingDate >= since),
    [departmentId, since], [] as PrepCheck[]);
  // The latest service with anything for the morning team: its handover and its "Leave for morning" jobs together.
  const day = [rows[0]?.tradingDate, ...left.map((c) => c.tradingDate)].filter(Boolean).sort().pop();
  if (!day) return null;
  const h = rows[0]?.tradingDate === day ? rows[0] : undefined;
  const taskOf = new Map(tasks.map((t) => [t.id, t]));
  const inHandover = new Set((h?.status === 'needed' ? h.items : []).flatMap((i) => (i.taskId ? [i.taskId] : [])));
  const extra: PrepItem[] = left.filter((c) => c.tradingDate === day && !inHandover.has(c.taskId) && taskOf.has(c.taskId)).map((c) => ({
    id: `chk:${c.taskId}`, taskId: c.taskId, group: taskOf.get(c.taskId)!.group, name: taskOf.get(c.taskId)!.name, qty: null, note: c.note,
    doneAt: c.morningDoneAt, doneBy: c.morningDoneBy,
  }));
  const items = [...(h?.status === 'needed' ? h.items : []), ...extra];
  const merged: LocalPrep = h && !extra.length ? h : {
    sessionId: h?.sessionId ?? '', departmentId, tradingDate: day, status: items.length ? 'needed' : 'none', items,
    updatedBy: h?.updatedBy ?? null, updatedAt: h?.updatedAt ?? '',
  };
  const dateLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
  const onDone = (id: string, done: boolean) => (id.startsWith('chk:')
    ? void setPrepCheck(departmentId, day, id.slice(4), { morningDone: done }, who)
    : h ? void setPrepDone(h.sessionId, id, done, who) : undefined);
  const sub = !h ? `Left for morning on the ${dateLabel} prep checklist` : extra.length ? `From the ${dateLabel} close and prep checklist` : undefined;
  return <MorningPrepCard handover={merged} dateLabel={dateLabel} sub={sub} onDone={onDone} foldKey={`vr-prep-${departmentId}`} />;
}

function shiftDay(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
