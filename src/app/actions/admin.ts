'use server';
// Every admin change goes through these server actions. Each one:
//   1. checks the caller is a signed-in, active admin,
//   2. validates the input on the server (never trusting the browser),
//   3. writes to the database, and
//   4. refreshes the admin pages.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/server/db';
import { hashSecret, requireAdmin } from '@/lib/server/auth';

export type ActionResult = { ok?: boolean; error?: string; message?: string } | undefined;

const uuid = z.uuid('Something went wrong: invalid id.');
const optUuid = z.preprocess((v) => (v === '' || v == null ? null : v), uuid.nullable());
const text = (max: number, label: string) => z.string().trim().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`);
const optText = (max: number) => z.string().trim().max(max).default('');
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

function fail(e: unknown): ActionResult {
  const code = (e as { code?: string })?.code;
  if (code === '23505') return { error: 'That name is already used. Choose a different name.' };
  if (code === '23514') return { error: 'One of the values isn’t allowed. Check the form and try again.' };
  console.error(e);
  return { error: 'Couldn’t save. Please try again.' };
}

function firstIssue(err: z.ZodError): ActionResult {
  return { error: err.issues[0]?.message ?? 'Check the form and try again.' };
}

function done(message: string): ActionResult {
  revalidatePath('/admin', 'layout');
  return { ok: true, message };
}

async function nextSort(table: 'departments' | 'check_areas' | 'categories' | 'storage_locations' | 'products', scope?: { col: 'department_id'; id: string }) {
  const sql = db();
  const rows = scope
    ? await sql`select coalesce(max(sort_order), 0) + 1 as n from ${sql(table)} where ${sql(scope.col)} = ${scope.id}`
    : await sql`select coalesce(max(sort_order), 0) + 1 as n from ${sql(table)}`;
  return Number(rows[0].n);
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------
const departmentSchema = z.object({
  id: optUuid,
  name: text(60, 'Name'),
  shortName: text(30, 'Short name'),
  groupLabel: optText(30),
  theme: z.enum(['village', 'gold']),
  icon: z.enum(['bar', 'kitchen', 'candy', 'box']),
  description: optText(160),
  active: checkbox,
});

export async function saveDepartment(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = departmentSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const d = p.data;
  try {
    if (d.id) {
      await db()`update departments set name = ${d.name}, short_name = ${d.shortName}, group_label = ${d.groupLabel},
        theme = ${d.theme}, icon = ${d.icon}, description = ${d.description}, active = ${d.active} where id = ${d.id}`;
      return done('Department saved.');
    }
    const sort = await nextSort('departments');
    await db()`insert into departments (name, short_name, group_label, theme, icon, description, sort_order)
      values (${d.name}, ${d.shortName}, ${d.groupLabel}, ${d.theme}, ${d.icon}, ${d.description}, ${sort})`;
    return done(`${d.name} added.`);
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Checking areas, categories, storerooms
// ---------------------------------------------------------------------------
const areaSchema = z.object({
  id: optUuid, departmentId: uuid, name: text(60, 'Area name'), guideText: optText(600), active: checkbox,
});

export async function saveArea(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = areaSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const a = p.data;
  try {
    if (a.id) {
      await db()`update check_areas set name = ${a.name}, guide_text = ${a.guideText}, active = ${a.active}
        where id = ${a.id} and department_id = ${a.departmentId}`;
      return done('Area saved.');
    }
    const sort = await nextSort('check_areas', { col: 'department_id', id: a.departmentId });
    await db()`insert into check_areas (department_id, name, guide_text, sort_order) values (${a.departmentId}, ${a.name}, ${a.guideText}, ${sort})`;
    return done(`${a.name} added.`);
  } catch (e) { return fail(e); }
}

const categorySchema = z.object({ id: optUuid, departmentId: uuid, name: text(40, 'Category name'), active: checkbox });

export async function saveCategory(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = categorySchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const c = p.data;
  try {
    if (c.id) {
      await db()`update categories set name = ${c.name}, active = ${c.active} where id = ${c.id} and department_id = ${c.departmentId}`;
      return done('Category saved.');
    }
    const sort = await nextSort('categories', { col: 'department_id', id: c.departmentId });
    await db()`insert into categories (department_id, name, sort_order) values (${c.departmentId}, ${c.name}, ${sort})`;
    return done(`${c.name} added.`);
  } catch (e) { return fail(e); }
}

const locationSchema = z.object({ id: optUuid, name: text(60, 'Storeroom name'), active: checkbox });

export async function saveLocation(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = locationSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const l = p.data;
  try {
    if (l.id) {
      await db()`update storage_locations set name = ${l.name}, active = ${l.active} where id = ${l.id}`;
      return done('Storeroom saved.');
    }
    const sort = await nextSort('storage_locations');
    await db()`insert into storage_locations (name, sort_order) values (${l.name}, ${sort})`;
    return done(`${l.name} added.`);
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Reordering (up/down buttons; easier than drag-and-drop on an iPad)
// ---------------------------------------------------------------------------
const MOVABLE = {
  department: { table: 'departments', scope: null },
  area: { table: 'check_areas', scope: 'department_id' },
  category: { table: 'categories', scope: 'department_id' },
  location: { table: 'storage_locations', scope: null },
  product: { table: 'products', scope: 'department_id' },
  placement: { table: 'product_placements', scope: 'check_area_id' },
} as const;

const moveSchema = z.object({ kind: z.enum(Object.keys(MOVABLE) as [keyof typeof MOVABLE, ...(keyof typeof MOVABLE)[]]), id: uuid, dir: z.enum(['up', 'down']) });

export async function moveItem(form: FormData): Promise<void> {
  await requireAdmin();
  const p = moveSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return;
  const { table, scope } = MOVABLE[p.data.kind];
  const sql = db();
  await sql.begin(async (tx) => {
    const [me] = await tx`select * from ${tx(table)} where id = ${p.data.id}`;
    if (!me) return;
    const scopeVal = scope ? (me as Record<string, unknown>)[scope.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())] : null;
    const siblings = p.data.kind === 'placement'
      ? await tx`select pl.id from product_placements pl join products pr on pr.id = pl.product_id and pr.status = 'active'
          where pl.check_area_id = ${String(scopeVal)} order by pl.sort_order, pl.created_at for update of pl`
      : scope
      ? await tx`select id from ${tx(table)} where ${tx(scope)} = ${String(scopeVal)} order by sort_order, created_at for update`
      : await tx`select id from ${tx(table)} order by sort_order, created_at for update`;
    const ids = siblings.map((r) => String(r.id));
    const i = ids.indexOf(p.data.id);
    const j = p.data.dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    for (let k = 0; k < ids.length; k++) {
      await tx`update ${tx(table)} set sort_order = ${k + 1} where id = ${ids[k]}`;
    }
  });
  revalidatePath('/admin', 'layout');
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
const productSchema = z.object({
  id: optUuid,
  departmentId: uuid,
  categoryId: optUuid,
  name: text(80, 'Product name'),
  unitSingular: text(30, 'Unit (one)'),
  unitPlural: text(30, 'Unit (more than one)'),
  method: z.enum(['par', 'manual', 'routine']),
  allowDecimal: checkbox,
  instructions: optText(400),
  defaultLocationId: optUuid,
});

const parValue = (raw: FormDataEntryValue | null, allowDecimal: boolean): number | null | string => {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 9999) return 'Target levels must be numbers from 0 to 9999.';
  if (!allowDecimal && !Number.isInteger(n)) return 'Target levels must be whole numbers unless “Allow decimals” is ticked.';
  return Math.round(n * 100) / 100;
};

export async function saveProduct(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = productSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const d = p.data;

  // Placements: one per ticked area, each with its own target and optional storeroom.
  const areaIds = form.getAll('area').map(String);
  if (areaIds.length === 0) return { error: 'Tick at least one area where staff check this product.' };
  const placements: { areaId: string; par: number | null; locationId: string | null }[] = [];
  for (const areaId of areaIds) {
    if (!uuid.safeParse(areaId).success) return { error: 'Something went wrong with the areas. Reload and try again.' };
    const par = parValue(form.get(`par_${areaId}`), d.allowDecimal);
    if (typeof par === 'string') return { error: par };
    if (d.method === 'par' && par === null) return { error: 'Enter a target level for every ticked area (or choose a different restock method).' };
    const loc = String(form.get(`loc_${areaId}`) ?? '');
    placements.push({ areaId, par: d.method === 'par' ? par : null, locationId: loc && uuid.safeParse(loc).success ? loc : null });
  }
  if (!d.defaultLocationId && placements.some((pl) => !pl.locationId)) {
    return { error: 'Choose where staff collect this product from (the storeroom).' };
  }

  const sql = db();
  try {
    // Areas and category must belong to the product's department.
    const validAreas = await sql`select id from check_areas where department_id = ${d.departmentId} and id in ${sql(areaIds)}`;
    if (validAreas.length !== areaIds.length) return { error: 'One of the areas belongs to a different department.' };
    if (d.categoryId) {
      const c = await sql`select 1 from categories where id = ${d.categoryId} and department_id = ${d.departmentId}`;
      if (!c.length) return { error: 'That category belongs to a different department.' };
    }

    const productId = await sql.begin(async (tx) => {
      let id = d.id;
      if (id) {
        const [row] = await tx`update products set category_id = ${d.categoryId}, name = ${d.name}, unit_singular = ${d.unitSingular},
          unit_plural = ${d.unitPlural}, method = ${d.method}, allow_decimal = ${d.allowDecimal}, instructions = ${d.instructions},
          default_location_id = ${d.defaultLocationId}
          where id = ${id} and department_id = ${d.departmentId} returning id`;
        if (!row) throw Object.assign(new Error('not found'), { code: 'NOTFOUND' });
      } else {
        const [{ n }] = await tx`select coalesce(max(sort_order), 0) + 1 as n from products where department_id = ${d.departmentId}`;
        const [row] = await tx`insert into products (department_id, category_id, name, unit_singular, unit_plural, method, allow_decimal,
          instructions, default_location_id, sort_order)
          values (${d.departmentId}, ${d.categoryId}, ${d.name}, ${d.unitSingular}, ${d.unitPlural}, ${d.method}, ${d.allowDecimal},
          ${d.instructions}, ${d.defaultLocationId}, ${Number(n)}) returning id`;
        id = String(row.id);
      }
      await tx`delete from product_placements where product_id = ${id} and not (check_area_id in ${tx(areaIds)})`;
      for (const pl of placements) {
        const [{ n }] = await tx`select coalesce(max(sort_order), 0) + 1 as n from product_placements where check_area_id = ${pl.areaId}`;
        await tx`insert into product_placements (product_id, check_area_id, par_level, location_id, sort_order)
          values (${id}, ${pl.areaId}, ${pl.par}, ${pl.locationId}, ${Number(n)})
          on conflict (product_id, check_area_id) do update set par_level = excluded.par_level, location_id = excluded.location_id`;
      }
      return id;
    });
    revalidatePath('/admin', 'layout');
    if (!d.id) redirect(`/admin/products/${productId}?saved=1`);
    return { ok: true, message: `${d.name} saved.` };
  } catch (e) {
    if ((e as { code?: string }).code === 'NOTFOUND') return { error: 'That product no longer exists.' };
    if ((e as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw e;
    return fail(e);
  }
}

export async function setProductStatus(form: FormData): Promise<void> {
  await requireAdmin();
  const id = uuid.safeParse(form.get('id'));
  const status = z.enum(['active', 'archived']).safeParse(form.get('status'));
  if (!id.success || !status.success) return;
  await db()`update products set status = ${status.data} where id = ${id.data}`;
  revalidatePath('/admin', 'layout');
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
export async function removeSampleData(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  if (form.get('confirm') !== 'REMOVE') return { error: 'Type REMOVE in capitals to confirm.' };
  const sql = db();
  const r = await sql.begin(async (tx) => {
    const products = await tx`delete from products where is_sample returning id`;
    const categories = await tx`delete from categories c where c.is_sample and not exists (select 1 from products p where p.category_id = c.id) returning id`;
    const areas = await tx`delete from check_areas a where a.is_sample and not exists (select 1 from product_placements pl where pl.check_area_id = a.id) returning id`;
    const departments = await tx`delete from departments d where d.is_sample
      and not exists (select 1 from products p where p.department_id = d.id)
      and not exists (select 1 from check_areas a where a.department_id = d.id) returning id`;
    const locations = await tx`delete from storage_locations l where l.is_sample
      and not exists (select 1 from products p where p.default_location_id = l.id)
      and not exists (select 1 from product_placements pl where pl.location_id = l.id) returning id`;
    // Anything kept because real data now uses it stops being labelled as sample.
    await tx`update departments set is_sample = false where is_sample`;
    await tx`update check_areas set is_sample = false where is_sample`;
    await tx`update categories set is_sample = false where is_sample`;
    await tx`update storage_locations set is_sample = false where is_sample`;
    return { products: products.length, categories: categories.length, areas: areas.length, departments: departments.length, locations: locations.length };
  });
  revalidatePath('/admin', 'layout');
  // The sample-data panel disappears once it's done, so show the result on the overview instead.
  redirect(`/admin?removed=${[r.products, r.areas, r.categories, r.departments, r.locations].join('-')}`);
}

// ---------------------------------------------------------------------------
// Admin accounts
// ---------------------------------------------------------------------------
const newAdminSchema = z.object({
  name: text(40, 'Name'),
  email: z.email('Enter a valid email address.'),
  password: z.string().min(10, 'Use at least 10 characters for the password.').max(200),
});

export async function addAdmin(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = newAdminSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  try {
    await db()`insert into admins (email, display_name, password_hash) values (${p.data.email.trim()}, ${p.data.name}, ${await hashSecret(p.data.password)})`;
    return done(`${p.data.name} can now sign in. Give them the password in person and ask them to change it.`);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { error: 'There is already an admin with that email.' };
    return fail(e);
  }
}

export async function setAdminActive(form: FormData): Promise<void> {
  const me = await requireAdmin();
  const id = uuid.safeParse(form.get('id'));
  if (!id.success || id.data === me.adminId) return; // you can't lock yourself out
  await db()`update admins set active = ${form.get('active') === 'true'} where id = ${id.data}`;
  revalidatePath('/admin', 'layout');
}

export async function changeMyPassword(_: ActionResult, form: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const password = String(form.get('password') ?? '');
  if (password.length < 10) return { error: 'Use at least 10 characters for the password.' };
  if (password !== String(form.get('confirm') ?? '')) return { error: 'The two passwords don’t match.' };
  await db()`update admins set password_hash = ${await hashSecret(password)} where id = ${me.adminId}`;
  return done('Your password has been changed.');
}

export async function adminSignOut(): Promise<void> {
  const { clearSession } = await import('@/lib/server/auth');
  await clearSession();
  redirect('/');
}
