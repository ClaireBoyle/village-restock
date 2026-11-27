'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { TopBar } from '@/components/TopBar';
import { OfflineBanner, TopControls } from '@/components/restock/SyncControls';
import { useCatalogue } from '@/lib/client/use-catalogue';
import { useLive, useStaffName } from '@/lib/client/hooks';
import { localDb } from '@/lib/client/local-db';
import { importRemotePrepChecks, setPrepCheck } from '@/lib/client/prep-check-store';
import { importRemotePrep, setPrepDone } from '@/lib/client/prep-store';
import { tradingDate } from '@/lib/restock-math';
import { checklistGroups, type PrepCheck, type PrepTask } from '@/lib/prep';

const portionNames = new Set(['portion lamb', 'portion zucchini wedges', 'portion cauliflower popcorn', "portion fisherman's baskets", "portion fisherman's basket"]);

function serviceGroups(tasks: PrepTask[]) {
  const ingredients: [RegExp, string][] = [[/\bcarrots?\b/i, 'Carrot'], [/\bcucumbers?\b/i, 'Cucumber'], [/\bcelery\b/i, 'Celery'], [/\bradish(?:es)?\b/i, 'Radish']];
  return checklistGroups(tasks.map(task => {
    const context = [task.checklistGroup, task.checklistName, task.name].join(' ');
    const ingredient = ingredients.find(([pattern]) => pattern.test(context));
    if (!ingredient || (!/harvest|h[ou]mm?[ou]s/i.test(context) && !/^cut (carrots?|cucumbers?|celery|radish(?:es)?)$/i.test(task.name.trim()))) return task;
    return { ...task, checklistGroup: 'Harvest hummus veg', checklistName: ingredient[1] };
  }));
}

const RECHECK_MS = 20_000;

/**
 * Prep checklist (Gold Class Kitchen): open any time, e.g. before a busy night, with no restock or handover
 * needed. Each job starts Unchecked for the service; staff tap Ready (enough prepped) or Needs prep (for this
 * service). Leave for morning is separate: it puts the job on the opener's handover. Shared between devices
 * for the same service (trading day); the next service starts fresh.
 */
