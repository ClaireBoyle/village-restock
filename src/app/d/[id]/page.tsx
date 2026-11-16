import { RestockApp } from '@/components/restock/RestockApp';
import { getViewer } from '@/lib/server/auth';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Admins also see "Reset restock" (the server checks again before anything is reset).
  const viewer = await getViewer();
  return <RestockApp departmentId={id} isAdmin={viewer.role === 'admin'} />;
}
