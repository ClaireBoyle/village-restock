// Products and par levels as a spreadsheet: export, edit in Excel/Numbers/
// Google Sheets, import again. One row per product per checking area.
//
// Import rules (kept deliberately simple and safe):
//  - Nothing is deleted. To take a product off the menu, set Status to "archived".
//  - Products are matched by department + name. A new name makes a new product.
//  - The areas listed for a product replace its areas (so moving a product is just editing the rows).
//  - Departments, areas and storerooms must already exist (catches typos).
//    Missing categories are created.
//  - Every row is checked first. If anything is wrong, nothing is changed.
import type postgres from 'postgres';
import { db } from './db';
import { parseCsv, toCsv, unsafe } from '@/lib/csv';

type Sql = postgres.Sql<Record<string, unknown>> | postgres.TransactionSql<Record<string, unknown>>;

export const HEADERS = ['Department', 'Area', 'Product', 'Category', 'How restocked', 'Target', 'Unit (one)', 'Unit (more)',
  'Storeroom', 'Part quantities', 'Instructions', 'Menu items if out', 'Status'] as const;
type Col = (typeof HEADERS)[number];
const REQUIRED: Col[] = ['Department', 'Area', 'Product', 'How restocked', 'Unit (one)', 'Unit (more)', 'Storeroom'];

