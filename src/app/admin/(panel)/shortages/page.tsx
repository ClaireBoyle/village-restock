import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { CopyButton } from '@/components/admin/CopyButton';
import { resolveShortage } from '@/app/actions/admin';
import { listShortages } from '@/lib/server/restocks';

const REASON: Record<string, string> = { insufficient: 'Not enough in storeroom', access: 'Couldn’t access', time: 'Ran out of time', other: 'Other' };

export default async function Shortages() {
  const rows = await listShortages();
  const open = rows.filter((r) => r.status === 'open');
  const resolved = rows.filter((r) => r.status === 'resolved');
  const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const confirmed = open.filter((r) => r.reason === 'insufficient');
  const lowStock = [
    `LOW STOCK (${confirmed.length})`,
    ...confirmed.map((r) => `- ${r.productName} (${r.departmentName}): short ${Number(r.shortfallQty)} ${r.unitPlural} · ${day(r.tradingDate)}`),
    ...(open.some((r) => r.reason !== 'insufficient') ? ['', 'FLAGGED FOR SUPERVISOR', ...open.filter((r) => r.reason !== 'insufficient').map((r) => `- ${r.productName} (${r.departmentName}): ${REASON[r.reason]}`)] : []),
  ].join('\n');

  return (
    <>
      <div className="page-head">
        <div><h1>Shortages</h1><p>Products staff couldn&rsquo;t fully restock because the storeroom was short, or that they flagged for you. Nothing is ordered automatically.</p></div>
        {open.length ? <CopyButton text={lowStock} label="Copy low-stock list" /> : null}
      </div>

      <section className="panel">
        <h2 style={{ marginBottom: 6 }}>Open ({open.length})</h2>
        <div className="rows">
          {open.length === 0 ? <p className="meta">No open shortages.</p> : null}
          {open.map((r) => (
            <div key={r.id} className="row" style={{ flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 240 }}>
                <div className="title">{r.productName} <span className="meta">&middot; {r.departmentName}</span></div>
                <div className="meta">Short {Number(r.shortfallQty)} {r.unitPlural} &middot; {REASON[r.reason] ?? r.reason}{r.flagged ? ' · flagged' : ''} &middot; {day(r.tradingDate)}{r.reportedBy ? ` · ${r.reportedBy}` : ''}</div>
              </div>
              <span className={`badge ${r.reason === 'insufficient' ? 's-bad' : 's-warn'}`}><Icon name={r.flagged ? 'flag' : 'warn'} />{r.reason === 'insufficient' ? 'Low stock' : 'Flagged'}</span>
              {r.sessionId ? <Link className="linkbtn" href={`/admin/restocks/${r.sessionId}`}>Restock</Link> : null}
              <form action={resolveShortage} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexBasis: '100%' }}>
                <input type="hidden" name="id" value={r.id} />
                <input className="input" name="note" placeholder="Note (optional), e.g. Ordered Monday" maxLength={200} style={{ flex: '1 1 240px', minHeight: 44 }} aria-label={`Note for ${r.productName}`} />
                <button className="btn small primary"><Icon name="check" />Mark resolved</button>
              </form>
            </div>
          ))}
        </div>
      </section>

      {resolved.length ? (
        <section className="panel">
          <h2 style={{ marginBottom: 6 }}>Resolved in the last 30 days</h2>
          <div className="rows">
            {resolved.map((r) => (
              <div key={r.id} className="row muted-row">
                <div className="grow">
                  <div className="title">{r.productName} <span className="meta">&middot; {r.departmentName}</span></div>
                  <div className="meta">Short {Number(r.shortfallQty)} {r.unitPlural} &middot; {day(r.tradingDate)} &middot; resolved by {r.resolvedBy}{r.resolutionNote ? `: ${r.resolutionNote}` : ''}</div>
                </div>
                <form action={resolveShortage}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="reopen" value="true" /><button className="btn small">Reopen</button></form>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
