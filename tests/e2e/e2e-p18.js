// Gold Class Kitchen → Defrost: every item its own row (Pull or Not needed), where to grab it, where it
// goes, the collection list grouped by freezer, and suggestions from tomorrow's admits.
// Before running: reset the test database. The test applies the update script and sets two targets.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 6000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const row = (n) => `article.prow:has(h3:text-is('${n}'))`;
const line = (n) => `.line[data-line='${n}']`;
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql.file('db/updates/2026-11-gold-class-kitchen-defrost.sql');
  // As on the live site, Defrost is the Kitchen's only area (the sample data has others).
  await sql`update check_areas set active = false where name <> 'Defrost' and department_id = (select id from departments where name = 'Gold Class Kitchen')`;
  // Targets on two items (the rest have none: manual entry). Beef: 8 portions a 1 kg bag.
  await sql`update product_placements x set ready_targets = '[{"min":0,"max":150,"qty":24},{"min":151,"qty":36}]'::jsonb
    from products p where p.id = x.product_id and p.name = '9" Pizza Bases'`;
  await sql`update product_placements x set ready_targets = '[{"min":0,"qty":40}]'::jsonb, ready_per = 8
    from products p where p.id = x.product_id and p.name = 'Pulled Beef (Bao)'`;
  // Buns in tubs have a separate count unit but no conversion: manual, even with a target.
  await sql`update product_placements x set ready_targets = '[{"min":0,"qty":30}]'::jsonb
    from products p where p.id = x.product_id and p.name = 'Buns (Portioned Tubs)'`;

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  // 1. Defrost is the first section, every item its own row.
  ok(await sees(P, '#area-name', 'Defrost'), 'opens on Defrost (first in the Kitchen)');
  const names = await P.locator('article.prow h3').allInnerTexts();
  ok(names.length === 16 && names.includes('Bao Buns') && names.includes('Buns (Portioned Tubs)') && names.includes('Sticky Date'), `16 rows, bao buns and portioned buns separate (${names.length})`);
  ok(await sees(P, `${row('Beef Patties')} .dn-grab`, 'Freezer 1') && await sees(P, `${row('Beef Patties')} .dn-fall`, 'downstairs walk-in freezer')
    && await sees(P, `${row('Beef Patties')} .dn-put`, 'Right side of the under-salad-bar bench fridge'), 'row shows Grab, If empty and Put');
  ok(await P.locator(`${row('Bao Buns')} .dn-fall`).count() === 0, 'no "If empty" where none is confirmed (Bao buns)');
  ok(await sees(P, '.admits', 'Gold Class admits'), 'admits box (targets exist)');
  await P.screenshot({ path: `${OUT}/p18-defrost-rows.png` });

  // 2. Manual items: Pull or Not needed.
  await P.click(`${row('Bao Buns')} button.padd`);
  await P.click(`${row('Bao Buns')} button[aria-label="One more Bao Buns"]`);
  ok(await sees(P, `${row('Bao Buns')} .ps`, 'Pull 2 buns'), 'Bao buns: Pull 2 buns');
  await P.click(`${row('Brownie')} button.pnn`);
  ok(await sees(P, `${row('Brownie')} .ps`, 'Not needed'), 'Brownie: Not needed');
  await P.click(`${row('Grilled Chicken')} button.padd`);
  await P.fill(`${row('Grilled Chicken')} #q-${await P.getAttribute(row('Grilled Chicken'), 'data-placement')}`, '6'); await P.keyboard.press('Tab');
  ok(await sees(P, `${row('Grilled Chicken')} .ps`, 'Pull 6 portions'), 'Grilled chicken: typed 6');

  // 3. Admits: suggestions from targets and what's ready (pizza bases 24 − 10 = 14; beef 40 − 12 = 28 portions → 4 bags).
  await P.fill('#admits-in', '120'); await P.keyboard.press('Enter');
  ok(await sees(P, `${row('9" Pizza Bases')} .ps`, 'Count what'), 'with admits but no ready count: asks to count what\'s ready');
  const rid = async (n) => `#r-${await P.getAttribute(row(n), 'data-placement')}`;
  await P.fill(await rid('9" Pizza Bases'), '10'); await P.keyboard.press('Tab');
  ok(await sees(P, `${row('9" Pizza Bases')} .ps`, 'Pull 14 bases'), 'pizza bases: target 24, 10 ready → Pull 14 bases (suggested)');
  ok(await sees(P, `${row('9" Pizza Bases')} .dr-work`, 'Target 24 bases for 0–150 admits'), 'shows how it was worked out');
  await P.fill(await rid('Pulled Beef (Bao)'), '12'); await P.keyboard.press('Tab');
  ok(await sees(P, `${row('Pulled Beef (Bao)')} .ps`, 'Pull 4 bags') && await sees(P, `${row('Pulled Beef (Bao)')} .dr-work`, '28 portions → 4 bags'), 'pulled beef: 40 − 12 = 28 portions → 4 bags');
  ok(await P.locator(`${row('Buns (Portioned Tubs)')} .dr-ready`).count() === 0, 'portioned buns: no conversion set, so manual (no ready count)');
  // Staff can change a suggestion, and go back to it.
  await P.click(`${row('9" Pizza Bases')} button[aria-label="One more 9\\" Pizza Bases"]`);
  ok(await sees(P, `${row('9" Pizza Bases')} .ps`, 'Pull 15 bases') && await sees(P, `${row('9" Pizza Bases')} .dr-work`, 'suggested 14'), 'changed to 15 (suggested 14 still shown)');
  // Forecast up: the pizza target moves to 36 → 26.
  await P.fill('#admits-in', '200'); await P.keyboard.press('Enter');
  ok(await sees(P, `${row('Pulled Beef (Bao)')} .ps`, 'Pull 4 bags'), 'admits 200: beef still 4 bags (one range)');
  await P.click(`${row('9" Pizza Bases')} .dr-back`);
  ok(await sees(P, `${row('9" Pizza Bases')} .ps`, 'Pull 26 bases'), 'back to suggested: 36 − 10 = 26 for 200 admits');
  await P.screenshot({ path: `${OUT}/p18-defrost-suggested.png`, fullPage: true });
  const [s] = await waitDb(() => sql`select forecast_admits from restock_sessions where kind = 'full'`, (r) => r[0]?.forecastAdmits === 200);
  ok(s?.forecastAdmits === 200, 'admits saved on the restock (200)');

  // 4. Collection list, grouped by freezer, with where it goes.
  await P.click('.rbar .stage:has-text("Collect")'); await P.waitForSelector('.line');
  const rooms = await P.locator('.room-h h3').allInnerTexts();
  ok(rooms.join('|') === 'Freezer 1|Freezer 2', `grouped by freezer: ${rooms.join(', ')}`);
  ok(await sees(P, `.room:has(h3:text-is("Freezer 2")) ${line('Grilled Chicken')}`, '6'), 'Freezer 2: grilled chicken 6');
  ok(await sees(P, `${line('Pulled Beef (Bao)')} .dn-put`, 'for the morning team to portion') && await sees(P, `${line('Pulled Beef (Bao)')}`, '4'), 'beef line: 4 bags, Put note');
  ok(await P.locator(line('Brownie')).count() === 0, 'Not needed items are not on the list');
  await P.screenshot({ path: `${OUT}/p18-defrost-collect.png`, fullPage: true });
  for (const n of ['Bao Buns', 'Grilled Chicken', 'Pulled Beef (Bao)', '9" Pizza Bases']) await P.click(`${line(n)} button.l-all`);
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');
  const [f] = await waitDb(() => sql`select status from restock_sessions where kind = 'full'`, (r) => r[0]?.status === 'finished');
  ok(f?.status === 'finished', 'finished');

  // 5. Admin: change an item's targets, and add a new item to Defrost.
  await sql`insert into admins (email, display_name, password_hash) values ('admin@example.com', 'Admin', ${await bcrypt.hash('correct-horse-1', 10)}) on conflict do nothing`;
  const A = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); A.on('pageerror', (e) => errs.push(e.message));
  await A.goto(B + '/admin/login'); await A.fill('#email', 'admin@example.com'); await A.fill('#password', 'correct-horse-1'); await A.click('button.btn.primary'); await A.waitForURL(/\/admin$/);
  const [pz] = await sql`select p.id, x.check_area_id from products p join product_placements x on x.product_id = p.id where p.name = '9" Pizza Bases'`;
  await A.goto(`${B}/admin/products/${pz.id}`);
  const tgt = `#tgt_${pz.checkAreaId}`;
  ok(await A.inputValue(tgt) === '0-150: 24\n151+: 36' && await A.inputValue(`#grab_${pz.checkAreaId}`) === 'Freezer 1, lower-left door: the labelled 9" Pizza Bases drawer', 'admin: defrost details shown for the area');
  await A.fill(tgt, '0-100: 20\n101-200: 30\n201+: 40'); await A.click('button.btn.primary:has-text("Save changes")'); await A.waitForURL(/saved=/);
  const [pz2] = await sql`select ready_targets from product_placements where product_id = ${pz.id}`;
  ok(pz2.readyTargets.map((t) => `${t.min}-${t.max}:${t.qty}`).join(' ') === '0-100:20 101-200:30 201-null:40', 'admin: targets saved');
  await A.goto(`${B}/admin/products/${pz.id}`); await A.fill(tgt, '0-100: 20\n50-200: 30'); await A.click('button.btn.primary:has-text("Save changes")');
  ok(await sees(A, '[role="alert"], .banner, .err', 'overlap'), 'admin: overlapping ranges refused');
  // A new item, ticked into Defrost as "staff enter" (no notes needed to be a Defrost row).
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await A.goto(`${B}/admin/products/new?dept=${k.id}`);
  await A.fill('#name', 'Croissants'); await A.fill('#unitSingular', 'croissant'); await A.fill('#unitPlural', 'croissants');
  await A.selectOption('#defaultLocationId', { label: 'Freezer 1' });
  await A.check('input[name="method"][value="manual"]'); await A.check(`input[name="area"][value="${pz.checkAreaId}"]`);
  await A.click('button.btn.primary:has-text("Add product")'); await A.waitForURL(/saved=1/);
  const [cr] = await sql`select x.sort_order, x.grab_note from product_placements x join products p on p.id = x.product_id where p.name = 'Croissants'`;
  ok(cr && cr.grabNote === null, 'admin: new Defrost item added (at the end)');
  // A fresh night on another device (tonight's restock is finished).
  await sql`delete from shortages`; await sql`delete from session_items`; await sql`delete from session_areas`; await sql`delete from restock_sessions`;
  const P2 = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P2.on('pageerror', (e) => errs.push(e.message));
  await P2.goto(B + '/'); await P2.waitForSelector('.dcard2'); await P2.click('.who'); await P2.fill('#staffname', 'Jo'); await P2.click('.sheet .btn.primary');
  await P2.click('.dcard2:has-text("Kitchen") >> nth=0'); await P2.click('.type-full button.btn.primary'); await P2.waitForSelector(row('Croissants'));
  ok(await P2.locator(`${row('Croissants')} button.pnn`).count() === 1, 'new item: Pull or Not needed, like the rest');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
