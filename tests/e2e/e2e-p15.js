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
  await sql.file('db/updates/2026-11-gold-class-bar-back-bench-walk.sql');
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ ...devices['iPhone 13'] }); const P = await c.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  const foh = await rail(P);
  ok(JSON.stringify(foh) === JSON.stringify(['FOH beer fridge', 'FOH freezer', 'Coffee cupboard', 'Back bench', 'Back shelves', 'Popcorn boxes', 'Cups, Lids & Straws storage', 'Confection']),
    'Check FOH walk: ' + foh.join(' › '));
  // One primary next action: in the bottom bar only, and Done works with nothing entered.
  ok(await primary(P).count() === 1 && await P.locator('main .btn.primary').count() === 0, 'one primary action (bottom bar), none repeated in the area');
  ok(await primaryText(P) === 'Done → FOH freezer', 'FOH beer fridge: "Done → FOH freezer"');
  await primary(P).click(); await waitCur(P, 'FOH freezer');
  ok(await sees(P, '.area-btn:has-text("FOH beer fridge")', 'Complete'), 'Done with nothing entered marks the area complete');
  await primary(P).click(); await waitCur(P, 'Coffee cupboard');

  // Coffee cupboard: the sugar and the overflow stock.
  ok(JSON.stringify(await listOf(P)) === JSON.stringify(['Sugar container', 'Coffee Beans', 'Hot Chocolate Powder', 'Lemon Lime Cordial']), 'Coffee cupboard: sugar, then coffee beans, hot chocolate, cordial');
  ok(await P.locator(`${row('Sugar container')} .pseg button`).innerText() === 'Needs refill' && await P.locator(`${row('Sugar container')} .pnote.task`).count() === 0, 'sugar: one "Needs refill" button (instructions are on the pickup list)');
  await P.click(`${row('Sugar container')} .pseg button`);
  ok(await sees(P, `${row('Sugar container')} .ps`, 'On the Refill FOH list'), '...then "On the Refill FOH list"');
  await P.click(`${row('Coffee Beans')} button.padd`);
  ok(await sees(P, `${row('Coffee Beans')} .ps`, '1 bag'), 'bottles and stock keep + Add and quantity controls');
  ok(await primaryText(P) === 'Done → Back bench', 'Coffee cupboard: "Done → Back bench"');
  await primary(P).click(); await waitCur(P, 'Back bench');

  // Back bench: sink → milkshake machine.
  const bench = await listOf(P);
  const heads = bench.filter((x) => x.startsWith('# ')).map((x) => x.slice(2));
  ok(JSON.stringify(heads) === JSON.stringify(['Liqueurs & Vermouth', 'Cocktail Syrups & Mixers', 'Spirits', 'Red Wines', 'Milkshake Syrups & Flake']), 'Back bench stops: ' + heads.join(' → '));
  const items = bench.filter((x) => !x.startsWith('# '));
  const added = ['Noilly Prat', 'Campari', 'Aperol', 'Disaronno', 'Vok White Crème de Cacao', 'De Kuyper Crème de Café', 'De Kuyper Blue Curaçao', 'De Kuyper Wild Strawberry', 'De Kuyper Triple Sec', 'Cawsey’s Grenadine', 'Master of Mixes Margarita Mixer'];
  ok(added.every((n) => items.includes(n)), 'the 11 bench bottles are on the Back bench');
  const groupOf = (n) => { let g = ''; for (const x of bench) { if (x.startsWith('# ')) g = x.slice(2); else if (x === n) return g; } return null; };
  ok(groupOf('De Kuyper Crème de Café') === 'Liqueurs & Vermouth' && groupOf('Noilly Prat') === 'Liqueurs & Vermouth' && groupOf('Cawsey’s Grenadine') === 'Cocktail Syrups & Mixers' && groupOf('Master of Mixes Margarita Mixer') === 'Cocktail Syrups & Mixers',
    'Crème de Café and vermouth under Liqueurs; Grenadine and Margarita Mixer under Cocktail Syrups & Mixers');
  ok(JSON.stringify(items.slice(0, 5)) === JSON.stringify(['Noilly Prat', 'Campari', 'Aperol', 'Martini Rosso', 'Disaronno'])
    && JSON.stringify(items.slice(11, 17)) === JSON.stringify(['Vok White Crème de Cacao', 'De Kuyper Blue Curaçao', 'De Kuyper Wild Strawberry', 'De Kuyper Crème de Café', 'De Kuyper Triple Sec', 'Cawsey’s Grenadine']),
    'left to right from the sink, as on the bench: ' + items.slice(0, 6).join(', ') + ' …');
  ok(items.indexOf('Alexander Hill Shiraz') + 5 === items.indexOf('Mt Yengo Chilled Shiraz') && items.indexOf('42 Below') < items.indexOf('Bombay Sapphire'), 'red wines and spirits left to right too');
  ok(items[items.length - 1] === 'Cadbury Flake container' && !items.includes('Sugar container'), 'Flake container last (by the milkshake machine); sugar is in the Coffee cupboard');
  ok(!items.includes('Grey Goose') && !items.includes('Patron Silver'), 'glass-shelf bottles stay on Back shelves');
  const [{ n: dup }] = await sql`select count(*)::int as n from (select lower(p.name) from products p join departments d on d.id = p.department_id where d.name = 'Gold Class Bar' and p.status = 'active' group by 1 having count(*) > 1) x`;
  ok(dup === 0, 'no duplicate products after two runs');
  ok(await P.locator('.flow-end .area-skip-flow').isVisible(), 'Skip is still there (end of the list) for an area not checked');
  await P.click(`${row('De Kuyper Crème de Café')} button.padd`);
  await P.click(`${row('Red Claw Shiraz')} button.padd`);
  ok(await sees(P, `${row('Red Claw Shiraz')} .pnote`, 'Grab it from the Wine cupboard') && await P.locator(`${row('De Kuyper Crème de Café')} .pnote`).count() === 0, 'Shiraz: grab from the Wine cupboard; Crème de Café: straight from downstairs');
  ok(await P.locator(`${row('Cadbury Flake container')} .pseg button`).innerText() === 'Needs refill', 'Flake: "Needs refill"');
  await P.click(`${row('Cadbury Flake container')} .pseg button`);
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
  ok(await sees(P, '.area-btn:has-text("Back shelves")', 'Skipped') && await primaryText(P) === 'Next: Popcorn boxes', 'Skip still works; then "Next: Popcorn boxes"');
  await primary(P).click(); await waitCur(P, 'Popcorn boxes');
  ok(await primaryText(P) === 'Done → Cups, Lids & Straws storage', 'Popcorn boxes: "Done → Cups, Lids & Straws storage"');
  await primary(P).click(); await waitCur(P, 'Cups, Lids & Straws storage');
  await primary(P).click(); await waitCur(P, 'Confection');
  ok(await primaryText(P) === 'Done → Refill FOH', 'last area: "Done → Refill FOH"');
  await primary(P).click(); await P.waitForSelector('.room');

  // Refill FOH, grouped by source.
  const rooms = await P.$$eval('.room', (els) => els.map((r) => [r.querySelector('h3').textContent, [...r.querySelectorAll('.line')].map((l) => l.dataset.line)]));
  ok(JSON.stringify(rooms) === JSON.stringify([['Upstairs cupboards', ['Sugar container', 'Cadbury Flake container']], ['Wine cupboard', ['Red Claw Shiraz']]]), 'Refill FOH by source: ' + JSON.stringify(rooms));
  ok(await sees(P, '.line[data-line="Sugar container"]', 'next to the coffee machine') && await sees(P, '.line[data-line="Cadbury Flake container"]', 'fill it to the top'), 'refill instructions on the pickup list');
  ok(!JSON.stringify(rooms).includes('Crème de Café') && !JSON.stringify(rooms).includes('Coffee Beans'), 'downstairs items are not upstairs pickups');
  await P.screenshot({ path: `${OUT}/p15-refill-phone.png`, fullPage: true });
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
