// Gold Class Bar: Equal packets work like the sugar packets. At the Coffee machine, a "Needs refill" tap (no amount);
// on Upstairs, the Upstairs cupboards list says to take the Equal container up and fill it to the top; no separate
// Equal stock row upstairs; nothing on the downstairs list for it.
// Before running: reset the test database, then load gcbar-refill-fixture.sql. The test applies the update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const goArea = async (P, n) => { await P.click(`.area-btn:has-text("${n}")`); await P.waitForSelector(`.area-btn.cur:has-text("${n}")`); await P.waitForTimeout(200); };
const text = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  for (const f of ['refill-foh', 'back-bench-walk', 'foh-lap', 'coffee-cupboard', 'beer-fridge-area']) await sql.file(`db/updates/2026-11-gold-class-bar-${f}.sql`);
  // As it is live: Equal packets entered by staff, in the Upstairs cupboards and at the Coffee machine.
  const [d] = await sql`select id from departments where name = 'Gold Class Bar'`;
  const [p] = await sql`insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
    values (${d.id}, 'Equal packets', 'packet', 'packets', 'manual', (select id from storage_locations where name ilike 'alcohol%' limit 1), 999) returning id`;
  await sql`insert into product_placements (product_id, check_area_id, sort_order) select ${p.id}, a.id, case when a.name = 'Upstairs cupboards' then 1 else 2 end
    from check_areas a where a.department_id = ${d.id} and a.name in ('Upstairs cupboards', 'Coffee machine')`;
  await sql.file('db/updates/2026-11-gold-class-bar-equal-refill.sql'); await sql.file('db/updates/2026-11-gold-class-bar-equal-refill.sql');
  const rows = await sql`select c.name, q.method, a.name as pickup from product_placements x join products q on q.id = x.product_id join check_areas c on c.id = x.check_area_id
    left join check_areas a on a.id = x.pickup_area_id where q.id = ${p.id}`;
  ok(rows.length === 1 && rows[0].name === 'Coffee machine' && rows[0].method === 'routine' && rows[0].pickup === 'Upstairs cupboards', 'script (run twice): one row, at the Coffee machine, a refill task from the Upstairs cupboards');

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  await goArea(P, 'Coffee cupboard');
  const order = await P.$$eval('article.prow h3', (e) => e.map((x) => x.textContent));
  ok(order.indexOf('Equal packets') === order.indexOf('Sugar container') + 1, 'Coffee machine: Equal straight after the sugar');
  ok(await P.locator(`${row('Equal packets')} .pseg button`).count() >= 1 && await P.locator(`${row('Equal packets')} .qty-input, ${row('Equal packets')} button.padd`).count() === 0,
    'Equal: the same refill button as the sugar, no amount');
  ok(await P.locator(`${row('Equal packets')} .pseg button`).first().innerText() === await P.locator(`${row('Sugar container')} .pseg button`).first().innerText(), 'same wording as the sugar: ' + await P.locator(`${row('Equal packets')} .pseg button`).first().innerText());
  await P.click(`${row('Sugar container')} .pseg button >> nth=0`); await P.click(`${row('Equal packets')} .pseg button >> nth=0`); await P.waitForTimeout(300);
  await P.screenshot({ path: `${OUT}/p29-coffee-machine.png`, fullPage: true });

  await P.click('.rbar .stage:has-text("Upstairs")'); await P.waitForSelector('.area-btn.cur');
  await goArea(P, 'Upstairs cupboards');
  ok(await P.locator(`.grab ${line('Equal packets')}`).count() === 1 && (await text(P, `.grab ${line('Equal packets')}`)).includes('Take the Equal container (next to the coffee machine) to the upstairs cupboard and fill it to the top'),
    'Upstairs cupboards: "Take the Equal container … fill it to the top" on the grab list, like the sugar');
  ok(await P.locator(`.grab ${line('Sugar container')}`).count() === 1, '…with the sugar');
  ok(await P.locator(`.prows ${row('Equal packets')}`).count() === 0, 'no separate Equal stock row upstairs');
  await P.screenshot({ path: `${OUT}/p29-upstairs.png`, fullPage: true });
  await P.click(`.grab ${line('Equal packets')} button.l-all`); await P.waitForSelector(`.grab ${line('Equal packets')}.done`);
  ok(true, 'refilled: one tick');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
