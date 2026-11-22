'use server';
// Every admin change goes through these server actions. Each one:
//   1. checks the caller is a signed-in, active admin,
//   2. validates the input on the server (never trusting the browser),
//   3. writes to the database, and
//   4. refreshes the admin pages.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db, setSetting } from '@/lib/server/db';
import { parseTargets } from '@/lib/defrost-rows';
import type { ReadyTarget } from '@/lib/catalogue-types';
import type postgres from 'postgres';
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
  restockByArea: checkbox,
  noneOnDisplay: checkbox,
  noneLeftCheck: checkbox,
  emailEveryRestock: checkbox,
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
      if (await hasColumn('departments', 'restock_by_area')) await db()`update departments set restock_by_area = ${d.restockByArea} where id = ${d.id}`;
      else if (d.restockByArea) return { error: 'Run db/migrations/009_area_restocks.sql in Supabase first, then try again.' };
      if (await hasColumn('departments', 'none_on_display')) await db()`update departments set none_on_display = ${d.noneOnDisplay} where id = ${d.id}`;
      else if (d.noneOnDisplay) return { error: 'Run db/migrations/013_none_on_display.sql in Supabase first, then try again.' };
      if (await hasColumn('departments', 'none_left_check')) await db()`update departments set none_left_check = ${d.noneLeftCheck} where id = ${d.id}`;
      else if (d.noneLeftCheck) return { error: 'Run db/migrations/020_none_left_here.sql in Supabase first, then try again.' };
      if (await hasColumn('departments', 'email_every_restock')) await db()`update departments set email_every_restock = ${d.emailEveryRestock} where id = ${d.id}`;
      else if (d.emailEveryRestock) return { error: 'Run db/migrations/014_email_every_restock.sql in Supabase first, then try again.' };
      return done('Department saved.');
    }
    const sort = await nextSort('departments');
    const [row] = await db()`insert into departments (name, short_name, group_label, theme, icon, description, sort_order)
      values (${d.name}, ${d.shortName}, ${d.groupLabel}, ${d.theme}, ${d.icon}, ${d.description}, ${sort}) returning id`;
    if (d.restockByArea && await hasColumn('departments', 'restock_by_area')) await db()`update departments set restock_by_area = true where id = ${String(row.id)}`;
    if (d.noneOnDisplay && await hasColumn('departments', 'none_on_display')) await db()`update departments set none_on_display = true where id = ${String(row.id)}`;
    if (d.noneLeftCheck && await hasColumn('departments', 'none_left_check')) await db()`update departments set none_left_check = true where id = ${String(row.id)}`;
    if (d.emailEveryRestock && await hasColumn('departments', 'email_every_restock')) await db()`update departments set email_every_restock = true where id = ${String(row.id)}`;
    return done(`${d.name} added.`);
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Checking areas, categories, storerooms
// ---------------------------------------------------------------------------
const areaSchema = z.object({
  id: optUuid, departmentId: uuid, name: text(60, 'Area name'), guideText: optText(600), active: checkbox,
  parentAreaId: optUuid.optional(), sectionMode: z.enum(['open', 'collapsed', 'optional', 'side']).optional(),
});

