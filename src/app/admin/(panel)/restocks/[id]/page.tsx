import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { CopyButton } from '@/components/admin/CopyButton';
import { restockDetail } from '@/lib/server/restocks';
import { STATUS } from '@/components/admin/restock-status';

const REASON: Record<string, string> = { insufficient: 'Not enough in storeroom', access: 'Couldn’t access', time: 'Ran out of time', other: 'Other' };

export default async function RestockDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await restockDetail(id);
  if (!r) notFound();
  const s = r.session;
  const tz = r.timeZone;
  const time = (iso: unknown) => (iso ? new Date(iso as string).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz }).toLowerCase() : '');
  const areaById = new Map((r.view?.areas ?? []).map((a) => [a.area.id, a.area.name]));
  const st = STATUS[String(s.status)] ?? { cls: 's-none', label: String(s.status) };
  const n = (v: unknown) => (v === null || v === undefined ? '–' : String(Number(v)));

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="linkbtn" href="/admin/restocks"><Icon name="back" />All restocks</Link>
          <h1>{String(s.departmentName)} &middot; {s.kind === 'full' ? 'Full restock' : 'Quick restock'}</h1>
          <p>{new Date(`${s.tradingDate}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })} &middot; started {time(s.startedAt)}{s.finishedAt ? `, finished ${time(s.finishedAt)}` : ''} &middot; {(s.people as string[]).join(', ') || 'No names'}</p>
        </div>
        <span className={`badge ${st.cls}`}>{st.label}</span>
      </div>
      {s.exceptionReason ? <div className="banner s-warn"><Icon name="warn" /><div><b>Finished with exceptions</b><p>Reason: {String(s.exceptionReason)}</p></div></div> : null}
      {s.finishNote ? <div className="banner s-info"><Icon name="info" /><div><b>Comments from staff</b><p style={{ whiteSpace: 'pre-wrap' }}>{String(s.finishNote)}</p></div></div> : null}
      {s.status === 'unfinished' ? <div className="banner s-bad"><Icon name="warn" /><div><b>Never finished</b><p>This restock was still open after the 5 am cut-off. Check what was left below.</p></div></div> : null}

      {s.kind === 'full' && r.view ? (
        <section className="panel">
          <h2 style={{ marginBottom: 6 }}>Areas</h2>
          <div className="rows">
            {r.view.areas.map(({ area }) => {
              const a = r.areas.find((x) => x.checkAreaId === area.id);
              const status = a?.status === 'complete' ? ['s-ok', 'Complete'] : a?.status === 'skipped' ? ['s-skip', `Skipped: ${a.skipReason ?? ''}`]
                : r.items.some((i) => i.checkAreaId === area.id) ? ['s-info', 'In progress'] : ['s-none', 'Not started'];
              return (
                <div key={area.id} className="row"><div className="grow"><div className="title">{area.name}</div>
                  {a?.updatedBy ? <div className="meta">{String(a.updatedBy)}, {time(a.updatedAt)}</div> : null}</div>
                  <span className={`badge ${status[0]}`}>{status[1]}</span></div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2 style={{ marginBottom: 6 }}>Products entered ({r.items.length})</h2>
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>Product</th><th>Area</th><th>Target</th><th>Had</th><th>Asked for</th><th>Collected</th><th>Notes</th><th>By</th></tr></thead>
            <tbody>
              {r.items.map((i) => {
                const notes: string[] = [];
                if (i.conflict) notes.push('Two different counts (unresolved)');
                if (i.shortfallReason) notes.push(REASON[String(i.shortfallReason)] ?? String(i.shortfallReason));
                if (i.flagged) notes.push('Flagged for manager');
                if (i.routineChoice) notes.push(i.routineChoice === 'needed' ? 'Task needed' : 'Task not needed');
                return (
                  <tr key={String(i.placementId)} className={i.conflict || i.shortfallReason ? 'warn' : ''}>
                    <td>{String(i.productName)}</td><td>{areaById.get(String(i.checkAreaId)) ?? ''}</td>
                    <td className="tabular">{n(i.parLevel)}</td><td className="tabular">{n(i.currentQty)}</td><td className="tabular">{n(i.requestedQty)}</td>
                    <td className="tabular">{i.collectedMode === 'all' ? 'All' : n(i.collectedQty)}</td>
                    <td>{notes.join(' · ')}</td><td>{String(i.updatedBy ?? '')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {r.summary ? (
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2>Summary</h2><CopyButton text={r.summary} label="Copy summary" targetId="restock-summary" /></div>
          <textarea id="restock-summary" className="input" readOnly value={r.summary} style={{ minHeight: 220, padding: 12, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14 }} />
        </section>
      ) : null}
    </>
  );
}
