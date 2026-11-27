// Redesign: physical order, compact rows, area notes, progress, picking list, admin arrange.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100', out = __dirname + '/out/';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
// Staff-entered products start as "+ Add": tap it first, then type the amount.
const fillQty = async (pg, rowSel, v) => { if (await pg.$(`${rowSel} button.padd`)) { await pg.click(`${rowSel} button.padd`); await pg.waitForSelector(`${rowSel} .qty-input`); } await pg.fill(`${rowSel} .qty-input`, v); };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const names = (p) => p.$$eval('article.prow h3', (els) => els.map((e) => e.textContent));
const has = (p, sel, t) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
const val = async (p, sel, v) => { for (let k = 0; k < 40; k++) { if (await p.inputValue(sel) === v) return true; await p.waitForTimeout(100); } return false; };
const waitSynced = (p) => p.waitForSelector('.pill.ok', { timeout: 20000 });
const STAND = ["Milk M&M's", "Peanut M&M's", "Crispy M&M's", 'Maltesers', 'Pods'];
const FRIDGE = ['Fuze Peach Iced Tea', 'Monster Original', 'Monster White', 'Monster Peach', 'Monster Lando Norris', 'Pump', 'Pump Berry',
  'Mount Franklin Still Water', 'Mount Franklin Sparkling Water', 'Coca-Cola Bottle', 'Coca-Cola No Sugar Bottle', 'Sprite Bottle',
  'Apple Juice Box', 'Apple & Blackcurrant Juice Box', 'Tropical Juice Box', 'Orange Juice Box', 'Skinny Milk', 'Oat Milk', 'Soy Milk'];

