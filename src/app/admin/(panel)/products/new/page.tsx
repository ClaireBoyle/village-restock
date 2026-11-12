import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { ProductForm } from '@/components/admin/ProductForm';
import { db } from '@/lib/server/db';
import { loadFormOptions } from '../load-form-options';

export default async function NewProduct({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  if (!dept || !/^[0-9a-f-]{36}$/i.test(dept)) notFound();
  const [d] = await db()`select id, name from departments where id = ${dept}`;
  if (!d) notFound();
  const opts = await loadFormOptions(dept);
  return (
    <>
      <div className="page-head"><div>
        <Link className="linkbtn" href={`/admin/products?dept=${dept}`}><Icon name="back" />Products</Link>
        <h1>New product</h1><p>In {String(d.name)}</p>
      </div></div>
      <ProductForm departmentId={dept} {...opts} />
    </>
  );
}
