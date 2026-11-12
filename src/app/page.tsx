import { HomeScreen } from '@/components/staff/HomeScreen';
import { requireStaffPage } from '@/lib/server/auth';

export default async function Page() {
  const viewer = await requireStaffPage();
  return <HomeScreen isAdmin={viewer.role === 'admin'} />;
}