export async function saveArea(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = areaSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const a = p.data;
  try {
    const sql = db();
    // Sections (migration 008): an area can sit inside another area's screen.
    const [{ has }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'check_areas' and column_name = 'parent_area_id') as has`;
    const parent = has && a.parentAreaId ? a.parentAreaId : null;
    if (parent) {
      if (parent === a.id) return { error: 'An area can’t be a section of itself.' };
      const [pa] = await sql`select parent_area_id from check_areas where id = ${parent} and department_id = ${a.departmentId}`;
      if (!pa) return { error: 'That area belongs to a different department.' };
      if (pa.parentAreaId) return { error: 'Sections can’t have their own sections. Choose an area that isn’t a section.' };
      if (a.id) {
        const kids = await sql`select 1 from check_areas where parent_area_id = ${a.id} limit 1`;
        if (kids.length) return { error: 'This area has sections of its own, so it can’t become a section.' };
      }
    }
    if (a.id) {
      await sql`update check_areas set name = ${a.name}, guide_text = ${a.guideText}, active = ${a.active}
        where id = ${a.id} and department_id = ${a.departmentId}`;
      if (has) await sql`update check_areas set parent_area_id = ${parent}, section_mode = ${a.sectionMode ?? 'collapsed'} where id = ${a.id}`;
      revalidatePath('/admin', 'layout');
      return done('Area saved.');
    }
    const sort = await nextSort('check_areas', { col: 'department_id', id: a.departmentId });
    const [row] = await sql`insert into check_areas (department_id, name, guide_text, sort_order) values (${a.departmentId}, ${a.name}, ${a.guideText}, ${sort}) returning id`;
    if (has && parent) await sql`update check_areas set parent_area_id = ${parent}, section_mode = ${a.sectionMode ?? 'collapsed'} where id = ${String(row.id)}`;
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

const locationSchema = z.object({ id: optUuid, name: text(60, 'Storeroom name'), active: checkbox, collectNote: optText(200).optional() });

async function hasColumn(table: string, column: string) {
  const [{ has }] = await db()`select exists (select 1 from information_schema.columns where table_name = ${table} and column_name = ${column}) as has`;
  return Boolean(has);
}

export async function saveLocation(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = locationSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const l = p.data;
  try {
    if (l.id) {
      await db()`update storage_locations set name = ${l.name}, active = ${l.active} where id = ${l.id}`;
      if (l.collectNote !== undefined && await hasColumn('storage_locations', 'collect_note')) await db()`update storage_locations set collect_note = ${l.collectNote} where id = ${l.id}`;
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
  prepTask: { table: 'prep_tasks', scope: 'department_id' },
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
    // One statement for the whole list (a round trip per row was several seconds on the live database).
    await tx`update ${tx(table)} t set sort_order = x.k from unnest(${ids}::uuid[]) with ordinality as x(id, k)
      where t.id = x.id and t.sort_order is distinct from x.k`;
  });
  revalidatePath('/admin', 'layout');
}

// ---------------------------------------------------------------------------
// Morning prep checklist (Gold Class Kitchen)
// ---------------------------------------------------------------------------
const prepTaskSchema = z.object({
  id: optUuid, departmentId: uuid, name: text(80, 'Task'),
  group: z.enum(['vegetables', 'proteins', 'sauces', 'other']), active: checkbox,
  // Prep checklist (migration 021): shown there, under which group, with which short name.
  onChecklist: checkbox, checklistGroup: optText(60), checklistName: optText(80),
});

export async function savePrepTask(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = prepTaskSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const t = p.data;
  const sql = db();
  try {
    if (!(await sql`select to_regclass('public.prep_tasks') is not null as ok`)[0].ok) return { error: 'Run db/migrations/017_morning_prep.sql first.' };
    if (t.id) {
      const r = await sql`update prep_tasks set name = ${t.name}, grp = ${t.group}, active = ${t.active} where id = ${t.id} and department_id = ${t.departmentId} returning id`;
      if (!r.length) return { error: 'That task no longer exists.' };
      if (await hasColumn('prep_tasks', 'on_checklist')) {
        await sql`update prep_tasks set on_checklist = ${t.onChecklist}, checklist_group = ${t.checklistGroup || null}, checklist_name = ${t.checklistName || null} where id = ${t.id}`;
      } else if (t.onChecklist && (t.checklistGroup || t.checklistName)) return { error: 'Run db/migrations/021_prep_checklist.sql in Supabase first, then try again.' };
      return done('Task saved.');
    }
    const [{ n }] = await sql`select coalesce(max(sort_order), 0) + 1 as n from prep_tasks where department_id = ${t.departmentId}`;
    const [row] = await sql`insert into prep_tasks (department_id, grp, name, sort_order) values (${t.departmentId}, ${t.group}, ${t.name}, ${Number(n)}) returning id`;
    if (await hasColumn('prep_tasks', 'on_checklist')) {
      await sql`update prep_tasks set on_checklist = ${t.onChecklist}, checklist_group = ${t.checklistGroup || null}, checklist_name = ${t.checklistName || null} where id = ${String(row.id)}`;
    }
    return done(`${t.name} added.`);
  } catch (e) { return fail(e); }
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

/** Migration 024 adds the collection reminder and storeroom spot; until it runs, products save without them. */
let hasCollectColumns = false;
async function collectColumns(sql: postgres.Sql<Record<string, unknown>> | postgres.TransactionSql<Record<string, unknown>>): Promise<boolean> {
  if (!hasCollectColumns) {
    hasCollectColumns = (await sql`select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'collect_note'`).length > 0;
  }
  return hasCollectColumns;
}

/** Migration 016 adds the defrost details; until it runs, products still save (without them). */
let hasDefrostColumns = false;
async function defrostColumns(sql: postgres.Sql<Record<string, unknown>> | postgres.TransactionSql<Record<string, unknown>>): Promise<boolean> {
  if (!hasDefrostColumns) {
    hasDefrostColumns = (await sql`select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'ready_targets'`).length > 0;
  }
  return hasDefrostColumns;
}

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
  // Defrost details ("staff enter" products only): notes, the unit what's ready is counted in, and admits targets.
  const defrost = new Map<string, { grab: string | null; fallback: string | null; put: string | null; rus: string | null; rup: string | null; per: number | null; targets: ReadyTarget[] }>();
  if (d.method === 'manual') {
    for (const areaId of areaIds) {
      const t = (k: string, max: number) => { const v = String(form.get(`${k}_${areaId}`) ?? '').trim(); return v ? v.slice(0, max) : null; };
      if (!form.has(`grab_${areaId}`)) continue; // an older form without them: leave them as they are
      const rus = t('rus', 30), rup = t('rup', 30);
      if (!!rus !== !!rup) return { error: 'Give both words for the unit what\u2019s ready is counted in (e.g. portion and portions), or leave both blank.' };
      const perText = t('rper', 12);
      const per = perText === null ? null : Number(perText.replace(',', '.'));
      if (per !== null && (!Number.isFinite(per) || per <= 0 || per > 9999)) return { error: 'How many in one: enter a number above 0, e.g. 8.' };
      const tg = parseTargets(String(form.get(`tgt_${areaId}`) ?? ''));
      if (!tg.ok) return { error: `Ready-stock targets: ${tg.message}` };
      defrost.set(areaId, { grab: t('grab', 300), fallback: t('fallback', 300), put: t('put', 300), rus, rup, per, targets: tg.targets });
    }
  }
  const affects = [...new Set(String(form.get('affects') ?? '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean))];
  if (affects.length > 10) return { error: 'List at most 10 menu items.' };
  if (affects.some((x) => x.length > 60)) return { error: 'Menu item names must be 60 characters or fewer.' };
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
          default_location_id = ${d.defaultLocationId}, affects = ${affects}
          where id = ${id} and department_id = ${d.departmentId} returning id`;
        if (!row) throw Object.assign(new Error('not found'), { code: 'NOTFOUND' });
      } else {
        const [{ n }] = await tx`select coalesce(max(sort_order), 0) + 1 as n from products where department_id = ${d.departmentId}`;
        const [row] = await tx`insert into products (department_id, category_id, name, unit_singular, unit_plural, method, allow_decimal,
          instructions, default_location_id, sort_order, affects)
          values (${d.departmentId}, ${d.categoryId}, ${d.name}, ${d.unitSingular}, ${d.unitPlural}, ${d.method}, ${d.allowDecimal},
          ${d.instructions}, ${d.defaultLocationId}, ${Number(n)}, ${affects}) returning id`;
        id = String(row.id);
      }
      await tx`delete from product_placements where product_id = ${id} and not (check_area_id in ${tx(areaIds)})`;
      for (const pl of placements) {
        const [{ n }] = await tx`select coalesce(max(sort_order), 0) + 1 as n from product_placements where check_area_id = ${pl.areaId}`;
        await tx`insert into product_placements (product_id, check_area_id, par_level, location_id, sort_order)
          values (${id}, ${pl.areaId}, ${pl.par}, ${pl.locationId}, ${Number(n)})
          on conflict (product_id, check_area_id) do update set par_level = excluded.par_level, location_id = excluded.location_id`;
        if (form.has(`cnote_${pl.areaId}`) && await collectColumns(tx)) {
          const note = String(form.get(`cnote_${pl.areaId}`) ?? '').trim().slice(0, 120) || null;
          await tx`update product_placements set collect_note = ${d.method === 'routine' ? null : note} where product_id = ${id} and check_area_id = ${pl.areaId}`;
        }
        const df = defrost.get(pl.areaId);
        if (df && await defrostColumns(tx)) {
          await tx`update product_placements set grab_note = ${df.grab}, fallback_note = ${df.fallback}, put_note = ${df.put},
            ready_unit_singular = ${df.rus}, ready_unit_plural = ${df.rup}, ready_per = ${df.per}, ready_targets = ${tx.json(df.targets as unknown as Parameters<typeof tx.json>[0])}
            where product_id = ${id} and check_area_id = ${pl.areaId}`;
        }
      }
      if (form.has('collectReminder') && await collectColumns(tx)) {
        const reminder = String(form.get('collectReminder') ?? '').trim().slice(0, 120) || null;
        await tx`update products set collect_reminder = ${d.method === 'routine' ? null : reminder} where id = ${id}`;
      }
      return id;
    });
    revalidatePath('/admin', 'layout');
    if (!d.id) redirect(`/admin/products/${productId}?saved=1`);
    // Changes saved: back to all the products, at this one.
    redirect(`/admin/products?dept=${d.departmentId}&saved=${encodeURIComponent(d.name)}&at=${productId}`);
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

