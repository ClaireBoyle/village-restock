import { redirect } from 'next/navigation';
import { SetupForm } from '@/components/AuthForms';
import { adminCount } from '@/lib/server/auth';

export const metadata = { title: 'Set up · Village Restock' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  if ((await adminCount()) > 0) redirect('/admin/login');
  return <main className="auth"><SetupForm /></main>;
}
