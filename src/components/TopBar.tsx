import Link from 'next/link';
import { Icon } from './Icon';

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return sameDay ? t : `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} ${t}`;
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
          logo ?? (
            <span className="logo" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="logo-mark" src="/brand/village-v-white.png" alt="" />
            </span>
          )
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
