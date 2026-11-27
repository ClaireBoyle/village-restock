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
  const groups = useMemo(() => checklistGroups(tasks), [tasks]);
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
  const all = groups.flatMap((g) => g.tasks);
  const total = all.length + portions.length;
  const checked = portions.filter(p => p.doneAt).length + all.filter((t) => byTask.get(t.id)?.status).length;
  const needs = portions.filter(p => !p.doneAt).length + all.filter((t) => byTask.get(t.id)?.status === 'needs').length;
  const morning = all.filter((t) => byTask.get(t.id)?.morning).length;

  // Needs prep: the outstanding jobs. One marked Ready stays in view (with Undo) until the filter is changed.
  const [filter, setFilter] = useState<'all' | 'needs'>('all');
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const show = (t: PrepTask) => filter === 'all' || byTask.get(t.id)?.status === 'needs' || keep.has(t.id);
  const pick = (f: 'all' | 'needs') => { setFilter(f); setKeep(new Set()); };

  const save = (t: PrepTask, fields: Parameters<typeof setPrepCheck>[3]) => {
    if (!today) return;
    if (filter === 'needs' && fields.status === 'ready') setKeep((k) => new Set(k).add(t.id));
    void setPrepCheck(departmentId, today, t.id, fields, who);
  };

  const gold = dept?.theme === 'gold';
  const back = () => (window.history.length > 1 ? router.back() : router.push(`/d/${departmentId}`));
  const dayLabel = today ? new Date(`${today}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

  return (
    <div className={`theme-navy ${gold ? 'theme-gold gc' : ''}`}>
      <TopBar title={dept?.name ?? 'Prep checklist'} crumbs="Prep checklist" right={<TopControls catalogueCheckedAt={checkedAt} />}
        logo={<button className="iconbtn" onClick={back} aria-label="Back"><Icon name="back" /></button>} />
      <OfflineBanner />
      <main className="wrap restock-main pcl">
        <section className="pcl-head" aria-labelledby="pcl-h">
          <div className="pcl-top">
            <div>
              <p className="dp-eyebrow"><Icon name="clock" />This service &middot; {dayLabel}</p>
              <h1 id="pcl-h">Prep checklist</h1>
            </div>
            <Link className="btn small" href={`/d/${departmentId}`}><Icon name="list" />Kitchen</Link>
          </div>
          {total ? (
            <>
              <p className="pcl-sum" aria-live="polite"><b>{checked} of {total} checked</b>
                {needs ? <span className="w"><Icon name="warn" />{needs} need prep</span> : null}
                {morning ? <span><Icon name="clock" />{morning} left for morning</span> : null}</p>
              <span className="pcl-bar" aria-hidden="true"><i style={{ width: `${Math.round((checked / total) * 100)}%` }} /></span>
              <div className="segb pcl-filter" role="group" aria-label="Show">
                <button className={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} onClick={() => pick('all')}>All jobs</button>
                <button className={filter === 'needs' ? 'on' : ''} aria-pressed={filter === 'needs'} onClick={() => pick('needs')}>Needs prep{needs ? ` (${needs})` : ''}</button>
              </div>
            </>
          ) : null}
          {groups.some((g) => chipsFor(g.tasks)) ? (
            <p className="pcl-hint">Tap a job: once <span className="pcl-chip-i ok" aria-hidden="true"><Icon name="check" /></span>Ready, twice
              <span className="pcl-chip-i w" aria-hidden="true"><Icon name="warn" /></span>Needs prep, again to clear.</p>
          ) : null}
          {serverReady === false ? <p className="pcl-warn"><Icon name="warn" />Saved on this device only: the server needs a database update (021_prep_checklist.sql) before other devices see these checks.</p> : null}
        </section>

        {!catalogue ? null : total === 0 ? (
          <p className="empty">No prep jobs are on the checklist yet. A manager can add them in Admin &rsaquo; Morning prep.</p>
        ) : filter === 'needs' && !all.some(show) && !portions.some(p => !p.doneAt || keep.has(p.id)) ? (
          <p className="empty pcl-none"><Icon name="check" />Nothing needs prep right now.</p>
        ) : groups.map((g) => {
          const list = g.tasks.filter(show);
          if (!list.length) return null;
          const done = g.tasks.filter((t) => byTask.get(t.id)?.status).length;
          const open = list.filter((t) => !byTask.get(t.id)?.status);
          return (
            <section key={g.name} className="pcl-group" aria-label={g.name}>
              <h2><span>{g.name}</span>
                {open.length >= 2 ? <button type="button" className="linkbtn pcl-all" onClick={() => open.forEach((t) => save(t, { status: 'ready' }))}
                  aria-label={`All ready: ${g.name}`}><Icon name="check" />All ready</button> : null}
                <small>{done === g.tasks.length ? <><Icon name="check" />{g.tasks.length}</> : `${done} of ${g.tasks.length}`}</small></h2>
              {chipsFor(g.tasks) ? (
                // Short jobs (e.g. the Harvest Hommus veg): a grid of chips, tap to go Ready → Needs prep → clear.
                <>
                  <div className="pcl-chips" role="group" aria-label={`${g.name}: tap once for Ready, twice for Needs prep`}>
                    {list.map((t) => <ChipJob key={t.id} label={t.label} short={t.short} check={byTask.get(t.id)} doing={filter === 'needs'} onChange={(f) => save(t, f)} />)}
                  </div>
                  {list.some((t) => { const c = byTask.get(t.id); return c?.status === 'needs' || c?.morning || c?.note; }) ? (
                    <ul className="pcl-chip-x">{list.filter((t) => { const c = byTask.get(t.id); return c?.status === 'needs' || c?.morning || c?.note; }).map((t) => (
                      <li key={t.id} className="pcl-job s-needs" data-job={t.label}>
                        <JobExtras label={t.label} check={byTask.get(t.id)} onChange={(f) => save(t, f)} lead={<b className="pcl-x-n">{t.short}</b>} />
                      </li>
                    ))}</ul>
                  ) : null}
                </>
              ) : (
                <ul>{list.map((t) => <Job key={t.id} label={t.label} short={t.short} check={byTask.get(t.id)} onChange={(f) => save(t, f)} />)}</ul>
              )}
            </section>
          );
        })}
        {portions.some(p => filter === 'all' || !p.doneAt || keep.has(p.id)) && (
          <section className="pcl-group" aria-label="Portioning from restock">
            <h2><span>Portioning from restock</span><small>{portions.filter(p => p.doneAt).length} of {portions.length} ready</small></h2>
            <ul>{portions.filter(p => filter === 'all' || !p.doneAt || keep.has(p.id)).map(p => (
              <li key={p.id}><strong>{p.name}</strong>
                {p.note && <p>{p.note}</p>}
                <button type="button" className="btn small" aria-label={p.name + (p.doneAt ? ': mark needs prep' : ': mark ready')}
                  onClick={() => {
                    if (filter === 'needs') setKeep(k => new Set(k).add(p.id));
                    void setPrepDone(p.sessionId, p.id, !p.doneAt, who);
                  }}>{p.doneAt ? 'Ready · Undo' : 'Needs prep · Mark ready'}</button>
              </li>
            ))}</ul>
          </section>
        )}
      </main>
    </div>
  );
}

/** Three or more jobs, every one short (e.g. Carrot, Cucumber, Celery, Radish): shown as chips. */
const chipsFor = (tasks: { short: string }[]) => tasks.length >= 3 && tasks.every((t) => t.short.length <= 24);

/**
 * A chip: its name and state. Tap: Unchecked → Ready → Needs prep → Unchecked. Doing the prep (the Needs prep
 * filter): a Needs prep chip goes straight to Ready.
 */
function ChipJob({ label, short, check, doing, onChange }: { label: string; short: string; check: PrepCheck | undefined; doing: boolean; onChange: (f: Parameters<typeof setPrepCheck>[3]) => void }) {
  const st = check?.status ?? null;
  // Quick taps: count on from the last one, not the saved state (it can lag a tap behind).
  const last = useRef(st);
  useEffect(() => { last.current = st; }, [st]);
  const nextOf = (v: typeof st) => (v === null ? 'ready' : v === 'ready' ? 'needs' : doing ? 'ready' : null);
  const next = nextOf(st);
  const now = st === 'ready' ? 'Ready' : st === 'needs' ? 'Needs prep' : 'Unchecked';
  return (
    <button type="button" className={`pcl-chip s-${st ?? 'none'} ${check?.morning ? 'morning' : ''}`} data-chip={label}
      aria-label={`${label}: ${now}. Tap for ${next === 'ready' ? 'Ready' : next === 'needs' ? 'Needs prep' : 'Unchecked'}`}
      onClick={() => { const v = nextOf(last.current); last.current = v; onChange({ status: v }); }}>
      <span className="pcl-chip-i" aria-hidden="true">{st === 'ready' ? <Icon name="check" /> : st === 'needs' ? <Icon name="warn" /> : null}</span>
      <span className="pcl-chip-n">{short}</span>
      {check?.morning ? <Icon name="clock" /> : null}
    </button>
  );
}

/** Add note / the note, and Leave for morning (or "Left for morning · Undo"). */
function JobExtras({ label, check, onChange, lead = null, onNote }: {
  label: string; check: PrepCheck | undefined; onChange: (f: Parameters<typeof setPrepCheck>[3]) => void; lead?: React.ReactNode; onNote?: (open: boolean) => void;
}) {
  const [noteOpen, setNoteOpenRaw] = useState(false);
  const setNoteOpen = (v: boolean) => { setNoteOpenRaw(v); onNote?.(v); };
  const [draft, setDraft] = useState(check?.note ?? '');
  const noteRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!noteOpen) setDraft(check?.note ?? ''); }, [check?.note, noteOpen]);
  const saveNote = () => { setNoteOpen(false); if ((draft.trim() || null) !== (check?.note ?? null)) onChange({ note: draft.trim() || null }); };
  const editNote = () => { setNoteOpen(true); window.setTimeout(() => noteRef.current?.focus(), 30); };
  return (
    <div className="pcl-extra">
      {lead}
      {noteOpen ? (
        <input ref={noteRef} className="pcl-note-in" value={draft} maxLength={200} placeholder="Note (optional)" aria-label={`Note for ${label}`}
          onChange={(e) => setDraft(e.target.value)} onBlur={saveNote}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNote(); } else if (e.key === 'Escape') { setDraft(check?.note ?? ''); setNoteOpen(false); } }} />
      ) : check?.note ? (
        <button type="button" className="linkbtn pcl-note" onClick={editNote}><Icon name="info" />{check.note}</button>
      ) : (
        <button type="button" className="linkbtn pcl-add-note" onClick={editNote}>Add note</button>
      )}
      {check?.morning ? (
        <span className="pcl-morning on"><Icon name="clock" />Left for morning{check.morningDoneAt ? ' · done' : ''}
          <button type="button" className="linkbtn" onClick={() => onChange({ morning: false })} aria-label={`Undo leave for morning: ${label}`}>Undo</button></span>
      ) : (
        <button type="button" className="linkbtn pcl-morning" onClick={() => onChange({ morning: true })} aria-label={`Leave for morning: ${label}`}><Icon name="clock" />Leave for morning</button>
      )}
    </div>
  );
}

/**
 * One job, on one line: its name and Ready / Needs prep (tap again for Unchecked). The note and Leave for morning
 * appear once it needs prep, or when the name is tapped, and stay while there's a note or it's left for morning.
 */
function Job({ label, short, check, onChange }: { label: string; short: string; check: PrepCheck | undefined; onChange: (f: Parameters<typeof setPrepCheck>[3]) => void }) {
  const st = check?.status ?? null;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const extras = open || editing || st === 'needs' || !!check?.note || !!check?.morning;
  return (
    <li className={`pcl-job ${st ? `s-${st}` : 's-none'}`} data-job={label}>
      <div className="pcl-main">
        <button type="button" className="pcl-t" aria-expanded={extras} onClick={() => setOpen(!open)} title={label !== short ? label : undefined}>
          <b>{short}</b>
          <small className="pcl-st">{st === 'ready' ? 'Ready' : st === 'needs' ? 'Needs prep' : 'Unchecked'}{check?.updatedBy && st ? ` · ${check.updatedBy}` : ''}</small>
        </button>
        <span className="pcl-seg" role="group" aria-label={`${label}: ready or needs prep?`}>
          <button type="button" className={`pcl-ready ${st === 'ready' ? 'on' : ''}`} aria-pressed={st === 'ready'} aria-label={`${label}: ready`} onClick={() => onChange({ status: st === 'ready' ? null : 'ready' })}>
            <Icon name="check" />Ready</button>
          <button type="button" className={`pcl-needs ${st === 'needs' ? 'on' : ''}`} aria-pressed={st === 'needs'} aria-label={`${label}: needs prep`} onClick={() => onChange({ status: st === 'needs' ? null : 'needs' })}>
            Needs prep</button>
        </span>
      </div>
      {extras ? <JobExtras label={label} check={check} onChange={onChange} onNote={setEditing} /> : null}
    </li>
  );
}
