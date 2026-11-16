import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { TestActivityForm } from '@/components/admin/TestActivityForm';
import { listActivity, listDefrostActivity, resetsReady } from '@/lib/server/reset';
import { requireAdmin } from '@/lib/server/auth';
import { loadCatalogue } from '@/lib/server/catalogue';

export const dynamic = 'force-dynamic';

export default async function TestActivity() {
  await requireAdmin();
  const ready = await resetsReady();
  const [restocks, defrost, cat] = await Promise.all([listActivity(60), listDefrostActivity(60), loadCatalogue()]);
  return (
    <>
      <div className="page-head"><div>
        <Link className="linkbtn" href="/admin/settings"><Icon name="back" />Access &amp; settings</Link>
        <h1>Clear test activity</h1>
        <p>For use before staff start using Village Restock. Review the restocks and Defrost Planner records from testing, tick only the ones to remove, and confirm.</p>
      </div></div>
      {!ready ? (
        <div className="banner s-warn"><Icon name="warn" /><div><b>Run db/migrations/010_restock_resets.sql in Supabase first</b>
          <p>It records what was cleared, so devices that still hold a copy drop it instead of uploading it again.</p></div></div>
      ) : null}
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="banner s-info"><Icon name="info" /><div><b>What clearing removes</b>
          <p>The selected restocks with everything entered and collected, their shortages and manager email records, and the selected Defrost Planner records. They disappear from Restocks, Shortages and Stock Insights, and from every device.</p>
          <p>Products, photos, areas, storerooms, targets, defrost settings and admins are never changed.</p></div></div>
        <TestActivityForm restocks={restocks} defrost={defrost} timeZone={cat.settings.timeZone} disabled={!ready} />
      </section>
    </>
  );
}
