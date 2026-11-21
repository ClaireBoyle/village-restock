import { PrepChecklist } from '@/components/prep/PrepChecklist';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrepChecklist departmentId={id} />;
}
