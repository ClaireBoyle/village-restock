import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { PhotoField } from '@/components/admin/PhotoField';
import { ProductForm, type ProductFormData } from '@/components/admin/ProductForm';
import { ProductDelete } from '@/components/admin/ProductDelete';
import { setProductStatus } from '@/app/actions/admin';
import { db } from '@/lib/server/db';
import { loadFormOptions } from '../load-form-options';

export default async function EditProduct({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = db();
  const [p] = await sql`
    select p.*, d.name as department_name from products p join departments d on d.id = p.department_id where p.id = ${id}`;
  if (!p) notFound();
  const placements = await sql`select pl.check_area_id, pl.par_level, pl.location_id, a.name as area_name from product_placements pl join check_areas a on a.id = pl.check_area_id where pl.product_id = ${id}`;
  const opts = await loadFormOptions(String(p.departmentId));
  const product: ProductFormData = {
    id, name: String(p.name), categoryId: (p.categoryId as string) ?? null, unitSingular: String(p.unitSingular),
    unitPlural: String(p.unitPlural), method: p.method as ProductFormData['method'], allowDecimal: Boolean(p.allowDecimal),
    instructions: String(p.instructions), defaultLocationId: (p.defaultLocationId as string) ?? null,
    affects: (p.affects as string[]) ?? [],
    placements: placements.map((r) => ({ areaId: String(r.checkAreaId), par: r.parLevel as number | null, locationId: (r.locationId as string) ?? null })),
  };
  const archived = p.status === 'archived';

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="linkbtn" href={`/admin/products?dept=${p.departmentId}`}><Icon name="back" />Products</Link>
          <h1>{product.name}</h1>
          <p>In {String(p.departmentName)}{p.isSample ? ' · sample product' : ''}</p>
        </div>
        <form action={setProductStatus}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={archived ? 'active' : 'archived'} />
          <button className={archived ? 'btn primary' : 'btn'}><Icon name="archive" />{archived ? 'Restore to menu' : 'Archive (off the menu)'}</button>
        </form>
      </div>
      {saved ? <div className="banner s-ok" role="status"><Icon name="check" /><div><b>Product added.</b></div></div> : null}
      {archived ? <div className="banner s-none"><Icon name="archive" /><div><b>Archived</b><p>Staff don&rsquo;t see this product. Past restocks that included it are unchanged.</p></div></div> : null}
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
        <h2>Reference photo</h2>
        <PhotoField kind="product" id={id} current={(p.photoPath as string) ?? null}
          hint="Shown on the product card so staff can spot the right item. On an iPad you can take the photo straight away." />
      </section>
      <ProductForm departmentId={String(p.departmentId)} product={product} {...opts} />
      <ProductDelete id={id} name={product.name} areas={placements.map((r) => String(r.areaName))} />
    </>
  );
}
