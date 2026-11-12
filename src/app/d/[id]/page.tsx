import { RestockApp } from '@/components/restock/RestockApp';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RestockApp departmentId={id} />;
}
