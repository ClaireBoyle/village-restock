import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { TopBar } from '@/components/TopBar';
import { AdminNav } from '@/components/admin/AdminNav';
import { adminSignOut } from '@/app/actions/admin';
import { requireAdmin } from '@/lib/server/auth';

export const metadata = { title: 'Admin · Village Restock' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdmin();
  return (
    <>
      <TopBar
        title="Village Restock Admin"
        crumbs={`Signed in as ${me.name}`}
        right={
          <>
            <Link className="pill" href="/"><Icon name="home" />Staff app</Link>
            <form action={adminSignOut}><button className="pill"><Icon name="out" />Sign out</button></form>
          </>
        }
      />
      <div className="wrap admin-shell">
        <AdminNav />
        <main className="admin-main">{children}</main>
      </div>
    </>
  );
}