const METHOD_OUT = { par: 'target level', manual: 'staff enter', routine: 'routine task' } as const;
type Method = keyof typeof METHOD_OUT;
function readMethod(v: string): Method | null {
  const s = v.trim().toLowerCase();
  if (['par', 'target', 'target level', 'par level'].includes(s)) return 'par';
  if (['manual', 'staff enter', 'enter', 'staff enter what they need'].includes(s)) return 'manual';
  if (['routine', 'routine task', 'task'].includes(s)) return 'routine';
  return null;
}
const yes = (v: string) => ['yes', 'y', 'true', '1'].includes(v.trim().toLowerCase());
const lc = (s: string) => s.trim().toLowerCase();
const n2 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export async function exportProductsCsv(): Promise<string> {
  const rows = await db()`
    select d.name as department, a.name as area, p.name as product, c.name as category, p.method, pl.par_level,
      p.unit_singular, p.unit_plural, coalesce(pll.name, dl.name) as storeroom, p.allow_decimal, p.instructions,
      coalesce(to_jsonb(p)->'affects', '[]'::jsonb) as affects, p.status
    from product_placements pl
    join products p on p.id = pl.product_id
    join departments d on d.id = p.department_id
    join check_areas a on a.id = pl.check_area_id
    left join categories c on c.id = p.category_id
    left join storage_locations pll on pll.id = pl.location_id
    left join storage_locations dl on dl.id = p.default_location_id
    order by d.sort_order, d.name, a.sort_order, a.name, pl.sort_order, p.name`;
  return toCsv([
    [...HEADERS],
    ...rows.map((r) => [
      String(r.department), String(r.area), String(r.product), (r.category as string) ?? '', METHOD_OUT[r.method as Method],
      r.parLevel === null ? '' : Number(r.parLevel), String(r.unitSingular), String(r.unitPlural), (r.storeroom as string) ?? '',
      Boolean(r.allowDecimal), String(r.instructions ?? ''), ((r.affects as string[]) ?? []).join('; '), String(r.status),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Import: check everything, then (if asked) apply in one transaction
// ---------------------------------------------------------------------------
export interface ImportPreview {
  errors: { row: number; message: string }[];
  newProducts: string[];
  updated: { name: string; changes: string[] }[];
  unchanged: number;
  newCategories: string[];
  rows: number;
}

interface PlannedProduct {
  key: string; row: number; existingId: string | null; departmentId: string; departmentName: string;
  name: string; category: string | null; method: Method; unitSingular: string; unitPlural: string;
  allowDecimal: boolean; instructions: string; affects: string[]; status: 'active' | 'archived';
  placements: { areaId: string; areaName: string; par: number | null; locationId: string; locationName: string }[];
  defaultLocationId: string;
}

async function plan(sql: Sql, text: string): Promise<{ preview: ImportPreview; products: PlannedProduct[] }> {
  const preview: ImportPreview = { errors: [], newProducts: [], updated: [], unchanged: 0, newCategories: [], rows: 0 };
  const err = (row: number, message: string) => { if (preview.errors.length < 50) preview.errors.push({ row, message }); };
  const table = parseCsv(text).map((r) => r.map((c) => unsafe(c.trim())));
  if (table.length < 2) { err(1, 'The file has no product rows.'); return { preview, products: [] }; }

  const header = table[0].map(lc);
  const idx = new Map<Col, number>();
  for (const h of HEADERS) { const i = header.indexOf(lc(h)); if (i >= 0) idx.set(h, i); }
  const missing = REQUIRED.filter((h) => !idx.has(h));
  if (missing.length) { err(1, `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Start from an exported file to get the right columns.`); return { preview, products: [] }; }
  const get = (r: string[], c: Col) => (idx.has(c) ? (r[idx.get(c)!] ?? '').trim() : '');
  const has = (c: Col) => idx.has(c);

  const depts = await sql`select id, name, short_name from departments`;
  const areas = await sql`select id, department_id, name from check_areas`;
  const locs = await sql`select id, name from storage_locations`;
  const cats = await sql`select id, department_id, name from categories`;
  const prods = await sql`select id, department_id, name, category_id, method, unit_singular, unit_plural, allow_decimal, instructions,
    coalesce(to_jsonb(products)->'affects', '[]'::jsonb) as affects, status, default_location_id from products`;
  const pls = await sql`select product_id, check_area_id, par_level, location_id from product_placements`;

  const deptBy = new Map<string, { id: string; name: string }>();
  for (const d of depts) { deptBy.set(lc(String(d.name)), { id: String(d.id), name: String(d.name) }); deptBy.set(lc(String(d.shortName)), { id: String(d.id), name: String(d.name) }); }
  const areaBy = new Map(areas.map((a) => [`${a.departmentId}|${lc(String(a.name))}`, { id: String(a.id), name: String(a.name) }]));
  const locBy = new Map(locs.map((l) => [lc(String(l.name)), { id: String(l.id), name: String(l.name) }]));
  const locName = new Map(locs.map((l) => [String(l.id), String(l.name)]));
  const catBy = new Map(cats.map((c) => [`${c.departmentId}|${lc(String(c.name))}`, String(c.name)]));
  const catName = new Map(cats.map((c) => [String(c.id), String(c.name)]));
  const areaName = new Map(areas.map((a) => [String(a.id), String(a.name)]));
  const prodBy = new Map(prods.map((p) => [`${p.departmentId}|${lc(String(p.name))}`, p]));

  const planned = new Map<string, PlannedProduct>();
  const newCats = new Set<string>();
  for (let i = 1; i < table.length; i++) {
    const r = table[i], rowNo = i + 1;
    preview.rows++;
    const dept = deptBy.get(lc(get(r, 'Department')));
    if (!dept) { err(rowNo, `No department called “${get(r, 'Department')}”.`); continue; }
    const name = get(r, 'Product');
    if (!name || name.length > 80) { err(rowNo, 'Product name is missing or longer than 80 characters.'); continue; }
    const area = areaBy.get(`${dept.id}|${lc(get(r, 'Area'))}`);
    if (!area) { err(rowNo, `${dept.name} has no area called “${get(r, 'Area')}”. Add it in Departments first, or fix the spelling.`); continue; }
    const loc = locBy.get(lc(get(r, 'Storeroom')));
    if (!loc) { err(rowNo, `No storeroom called “${get(r, 'Storeroom')}”. Add it in Storerooms first, or fix the spelling.`); continue; }
    const method = readMethod(get(r, 'How restocked'));
    if (!method) { err(rowNo, `“How restocked” must be target level, staff enter, or routine task (not “${get(r, 'How restocked')}”).`); continue; }
    const unitSingular = get(r, 'Unit (one)'), unitPlural = get(r, 'Unit (more)');
    if (!unitSingular || !unitPlural || unitSingular.length > 30 || unitPlural.length > 30) { err(rowNo, 'Units are required and must be 30 characters or fewer.'); continue; }

    const key = `${dept.id}|${lc(name)}`;
    const existing = prodBy.get(key);
    const allowDecimal = has('Part quantities') ? yes(get(r, 'Part quantities')) : Boolean(existing?.allowDecimal);
    let par: number | null = null;
    const t = get(r, 'Target');
    if (method === 'par') {
      const v = Number(t.replace(',', '.'));
      if (t === '' || !Number.isFinite(v) || v < 0 || v > 9999) { err(rowNo, `${name}: enter a target between 0 and 9999 for ${area.name}.`); continue; }
      if (!allowDecimal && !Number.isInteger(v)) { err(rowNo, `${name}: the target must be a whole number (or set Part quantities to yes).`); continue; }
      par = Math.round(v * 100) / 100;
    }
    const instructions = has('Instructions') ? get(r, 'Instructions') : String(existing?.instructions ?? '');
    if (instructions.length > 400) { err(rowNo, `${name}: instructions must be 400 characters or fewer.`); continue; }
    const affects = has('Menu items if out')
      ? [...new Set(get(r, 'Menu items if out').split(/[;\n]/).map((x) => x.trim()).filter(Boolean))]
      : ((existing?.affects as string[]) ?? []);
    if (affects.length > 10 || affects.some((x) => x.length > 60)) { err(rowNo, `${name}: at most 10 menu items, each 60 characters or fewer.`); continue; }
    const statusText = has('Status') ? lc(get(r, 'Status')) : String(existing?.status ?? 'active');
    if (statusText !== 'active' && statusText !== 'archived' && statusText !== '') { err(rowNo, `${name}: Status must be active or archived.`); continue; }
    const status = (statusText || 'active') as 'active' | 'archived';
    let category: string | null = has('Category') ? get(r, 'Category') || null : (existing?.categoryId ? catName.get(String(existing.categoryId)) ?? null : null);
    if (category) {
      if (category.length > 40) { err(rowNo, `${name}: category must be 40 characters or fewer.`); continue; }
      const known = catBy.get(`${dept.id}|${lc(category)}`);
      if (known) category = known; else newCats.add(`${dept.name}: ${category}`);
    }

    const fields = { category, method, unitSingular, unitPlural, allowDecimal, instructions, affects, status };
    let p = planned.get(key);
    if (!p) {
      p = { key, row: rowNo, existingId: existing ? String(existing.id) : null, departmentId: dept.id, departmentName: dept.name, name: existing ? String(existing.name) : name,
        ...fields, placements: [], defaultLocationId: loc.id };
      planned.set(key, p);
    } else {
      const differs = (Object.keys(fields) as (keyof typeof fields)[]).find((k) => JSON.stringify(fields[k]) !== JSON.stringify(p![k]));
      if (differs) { err(rowNo, `${name}: this row's ${differs === 'unitSingular' || differs === 'unitPlural' ? 'unit' : differs === 'allowDecimal' ? 'part quantities' : differs === 'affects' ? 'menu items' : differs} is different from row ${p.row}. A product's details must match on every row.`); continue; }
    }
    if (p.placements.some((x) => x.areaId === area.id)) { err(rowNo, `${name} is listed twice for ${area.name}.`); continue; }
    p.placements.push({ areaId: area.id, areaName: area.name, par, locationId: loc.id, locationName: loc.name });
  }

  // Default storeroom: keep the current one if it's still used, otherwise the first row's.
  for (const p of planned.values()) {
    const cur = p.existingId ? String(prodBy.get(p.key)?.defaultLocationId ?? '') : '';
    if (cur && p.placements.some((x) => x.locationId === cur)) p.defaultLocationId = cur;
  }

  // Describe the changes.
  for (const p of planned.values()) {
    if (!p.existingId) { preview.newProducts.push(`${p.name} (${p.departmentName})`); continue; }
    const e = prodBy.get(p.key)!;
    const ch: string[] = [];
    const cmp = (label: string, a: unknown, b: unknown) => { if (String(a ?? '') !== String(b ?? '')) ch.push(`${label}: ${String(a ?? '') || '(none)'} → ${String(b ?? '') || '(none)'}`); };
    cmp('category', e.categoryId ? catName.get(String(e.categoryId)) : '', p.category);
    if (e.method !== p.method) ch.push(`how restocked: ${METHOD_OUT[e.method as Method]} → ${METHOD_OUT[p.method]}`);
    cmp('unit', `${e.unitSingular}/${e.unitPlural}`, `${p.unitSingular}/${p.unitPlural}`);
    if (Boolean(e.allowDecimal) !== p.allowDecimal) ch.push(`part quantities: ${p.allowDecimal ? 'now allowed' : 'no longer allowed'}`);
    if (String(e.instructions ?? '') !== p.instructions) ch.push('instructions changed');
    if (JSON.stringify(e.affects ?? []) !== JSON.stringify(p.affects)) ch.push('menu items changed');
    if (e.status !== p.status) ch.push(p.status === 'archived' ? 'archived (taken off the menu)' : 'restored to the menu');
    const before = pls.filter((x) => String(x.productId) === p.existingId);
    for (const x of p.placements) {
      const b = before.find((y) => String(y.checkAreaId) === x.areaId);
      const bLoc = b ? String(b.locationId ?? e.defaultLocationId ?? '') : '';
      if (!b) ch.push(`added to ${x.areaName}${x.par !== null ? ` (target ${x.par})` : ''}`);
      else {
        if (n2(b.parLevel) !== x.par) ch.push(`${x.areaName} target: ${n2(b.parLevel) ?? '–'} → ${x.par ?? '–'}`);
        if (bLoc !== x.locationId) ch.push(`${x.areaName} storeroom: ${locName.get(bLoc) ?? '(none)'} → ${x.locationName}`);
      }
    }
    for (const b of before) if (!p.placements.some((x) => x.areaId === String(b.checkAreaId))) ch.push(`removed from ${areaName.get(String(b.checkAreaId))}`);
    if (ch.length) preview.updated.push({ name: `${p.name} (${p.departmentName})`, changes: ch }); else preview.unchanged++;
  }
  preview.newCategories = [...newCats];
  return { preview, products: [...planned.values()] };
}

export async function previewImport(text: string): Promise<ImportPreview> {
  return (await plan(db(), text)).preview;
}

/** Re-checks and applies in one transaction. Nothing changes if any row has a problem. */
export async function applyImport(text: string): Promise<ImportPreview> {
  return db().begin(async (tx) => {
    const { preview, products } = await plan(tx, text);
    if (preview.errors.length) return preview;
    for (const p of products) {
      let categoryId: string | null = null;
      if (p.category) {
        const [c] = await tx`select id from categories where department_id = ${p.departmentId} and lower(name) = lower(${p.category})`;
        if (c) categoryId = String(c.id);
        else {
          const [{ n }] = await tx`select coalesce(max(sort_order), 0) + 1 as n from categories where department_id = ${p.departmentId}`;
          const [nc] = await tx`insert into categories (department_id, name, sort_order) values (${p.departmentId}, ${p.category}, ${Number(n)}) returning id`;
          categoryId = String(nc.id);
        }
      }
      let id = p.existingId;
      if (id) {
        await tx`update products set category_id = ${categoryId}, method = ${p.method}, unit_singular = ${p.unitSingular}, unit_plural = ${p.unitPlural},
          allow_decimal = ${p.allowDecimal}, instructions = ${p.instructions}, affects = ${p.affects}, status = ${p.status},
          default_location_id = ${p.defaultLocationId} where id = ${id}`;
      } else {
        const [{ n }] = await tx`select coalesce(max(sort_order), 0) + 1 as n from products where department_id = ${p.departmentId}`;
        const [row] = await tx`insert into products (department_id, category_id, name, unit_singular, unit_plural, method, allow_decimal, instructions,
          default_location_id, sort_order, affects, status)
          values (${p.departmentId}, ${categoryId}, ${p.name}, ${p.unitSingular}, ${p.unitPlural}, ${p.method}, ${p.allowDecimal}, ${p.instructions},
          ${p.defaultLocationId}, ${Number(n)}, ${p.affects}, ${p.status}) returning id`;
        id = String(row.id);
      }
      const keep = p.placements.map((x) => x.areaId);
      await tx`delete from product_placements where product_id = ${id} and not (check_area_id in ${tx(keep)})`;
      for (const x of p.placements) {
        const loc = x.locationId === p.defaultLocationId ? null : x.locationId;
        const [{ n }] = await tx`select coalesce(max(sort_order), 0) + 1 as n from product_placements where check_area_id = ${x.areaId}`;
        await tx`insert into product_placements (product_id, check_area_id, par_level, location_id, sort_order)
          values (${id}, ${x.areaId}, ${x.par}, ${loc}, ${Number(n)})
          on conflict (product_id, check_area_id) do update set par_level = excluded.par_level, location_id = excluded.location_id`;
      }
    }
    return preview;
  });
}

// ---------------------------------------------------------------------------
// Records for managers
// ---------------------------------------------------------------------------
export async function exportShortagesCsv(): Promise<string> {
  const rows = await db()`
    select s.trading_date, d.name as department, sh.product_name, sh.shortfall_qty, sh.unit_plural, sh.reason, sh.flagged,
      sh.reported_by, sh.status, sh.resolution_note, sh.created_at
    from shortages sh join departments d on d.id = sh.department_id left join restock_sessions s on s.id = sh.session_id
    order by sh.created_at desc limit 5000`;
  const reason: Record<string, string> = { insufficient: 'Not enough in storeroom', access: 'Couldn’t access', time: 'Ran out of time', other: 'Other' };
  return toCsv([
    ['Date', 'Department', 'Product', 'Short by', 'Unit', 'Reason', 'Flagged', 'Reported by', 'Status', 'Resolution note'],
    ...rows.map((r) => [dateOnly(r.tradingDate ?? r.createdAt), String(r.department), String(r.productName), Number(r.shortfallQty), String(r.unitPlural ?? ''),
      reason[String(r.reason)] ?? String(r.reason), Boolean(r.flagged), (r.reportedBy as string) ?? '', String(r.status), (r.resolutionNote as string) ?? '']),
  ]);
}

export async function exportRestocksCsv(timeZone: string): Promise<string> {
  const rows = await db()`
    select s.trading_date, d.name as department, s.kind, s.status, s.started_at, s.finished_at, s.people, s.exception_reason,
      to_jsonb(s)->>'finish_note' as note,
      (select count(*) from shortages sh where sh.session_id = s.id)::int as shortages
    from restock_sessions s join departments d on d.id = s.department_id
    order by s.trading_date desc, d.sort_order limit 5000`;
  const t = (v: unknown) => (v ? new Date(v as string).toLocaleTimeString('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).toLowerCase() : '');
  const status: Record<string, string> = { open: 'In progress', finished: 'Complete', finished_exceptions: 'Finished with exceptions', unfinished: 'Never finished' };
  return toCsv([
    ['Date', 'Department', 'Type', 'Status', 'Started', 'Finished', 'Staff', 'Exception reason', 'Comments', 'Shortages'],
    ...rows.map((r) => [dateOnly(r.tradingDate), String(r.department), r.kind === 'full' ? 'Full' : r.kind === 'area' ? 'Area' : 'Stock top-up', status[String(r.status)] ?? String(r.status),
      t(r.startedAt), t(r.finishedAt), ((r.people as string[]) ?? []).join(', '), (r.exceptionReason as string) ?? '', (r.note as string) ?? '', Number(r.shortages)]),
  ]);
}

function dateOnly(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