export function PrepChecklist({ departmentId }: { departmentId: string }) {
  const router = useRouter();
  const { catalogue, checkedAt } = useCatalogue();
  const [who] = useStaffName();
  const dept = catalogue?.departments.find((d) => d.id === departmentId);
  const tasks = useMemo(() => (catalogue?.prepTasks ?? []).filter((t) => t.departmentId === departmentId), [catalogue, departmentId]);
  // A heading for a single job is noise: those jobs go together under "Other prep" at the end, by their full name.
  const groups = useMemo(() => {
    const all = serviceGroups(tasks);
    const singles = all.filter((g) => g.tasks.length === 1);
    if (singles.length < 2) return all;
    return [...all.filter((g) => g.tasks.length > 1), { name: 'Other prep', tasks: singles.map((g) => ({ ...g.tasks[0], short: g.tasks[0].label })) }];
  }, [tasks]);
  const tz = catalogue?.settings.timeZone ?? 'Australia/Melbourne';
  const today = catalogue ? tradingDate(new Date(), tz, catalogue.settings.cutoffHour) : null;
  const [serverReady, setServerReady] = useState<boolean | null>(true);

  const rows = useLive(async () => (today ? localDb().prepChecks.where('[departmentId+tradingDate]').equals([departmentId, today]).toArray() : []), [departmentId, today], [] as PrepCheck[]);
  const portions = useLive(async () => {
    if (!today) return [];
    const handovers = await localDb().prep.where('departmentId').equals(departmentId).toArray();
    return handovers.filter(h => h.tradingDate === today && h.status === 'needed' && h.restockStatus !== 'cancelled')
      .flatMap(h => h.items.filter(i => portionNames.has(i.name.toLowerCase().replace(/’/g, "'")))
        .map(i => ({ ...i, sessionId: h.sessionId })));
  }, [departmentId, today], [] as (import('@/lib/prep').PrepItem & { sessionId: string })[]);
  // Other devices' checks: on opening, every 20 seconds while open, and when the screen comes back.
  useEffect(() => {
    if (!today) return;
    const pull = () => { void importRemotePrep(departmentId, today, true); void importRemotePrepChecks(departmentId, today).then((r) => { if (r !== null) setServerReady(r); }); };
    pull();
    const t = window.setInterval(pull, RECHECK_MS);
    const vis = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [departmentId, today]);

  const byTask = new Map(rows.map((r) => [r.taskId, r]));
  const all = groups.flatMap((g) => g.tasks.map((t) => ({ ...t, groupName: g.name })));
  // On the To prep list: what was marked Needs prep (Ready = prepped), plus the portioning from last night's restock.
  const toPrep = all.filter((t) => byTask.get(t.id)?.status);
  const prepTotal = toPrep.length + portions.length;
  const prepDone = toPrep.filter((t) => byTask.get(t.id)?.status === 'ready').length + portions.filter((p) => p.doneAt).length;

  // Step 1 Check (tap what needs prep) · Step 2 To prep (tick each one when done).
  const [step, setStep] = useState<'check' | 'prep'>('check');
  useEffect(() => { if (window.location.hash === '#prep') setStep('prep'); }, []);
  const go = (s: 'check' | 'prep') => {
    setStep(s);
    try { window.history.replaceState(null, '', s === 'prep' ? '#prep' : window.location.pathname); } catch { /* fine */ }
    window.scrollTo({ top: 0 });
  };

  const save = (t: PrepTask, fields: Parameters<typeof setPrepCheck>[3]) => {
    if (!today) return;
    void setPrepCheck(departmentId, today, t.id, fields, who);
  };

  const gold = dept?.theme === 'gold';
  const back = () => (window.history.length > 1 ? router.back() : router.push(`/d/${departmentId}`));
  const dayLabel = today ? new Date(`${today}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
  const noJobs = catalogue && all.length + portions.length === 0;

  return (
    <div className={`theme-navy ${gold ? 'theme-gold gc' : ''}`}>
      <TopBar title={dept?.name ?? 'Prep checklist'} crumbs="Prep checklist" right={<TopControls catalogueCheckedAt={checkedAt} />}
        logo={<button className="iconbtn" onClick={back} aria-label="Back"><Icon name="back" /></button>} />
      <OfflineBanner />
      <main className={`wrap restock-main pcl step-${step}`}>
        <section className="pcl-head" aria-labelledby="pcl-h">
          <div className="pcl-top">
            <h1 id="pcl-h">Prep checklist <small>{dayLabel}</small></h1>
            <Link className="btn small" href={`/d/${departmentId}`}><Icon name="list" />Kitchen</Link>
          </div>
          {!noJobs ? (
            <nav className="pcl-steps" aria-label="Prep checklist steps">
              <button type="button" className={step === 'check' ? 'on' : ''} aria-current={step === 'check' ? 'step' : undefined} onClick={() => go('check')}>
                <span className="n">1</span>Check</button>
              <button type="button" className={step === 'prep' ? 'on' : ''} aria-current={step === 'prep' ? 'step' : undefined} onClick={() => go('prep')}>
                <span className="n">2</span>To prep{prepTotal ? <small>{prepDone}/{prepTotal}</small> : null}</button>
            </nav>
          ) : null}
          {serverReady === false ? <p className="pcl-warn"><Icon name="warn" />Saved on this device only: the server needs a database update (021_prep_checklist.sql) before other devices see these checks.</p> : null}
        </section>

        {!catalogue ? null : noJobs ? (
          <p className="empty">No prep jobs are on the checklist yet. A manager can add them in Admin &rsaquo; Morning prep.</p>
        ) : step === 'check' ? (
          <>
            <p className="pcl-hint">Tap anything that <b>needs prepping</b>. Leave the rest.</p>
            {groups.map((g) => {
              const n = g.tasks.filter((t) => byTask.get(t.id)?.status).length;
              return (
                <section key={g.name} className="pcl-group" aria-label={g.name}>
                  <h2><span>{g.name}</span>{n ? <small className="w">{n} to prep</small> : null}</h2>
                  <div className="pcl-chips" role="group" aria-label={g.name}>
                    {g.tasks.map((t) => <ChipJob key={t.id} label={t.label} short={t.short} check={byTask.get(t.id)} onChange={(f) => save(t, f)} />)}
                  </div>
                </section>
              );
            })}
            {portions.length ? <p className="pcl-hint pcl-from"><Icon name="info" />Also {portions.length === 1 ? '1 portioning job' : `${portions.length} portioning jobs`} from last night&rsquo;s restock on To prep.</p> : null}
            <div className="pcl-go">
              <button type="button" className="btn primary big" onClick={() => go('prep')} disabled={!prepTotal}>
                {prepTotal ? <>Start prepping ({prepTotal - prepDone || prepTotal})<Icon name="next" /></> : 'Nothing to prep yet'}</button>
            </div>
          </>
        ) : (
          <>
            {prepTotal ? (
              <div className="pcl-prog" aria-live="polite">
                <p><b>{prepDone} of {prepTotal} done</b>{prepDone === prepTotal ? <span className="ok"><Icon name="check" />All prepped</span> : null}</p>
                <span className="pcl-bar" aria-hidden="true"><i style={{ width: `${Math.round((prepDone / prepTotal) * 100)}%` }} /></span>
              </div>
            ) : null}
            {!prepTotal ? (
              <div className="empty pcl-none"><p>Nothing to prep. Tap the jobs that need prepping on <b>Check</b>.</p>
                <button type="button" className="btn" onClick={() => go('check')}><Icon name="back" />Back to Check</button></div>
            ) : (
              <ul className="pcl-todo">
                {toPrep.map((t) => {
                  const c = byTask.get(t.id);
                  return <TodoRow key={t.id} label={t.label} name={t.short} where={t.groupName} done={c?.status === 'ready'} by={c?.updatedBy ?? null}
                    check={c} onDone={(d) => save(t, { status: d ? 'ready' : 'needs' })} onChange={(f) => save(t, f)} />;
                })}
                {portions.map((p) => (
                  <TodoRow key={p.id} label={p.name} name={p.name} where="From last night’s restock" done={!!p.doneAt} by={p.doneBy ?? null} note={p.note}
                    onDone={(d) => void setPrepDone(p.sessionId, p.id, d, who)} />
                ))}
              </ul>
            )}
            {prepTotal ? <p className="pcl-hint">Tick each job when it&rsquo;s done. Something else needs prepping? Add it on <button type="button" className="linkbtn" onClick={() => go('check')}>Check</button>.</p> : null}
          </>
        )}
      </main>
    </div>
  );
}

/** A job on the To prep list: name, where it's from, an optional note, and a big tick for Done (tap again to undo). */
function TodoRow({ label, name, where, done, by, check, note, onDone, onChange }: {
  label: string; name: string; where: string; done: boolean; by: string | null;
  check?: PrepCheck; note?: string | null; onDone: (done: boolean) => void; onChange?: (f: Parameters<typeof setPrepCheck>[3]) => void;
}) {
  return (
    <li className={`pcl-tr ${done ? 'done' : ''}`} data-todo={label}>
      <span className="pcl-tr-t">
        <b>{name}</b>
        <span className="pcl-tr-sub">
          <small>{done ? <>Done{by ? ` · ${by}` : ''}</> : where}</small>
          {onChange && !check?.note && !done ? <NoteLine label={label} check={check} onChange={onChange} /> : null}
        </span>
        {onChange && check?.note ? <NoteLine label={label} check={check} onChange={onChange} /> : !onChange && note ? <small className="pcl-note-ro"><Icon name="info" />{note}</small> : null}
      </span>
      <button type="button" className={`pcl-tick ${done ? 'on' : ''}`} aria-pressed={done} aria-label={done ? `${label}: done (tap to undo)` : `${label}: mark done`} onClick={() => onDone(!done)}>
        <Icon name="check" /><span>{done ? 'Done' : 'Done?'}</span>
      </button>
    </li>
  );
}

/**
 * Check: a job is tapped when it needs prepping (orange), tapped again to undo. A job already prepped (ticked on
 * To prep) shows Done; tapping it puts it back on the list.
 */
function ChipJob({ label, short, check, onChange }: { label: string; short: string; check: PrepCheck | undefined; onChange: (f: Parameters<typeof setPrepCheck>[3]) => void }) {
  const st = check?.status ?? null;
  // Quick taps: count on from the last one, not the saved state (it can lag a tap behind).
  const last = useRef(st);
  useEffect(() => { last.current = st; }, [st]);
  const nextOf = (v: typeof st) => (v === 'needs' ? null : 'needs');
  const now = st === 'ready' ? 'Done' : st === 'needs' ? 'Needs prep' : 'Not needed';
  return (
    <button type="button" className={`pcl-chip s-${st ?? 'none'} ${short.length > 22 ? 'wide' : ''}`} data-chip={label} aria-pressed={st === 'needs'}
      aria-label={`${label}: ${now}. ${st === 'needs' ? 'Tap to undo' : 'Tap if it needs prep'}`}
      onClick={() => { const v = nextOf(last.current); last.current = v; onChange({ status: v }); }}>
      <span className="pcl-chip-i" aria-hidden="true">{st === 'ready' ? <Icon name="check" /> : st === 'needs' ? <Icon name="warn" /> : null}</span>
      <span className="pcl-chip-n">{short}</span>
      {st === 'ready' ? <small className="pcl-chip-s">Done</small> : null}
    </button>
  );
}

/** Add note, or the note (tap to edit). */
function NoteLine({ label, check, onChange }: { label: string; check: PrepCheck | undefined; onChange: (f: Parameters<typeof setPrepCheck>[3]) => void }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState(check?.note ?? '');
  const noteRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!noteOpen) setDraft(check?.note ?? ''); }, [check?.note, noteOpen]);
  const saveNote = () => { setNoteOpen(false); if ((draft.trim() || null) !== (check?.note ?? null)) onChange({ note: draft.trim() || null }); };
  const editNote = () => { setNoteOpen(true); window.setTimeout(() => noteRef.current?.focus(), 30); };
  return noteOpen ? (
    <input ref={noteRef} className="pcl-note-in" value={draft} maxLength={200} placeholder="Note (optional)" aria-label={`Note for ${label}`}
      onChange={(e) => setDraft(e.target.value)} onBlur={saveNote}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNote(); } else if (e.key === 'Escape') { setDraft(check?.note ?? ''); setNoteOpen(false); } }} />
  ) : check?.note ? (
    <button type="button" className="linkbtn pcl-note" onClick={editNote}><Icon name="info" />{check.note}</button>
  ) : (
    <button type="button" className="linkbtn pcl-add-note" onClick={editNote}>Add note</button>
  );
}
