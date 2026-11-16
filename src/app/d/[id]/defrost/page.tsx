import { DefrostPlanner } from '@/components/defrost/DefrostPlanner';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DefrostPlanner departmentId={id} />;
}
