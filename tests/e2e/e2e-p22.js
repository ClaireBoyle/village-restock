// Quick Restock, the same in every department: + and a number (with its unit) in each product row on Pick products;
// above zero it's on Your list and Collection list is on; editing changes the same entry; zero takes it off. No
// Add → quantity step. Search, filters and scroll stay put. The area's instructions once above its products.
// Candy Bar and Kitchen, phone and iPad.
// Before running: reset the test database, then load candy-fixture.sql and candy-area-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const waitDb = async (q, check, ms = 15000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const pick = (n) => `.qpanel .qrow:has(b:text-is("${n}"))`;
const listed = (n) => `.picked .qrow:has(b:text-is("${n}"))`;
const val = (P, sel) => P.locator(`${sel} .q-num`).first().inputValue();
const unit = (P, sel) => P.locator(`${sel} .q-unit`).first().innerText();
const count = (P) => P.locator('.picked .qrow').count();
const collectOn = async (P) => !(await P.locator('.dock button:has-text("Collect")').isDisabled());

async function run(b, device, name) {
  const errs = [];
  const P = await (await b.newContext(device)).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.dcard2:has-text("Candy Bar")'); await P.click('.quick-link:has-text("Quick restock")'); await P.waitForSelector('#qsearch');
  ok(await P.locator('.qpanel .qrow button:has-text("Add")').count() === 0, `${name}: no "Add to list" buttons, only + and a number`);
  ok(await count(P) === 0 && !(await collectOn(P)), `${name}: empty list, Collection list off`);

  // The confection stand: its instructions once, above its products.
  await P.click('.chip:has-text("Confection stand")');
  ok(await P.locator('.q-guide').count() === 1 && (await P.locator('.q-guide').innerText()).includes('Check both sides of the stand'), `${name}: "Check both sides…" once above the products`);
  const first = await P.locator('.qpanel .qrow b').first().innerText();
  ok(await unit(P, pick(first)) === 'packets', `${name}: unit beside the number (${first}: packets)`);

  // + adds one: on the list straight away, Collection list on.
  await P.click(`${pick(first)} button[aria-label^="Add one"]`);
  await P.waitForSelector(listed(first));
  ok(await val(P, pick(first)) === '1' && await unit(P, pick(first)) === 'packet' && await collectOn(P), `${name}: + → 1 packet, on Your list, Collection list on`);
  // A bigger number typed in.
  const second = await P.locator('.qpanel .qrow b').nth(3).innerText();
  await P.fill(`${pick(second)} .q-num`, '12'); await P.waitForSelector(listed(second));
  ok(await count(P) === 2 && await val(P, listed(second)) === '12', `${name}: typed 12 ${second}: on the list with 12`);
  // Editing the number updates the same entry.
  await P.fill(`${pick(second)} .q-num`, '5'); await P.waitForTimeout(300);
  ok(await count(P) === 2 && await val(P, listed(second)) === '5', `${name}: changed to 5: same entry, now 5`);
  // Zero takes it off.
  await P.fill(`${pick(second)} .q-num`, '0'); await P.locator(`${pick(second)} .q-num`).blur(); await P.waitForTimeout(300);
  ok(await count(P) === 1 && await val(P, pick(second)) === '', `${name}: 0 takes it off the list (box back to blank)`);
  // − at 1 takes it off too.
  await P.click(`${pick(first)} button[aria-label^="One less"]`); await P.waitForTimeout(300);
  ok(await count(P) === 0 && !(await collectOn(P)), `${name}: − at 1 takes it off; Collection list off again`);

  // Scroll stays put while entering further down the list.
  const far = await P.locator('.qpanel .qrow b').nth(14).innerText();
  await P.locator(pick(far)).scrollIntoViewIfNeeded();
  const y0 = await P.evaluate(() => window.scrollY);
  await P.click(`${pick(far)} button[aria-label^="Add one"]`); await P.click(`${pick(far)} button[aria-label^="Add one"]`);
  await P.waitForSelector(listed(far)); await P.waitForTimeout(200);
  const y1 = await P.evaluate(() => window.scrollY);
  ok(Math.abs(y1 - y0) < 4 && await P.locator('.chip.on:has-text("Confection stand")').count() === 1, `${name}: scroll and filter stay put (${Math.round(y0)} → ${Math.round(y1)})`);

  // Search: the same product in two areas, entered separately; the search stays.
  await P.fill('#qsearch', 'coca');
  const coke = P.locator('.qpanel .qrow:has(b:text-is("Coca-Cola Bottle"))');
  ok(await coke.count() === 2 && (await coke.nth(1).innerText()).includes('FOH drinks fridge'), `${name}: search shows Coca-Cola in both areas, with the area`);
  await coke.nth(1).locator('.q-num').fill('3'); await P.waitForTimeout(300);
  ok(await P.inputValue('#qsearch') === 'coca' && (await coke.nth(1).locator('.q-unit').innerText()) === 'bottles', `${name}: search kept; "bottles" beside the drink`);
  await P.screenshot({ path: `${OUT}/p22-quick-${name}.png` });
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: no sideways scrolling`);
  const h = await coke.nth(1).locator('button[aria-label^="Add one"]').evaluate((e) => e.getBoundingClientRect().height);
  ok(h >= 42, `${name}: + is easy to hit (${Math.round(h)}px)`);

  // Straight to the collection list from the rows.
  await P.click('.dock button:has-text("Collect")'); await P.waitForSelector('.line');
  const lines = await P.$$eval('.line', (els) => els.map((e) => `${e.getAttribute('data-line')} ${e.querySelector('.l-qty b')?.textContent}`));
  ok(JSON.stringify(lines.sort()) === JSON.stringify([`${far} 2`, 'Coca-Cola Bottle 3'].sort()), `${name}: collection list: ${lines.join(', ')}`);
  ok(!errs.length, `${name}: no page errors ${errs.join(' | ')}`);
  await P.context().close();
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  await run(b, devices['iPhone 13'], 'phone');
  await sql`delete from restock_sessions where kind = 'quick'`;
  await run(b, devices['iPad (gen 7)'], 'ipad');

  // Kitchen: same rows; a target-level product takes the amount needed; refill tasks aren't listed.
  const errs = [];
  const P = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('button:has-text("Start quick restock")'); await P.waitForSelector('#qsearch');
  await P.fill('#qsearch', 'milk'); await P.fill(`${pick('Milk')} .q-num`, '2'); await P.waitForSelector(listed('Milk'));
  ok(await unit(P, pick('Milk')) !== '' && await collectOn(P), 'kitchen: Milk 2 on Your list, Collection list on');
  const [{ n }] = await waitDb(() => sql`select count(*)::int as n from session_items i join restock_sessions s on s.id = i.session_id where s.kind = 'quick' and i.product_name = 'Milk' and i.requested_qty = 2`, (r) => r[0].n === 1);
  ok(n === 1, 'kitchen: saved to the server (Milk, 2 needed)');
  ok(!errs.length, 'kitchen: no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
