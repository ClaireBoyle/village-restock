import { redirect } from 'next/navigation';
import { AdminSignInForm } from '@/components/AuthForms';
import { adminCount, getViewer } from '@/lib/server/auth';

export const metadata = { title: 'Admin sign in · Village Restock' };

export default async function Page() {
  const v = await getViewer();
  if (v?.role === 'admin') redirect('/admin');
  if ((await adminCount()) === 0) redirect('/admin/setup');
  return <main className="auth"><AdminSignInForm /></main>;
}