(async () => {
  await sql`insert into admins (email, display_name, password_hash) values ('supervisor@example.com', 'Claire', ${await bcrypt.hash('correct-horse-1', 10)})`;
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const P = await ctx.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Sam'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Candy")'); await P.click('text=/Start (full|closing) restock/'); await P.waitForSelector('article.prow');

  // ---- Physical order, not product/category order ----
  const stand = await names(P);
  ok(stand.length === 31 && STAND.every((n, i) => stand[i] === n), 'Confection stand lists products in the configured physical order');
  // ---- General instructions once, product notes kept ----
  const guide = await P.textContent('.aguide');
  // The area's own guide replaces the long note repeated on every product (storeroom tips belong on the collection list).
  ok(guide.includes('Check both sides of the stand') && !guide.includes('Collect from Candy Bar BOH first'), 'area guide shown once at the top (the repeated product note is not added to it)');
  ok(await P.locator('article.prow .pnote:has-text("Check both sides")').count() === 0, 'repeated instruction is not shown under each product');
  ok((await P.textContent(row('Toblerone'))).includes('Keep away from the heat lamp'), 'a product-specific note stays on that product');
  ok(await P.locator('.aguide.open').count() === 0, 'area guide starts as a short preview');
  await P.click('.ag-text'); ok(await P.locator('.aguide.open').count() === 1, 'tap the guide to read it all');
  await P.click('.ag-text'); ok(await P.locator('.aguide.open').count() === 0, 'tap again to shrink it');

  // ---- Zero vs unchecked; status in words; progress ----
  ok(await P.locator(`${row("Milk M&M's")}.quiet`).count() === 1 && !(await P.isVisible(`${row("Milk M&M's")} .ps`)), 'untouched staff-entered product is calm: no "Not checked" to-do');
  ok(await P.locator(`${row("Milk M&M's")} .pquick`).count() === 0, 'no None button: blank already means nothing needed');
  await fillQty(P, `${row("Peanut M&M's")}`, '0');
  ok(await has(P, `${row("Peanut M&M's")} .ps`, 'None needed'), 'typing 0 = checked, nothing needed (still different from blank)');
  await fillQty(P, `${row("Milk M&M's")}`, '5');
  ok(await has(P, `${row("Milk M&M's")} .ps`, '5 packets'), 'typed 5 -> 5 packets to collect');
  await P.click(`${row('Maltesers')} button.padd`); await P.click(`${row('Maltesers')} button[aria-label^="One more"]`);
  ok(await val(P, `${row('Maltesers')} .qty-input`, '2'), 'Add then + = 2');
  await P.click(`${row('Pods')} button.padd`); await P.click(`${row('Pods')} button[aria-label^="One less"]`);
  ok(await val(P, `${row('Pods')} .qty-input`, '0') && await has(P, `${row('Pods')} .ps`, 'None needed'), 'Add then − = 0 (checked, none needed)');
  await fillQty(P, `${row("Peanut M&M's")}`, '');
  ok(await P.locator(`${row("Peanut M&M's")}.quiet`).waitFor({ timeout: 8000 }).then(() => true, () => false), 'clearing the box returns it to blank (not entered)');
  ok(await has(P, '.area-btn.cur', '3 entered'), 'area tab counts what was entered, including 0');
  ok(await has(P, '.dock', '2 to collect') && !(await P.textContent('.dock')).includes('entered'), 'bottom bar: what to collect (the entered count is on the area tab only)');
  await P.click('.dock-review'); await P.waitForSelector('.entered');
  ok(await has(P, '.entered', "Milk M&M's") && await has(P, '.entered', 'Maltesers'), 'tapping "to collect" lists everything entered for a quick review');
  await P.click('.dock-review');
  // Enter jumps to the next product
  await P.click(`${row('Skittles')} button.padd`); await P.click(`${row('Starburst')} button.padd`);
  await P.waitForSelector(`${row('Starburst')} .qty-input`); await P.waitForSelector(`${row('Skittles')} .qty-input`);
  await P.focus(`${row('Skittles')} .qty-input`); await P.keyboard.type('4'); await P.keyboard.press('Enter');
  ok(await P.evaluate(() => document.activeElement?.closest('article')?.querySelector('h3')?.textContent) === 'Starburst', 'Enter moves straight to the next product');
  ok(await P.locator('.area-end.s-none').count() === 0, 'exception-based: blanks are fine, no "go back and check" prompt');

  // Fill the rest of the stand -> completes by itself
  for (const n of stand) { if (await P.$(`${row(n)} button.padd`)) await fillQty(P, `${row(n)}`, '0'); }
  await fillQty(P, `${row('Coca-Cola Bottle')}`, '3');
  await P.waitForSelector('.banner.s-ok:has-text("Confection stand complete")');
  ok(true, 'area completes by itself once every product is checked');
  ok(await P.isVisible('button:has-text("Next: FOH drinks fridge")'), 'shows which area is next');
  await P.click('button:has-text("Next: FOH drinks fridge")'); await P.waitForSelector(row('Fuze Peach Iced Tea'));
  const fridge = await names(P);
  ok(JSON.stringify(fridge) === JSON.stringify(FRIDGE), 'FOH drinks fridge: Fuze first, then Monster, water/soft drinks, juice and milk');
  ok(!(await P.textContent('.area')).match(/top shelf|middle shelf|bottom shelf/i), 'no shelf headings shown');
  for (const [n, v] of [['Pump', '2'], ['Mount Franklin Still Water', '12'], ['Sprite Bottle', '2'], ['Oat Milk', '1'], ['Coca-Cola Bottle', '5']]) await fillQty(P, `${row(n)}`, v);
  for (const n of FRIDGE) { if (await P.$(`${row(n)} button.padd`)) await fillQty(P, `${row(n)}`, '0'); }
  await P.waitForSelector('.banner.s-ok:has-text("FOH drinks fridge complete")');
  ok(await P.locator('.area-btn.s-ok').count() === 2, 'every product answered: both area tabs show done');
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling on a phone (check)');
  await P.screenshot({ path: out + 'p5-fridge.png' });

  // ---- Leave and resume keeps everything ----
  await P.click('.dock .save-exit'); await P.waitForSelector('.dcard2');
  await P.click('.dcard2:has-text("Candy")'); await P.click('text=/Resume (full|closing) restock/'); await P.waitForSelector('article.prow');
  ok(await val(P, `${row('Mount Franklin Still Water')} .qty-input`, '12'), 'Save and exit, then resume: entries and area kept');

  // ---- Picking list ----
  await P.click('.dock button:has-text("Collection list")'); await P.waitForSelector('.room-h');
  const rooms = await P.$$eval('.room-h h3', (els) => els.map((e) => e.textContent));
  ok(rooms[0] === 'Candy Bar BOH' && rooms[1] === 'Walk in fridge(Downstairs)', 'grouped by storeroom, in storeroom order: ' + rooms.join(', '));
  const coke = await P.textContent('.line[data-line="Coca-Cola Bottle"]');
  ok(coke.includes('8') && coke.includes('Confection stand 3') && coke.includes('FOH drinks fridge 5'), 'Coke from two areas combined: 8, with where each goes');
  ok(await P.locator('.line.short').count() === 0, 'nothing is marked short just because it isn\'t collected yet');
  await P.click('.line[data-line="Pump"] .l-all');
  await P.waitForSelector('.line.done[data-line="Pump"]');
  const order1 = await P.$$eval('.line', (els) => els.map((e) => e.dataset.line));
  ok(order1.indexOf('Pump') >= 0, 'Got all: one tap');
  await P.click('.line[data-line="Pump"] button:has-text("Undo")'); await P.waitForSelector('.line.todo[data-line="Pump"]');
  const order2 = await P.$$eval('.line', (els) => els.map((e) => e.dataset.line));
  ok(JSON.stringify(order1) === JSON.stringify(order2), 'Undo works and rows never jump around');
  await P.click('.line[data-line="Mount Franklin Still Water"] .l-few');
  await P.fill(`.line[data-line="Mount Franklin Still Water"] .fewer .qty-input`, String(Number(await P.textContent(`.line[data-line="Mount Franklin Still Water"] .l-amt b`)) - 1));
  ok(await has(P, '.line[data-line="Mount Franklin Still Water"] .short-txt', 'Short 1'), 'Got fewer: actual amount, shortfall shown');
  await P.click('.line[data-line="Mount Franklin Still Water"] .fw-more'); await P.click('.line[data-line="Mount Franklin Still Water"] .flag');
  await P.click('.line[data-line="Mount Franklin Still Water"] .fw-ok');
  ok(await has(P, '.line[data-line="Mount Franklin Still Water"] .l-amt', '11/12'), 'partial line folds to a one-line summary');
  ok(await has(P, '.dock', '1 of'), 'bottom bar: collected count');
  while (await P.$('.line.todo .l-all')) { await P.click('.line.todo .l-all >> nth=0'); await P.waitForTimeout(100); }
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling on a phone (collect)');
  await P.screenshot({ path: out + 'p5-collect.png' });
  await P.waitForTimeout(1600);
  ok(await P.locator('.room:has(.room-h:has-text("Candy Bar BOH")) .line').count() === 0, 'everything collected: the storeroom folds up by itself');
  await P.click('.room-h:has-text("Candy Bar BOH")');
  ok(await P.locator('.room:has(.room-h:has-text("Candy Bar BOH")) .line').count() > 0, 'tap its heading: open again');
  await P.click('.room-h:has-text("Candy Bar BOH")');
  ok(await P.locator('.room:has(.room-h:has-text("Candy Bar BOH")) .line').count() === 0, 'and folded away again');
  await P.click('.dock button:has-text("Review")'); await P.click('.dock button:has-text("Finish restock")');
  await P.waitForSelector('.finish-hero'); await waitSynced(P);
  const [sh] = await sql`select product_name, shortfall_qty, flagged from shortages`;
  ok(sh && sh.productName === 'Mount Franklin Still Water' && Number(sh.shortfallQty) === 1 && sh.flagged, 'finished: shortage recorded and flagged for managers');

  // ---- Admin: arrange the fridge ----
  const A = await (await b.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  A.on('pageerror', (e) => errs.push('admin: ' + e.message));
  await A.goto(B + '/admin/login'); await A.fill('#email', 'supervisor@example.com'); await A.fill('#password', 'correct-horse-1'); await A.click('button.btn.primary'); await A.waitForURL(B + '/admin');
  const [fr] = await sql`select id from check_areas where name = 'FOH drinks fridge'`;
  await A.goto(`${B}/admin/arrange/${fr.id}`); await A.waitForSelector('.arr-list li');
  // Monster drinks moved to the bottom shelf: drag Monster Original to the end
  const h = A.locator('li:has-text("Monster Original") .arr-handle'); const last = A.locator('.arr-list li').last();
  const hb = await h.boundingBox(), lb = await last.boundingBox();
  await A.mouse.move(hb.x + 10, hb.y + 10); await A.mouse.down();
  for (let k = 1; k <= 12; k++) await A.mouse.move(hb.x + 10, hb.y + 10 + ((lb.y + lb.height - hb.y) * k) / 12);
  await A.mouse.up();
  let order = await A.$$eval('.arr-t b', (els) => els.map((e) => e.textContent));
  ok(order[order.length - 1] === 'Monster Original', 'drag and drop moves a product (to the bottom)');
  await A.click('li:has-text("Monster Original") button[aria-label="Move Monster Original up"]');
  order = await A.$$eval('.arr-t b', (els) => els.map((e) => e.textContent));
  ok(order[order.length - 1] === 'Soy Milk' && order[order.length - 2] === 'Monster Original', 'arrow buttons move one step');
  ok(await A.isVisible('text=Unsaved changes'), 'nothing saved until Save');
  await A.click('button:has-text("Save order")'); await A.waitForSelector('text=Order saved');
  const db = await sql`select p.name from product_placements pl join products p on p.id = pl.product_id where pl.check_area_id = ${fr.id} order by pl.sort_order`;
  ok(JSON.stringify(db.map((r) => r.name)) === JSON.stringify(order), 'order saved to the database');
  await A.reload(); await A.waitForSelector('.arr-list li');
  ok(JSON.stringify(await A.$$eval('.arr-t b', (els) => els.map((e) => e.textContent))) === JSON.stringify(order), 'order kept after reload');
  // CSV export follows the same order; re-importing doesn't reshuffle
  const csv = await (await A.request.get(`${B}/api/admin/export/products`)).text();
  const fridgeRows = csv.split('\r\n').filter((l) => l.includes(',FOH drinks fridge,')).map((l) => l.split(',')[2].replace(/"/g, ''));
  ok(fridgeRows[fridgeRows.length - 1] === 'Soy Milk' && fridgeRows[0] === 'Fuze Peach Iced Tea', 'CSV export lists products in checking order');
  // Staff device picks up the new order
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.evaluate(() => window.dispatchEvent(new Event('online')));
  await P.waitForTimeout(1500);
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); process.exit(1); });
