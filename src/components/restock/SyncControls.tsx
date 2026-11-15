'use client';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { timeLabel } from '@/components/TopBar';
import { useStaffName, useSyncStatus } from '@/lib/client/hooks';
import { syncNow } from '@/lib/client/sync-engine';
import { initials } from './shared';

/**
 * Connection and sync status. Each state is only shown when it's true:
 * "All changes synced" means the server confirmed everything on this device.
 */
export function StatusPill({ onOpen, catalogueCheckedAt }: { onOpen: () => void; catalogueCheckedAt?: string | null }) {
  const s = useSyncStatus();
  // `short` is shown on phones, where the full wording doesn't fit.
  let cls = 'warn', text = 'Checking…', short = 'Checking';
  if (s.problems > 0) { cls = 'off'; text = `Sync needs attention (${s.problems})`; short = 'Needs attention'; }
  else if (s.connection === 'offline') { cls = 'off'; text = s.pending ? `Offline · ${s.pending} saved on device` : 'Offline · changes save on device'; short = s.pending ? `Offline · ${s.pending}` : 'Offline'; }
  else if (s.pending > 0) { cls = 'warn'; text = `Syncing ${s.pending}…`; short = `Syncing ${s.pending}`; }
  else if (s.connection === 'online') { cls = 'ok'; text = 'All changes synced'; short = 'Synced'; }
  return (
    <button className={`pill ${cls}`} onClick={onOpen} aria-label={`Sync status: ${text}. Open details`}
      title={catalogueCheckedAt ? `Product data checked ${timeLabel(catalogueCheckedAt)}` : undefined}>
      <span className="dot" aria-hidden="true" /><span className="ptxt lg">{text}</span><span className="ptxt sm" aria-hidden="true">{short}</span>
      {s.syncing ? <Icon name="sync" className="spin" /> : null}
    </button>
  );
}

export function OfflineBanner() {
  const s = useSyncStatus();
  if (s.connection !== 'offline') return null;
  return (
    <div className="net" role="status"><div className="wrap net-in"><Icon name="wifioff" />
      <span><b>No connection.</b> Keep going: your work is saved on this device{s.pending ? <> and <b>{s.pending} change{s.pending === 1 ? '' : 's'}</b> will upload</> : ' and will upload'} when Wi-Fi returns.</span>
    </div></div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // Drawn at the end of <body>: inside the blurred top bar, a fixed panel gets
  // trapped in the bar's 68px and can't be used.
  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SyncSheet({ onClose, catalogueCheckedAt }: { onClose: () => void; catalogueCheckedAt: string | null }) {
  const s = useSyncStatus();
  return (
    <Sheet title="Sync status" onClose={onClose}>
      <div className="kv">
        <div><span>Connection</span><span>{s.connection === 'online' ? 'Online' : s.connection === 'offline' ? 'Offline' : 'Checking…'}</span></div>
        <div><span>Saved on this device, waiting to upload</span><span className="tabular">{s.pending}</span></div>
        <div><span>Last successful sync</span><span>{s.lastSyncAt ? timeLabel(s.lastSyncAt) : 'Not yet'}</span></div>
        <div><span>Product data last checked</span><span>{catalogueCheckedAt ? timeLabel(catalogueCheckedAt) : 'Not yet'}</span></div>
      </div>
      {s.problems > 0 ? (
        <div className="banner s-bad"><Icon name="warn" /><div><b>{s.problems} change{s.problems === 1 ? '' : 's'} couldn&rsquo;t be saved to the server</b>
          <p>Usually because a product was removed while you were working. They&rsquo;re kept on this device. Tell a manager.</p></div></div>
      ) : null}
      {s.lastError ? <p className="meta">{s.lastError}</p> : null}
      <p className="meta">{s.connection === 'offline'
        ? 'Everything you enter is saved on this device and uploads by itself when Wi-Fi returns. Don’t clear Safari’s website data until it has.'
        : 'Changes upload automatically every few seconds.'}</p>
      <button className="btn primary big" onClick={() => void syncNow()} disabled={s.syncing}>
        <Icon name="sync" className={s.syncing ? 'spin' : ''} />{s.syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </Sheet>
  );
}

export function NameSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useStaffName();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Sheet title="Your name" onClose={onClose}>
      <div className="field">
        <label htmlFor="staffname">First name or initials</label>
        <input id="staffname" value={draft ?? name} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Sam or SB" maxLength={30}
          autoComplete="off" autoCapitalize="words" enterKeyHint="done" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { if (draft !== null) setName(draft.trim()); onClose(); } }} />
        <small>Optional. Shown next to the work you do, so the next person knows who checked what. Change it when someone else picks up this device.</small>
      </div>
      <button className="btn primary big" onClick={() => { if (draft !== null) setName(draft.trim()); onClose(); }}>Done</button>
    </Sheet>
  );
}

/** The right-hand side of the top bar: name + sync status, with their panels. */
export function TopControls({ catalogueCheckedAt }: { catalogueCheckedAt: string | null }) {
  const [sheet, setSheet] = useState<'sync' | 'name' | null>(null);
  const [name] = useStaffName();
  return (
    <>
      <button className="who" onClick={() => setSheet('name')} aria-label="Your name">
        <span className="avatar">{name ? initials(name) : <Icon name="user" />}</span><span className="nm">{name || 'Add your name'}</span>
      </button>
      <span className="sep" aria-hidden="true" />
      <StatusPill onOpen={() => setSheet('sync')} catalogueCheckedAt={catalogueCheckedAt} />
      {sheet === 'sync' ? <SyncSheet onClose={() => setSheet(null)} catalogueCheckedAt={catalogueCheckedAt} /> : null}
      {sheet === 'name' ? <NameSheet onClose={() => setSheet(null)} /> : null}
    </>
  );
}
