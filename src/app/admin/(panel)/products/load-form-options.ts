import { db } from '@/lib/server/db';

/** Areas, categories and storerooms to choose from when editing a product. */
export async function loadFormOptions(departmentId: string) {
  const sql = db();
  const [areas, categories, locations] = await Promise.all([
    sql`select id, name from check_areas where department_id = ${departmentId} and active order by sort_order, name`,
    sql`select id, name from categories where department_id = ${departmentId} and active order by sort_order, name`,
    sql`select id, name from storage_locations where active order by sort_order, name`,
  ]);
  const plain = (rows: readonly Record<string, unknown>[]) => rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
  return { areas: plain(areas), categories: plain(categories), locations: plain(locations) };
}