/**
 * Permanently delete a product (admins only). It disappears from every checking area and from
 * staff devices on their next catalogue update. Past restocks, shortages and reports keep their
 * own copy of the name and amounts, so history is unchanged. Its photo goes too if nothing else uses it.
 */
export async function deleteProduct(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = uuid.safeParse(form.get('id'));
  if (!id.success) return { error: 'Something went wrong. Reload and try again.' };
  if (form.get('understand') !== 'on') return { error: 'Tick the box to confirm you want to delete this product permanently.' };
  const [p] = await db()`delete from products where id = ${id.data} returning name, photo_path, department_id`;
  if (!p) return { error: 'That product no longer exists.' };
  const { deletePhotoIfUnused } = await import('@/lib/server/photos');
  await deletePhotoIfUnused((p.photoPath as string) ?? null).catch(() => undefined);
  revalidatePath('/admin', 'layout');
  redirect(`/admin/products?dept=${String(p.departmentId)}&deleted=${encodeURIComponent(String(p.name))}`);
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
// Shortages
// ---------------------------------------------------------------------------
export async function resolveShortage(form: FormData): Promise<void> {
  const me = await requireAdmin();
  const id = uuid.safeParse(form.get('id'));
  if (!id.success) return;
  const note = String(form.get('note') ?? '').trim().slice(0, 200) || null;
  if (form.get('reopen') === 'true') {
    await db()`update shortages set status = 'open', resolved_at = null, resolved_by = null, resolution_note = null where id = ${id.data}`;
  } else {
    await db()`update shortages set status = 'resolved', resolved_at = now(), resolved_by = ${me.name}, resolution_note = ${note} where id = ${id.data}`;
  }
  revalidatePath('/admin', 'layout');
}

// ---------------------------------------------------------------------------
// Manager email
// ---------------------------------------------------------------------------
export async function saveManagerEmail(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const to = String(form.get('to') ?? '').trim();
  const enabled = form.get('enabled') === 'on';
  if (to && !z.email().safeParse(to).success) return { error: 'Enter a valid email address.' };
  if (enabled && !to) return { error: 'Enter the managers\u2019 email address first.' };
  await setSetting('manager_email', to);
  await setSetting('manager_email_enabled', enabled);
  return done(enabled ? `Emails will go to ${to} after every finished full restock.` : 'Manager emails are switched off.');
}

export async function retryEmailAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = uuid.safeParse(form.get('id'));
  if (!id.success) return;
  const { retryEmail } = await import('@/lib/server/email');
  await retryEmail(id.data);
  revalidatePath('/admin', 'layout');
}

