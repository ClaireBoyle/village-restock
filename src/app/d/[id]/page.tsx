import { DepartmentScreen } from '@/components/staff/DepartmentScreen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DepartmentScreen id={id} />;
}
