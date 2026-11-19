import { db, getSetting } from './db';
import type { Catalogue } from '@/lib/catalogue-types';
import { cleanTargets } from '@/lib/defrost-rows';

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
      select d.id, d.name, d.short_name, d.group_label, d.theme, d.icon, d.description, d.sort_order,
             coalesce((to_jsonb(d)->>'restock_by_area')::boolean, false) as restock_by_area,
             coalesce((to_jsonb(d)->>'none_on_display')::boolean, false) as none_on_display
      from departments d where d.active order by d.sort_order, d.name`;
    const areas = await tx`
      select a.id, a.department_id, a.name, a.guide_text, a.guide_photo_path, a.sort_order,
             (to_jsonb(a)->>'parent_area_id') as parent_area_id, coalesce(to_jsonb(a)->>'section_mode', 'open') as section_mode
      from check_areas a join departments d on d.id = a.department_id and d.active
      where a.active order by a.sort_order, a.name`;
    const locations = await tx`select l.id, l.name, l.sort_order, coalesce(to_jsonb(l)->>'collect_note', '') as collect_note
      from storage_locations l where l.active order by l.sort_order, l.name`;
    const categories = await tx`
      select id, department_id, name, sort_order from categories where active order by sort_order, name`;
    // Photo credits exist once migrations 005/007 have run; never let a missing table break the catalogue.
    const [{ hasPhotos }] = await tx`select to_regclass('public.photos') is not null as has_photos`;
    const products = await tx`
      select p.id, p.department_id, p.category_id, p.name, p.unit_singular, p.unit_plural, p.method,
             p.allow_decimal, p.instructions, p.default_location_id, p.sort_order, p.photo_path,
             -- read via jsonb so the app still works before migration 003 adds the column
             coalesce(to_jsonb(p)->'affects', '[]'::jsonb) as affects,
             ${hasPhotos ? tx`(select to_jsonb(ph)->>'credit' from photos ph where p.photo_path = '/api/photos/' || ph.id::text)` : tx`null`} as photo_credit
      from products p join departments d on d.id = p.department_id and d.active
      where p.status = 'active' order by p.sort_order, p.name`;
    const placements = await tx`
      select pl.id, pl.product_id, pl.check_area_id, pl.par_level, pl.location_id, pl.instructions, pl.sort_order,
             (to_jsonb(pl)->>'heading') as heading,
             -- Refill FOH (migration 012): read via jsonb so the app still works before it runs
             (to_jsonb(pl)->>'pickup_area_id') as pickup_area_id, coalesce((to_jsonb(pl)->>'pickup_suggest')::boolean, false) as pickup_suggest,
             (to_jsonb(pl)->>'unit_singular') as unit_singular, (to_jsonb(pl)->>'unit_plural') as unit_plural,
             -- Defrost rows (migration 016)
             (to_jsonb(pl)->>'grab_note') as grab_note, (to_jsonb(pl)->>'fallback_note') as fallback_note, (to_jsonb(pl)->>'put_note') as put_note,
             (to_jsonb(pl)->>'ready_unit_singular') as ready_unit_singular, (to_jsonb(pl)->>'ready_unit_plural') as ready_unit_plural,
             (to_jsonb(pl)->>'ready_per')::numeric as ready_per, coalesce(to_jsonb(pl)->'ready_targets', '[]'::jsonb) as ready_targets,
             -- Morning prep (migration 017)
             (to_jsonb(pl)->>'prep_task_id') as prep_task_id
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
    // Morning prep checklist exists once migration 017 has run.
    const [{ hasPrep }] = await tx`select to_regclass('public.prep_tasks') is not null as has_prep`;
    const prepTasks = hasPrep ? await tx`
      select t.id, t.department_id, t.grp as "group", t.name, t.sort_order from prep_tasks t join departments d on d.id = t.department_id and d.active
      where t.active order by t.sort_order, t.name` : [];
    return {
      version: Number(setting('catalogue_version') ?? 1),
      prepTasks,
      defrostItems: defrostItems.map((r) => ({ ...r, weekdayDemand: r.weekdayDemand ?? {} })),
      generatedAt: new Date().toISOString(),
      settings: { timeZone: String(setting('timezone') ?? 'Australia/Melbourne'), cutoffHour: Number(setting('trading_day_cutoff_hour') ?? 5), defrostServiceTime: String(setting('defrost_service_time') ?? '11:00') },
      departments, areas, locations, categories, products,
      placements: placements.map((r) => ({ ...r, readyPer: r.readyPer === null ? null : Number(r.readyPer), readyTargets: cleanTargets(r.readyTargets) })),
    } as unknown as Catalogue;
  });
}