export async function sendTestEmailAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const to = String(form.get('to') ?? '').trim();
  if (!z.email().safeParse(to).success) return { error: 'Save a valid email address first.' };
  try {
    const { sendTestEmail } = await import('@/lib/server/email');
    await sendTestEmail(to);
    return { ok: true, message: `Test email sent to ${to}. Check the inbox (and junk folder).` };
  } catch (e) {
    return { error: `Couldn\u2019t send: ${(e as Error).message}` };
  }
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

// ---------------------------------------------------------------------------
// Reference photos (products and checking areas)
// ---------------------------------------------------------------------------
export async function setPhoto(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const kind = form.get('kind');
  const id = uuid.safeParse(form.get('id'));
  if ((kind !== 'product' && kind !== 'area') || !id.success) return { error: 'Something went wrong. Reload and try again.' };
  const { savePhoto, deletePhotoIfUnused } = await import('@/lib/server/photos');
  const sql = db();
  const remove = form.get('remove') === '1';
  const [cur] = kind === 'product'
    ? await sql`select photo_path as path from products where id = ${id.data}`
    : await sql`select guide_photo_path as path from check_areas where id = ${id.data}`;
  if (!cur) return { error: 'Not found. Reload and try again.' };
  let path: string | null = null;
  if (!remove) {
    const saved = await savePhoto(form.get('photo'));
    if ('error' in saved) return { error: saved.error };
    path = saved.path;
  }
  if (kind === 'product') await sql`update products set photo_path = ${path} where id = ${id.data}`;
  else await sql`update check_areas set guide_photo_path = ${path} where id = ${id.data}`;
  await deletePhotoIfUnused(cur.path as string | null);
  revalidatePath('/admin', 'layout');
  return { ok: true, message: remove ? 'Photo removed.' : 'Photo saved. Devices get it next time they connect.' };
}

