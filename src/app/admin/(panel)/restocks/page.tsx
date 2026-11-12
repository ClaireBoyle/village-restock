import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { listRestocks, serverToday, type RestockRow } from '@/lib/server/restocks';
import { STATUS } from '@/components/admin/restock-status';


export default async function Restocks() {
  const [rows, today] = await Promise.all([listRestocks(14), serverToday()]);
  const days = [...new Set(rows.map((r) => r.tradingDate))];
  const label = (d: string) => (d === today ? 'Tonight' : new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }));
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' }).toLowerCase() : '');

  return (
    <>
      <div className="page-head"><div><h1>Restocks</h1><p>The last two weeks of full and quick restocks. Restocks still open after the 5 am cut-off are marked Unfinished.</p></div></div>
      {rows.length === 0 ? <section className="panel"><p className="meta">No restocks yet.</p></section> : null}
      {days.map((d) => {
        const dayRows = rows.filter((r) => r.tradingDate === d);
        return (
          <section key={d} className="panel">
            <h2 style={{ marginBottom: 6 }}>{label(d)}</h2>
            <div className="rows">
              {dayRows.map((r: RestockRow) => (
                <div key={r.id} className="row" style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 240 }}>
                    <div className="title">{r.departmentName} &middot; {r.kind === 'full' ? 'Full restock' : 'Quick restock'}</div>
                    <div className="meta">
                      {r.people.length ? r.people.join(', ') : 'No names'} &middot; started {time(r.startedAt)}{r.finishedAt ? `, finished ${time(r.finishedAt)}` : ''}
                      {r.kind === 'full' ? ` · ${r.areasDone} of ${r.areasTotal} areas` : ` · ${r.itemsTouched} products`}
                    </div>
                    {r.exceptionReason ? <div className="meta">Reason: {r.exceptionReason}</div> : null}
                  </div>
                  <span className={`badge ${STATUS[r.status]?.cls ?? 's-none'}`}>{STATUS[r.status]?.label ?? r.status}</span>
                  {r.shortages ? <span className="badge s-bad"><Icon name="warn" />{r.shortages} shortage{r.shortages === 1 ? '' : 's'}</span> : null}
                  {r.conflicts ? <span className="badge s-bad"><Icon name="warn" />{r.conflicts} clash{r.conflicts === 1 ? '' : 'es'}</span> : null}
                  <Link className="btn small" href={`/admin/restocks/${r.id}`}>Details<Icon name="next" /></Link>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
