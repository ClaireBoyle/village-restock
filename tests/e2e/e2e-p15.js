// Gold Class Bar Check FOH: Back bench in walking order (sink → milkshake machine), the new Coffee cupboard,
// the bottles added to the bench, one next action ("Done → Back shelves"), Needs refill containers, and
// Refill FOH grouped by source. Phone, iPad and laptop.
// Before running: reset the test database, then load gcbar-refill-fixture.sql. The test applies the
// db/updates scripts itself.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 6000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const rail = (P) => P.$$eval('.area-btn b', (els) => els.map((e) => e.textContent));
const primary = (P) => P.locator('.dock .dock-acts .btn.primary');
const primaryText = async (P) => (await primary(P).innerText()).replace(/\s+/g, ' ').trim();
const curArea = (P) => P.locator('.area-btn.cur b').innerText();
const listOf = (P) => P.$$eval('.area > .prows > *', (els) => els.map((e) => (e.matches('.phead') ? `# ${e.querySelector('span')?.textContent ?? e.textContent}` : e.querySelector('h3')?.textContent)));
const waitCur = async (P, name) => { await P.waitForSelector(`.area-btn.cur:has-text("${name}")`); await P.waitForTimeout(150); };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql.file('db/updates/2026-11-gold-class-bar-refill-foh.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-back-bench-walk.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-foh-lap.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-back-bench-walk.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-foh-lap.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-coffee-cupboard.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-coffee-cupboard.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-bench-fridge-stop.sql'); // superseded: changes nothing
  await sql.file('db/updates/2026-11-gold-class-bar-beer-fridge-area.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-refill-foh.sql'); // re-running earlier scripts keeps the fridge where it is
  await sql.file('db/updates/2026-11-gold-class-bar-foh-lap.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-beer-fridge-area.sql');
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ ...devices['iPhone 13'] }); const P = await c.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  const foh = await rail(P);
  ok(JSON.stringify(foh) === JSON.stringify(['FOH freezer', 'Confection', 'Popcorn boxes', 'Back bench', 'Back shelves', 'Milkshake station', 'Cups, Lids & Straws storage', 'Coffee cupboard', 'FOH beer fridge']),
    'Check FOH follows the lap of the bar: ' + foh.join(' › '));
  // One primary next action: in the bottom bar only, and Done works with nothing entered.
  ok(await primary(P).count() === 1 && await P.locator('main .btn.primary').count() === 0, 'one primary action (bottom bar), none repeated in the area');
  ok(await primaryText(P) === 'Done → Confection', 'FOH freezer: "Done → Confection" (the confection wall is alongside)');
  await primary(P).click(); await waitCur(P, 'Confection');
  ok(await sees(P, '.area-btn:has-text("FOH freezer")', 'Checked · nothing needed'), 'Done with nothing entered: "Checked · nothing needed"');
  ok(await primaryText(P) === 'Done → Popcorn boxes', 'Confection: "Done → Popcorn boxes"');
  await primary(P).click(); await waitCur(P, 'Popcorn boxes');
  // Jump ahead to the bench (Popcorn boxes stays open, so the flow comes back to it at the end).
  await P.click('.area-btn:has-text("Back bench")'); await waitCur(P, 'Back bench');

  // Back bench: sink → milkshake machine.
  const bench = await listOf(P);
  const heads = bench.filter((x) => x.startsWith('# ')).map((x) => x.slice(2));
  ok(JSON.stringify(heads) === JSON.stringify(['Liqueurs & Vermouth', 'Cocktail Syrups & Mixers', 'Spirits', 'Red Wines']), 'Back bench from the sink: ' + heads.join(' → '));
  const items = bench.filter((x) => !x.startsWith('# '));
  const added = ['Monin Passion Fruit Purée', 'Noilly Prat', 'Campari', 'Aperol', 'Disaronno', 'Vok White Crème de Cacao', 'De Kuyper Crème de Café', 'De Kuyper Blue Curaçao', 'De Kuyper Wild Strawberry', 'De Kuyper Triple Sec', 'Cawsey’s Grenadine', 'Master of Mixes Margarita Mixer'];
  ok(added.every((n) => items.includes(n)), 'the 12 bench bottles are on the Back bench');
  const groupOf = (n) => { let g = ''; for (const x of bench) { if (x.startsWith('# ')) g = x.slice(2); else if (x === n) return g; } return null; };
  ok(groupOf('De Kuyper Crème de Café') === 'Liqueurs & Vermouth' && groupOf('Noilly Prat') === 'Liqueurs & Vermouth' && groupOf('Cawsey’s Grenadine') === 'Cocktail Syrups & Mixers' && groupOf('Master of Mixes Margarita Mixer') === 'Cocktail Syrups & Mixers',
    'Crème de Café and vermouth under Liqueurs; Grenadine and Margarita Mixer under Cocktail Syrups & Mixers');
  ok(JSON.stringify(items.slice(0, 5)) === JSON.stringify(['Noilly Prat', 'Campari', 'Aperol', 'Martini Rosso', 'Disaronno'])
    && JSON.stringify(items.slice(11, 17)) === JSON.stringify(['Vok White Crème de Cacao', 'De Kuyper Blue Curaçao', 'De Kuyper Wild Strawberry', 'De Kuyper Crème de Café', 'De Kuyper Triple Sec', 'Monin Passion Fruit Purée']) && items[17] === 'Cawsey’s Grenadine',
    'left to right from the sink, as on the bench: ' + items.slice(0, 6).join(', ') + ' …');
  ok(items.indexOf('Alexander Hill Shiraz') + 5 === items.indexOf('Mt Yengo Chilled Shiraz') && items.indexOf('42 Below') < items.indexOf('Bombay Sapphire'), 'red wines and spirits left to right too');
  const secs = await P.$$eval('.area .psec .psec-t b', (e) => e.map((x) => x.textContent));
  ok(secs.length === 0, 'the FOH beer fridge is no longer part of the bench stop');
  ok(items[items.length - 1] === 'Mt Yengo Chilled Shiraz' && !items.includes('Cadbury Flake container') && !items.includes('Vanilla Syrup') && !items.includes('Sugar container'),
    'the bench ends with the red wine; milkshake syrups, Flake and sugar are at their own stops');
  ok(!items.includes('Grey Goose') && !items.includes('Patron Silver'), 'glass-shelf bottles stay on Back shelves');
  const [{ n: dup }] = await sql`select count(*)::int as n from (select lower(p.name) from products p join departments d on d.id = p.department_id where d.name = 'Gold Class Bar' and p.status = 'active' group by 1 having count(*) > 1) x`;
  ok(dup === 0, 'no duplicate products after two runs');
  const shelf = (await sql`select p.name, coalesce(pl.unit_plural, p.unit_plural) as unit from product_placements pl join products p on p.id = pl.product_id join check_areas a on a.id = pl.check_area_id
    join departments d on d.id = a.department_id where d.name = 'Gold Class Bar' and a.name = 'Back shelves' order by pl.sort_order`).map((r) => r.name);
  ok(shelf.indexOf('St-Germain') === shelf.indexOf('Kraken Black Spiced') + 1 && shelf.indexOf('St-Germain') + 1 === shelf.indexOf('Grey Goose'), 'St-Germain on the Back shelves between Kraken and Grey Goose');
  const [hc] = await sql`select unit_plural from products p join departments d on d.id = p.department_id where d.name = 'Gold Class Bar' and p.name = 'Hot Chocolate Powder'`;
  ok(hc?.unitPlural === 'bags', 'hot chocolate counted in bags');
  ok(await P.locator('.flow-end .area-skip-flow').isVisible(), 'Skip is still there (end of the list) for an area not checked');
  await P.click(`${row('De Kuyper Crème de Café')} button.padd`);
  await P.click(`${row('Red Claw Shiraz')} button.padd`);
  ok(await sees(P, `${row('Red Claw Shiraz')} .pnote`, 'Grab it from the Wine cupboard') && await P.locator(`${row('De Kuyper Crème de Café')} .pnote`).count() === 0, 'Shiraz: grab from the Wine cupboard; Crème de Café: straight from downstairs');
  ok(await primaryText(P) === 'Done → Back shelves', 'Back bench: "Done → Back shelves"');

  // Phone: stacked list, easy-to-tap controls.
  const xs = await P.$$eval('.area > .prows > article.prow', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
  const sizes = await P.$$eval('.area article.prow button.padd, .area article.prow .pstep button, .area article.prow .pseg button, .dock .dock-acts .btn', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  ok(xs.length === 1, 'phone: one stacked column');
  ok(Math.min(...sizes) >= 44, `phone: controls at least 44px tall (smallest ${Math.min(...sizes)}px)`);
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no sideways scrolling');
  await P.screenshot({ path: `${OUT}/p15-bench-phone.png` });
  // iPad and laptop: the same walk and the same next action.
  for (const [name, vp] of [['ipad', { width: 834, height: 1194 }], ['laptop', { width: 1366, height: 900 }]]) {
    await P.setViewportSize(vp); await P.waitForTimeout(250);
    ok(JSON.stringify(await rail(P)) === JSON.stringify(foh) && await primaryText(P) === 'Done → Back shelves'
      && JSON.stringify((await listOf(P)).filter((x) => x.startsWith('# '))) === JSON.stringify(heads.map((h) => `# ${h}`)), `${name}: same walk, same stops, same "Done → Back shelves"`);
    ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: no sideways scrolling`);
    await P.screenshot({ path: `${OUT}/p15-bench-${name}.png` });
  }
  await P.setViewportSize(devices['iPhone 13'].viewport); await P.waitForTimeout(200);

  // Done → Back shelves; Skip still works; then Done through the rest.
  await primary(P).click(); await waitCur(P, 'Back shelves');
  await P.click('.flow-end .area-skip-flow'); await P.click('.skip-panel .chip >> nth=1');
  ok(await sees(P, '.area-btn:has-text("Back shelves")', 'Skipped') && await primaryText(P) === 'Next: Milkshake station', 'Skip still works; then "Next: Milkshake station"');
  await primary(P).click(); await waitCur(P, 'Milkshake station');
  const shake = await listOf(P);
  ok(shake[0] === 'Vanilla Syrup' && shake[shake.length - 1] === 'Cadbury Flake container' && shake.length === 9, 'Milkshake station: the 8 syrups, then the Flake container');
  ok(await P.locator(`${row('Cadbury Flake container')} .pseg button`).innerText() === 'Needs refill', 'Flake: "Needs refill"');
  await P.click(`${row('Cadbury Flake container')} .pseg button`);
  ok(await primaryText(P) === 'Done → Cups, Lids & Straws storage', 'then across the aisle: "Done → Cups, Lids & Straws storage"');
  await primary(P).click(); await waitCur(P, 'Cups, Lids & Straws storage');
  ok(await primaryText(P) === 'Done → Coffee cupboard', 'up the left side: "Done → Coffee cupboard"');
  await primary(P).click(); await waitCur(P, 'Coffee cupboard');
  ok(JSON.stringify(await listOf(P)) === JSON.stringify(['# Top shelf', 'Coffee Beans', 'Hot Chocolate Powder', 'Decaf Coffee', 'Chai Powder', 'Matcha Powder', 'Biscoff Biscuits',
    '# Bottom shelf', 'Lemon Cordial', 'Lime Cordial', 'Raspberry Cordial', 'Bitters', 'Orange Bitters', 'Honey', 'Hazelnut Syrup']), 'Coffee cupboard: top shelf, then bottom shelf');
  const tea = P.locator('.psec:has-text("Tea bags")');
  ok(await tea.locator('article.prow').count() === 0 && await sees(P, '.psec:has-text("Tea bags") .psec-h', '5 products'), 'tea bags: a closed tab ("5 products")');
  await tea.locator('.psec-h').click();
  ok(JSON.stringify(await tea.locator('article.prow h3').allInnerTexts()) === JSON.stringify(['Earl Grey Tea Bags', 'English Breakfast Tea Bags', 'Chamomile Tea Bags', 'Green Tea Bags', 'Peppermint Tea Bags'])
    && await sees(P, '.psec:has-text("Tea bags") .psec-hint', 'tea bag tubs'), '...opens to the five teas, with "check the tea bag tubs"');
  await tea.locator('article.prow:has(h3:text-is("Earl Grey Tea Bags")) button.padd').click();
  ok(await sees(P, '.psec:has-text("Coffee machine")', 'Sugar container'), 'the sugar container is at the coffee machine');
  const [cord] = await sql`select count(*)::int as n from products p join departments d on d.id = p.department_id where d.name = 'Gold Class Bar' and p.status = 'active' and p.name = 'Lemon Lime Cordial'`;
  const [alcs] = await sql`select count(*)::int as n from product_placements pl join products p on p.id = pl.product_id join check_areas a on a.id = pl.check_area_id
    join storage_locations l on l.id = p.default_location_id where a.name in ('Coffee cupboard', 'Tea bags') and lower(l.name) <> 'alcohol storeroom'`;
  ok(cord.n === 0 && alcs.n === 0, 'Lemon Lime Cordial split into Lemon and Lime; everything in the cupboard comes from the Alcohol storeroom');
  ok(await P.locator(`${row('Sugar container')} .pseg button`).innerText() === 'Needs refill' && await P.locator(`${row('Sugar container')} .pnote.task`).count() === 0, 'sugar: one "Needs refill" button (instructions are on the pickup list)');
  await P.click(`${row('Sugar container')} .pseg button`);
  ok(await sees(P, `${row('Sugar container')} .ps`, 'To grab upstairs'), '...then "To grab upstairs"');
  await P.click(`${row('Coffee Beans')} button.padd`);
  ok(await sees(P, `${row('Coffee Beans')} .ps`, '1 bag'), 'stock keeps + Add and quantity controls');
  ok(await primaryText(P) === 'Done → FOH beer fridge', 'then the FOH beer fridge, the last stop before upstairs: "Done → FOH beer fridge"');
  await primary(P).click(); await waitCur(P, 'FOH beer fridge');
  ok(await P.locator('.area > .prows article.prow').count() === 23 && await P.locator('article.prow:has(h3:text-is("Heineken")) .pnote').count() === 0, 'FOH beer fridge: its own stop, 23 products, no "Already … for" notes');
  ok(await primaryText(P) === 'Done → Popcorn boxes', 'an area still open earlier in the lap comes next: "Done → Popcorn boxes"');
  await primary(P).click(); await waitCur(P, 'Popcorn boxes');
  ok(await primaryText(P) === 'Done → Upstairs', 'last open area: "Done → Upstairs"');
  await primary(P).click(); await P.waitForSelector('.area-btn.cur:has-text("BOH bar fridge")');

  // Upstairs, one screen per spot: grab for the bar, then bring up from downstairs.
  ok(await P.locator('.grab').count() === 0 && await sees(P, '.bring-h', 'Bring up from downstairs'), 'BOH bar fridge: nothing to grab, so straight to the top-up check');
  await primary(P).click(); await P.waitForSelector('.area-btn.cur:has-text("Walk in fridge")');
  await primary(P).click(); await P.waitForSelector('.area-btn.cur:has-text("Upstairs cupboards")');
  const rooms = await P.$$eval('.grab .grab-group', (els) => els.map((g) => [g.querySelector('.phead')?.textContent ?? '', [...g.querySelectorAll('.line')].map((l) => l.dataset.line)]));
  ok(JSON.stringify(rooms) === JSON.stringify([['Upstairs cupboards', ['Cadbury Flake container', 'Sugar container']], ['Wine cupboard', ['Red Claw Shiraz']]]), 'Upstairs cupboards: grab for the bar, by cupboard: ' + JSON.stringify(rooms));
  ok(await sees(P, '.grab .line[data-line="Sugar container"]', 'next to the coffee machine') && await sees(P, '.grab .line[data-line="Cadbury Flake container"]', 'fill it to the top'), 'refill instructions on the grab list');
  ok(!JSON.stringify(rooms).includes('Crème de Café') && !JSON.stringify(rooms).includes('Coffee Beans') && !JSON.stringify(rooms).includes('Earl Grey'), 'downstairs items are not upstairs pickups');
  ok(await primaryText(P) === 'Done → Collect downstairs', 'then "Done → Collect downstairs" (coffee beans and Crème de Café are on it)');
  await P.screenshot({ path: `${OUT}/p15-refill-phone.png`, fullPage: true });
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
