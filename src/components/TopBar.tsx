import Link from 'next/link';
import { Icon } from './Icon';
import type { Connection } from '@/lib/client/use-catalogue';

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return sameDay ? t : `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} ${t}`;
}

/**
 * Connection status that only claims what is known. Phase 1 has no restock
 * data to sync yet, so it reports whether product data is current.
 */
export function ConnectionPill({ connection, checkedAt }: { connection: Connection; checkedAt: string | null }) {
  const [cls, text] =
    connection === 'online' ? ['ok', 'Online'] :
    connection === 'offline' ? ['off', checkedAt ? `Offline · data from ${timeLabel(checkedAt)}` : 'Offline'] :
    ['warn', 'Checking…'];
  return (
    <span className={`pill ${cls}`} role="status" title={checkedAt ? `Product data last checked ${timeLabel(checkedAt)}` : undefined}>
      <span className="dot" aria-hidden="true" />
      <span className="ptxt">{text}</span>
    </span>
  );
}

export function TopBar({ title = 'Village Restock', crumbs, backHref, right, logo }: {
  title?: string; crumbs?: string; backHref?: string; right?: React.ReactNode; logo?: React.ReactNode;
}) {
  return (
    <header className="top">
      <div className="wrap top-in">
        {backHref ? (
          <Link className="iconbtn" href={backHref} aria-label="Back"><Icon name="back" /></Link>
        ) : (
          logo ?? <span className="logo" aria-hidden="true"><Icon name="logo" /></span>
        )}
        <div className="brand">
          <b>{title}</b>
          {crumbs ? <span className="crumbs">{crumbs}</span> : null}
        </div>
        {right ? <div className="top-right">{right}</div> : null}
      </div>
    </header>
  );
}

export { timeLabel };
