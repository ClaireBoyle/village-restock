import { db, getSetting } from './db';
import type { Catalogue } from '@/lib/catalogue-types';

export async function catalogueVersion(): Promise<number> {
  return Number(await getSetting<number>('catalogue_version', 1));
}

/** Everything a device needs to restock, active items only, in display order. */
export async function loadCatalogue(): Promise<Catalogue> {
  const sql = db();
  // Read in one transaction so the version matches the rows returned.
  return sql.begin('isolation level repeatable read', async (tx) => {
    const settingRows = await tx`select key, value from app_settings where key in ('catalogue_version', 'timezone', 'trading_day_cutoff_hour', 'defrost_service_time')`;
    const setting = (k: string) => settingRows.find((r) => r.key === k)?.value;
    const departments = await tx`
      select id, name, short_name, group_label, theme, icon, description, sort_order
      from departments where active order by sort_order, name`;
    const areas = await tx`
      select a.id, a.department_id, a.name, a.guide_text, a.guide_photo_path, a.sort_order
      from check_areas a join departments d on d.id = a.department_id and d.active
      where a.active order by a.sort_order, a.name`;
    const locations = await tx`select id, name, sort_order from storage_locations where active order by sort_order, name`;
    const categories = await tx`
      select id, department_id, name, sort_order from categories where active order by sort_order, name`;
    const products = await tx`
      select p.id, p.department_id, p.category_id, p.name, p.unit_singular, p.unit_plural, p.method,
             p.allow_decimal, p.instructions, p.default_location_id, p.sort_order, p.photo_path,
             -- read via jsonb so the app still works before migration 003 adds the column
             coalesce(to_jsonb(p)->'affects', '[]'::jsonb) as affects
      from products p join departments d on d.id = p.department_id and d.active
      where p.status = 'active' order by p.sort_order, p.name`;
    const placements = await tx`
      select pl.id, pl.product_id, pl.check_area_id, pl.par_level, pl.location_id, pl.instructions, pl.sort_order
      from product_placements pl
      join products p on p.id = pl.product_id and p.status = 'active'
      join check_areas a on a.id = pl.check_area_id and a.active
      order by pl.sort_order`;
    // Defrost items exist once migration 006 has run.
    const [{ has }] = await tx`select to_regclass('public.defrost_items') is not null as has`;
    const defrostItems = has ? await tx`
      select i.id, i.department_id, i.name, i.unit_singular, i.unit_plural, i.expected_demand, i.weekday_demand, i.buffer,
             i.pack_size, i.min_qty, i.thaw_method, i.thaw_hours, i.shelf_life_hours, i.safety_notes, i.sort_order
      from defrost_items i join departments d on d.id = i.department_id and d.active
      where i.active order by i.sort_order, i.name` : [];
    return {
      version: Number(setting('catalogue_version') ?? 1),
      defrostItems: defrostItems.map((r) => ({ ...r, weekdayDemand: r.weekdayDemand ?? {} })),
      generatedAt: new Date().toISOString(),
      settings: { timeZone: String(setting('timezone') ?? 'Australia/Melbourne'), cutoffHour: Number(setting('trading_day_cutoff_hour') ?? 5), defrostServiceTime: String(setting('defrost_service_time') ?? '11:00') },
      departments, areas, locations, categories, products, placements,
    } as unknown as Catalogue;
  });
}
