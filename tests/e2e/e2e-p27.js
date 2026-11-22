// Admin: "Take with you" on a product and "Where in the storeroom" per area, saved and shown on the collection list.
// Before running: reset the test database. The test applies the Gold Class Kitchen update scripts.
const { chromium } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };

(async () => {
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`delete from check_areas where department_id = ${k.id}`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2), ('Dry storage', 4) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact', 'freezer-1-first',
    'no-walk-in-desserts', 'walk-in-third-shelf', 'relish-prep', 'walk-in-fresh-produce', 'bottom-sauce-shelf', 'prep-checklist', 'dry-stock', 'trial']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);
  await sql`insert into admins (email, display_name, password_hash) values ('supervisor@example.com', 'Claire', ${await bcrypt.hash('correct-horse-1', 10)}) on conflict do nothing`;
  const b = await chromium.launch(); const errs = [];
  const S = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); S.on('pageerror', (e) => errs.push(e.message));
  await S.goto(B + '/admin/login'); await S.fill('#email', 'supervisor@example.com'); await S.fill('#password', 'correct-horse-1'); await S.click('button.btn.primary');
  await S.waitForURL(/\/admin(?!\/login)/);

  const [pat] = await sql`select id from products where name = 'Beef Patties' and department_id = ${k.id}`;
  await S.goto(`${B}/admin/products/${pat.id}`); await S.waitForSelector('#collectReminder');
  ok(await S.inputValue('#collectReminder') === 'Take tubs and boxes for the burger patties', 'Beef Patties: "Take with you" shows the reminder');
  await S.fill('#collectReminder', 'Take 2 tubs and 1 box for the burger patties');
  await S.click('button.btn.primary:has-text("Save changes")'); await S.waitForURL(/\/admin\/products\?/);
  const [r] = await sql`select collect_reminder from products where id = ${pat.id}`;
  ok(r.collectReminder === 'Take 2 tubs and 1 box for the burger patties', 'saved with the confirmed number');

  const [pz] = await sql`select id from products where name = 'Pizza cheese (portioned bags)'`;
  const [fr] = await sql`select x.check_area_id as id from product_placements x join check_areas c on c.id = x.check_area_id where x.product_id = ${pz.id} and c.name = 'Walk in fridge · Fourth shelf'`;
  await S.goto(`${B}/admin/products/${pz.id}`); await S.waitForSelector(`#cnote_${fr.id}`);
  ok(await S.inputValue(`#cnote_${fr.id}`) === 'Lower-right compartment, beside the zucchini wedges', 'pizza cheese: the fridge row\'s "Where in the storeroom"');
  await S.fill(`#cnote_${fr.id}`, 'Lower right, next to the zucchini wedges');
  await S.click('button.btn.primary:has-text("Save changes")'); await S.waitForURL(/\/admin\/products\?/);
  const rows = await sql`select c.name, x.collect_note, x.prep_task_id is not null as prep, l.name as loc from product_placements x join check_areas c on c.id = x.check_area_id
    left join storage_locations l on l.id = x.location_id where x.product_id = ${pz.id} order by c.name`;
  ok(rows.find((x) => x.name === 'Walk in fridge · Fourth shelf').collectNote === 'Lower right, next to the zucchini wedges' && rows.find((x) => x.name === 'Walk in fridge · Fourth shelf').loc === 'Freezer 2',
    'saved; still collected from Freezer 2');
  ok(rows.find((x) => x.name.startsWith('Freezer 2')).prep, 'the Freezer 2 prep check is kept');
  // Clearing it removes it.
  await S.goto(`${B}/admin/products/${pat.id}`); await S.waitForSelector('#collectReminder'); await S.fill('#collectReminder', '');
  await S.click('button.btn.primary:has-text("Save changes")'); await S.waitForURL(/\/admin\/products\?/);
  ok((await sql`select collect_reminder from products where id = ${pat.id}`)[0].collectReminder === null, 'cleared: no reminder');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