// ---------------------------------------------------------------------------
// Products spreadsheet import (check first, then apply)
// ---------------------------------------------------------------------------
const MAX_CSV = 1_000_000;
export async function checkProductsCsv(text: string) {
  await requireAdmin();
  if (typeof text !== 'string' || text.length > MAX_CSV) return { errors: [{ row: 1, message: 'That file is too large (1 MB at most).' }], newProducts: [], updated: [], unchanged: 0, newCategories: [], rows: 0 };
  const { previewImport } = await import('@/lib/server/catalogue-csv');
  return previewImport(text);
}

export async function importProductsCsv(text: string) {
  await requireAdmin();
  if (typeof text !== 'string' || text.length > MAX_CSV) return { errors: [{ row: 1, message: 'That file is too large (1 MB at most).' }], newProducts: [], updated: [], unchanged: 0, newCategories: [], rows: 0 };
  const { applyImport } = await import('@/lib/server/catalogue-csv');
  const r = await applyImport(text);
  revalidatePath('/admin', 'layout');
  return r;
}

// ---------------------------------------------------------------------------
// Product order within a checking area (the order staff physically find them)
// ---------------------------------------------------------------------------
export async function saveAreaOrder(areaId: string, placementIds: string[], headings?: Record<string, string | null>): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(areaId).success || !Array.isArray(placementIds) || placementIds.length > 2000
    || placementIds.some((id) => !uuid.safeParse(id).success) || new Set(placementIds).size !== placementIds.length) {
    return { error: 'Something went wrong. Reload and try again.' };
  }
  const sql = db();
  const result = await sql.begin(async (tx) => {
    const rows = await tx`select id from product_placements where check_area_id = ${areaId} order by sort_order, created_at for update`;
    const inArea = rows.map((r) => String(r.id));
    if (placementIds.some((id) => !inArea.includes(id))) return 'changed';
    // The new order first; anything not shown (archived products) keeps its place after them.
    const order = [...placementIds, ...inArea.filter((id) => !placementIds.includes(id))];
    // One statement each for the order and the subheadings (not a round trip per product).
    await tx`update product_placements t set sort_order = x.k from unnest(${order}::uuid[]) with ordinality as x(id, k)
      where t.id = x.id and t.sort_order is distinct from x.k`;
    // Subheadings (migration 011): blank removes one.
    if (headings && (await tx`select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading'`).length) {
      const hs = placementIds.map((id) => (typeof headings[id] === 'string' ? headings[id]!.trim().slice(0, 40) : '') || '');
      await tx`update product_placements t set heading = nullif(x.h, '') from unnest(${placementIds}::uuid[], ${hs}::text[]) as x(id, h)
        where t.id = x.id and t.heading is distinct from nullif(x.h, '')`;
    }
    return 'ok';
  });
  if (result === 'changed') return { error: 'The products in this area changed while you were arranging. Reload and try again.' };
  revalidatePath('/admin', 'layout');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Defrost Planner setup (managers only). Food-safety values come from the kitchen's
