import { Icon, type IconName } from '@/components/Icon';
import { ActionForm, SubmitButton } from '@/components/admin/ActionForm';
import { saveInsightSettings } from '@/app/actions/admin';
import { insightSettings, stockInsights, type Insight, type Kind } from '@/lib/server/insights';

export const dynamic = 'force-dynamic';

const KIND: Record<Kind, { label: string; icon: IconName; cls: string }> = {
  recurring_shortage: { label: 'Recurring storeroom shortage', icon: 'warn', cls: 's-bad' },
  defrost_shortfall: { label: 'Defrost shortfall', icon: 'clock', cls: 's-bad' },
  outpacing: { label: 'Demand may be outpacing orders', icon: 'up', cls: 's-warn' },
  over_defrost: { label: 'Possible over-defrosting', icon: 'archive', cls: 's-warn' },
  high_turnover: { label: 'High turnover', icon: 'sync', cls: 's-info' },
  not_collected: { label: 'Not collected (time or access)', icon: 'skip', cls: 's-none' },
};
const n = (v: number) => String(Math.round(v * 10) / 10);
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export default async function Insights() {
  const s = await insightSettings();
  const { insights, trend, products } = await stockInsights(s);
  const attention = insights.filter((i) => i.severity === 'attention');
  const watch = insights.filter((i) => i.severity === 'watch');
  const info = insights.filter((i) => i.severity === 'info');
  const maxShort = Math.max(1, ...trend.map((t) => t.short));

  return (
    <>
      <div className="page-head">
        <div><h1>Stock Insights</h1><p>Patterns from the last {s.windowDays} days of restocking and defrosting. Information only: nothing here orders stock or changes targets.</p></div>
      </div>

      <section className="ins-tiles" aria-label="Summary">
        <div className={`ins-tile ${attention.length ? 'bad' : 'ok'}`}><b>{attention.length}</b><span>need attention</span></div>
        <div className={`ins-tile ${watch.length ? 'warn' : ''}`}><b>{watch.length}</b><span>to keep an eye on</span></div>
        <div className="ins-tile"><b>{info.length}</b><span>for information</span></div>
        <div className="ins-tile"><b>{products}</b><span>products restocked</span></div>
      </section>

      <section className="panel ins-trend">
        <h2>Storeroom shortages, last 14 days</h2>
        <div className="ins-bars" role="img" aria-label={trend.map((t) => `${t.label}: ${t.short} short`).join(', ')}>
          {trend.map((t) => (
            <span key={t.day} className={t.restocks ? '' : 'none'} title={`${t.label}: ${t.short} product${t.short === 1 ? '' : 's'} short · ${t.restocks} restock${t.restocks === 1 ? '' : 's'}`}>
              <i style={{ height: `${Math.round((t.short / maxShort) * 100)}%` }} className={t.short ? 'on' : ''} />
              <small>{t.label.split(' ')[0].slice(0, 2)}</small>
            </span>
          ))}
        </div>
        <p className="meta">Each bar is the number of different products staff confirmed were short in the storeroom that day. Faded days had no restock recorded.</p>
      </section>

      {insights.length === 0 ? (
        <section className="panel"><div className="banner s-ok"><Icon name="check" /><div><b>Nothing to flag</b><p>No recurring shortages, high-turnover products or defrost issues in the last {s.windowDays} days. Insights appear as restock and defrost records build up.</p></div></div></section>
      ) : null}
      <Group title="Needs attention" items={attention} />
      <Group title="Keep an eye on" items={watch} />
      <Group title="For information" items={info} />

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>Alert thresholds</h2>
        <ActionForm action={saveInsightSettings} className="ins-form">
          <label className="field"><span>Days looked at</span><input name="windowDays" type="number" min={3} max={60} defaultValue={s.windowDays} /></label>
          <label className="field"><span>Recurring shortage: short on at least</span><input name="shortageDays" type="number" min={2} max={60} defaultValue={s.shortageDays} /><small>separate days</small></label>
          <label className="field"><span>High turnover: needed on at least</span><input name="turnoverDays" type="number" min={2} max={60} defaultValue={s.turnoverDays} /><small>days</small></label>
          <label className="field"><span>Defrost shortfall: ran out on at least</span><input name="defrostDays" type="number" min={1} max={60} defaultValue={s.defrostDays} /><small>days</small></label>
          <label className="field"><span>Over-defrosting: discarded on at least</span><input name="wasteDays" type="number" min={1} max={60} defaultValue={s.wasteDays} /><small>days</small></label>
          <div><SubmitButton>Save thresholds</SubmitButton></div>
        </ActionForm>
        <details className="meta">
          <summary style={{ cursor: 'pointer' }}>How these are worked out</summary>
          <ul style={{ marginTop: 8, lineHeight: 1.6, listStyle: 'disc', paddingLeft: 20 }}>
            <li><b>Needed</b>: the amount staff entered, or target − count, using the target saved with that restock. Routine tasks aren&rsquo;t counted.</li>
            <li><b>Storeroom shortage</b>: staff collected fewer and chose &ldquo;not enough in the storeroom&rdquo;. Not collecting because of time or access is listed separately.</li>
            <li><b>High turnover</b> just means often needed; it isn&rsquo;t treated as a problem unless shortages happen too.</li>
            <li><b>Defrost</b> signals only use what closers recorded in the Defrost Planner (ran out, discarded). Leftover stock is never assumed to be waste.</li>
            <li>Restock requests are not sales or usage figures.</li>
          </ul>
        </details>
      </section>
    </>
  );
}

function Group({ title, items }: { title: string; items: Insight[] }) {
  if (!items.length) return null;
  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2>{title} <span className="meta" style={{ fontWeight: 400 }}>{items.length}</span></h2>
      <div className="ins-list">
        {items.map((i, k) => {
          const kd = KIND[i.kind];
          return (
            <article key={`${i.kind}-${i.product}-${k}`} className={`ins-card ${kd.cls}`}>
              <header>
                <span className={`badge ${kd.cls}`}><Icon name={kd.icon} />{kd.label}</span>
                <h3>{i.product}</h3>
                <p className="meta">{i.department}{i.kind === 'recurring_shortage' || i.kind === 'outpacing' || i.kind === 'high_turnover' || i.kind === 'not_collected'
                  ? ` · needed ${n(i.requested)} ${i.unit}, collected ${n(i.collected)}` : i.kind === 'over_defrost' ? ` · ${n(i.collected)} of ${n(i.requested)} ${i.unit} discarded` : ''}</p>
              </header>
              <p className="ins-why"><b>Why:</b> {i.why}</p>
              <p className="ins-act"><Icon name="next" />{i.action}</p>
              {i.history.length ? (
                <details>
                  <summary className="linkbtn" style={{ cursor: 'pointer' }}>Recent history</summary>
                  <table className="ins-table">
                    <thead><tr><th>Day</th><th>Needed</th><th>Collected</th><th>Note</th></tr></thead>
                    <tbody>{i.history.map((h) => (
                      <tr key={h.date} className={h.reason === 'Not enough in storeroom' ? 'short' : ''}><td>{day(h.date)}</td><td>{n(h.requested)}</td><td>{h.collected === null ? '–' : n(h.collected)}</td><td>{h.reason ?? ''}</td></tr>
                    ))}</tbody>
                  </table>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
