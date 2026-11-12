import { DepartmentScreen } from '@/components/staff/DepartmentScreen';
import { requireStaffPage } from '@/lib/server/auth';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage();
  const { id } = await params;
  return <DepartmentScreen id={id} />;
}
