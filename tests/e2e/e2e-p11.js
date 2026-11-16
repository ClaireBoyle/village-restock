// Gold Class Bar BOH bar fridge: 24 products in physical order with two subheadings.
// Before running: reset the test database, then load boh-fixture.sql. The test applies
// db/updates/2026-11-gold-class-bar-boh-fridge.sql itself (twice, to prove it's safe to repeat).
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const has = (p, sel, t, ms = 8000) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const MIX = ['Cranberry Juice', 'Orange Juice', 'Apple Juice', 'Pineapple Juice', 'Mount Franklin Sparkling Water 750ml', 'Skinny Milk', 'Kirks Indian Tonic Water',
  'Kirks Dry Ginger Ale', 'Whipped Cream', 'Oat Milk', 'Soy Milk', 'Mount Franklin Sparkling Water 330ml'];
const BEER = ['Heineken Zero', 'James Squire Ginger Beer', 'Little Creatures Rogers', 'Hahn Superdry 3.5', 'Guinness', 'Stone & Wood Pacific Ale',
  'Little Creatures Pipsqueak Cider', 'James Boags Premium', 'Kirin Ichiban', 'Heineken', 'Furphy', 'Suntory -196 Lemon'];

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const [before] = await sql`select p.id, p.photo_path from products p join departments d on d.id = p.department_id where d.name = 'Gold Class Bar' and p.name = 'Heineken'`;
  const [{ n: productsBefore }] = await sql`select count(*)::int as n from products`;
  await sql.file('db/updates/2026-11-gold-class-bar-boh-fridge.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-boh-fridge.sql'); // again: must change nothing
  const rows = await sql`
    select p.id, p.name, p.status, p.method, p.unit_plural, l.name as loc, pl.par_level, pl.heading, pl.sort_order, p.photo_path
    from product_placements pl join products p on p.id = pl.product_id join check_areas a on a.id = pl.check_area_id
    join departments d on d.id = a.department_id left join storage_locations l on l.id = coalesce(pl.location_id, p.default_location_id)
    where d.name = 'Gold Class Bar' and a.name = 'BOH bar fridge' order by pl.sort_order`;
  const names = rows.map((r) => r.name);
  ok(JSON.stringify(names.slice(0, 24)) === JSON.stringify([...MIX, ...BEER].map((n) => (n === 'Whipped Cream' ? 'Whipped cream' : n))), 'all 24 products in the exact order (existing names kept): ' + names.slice(0, 24).join(', '));
  ok(names[24] === 'Old Mixer' && rows.length === 25, 'a product already in the fridge that is not on the list is kept, after the 24');
  ok(rows[0].heading === 'Mixers, Water & Milk' && rows[12].heading === 'Beer, Cider & Hard Soda' && rows.filter((r) => r.heading).length === 2, 'exactly two subheadings, on Cranberry Juice and Heineken Zero');
  ok(rows.slice(0, 12).every((r) => r.loc === 'Walk in fridge(Downstairs)') && rows.slice(12, 24).every((r) => /alcohol storeroom/i.test(r.loc)), 'collected from the walk-in fridge (mixers) and the Alcohol storeroom (beer)');
  ok(rows.slice(0, 24).every((r) => r.method === 'manual' && r.parLevel === null && r.status === 'active'), 'all staff-entered, no target levels, all active');
  ok(rows.slice(12, 24).every((r) => r.unitPlural === 'packs'), 'beer and cider keep their pack units');
  const hk = rows.find((r) => r.name === 'Heineken');
  ok(hk.id === before.id && hk.photoPath === before.photoPath, 'existing product kept its id and photo');
  ok(rows.find((r) => /whipped cream/i.test(r.name)).status === 'active', 'archived Whipped cream was brought back instead of a duplicate');
  const [{ n: productsAfter }] = await sql`select count(*)::int as n from products`;
  ok(productsAfter - productsBefore === 11, `11 missing products added (Whipped cream reused) (no duplicates): ${productsAfter - productsBefore}`);
  const dupes = await sql`select lower(p.name) as n, count(*) from products p join departments d on d.id = p.department_id where d.name = 'Gold Class Bar' group by 1 having count(*) > 1`;
  ok(dupes.length === 0, 'no duplicate product names in Gold Class Bar');
  const [area] = await sql`select guide_text from check_areas a join departments d on d.id = a.department_id where d.name = 'Gold Class Bar' and a.name = 'BOH bar fridge'`;
  ok(area.guideText === 'Refill FOH first.', 'the fridge keeps the "Refill FOH first." reminder');

  // ---- Staff screen ----
  const b = await chromium.launch(); const errs = [];
  for (const [name, opts] of [['phone', devices['iPhone 13']], ['desktop', { viewport: { width: 1366, height: 900 } }]]) {
    const c = await b.newContext(opts); const P = await c.newPage(); P.on('pageerror', (e) => errs.push(e.message));
    await P.goto(B + '/'); await P.waitForSelector('.dcard2');
    await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');
    const seq = await P.$$eval('.area > .prows > *', (els) => els.map((e) => (e.tagName === 'H3' ? `# ${e.textContent}` : e.querySelector('h3')?.textContent)));
    if (name === 'phone') {
      ok(seq[0] === '# Mixers, Water & Milk' && seq[13] === '# Beer, Cider & Hard Soda' && seq.filter((x) => x.startsWith('#')).length === 2, 'two small subheadings in the one list');
      ok(JSON.stringify(seq.filter((x) => !x.startsWith('#')).slice(0, 24)) === JSON.stringify([...MIX, ...BEER].map((n) => (n === 'Whipped Cream' ? 'Whipped cream' : n))), 'staff see all 24 in the physical order');
      ok(await has(P, '.aguide-line', 'Refill FOH first.'), 'one-line reminder: Refill FOH first.');
      ok(await P.locator('.psec, .psec-h').count() === 0, 'no collapsible sections or extra steps');
      await P.click(`${row('Orange Juice')} button.padd`); await P.click(`${row('Orange Juice')} button[aria-label="One more Orange Juice"]`);
      await P.click(`${row('Whipped cream')} button.padd`);
      await P.click(`${row('Guinness')} button.padd`);
      await P.screenshot({ path: `${OUT}/p11-phone.png` });
      await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
      const rooms = await P.$$eval('.room', (els) => els.map((e) => `${e.querySelector('h3').textContent}: ${[...e.querySelectorAll('.line')].map((l) => l.dataset.line).join(', ')}`));
      ok(rooms.includes('Walk in fridge(Downstairs): Orange Juice, Whipped cream') && rooms.some((r) => /^Alcohol storeroom: Guinness$/i.test(r)), 'collection grouped by storeroom: ' + rooms.join(' | '));
      ok(await P.locator('.col-note').count() === 0, 'no "not checked" warning for the untouched products');
      await P.screenshot({ path: `${OUT}/p11-collect.png` });
    } else {
      const cols = await P.$eval('.area .prows', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      const heads = await P.$$eval('.area .prows > h3.phead', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
      const listW = await P.$eval('.area .prows', (el) => Math.round(el.getBoundingClientRect().width));
      ok(heads.length === 2 && heads.every((w) => w >= listW - 8), `desktop (${cols} columns): subheadings span the full width`);
      await P.screenshot({ path: `${OUT}/p11-desktop.png` });
    }
    await c.close();
  }

  // ---- Admin can move things later ----
  await sql`insert into admins (email, display_name, password_hash) values ('admin@example.com', 'Admin', ${await bcrypt.hash('correct-horse-1', 10)}) on conflict do nothing`;
  const ac = await b.newContext({ viewport: { width: 1280, height: 900 } }); const A = await ac.newPage(); A.on('pageerror', (e) => errs.push(e.message));
  await A.goto(B + '/admin/login'); await A.fill('#email', 'admin@example.com'); await A.fill('#password', 'correct-horse-1'); await A.click('button.btn.primary'); await A.waitForURL(/\/admin$/);
  const [{ id: areaId }] = await sql`select a.id from check_areas a join departments d on d.id = a.department_id where d.name = 'Gold Class Bar' and a.name = 'BOH bar fridge'`;
  await A.goto(`${B}/admin/arrange/${areaId}`); await A.waitForSelector('.arr-list');
  ok(await A.inputValue('.arr-head input >> nth=0') === 'Mixers, Water & Milk' && await A.inputValue('.arr-head input >> nth=1') === 'Beer, Cider & Hard Soda', 'Admin > Arrange shows both subheadings');
  await A.fill('.arr-head input >> nth=1', 'Beer & Cider'); await A.click('button:has-text("Save order")');
  ok(await has(A, '.arr-bar', 'Order saved'), 'manager can rename a subheading and save');
  const [h] = await sql`select heading from product_placements where heading like 'Beer%'`;
  ok(h.heading === 'Beer & Cider', 'subheading saved');
  await A.screenshot({ path: `${OUT}/p11-arrange.png` });
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e.message); process.exit(1); });
