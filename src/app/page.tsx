import { HomeScreen } from '@/components/staff/HomeScreen';
import { getViewer } from '@/lib/server/auth';

export default async function Page() {
  const viewer = await getViewer();
  return <HomeScreen isAdmin={viewer.role === 'admin'} />;
}