// approved procedures; the app never changes them by itself.
// ---------------------------------------------------------------------------
const qtyField = (label: string, { allowBlank = false, min = 0 } = {}) => z.preprocess(
  (v) => (v === '' || v == null ? (allowBlank ? null : v) : Number(String(v).replace(',', '.'))),
  allowBlank
    ? z.number({ message: `${label} must be a number.` }).min(min, `${label} must be ${min} or more.`).max(9999).nullable()
    : z.number({ message: `${label} is required.` }).min(min, `${label} must be ${min} or more.`).max(9999),
);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const defrostSchema = z.object({
  id: optUuid,
  departmentId: uuid,
  name: text(80, 'Name'),
  unitSingular: text(30, 'Unit (one)'),
  unitPlural: text(30, 'Unit (more than one)'),
  expectedDemand: qtyField('Expected demand'),
  buffer: qtyField('Buffer'),
  packSize: qtyField('Pack size').refine((v) => (v ?? 0) > 0, 'Pack size must be more than 0.'),
  minQty: qtyField('Minimum amount'),
  thawMethod: optText(120),
  thawHours: qtyField('Thaw time', { allowBlank: true }),
  shelfLifeHours: qtyField('Usable life', { allowBlank: true }),
  safetyNotes: optText(400),
  active: checkbox,
});

export async function saveDefrostItem(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = defrostSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return firstIssue(p.error);
  const d = p.data;
  if (d.thawHours !== null && d.thawHours > 240) return { error: 'Thaw time must be 240 hours or less.' };
  const weekday: Record<string, number> = {};
  for (const day of DAYS) {
    const raw = String(form.get(`wd_${day}`) ?? '').trim().replace(',', '.');
    if (raw === '') continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 9999) return { error: `Expected demand for ${day} must be a number from 0 to 9999.` };
    weekday[day] = v;
  }
  const sql = db();
  try {
    if (d.id) {
      await sql`update defrost_items set name = ${d.name}, unit_singular = ${d.unitSingular}, unit_plural = ${d.unitPlural},
        expected_demand = ${d.expectedDemand}, weekday_demand = ${sql.json(weekday)}, buffer = ${d.buffer}, pack_size = ${d.packSize}, min_qty = ${d.minQty},
        thaw_method = ${d.thawMethod}, thaw_hours = ${d.thawHours}, shelf_life_hours = ${d.shelfLifeHours}, safety_notes = ${d.safetyNotes},
        active = ${d.active}, updated_at = now() where id = ${d.id} and department_id = ${d.departmentId}`;
      revalidatePath('/admin', 'layout');
      return done(`${d.name} saved. Devices get it next time they connect.`);
    }
    const [{ n }] = await sql`select coalesce(max(sort_order), 0) + 1 as n from defrost_items where department_id = ${d.departmentId}`;
    await sql`insert into defrost_items (department_id, name, unit_singular, unit_plural, expected_demand, weekday_demand, buffer, pack_size, min_qty,
        thaw_method, thaw_hours, shelf_life_hours, safety_notes, sort_order, active)
      values (${d.departmentId}, ${d.name}, ${d.unitSingular}, ${d.unitPlural}, ${d.expectedDemand}, ${sql.json(weekday)}, ${d.buffer}, ${d.packSize}, ${d.minQty},
        ${d.thawMethod}, ${d.thawHours}, ${d.shelfLifeHours}, ${d.safetyNotes}, ${Number(n)}, true)`;
    revalidatePath('/admin', 'layout');
    return done(`${d.name} added.`);
  } catch (e) { return fail(e); }
}

export async function saveDefrostServiceTime(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const t = String(form.get('serviceTime') ?? '').trim();
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) return { error: 'Enter a time like 11:00.' };
  await setSetting('defrost_service_time', t);
  await db()`update app_settings set value = to_jsonb(coalesce((value #>> '{}')::int, 1) + 1) where key = 'catalogue_version'`;
  revalidatePath('/admin', 'layout');
  return done('Next service time saved.');
}

