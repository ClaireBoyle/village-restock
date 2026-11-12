import { redirect } from 'next/navigation';
import { UnlockForm } from '@/components/AuthForms';
import { getViewer } from '@/lib/server/auth';

export const metadata = { title: 'Unlock · Village Restock' };

export default async function Page() {
  if (await getViewer()) redirect('/');
  return <main className="auth"><UnlockForm /></main>;
}
