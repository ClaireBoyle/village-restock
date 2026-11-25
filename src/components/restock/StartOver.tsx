'use client';
// "Start over" for one area: a ⋯ menu on the area heading, then a sheet that says exactly what will be cleared
// (and by whom) and what's kept (anything already collected or pulled). Undo is offered straight after.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from './SyncControls';

/** A small "⋯" menu on an area's heading with one action: Start over. */
export function AreaMenu({ areaName, onStartOver }: { areaName: string; onStartOver: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="amenu" ref={ref}>
      <button type="button" className="iconbtn amenu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`More options: ${areaName}`} onClick={() => setOpen(!open)}><Icon name="more" /></button>
      {open ? (
        <div className="amenu-pop" role="menu">
          <button type="button" role="menuitem" className="so-item" onClick={() => { setOpen(false); onStartOver(); }}><Icon name="reset" />Start over</button>
        </div>
      ) : null}
    </div>
  );
}

/** Who entered what: "4 by Mia, 2 by Sam". */
const byWhom = (names: (string | null | undefined)[]) => {
  const n = new Map<string, number>();
  for (const x of names) { const k = x?.trim() || 'someone'; n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]).map(([who, c]) => `${c} by ${who}`).join(', ');
};

export function StartOverSheet({ areaName, clearWho, kept, prepTicks, defrostLinked, wasDone, onConfirm, onClose }: {
  areaName: string;
  /** Who last changed each entry that will be cleared. */
  clearWho: (string | null | undefined)[];
  /** Entries kept because they're already collected or pulled. */
  kept: number;
  /** "Needs portioning" ticks here: kept (they're on the morning prep list). */
  prepTicks: number;
  /** Defrost amounts that were also added to the freezers' stock lists (those go too). */
  defrostLinked: boolean;
  /** The area was marked done or skipped: it goes back to "to check". */
  wasDone: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const n = clearWho.length;
  return (
    <Sheet title="Start over?" onClose={onClose}>
      <div className="so-body">
        <p className="so-what">{n
          ? <>Clears what&rsquo;s entered in <b>{areaName}</b>: {n} {n === 1 ? 'entry' : 'entries'} ({byWhom(clearWho)}).</>
          : <>Nothing in <b>{areaName}</b> can be cleared.</>}</p>
        <ul className="so-notes">
          {kept ? <li><Icon name="check" />Kept: {kept} already collected or pulled.</li> : null}
          {prepTicks ? <li><Icon name="check" />Kept: {prepTicks} &ldquo;Needs portioning&rdquo; {prepTicks === 1 ? 'tick' : 'ticks'} (on the morning prep list).</li> : null}
          {defrostLinked ? <li><Icon name="info" />The amounts added to the freezers from Defrost go too.</li> : null}
          {wasDone ? <li><Icon name="info" />{areaName} goes back to &ldquo;to check&rdquo;.</li> : null}
          <li><Icon name="reset" />You can undo it straight after.</li>
        </ul>
        <div className="so-acts">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn danger so-go" onClick={onConfirm} disabled={!n && !wasDone}><Icon name="reset" />Start over</button>
        </div>
      </div>
    </Sheet>
  );
}
