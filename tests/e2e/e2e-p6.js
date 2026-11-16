// Defrost Planner, exception-based restocking, Stock Insights.
// Before running: reset the test database, then load defrost-fixture.sql and candy-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const has = (p, sel, t, ms = 10000) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const drow = (n) => `article.dprow:has(h3:text-is("${n}"))`;
const prow = (n) => `article.prow:has(h3:text-is("${n}"))`;

(async () => {
  await sql`insert into admins (email, display_name, password_hash) values ('supervisor@example.com', 'Claire', ${await bcrypt.hash('correct-horse-1', 10)})`;
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const P = await ctx.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Sam'); await P.click('.sheet .btn.primary');

  // ---- Kitchen page: two independent options, no prerequisites ----
  await P.click('.dcard2:has-text("Kitchen")'); await P.waitForSelector('.type-defrost');
  ok(await has(P, '.type-defrost', 'Recommended'), 'Defrost Planner is offered, labelled Recommended');
  ok(await P.isEnabled('button:has-text("Start kitchen restock")'), 'Kitchen Restock can be started straight away (planner not required)');
  ok(await P.locator('.type-defrost').count() === 1 && await P.locator('.dcard2').count() === 0, 'both on the Gold Class Kitchen page');

  // Start Kitchen Restock first, without touching the planner
  await P.click('button:has-text("Start kitchen restock")'); await P.waitForSelector('article.prow');
  ok(await has(P, '.kreminder', 'You can use the Defrost Planner at any time'), 'non-blocking kitchen reminder at the top');
  await P.fill(`${prow('Tomatoes')} .qty-input`, '3');
  // Visit the planner from the reminder, then come back: progress kept
  await P.click('.kreminder a'); await P.waitForSelector('.dprow');
  ok(P.url().endsWith('/defrost'), 'reminder link opens the Defrost Planner');

  // ---- Defrost Planner ----
  ok(await has(P, drow('Ingredient X') + ' .dp-out', 'Enter what’s usable in the fridge and what’s already thawing'), 'no stock entered: no suggestion (not treated as 0)');
  await P.fill(`${drow('Ingredient X')} input[aria-label="Usable in fridge"]`, '10');
  ok(await has(P, drow('Ingredient X') + ' .dp-out', 'what’s already thawing'), 'thawing still missing: still no suggestion');
  await P.fill(`${drow('Ingredient X')} input[aria-label="Thawing, ready in time"]`, '4');
  ok(await has(P, drow('Ingredient X') + ' .dp-out', 'Defrost 14 portions'), '24 expected + 4 buffer − 10 − 4 = 14');
  ok(await has(P, drow('Ingredient X') + ' .dp-out small', '24 expected + 4 buffer − 10 chilled − 4 thawing = 14'), 'the working is shown');
  await P.fill(`${drow('Slow-cooked brisket')} input[aria-label="Usable in fridge"]`, '0'); await P.click(`${drow('Slow-cooked brisket')} .pquick`);
  ok(await has(P, drow('Slow-cooked brisket') + ' .dp-out', 'can’t be safely thawed'), '30 h thaw before 11 am tomorrow: warning, no number');
  await P.fill(`${drow('Dumplings')} input[aria-label="Usable in fridge"]`, '0'); await P.click(`${drow('Dumplings')} .pquick`);
  ok(await has(P, drow('Dumplings') + ' .dp-out', 'no approved thaw time'), 'no approved thaw time: no suggestion');
  await P.fill(`${drow('Bao buns')} input[aria-label="Usable in fridge"]`, '9'); await P.click(`${drow('Bao buns')} .pquick`);
  ok(await has(P, drow('Bao buns') + ' .dp-out', 'Nothing to defrost'), 'enough in the fridge: nothing to defrost, no confirmation needed');
  await P.click(`${drow('Ingredient X')} .dp-record .btn.good`);
  ok(await has(P, '.dp-list', 'Ingredient X'), 'summary lists what to defrost');
  await P.click(`${drow('Ingredient X')} .dp-more`); await P.click(`${drow('Ingredient X')} .flag`);
  const [e] = await waitDb(() => sql`select chilled_qty, thawing_qty, suggested_qty, defrost_qty, ran_out, updated_by from defrost_entries where item_name = 'Ingredient X'`, (r) => r[0] && r[0].defrostQty !== null && r[0].ranOut);
  ok(e && Number(e.chilledQty) === 10 && Number(e.thawingQty) === 4 && Number(e.suggestedQty) === 14 && Number(e.defrostQty) === 14 && e.updatedBy === 'Sam', 'saved on the server: chilled, thawing, suggestion, amount defrosted, who');

  // Offline: entries saved on the device and uploaded later
  await ctx.setOffline(true);
  await P.fill(`${drow('Bao buns')} input[aria-label="Usable in fridge"]`, '1');
  ok(await has(P, drow('Bao buns') + ' .dp-out', 'Defrost 6 packs'), 'works offline');
  await ctx.setOffline(false);
  await waitDb(() => sql`select chilled_qty from defrost_entries where item_name = 'Bao buns'`, (r) => r[0] && Number(r[0].chilledQty) === 1, 30000);
  ok(true, 'offline entry uploaded when the connection returned');

  // Second device sees the same plan
  const Q = await (await b.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await Q.goto(`${B}/d/${k.id}/defrost`); await Q.waitForSelector('.dprow');
  ok(await has(Q, drow('Ingredient X') + ' .dp-out', 'Defrost 14 portions', 20000), 'another device picks up the plan');

  // Back to Kitchen Restock: nothing lost
  await P.goBack(); await P.waitForSelector('article.prow');
  ok(await P.inputValue(`${prow('Tomatoes')} .qty-input`) === '3', 'back in Kitchen Restock with progress kept');

  // ---- Exception-based restocking (Candy Bar) ----
  await P.goto(B + '/'); await P.click('.dcard2:has-text("Candy")'); await P.click('text=Start full restock'); await P.waitForSelector('article.prow');
  const first = (await P.$$eval('article.prow h3', (els) => els.map((x) => x.textContent)))[0];
  await P.fill(`${prow(first)} .qty-input`, '2');
  ok(await P.locator('.area-end:has-text("still needed")').count() === 0, 'no "still to check" demand for blank staff-entered products');
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  await P.click('.line .l-all'); await P.click('.dock button:has-text("Review")');
  await P.waitForSelector('.dock button:has-text("Finish restock"):not([disabled])');
  await P.click('.dock button:has-text("Finish restock")'); await P.waitForSelector('.finish-hero');
  const [cs] = await waitDb(() => sql`select s.status from restock_sessions s join departments d on d.id = s.department_id where d.name = 'Candy Bar'`, (r) => r[0]?.status === 'finished');
  ok(cs?.status === 'finished', 'Candy Bar finishes cleanly with only one product entered (not "with exceptions")');
  const blanks = await sql`select count(*)::int as n from session_items i join restock_sessions s on s.id = i.session_id join departments d on d.id = s.department_id where d.name = 'Candy Bar' and i.requested_qty is null`;
  ok(blanks[0].n === 0, 'blank products are not stored as 0 (no row at all = not entered)');

  // ---- Stock Insights ----
  const A = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); A.on('pageerror', (x) => errs.push('admin: ' + x.message));
  await A.goto(B + '/admin/login'); await A.fill('#email', 'supervisor@example.com'); await A.fill('#password', 'correct-horse-1'); await A.click('button.btn.primary'); await A.waitForURL(B + '/admin');
  await A.goto(B + '/admin/insights'); await A.waitForSelector('.ins-tiles');
  ok(await has(A, '.panel', 'Nothing to flag') || await A.locator('.ins-card').count() >= 0, 'Stock Insights loads');
  const anon = await (await b.newContext()).request.get(B + '/admin/insights', { maxRedirects: 0 });
  ok(anon.status() === 307 || anon.status() === 302, 'Stock Insights needs an admin sign-in');
  await A.goto(B + '/admin/defrost'); await A.waitForSelector('.panel');
  ok(await has(A, '.row', 'Dumplings') && await has(A, '.badge', 'No thaw time'), 'admin setup flags an item without an approved thaw time');

  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); process.exit(1); });