// ---------------------------------------------------------------------------
// Stock Insights thresholds
// ---------------------------------------------------------------------------
export async function saveInsightSettings(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const fields: [string, string, number, number][] = [
    ['windowDays', 'insights_window_days', 3, 60], ['shortageDays', 'insights_shortage_days', 2, 60],
    ['turnoverDays', 'insights_turnover_days', 2, 60], ['defrostDays', 'insights_defrost_days', 1, 60], ['wasteDays', 'insights_waste_days', 1, 60],
  ];
  const vals: Record<string, number> = {};
  for (const [name, , min, max] of fields) {
    const v = Number(form.get(name));
    if (!Number.isInteger(v) || v < min || v > max) return { error: `Enter whole numbers between ${min} and ${max}.` };
    vals[name] = v;
  }
  if (vals.shortageDays > vals.windowDays || vals.turnoverDays > vals.windowDays) return { error: 'The day counts can’t be more than the number of days looked at.' };
  for (const [name, key] of fields) await setSetting(key, vals[name]);
  revalidatePath('/admin/insights');
  return done('Thresholds saved.');
}

// ---------------------------------------------------------------------------
// Product photos from Open Food Facts (public, CC BY-SA): search, then a person picks the match.
// ---------------------------------------------------------------------------
export async function findProductPhotos(query: string) {
  await requireAdmin();
  const { searchOpenFoodFacts } = await import('@/lib/server/open-food-facts');
  return searchOpenFoodFacts(String(query ?? ''));
}

export async function chooseOpenFoodFactsPhoto(productId: string, imageUrl: string, code: string): Promise<ActionResult & { path?: string }> {
  await requireAdmin();
  if (!uuid.safeParse(productId).success || typeof imageUrl !== 'string' || imageUrl.length > 500) return { error: 'Something went wrong. Reload and try again.' };
  const { downloadOffImage } = await import('@/lib/server/open-food-facts');
  const { savePhotoBytes, deletePhotoIfUnused } = await import('@/lib/server/photos');
  const got = await downloadOffImage(imageUrl);
  if ('error' in got) return { error: got.error };
  const cleanCode = String(code ?? '').replace(/[^0-9A-Za-z-]/g, '').slice(0, 40);
  const saved = await savePhotoBytes(got.bytes, `Photo: Open Food Facts${cleanCode ? ` (product ${cleanCode})` : ''}, CC BY-SA`, cleanCode ? `https://world.openfoodfacts.org/product/${cleanCode}` : imageUrl);
  if ('error' in saved) return { error: saved.error };
  const sql = db();
  const [cur] = await sql`select photo_path from products where id = ${productId}`;
  if (!cur) return { error: 'That product no longer exists.' };
  await sql`update products set photo_path = ${saved.path} where id = ${productId}`;
  await deletePhotoIfUnused(cur.photoPath as string | null);
  revalidatePath('/admin', 'layout');
  return { ok: true, message: 'Photo saved.', path: saved.path };
}

// ---------------------------------------------------------------------------
// Clear test activity (before staff start): only the restocks and defrost records ticked.
// ---------------------------------------------------------------------------
export async function clearTestActivity(_: ActionResult, form: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  if (form.get('understand') !== 'on') return { error: 'Tick “I understand” to confirm.' };
  const ids = form.getAll('session').map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  const plans = form.getAll('defrost').map(String).map((v) => v.split('|')).filter(([d, day]) => /^[0-9a-f-]{36}$/i.test(d ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(day ?? ''))
    .map(([departmentId, serviceDate]) => ({ departmentId, serviceDate }));
  if (!ids.length && !plans.length) return { error: 'Nothing selected. Tick the test records to clear.' };
  try {
    const { resetSessions, resetDefrost } = await import('@/lib/server/reset');
    const n = await resetSessions(ids, { by: me.name });
    const d = await resetDefrost(plans, me.name);
    revalidatePath('/admin', 'layout');
    return { ok: true, message: `Cleared ${n} restock${n === 1 ? '' : 's'}${plans.length ? ` and ${d} defrost record${d === 1 ? '' : 's'}` : ''}. Devices drop their copies on their next sync.` };
  } catch (e) { return { error: (e as Error).message || 'Something went wrong. Nothing was cleared.' }; }
}
