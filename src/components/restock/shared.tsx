'use client';
import { Icon, type IconName } from '@/components/Icon';
import type { AreaStatus } from '@/lib/restock-logic';
import type { CatDepartment } from '@/lib/catalogue-types';

export const initials = (n: string) =>
  n.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || n.slice(0, 1).toUpperCase();

export type BadgeState = 'ok' | 'warn' | 'bad' | 'info' | 'skip' | 'none';
const ICON: Record<BadgeState, IconName> = { ok: 'check', warn: 'up', bad: 'warn', info: 'half', skip: 'skip', none: 'circle' };

export function Badge({ st, children, icon }: { st: BadgeState; children: React.ReactNode; icon?: IconName }) {
  return <span className={`badge s-${st}`}><Icon name={icon ?? ICON[st]} />{children}</span>;
}

export const AREA_BADGE: Record<AreaStatus, BadgeState> = { not_started: 'none', in_progress: 'info', complete: 'ok', skipped: 'skip' };
export const AREA_LABEL: Record<AreaStatus, string> = { not_started: 'Not started', in_progress: 'In progress', complete: 'Complete', skipped: 'Skipped' };

export const timeOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : '';

export function DeptBand({ d, sub, right }: { d: CatDepartment; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="dband">
      <span className="dicon" aria-hidden="true"><Icon name={d.icon} /></span>
      <div className="dt">
        {d.groupLabel ? <p className="eyebrow">{d.groupLabel}</p> : null}
        <h1>{d.shortName}</h1>
        {sub ? <p className="dsub">{sub}</p> : null}
      </div>
      {right}
    </section>
  );
}

export type Step = 'check' | 'collect' | 'finish';

export function Stages({ kind, current, onGo }: { kind: 'full' | 'quick' | 'area'; current: Step; onGo: (s: Step) => void }) {
  const labels: [Step, string, string][] = [['check', kind === 'full' ? 'Check stock' : kind === 'area' ? 'What’s needed' : 'Pick products', kind === 'quick' ? 'Pick' : 'Check'], ['collect', 'Collect', 'Collect'], ['finish', 'Finish', 'Finish']];
  const idx = labels.findIndex(([s]) => s === current);
  return (
    <nav className="stages" aria-label="Restock steps">
      {labels.map(([s, l, sm], i) => (
        <button key={s} className={`stage ${i === idx ? 'on' : i < idx ? 'done' : ''}`} onClick={() => onGo(s)} aria-current={i === idx ? 'step' : undefined}>
          <span className="n">{i < idx ? <Icon name="check" /> : i + 1}</span><span className="lg">{l}</span><span className="sm">{sm}</span>
        </button>
      ))}
    </nav>
  );
}

export function Ring({ pct, st }: { pct: number; st: BadgeState }) {
  const r = 14, c = 2 * Math.PI * r;
  return (
    <svg className={`progress-ring s-${st}`} viewBox="0 0 36 36" aria-hidden="true">
      <circle className="bg" cx="18" cy="18" r={r} fill="none" strokeWidth="5" />
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 18 18)" />
      {st === 'ok' ? <path d="M12.5 18.5l3.8 3.8 7.2-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {st === 'skip' ? <path d="M13 18h10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function Dock({ icon, title, sub, progress, above, children }: { icon: IconName; title: React.ReactNode; sub?: React.ReactNode; progress?: number; above?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="dock">
      {above}
      {progress !== undefined ? <div className="dock-bar" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} /></div> : null}
      <div className="wrap dock-in">
        <div className="dock-txt"><Icon name={icon} /><div><b>{title}</b>{sub ? <small>{sub}</small> : null}</div></div>
        <div className="dock-acts">{children}</div>
      </div>
    </div>
  );
}

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
