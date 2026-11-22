// Collection list grouped inside each storeroom, so it's quicker to read and pick:
//   Gold Class Bar by type (Beer, cider & hard soda · Wine · Spirits · Syrups…, each category together),
//   Gold Class Kitchen by where it's going (For Freezer 1 · For Freezer 2 · For Walk in fridge…, walk order),
//   each line then just saying its compartment. Group headings count what's done. Candy Bar unchanged.
// Before running: reset the test database, then load gcbar-refill-fixture.sql. The test applies the update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const line = (n) => `.line[data-line="${n}"]`;
const text = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
// Each storeroom → its groups → the lines in each.
const layout = (P) => P.$$eval('.room', (rs) => rs.map((r) => [r.querySelector('h3').textContent,
  [...r.querySelectorAll('.lgrp')].map((g) => [g.dataset.group, [...g.querySelectorAll('.line')].map((l) => l.dataset.line)])]));

async function quick(P, dept, picks) {
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click(`.dcard2:has-text("${dept}") >> nth=0`); await P.click('text=Start quick restock'); await P.waitForSelector('#qsearch');
  for (const [n, q, area] of picks) {
    await P.fill('#qsearch', n); await P.waitForTimeout(250);
    // A product kept in several areas: the row for that area.
    const [pl] = area ? await sql`select x.id from product_placements x join products p on p.id = x.product_id join check_areas c on c.id = x.check_area_id where p.name = ${n} and c.name = ${area}` : [null];
    await P.fill(pl ? `.qpanel .qrow[data-placement="${pl.id}"] .q-num` : `.qpanel .qrow:has(b:text-is("${n}")) .q-num >> nth=0`, String(q)); await P.waitForSelector(`.picked .qrow:has-text("${n}")`);
  }
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.rooms');
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  for (const f of ['refill-foh', 'back-bench-walk', 'foh-lap', 'coffee-cupboard', 'beer-fridge-area']) await sql.file(`db/updates/2026-11-gold-class-bar-${f}.sql`);
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`delete from check_areas where department_id = ${k.id}`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2), ('Dry storage', 4) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact', 'freezer-1-first',
    'no-walk-in-desserts', 'walk-in-third-shelf', 'relish-prep', 'walk-in-fresh-produce', 'bottom-sauce-shelf', 'prep-checklist', 'dry-stock', 'trial']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);
  await sql.file('db/updates/2026-11-collection-groups.sql'); await sql.file('db/updates/2026-11-collection-groups.sql');

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');

  // Gold Class Bar: by type.
  await quick(P, 'Bar', [['Patron Silver', 1], ['Red Claw Shiraz', 2], ['Vanilla Syrup', 1], ['Grey Goose', 1], ['Curatif Negroni', 2]]);
  const bar = await layout(P);
  const store = bar.find(([r]) => /alcohol storeroom/i.test(r));
  ok(!!store, 'Bar: the Alcohol storeroom: ' + JSON.stringify(bar));
  const groups = store[1].map(([g]) => g);
  ok(groups.indexOf('Wine') < groups.indexOf('Spirits') && groups.indexOf('Spirits') < groups.indexOf('Syrups'), 'Bar: types in shelf order: ' + groups.join(' · '));
  const spirits = store[1].find(([g]) => g === 'Spirits')[1];
  ok(spirits.length === 2 && spirits.includes('Grey Goose') && spirits.includes('Patron Silver'), 'Bar: Grey Goose (Vodka) and Patron (Tequila) together under Spirits: ' + spirits.join(', '));
  ok(spirits[0] === 'Grey Goose', 'Bar: vodka before tequila (category order)');
  ok(store[1].find(([g]) => g === 'Wine')[1].join() === 'Red Claw Shiraz', 'Bar: Red Claw Shiraz under Wine');
  ok((await text(P, `${line('Grey Goose')}`)).includes('For '), 'Bar: each line still says where it goes');
  ok((await text(P, `.lgrp[data-group="Spirits"] .lgrp-h`)).endsWith('0 of 2'), 'Bar: "Spirits 0 of 2"');
  await P.click(`${line('Grey Goose')} .l-all`); await P.click(`${line('Patron Silver')} .l-all`); await P.waitForTimeout(300);
  ok(await P.locator('.lgrp[data-group="Spirits"] .lgrp-h .ic').count() === 1, 'Bar: both collected: the group shows a tick');
  await P.screenshot({ path: `${OUT}/p28-bar.png`, fullPage: true });

  // Gold Class Kitchen: by where it's going.
  await quick(P, 'Kitchen', [['Beef Patties', 2, 'Freezer 1 · Upper right'], ['Avocado (frozen)', 1], ['Fries', 1, 'Chest freezer'], ['Sopressa', 2], ['Pizza cheese (portioned bags)', 3, 'Walk in fridge · Fourth shelf']]);
  const kit = await layout(P);
  const freezer = kit.find(([r]) => /walk in freezer/i.test(r));
  ok(!!freezer && JSON.stringify(freezer[1].map(([g]) => g)) === JSON.stringify(['For Freezer 1', 'For Chest freezer']), 'Kitchen: downstairs freezer by destination, in walk order: ' + JSON.stringify(freezer && freezer[1]));
  ok(freezer[1][0][1].includes('Beef Patties') && freezer[1][0][1].includes('Avocado (frozen)') && freezer[1][1][1].join() === 'Fries', 'Kitchen: patties and avocado for Freezer 1, fries for the chest freezer');
  ok((await text(P, line('Beef Patties'))).includes('Upper right') && !(await text(P, line('Beef Patties'))).includes('For Freezer 1'), 'Kitchen: the line just says the compartment ("Upper right")');
  ok(JSON.stringify(kit.find(([r]) => r === 'Freezer 2')[1]) === JSON.stringify([['For Walk in fridge', ['Pizza cheese (portioned bags)']]]), 'Kitchen: pizza cheese from Freezer 2, for the walk-in fridge');
  ok((await text(P, line('Pizza cheese (portioned bags)'))).includes('Fourth shelf'), 'Kitchen: "Fourth shelf" on the line');
  ok(await P.locator('.take-down').count() === 1 && await P.locator('.rooms > *').first().evaluate((e) => e.classList.contains('take-down')), 'Kitchen: the container reminder still above the first storeroom');
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no sideways scrolling');
  await P.screenshot({ path: `${OUT}/p28-kitchen.png`, fullPage: true });

  // Candy Bar: not grouped.
  const [cb] = await sql`select collect_group from departments where name = 'Candy Bar'`;
  ok(cb.collectGroup === null, 'Candy Bar: not grouped');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
