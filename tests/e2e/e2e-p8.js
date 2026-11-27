// Gold Class Bar spirits: Back bench first, other FOH spirits and the optional Spirits cupboard as sections.
// Before running: reset the test database, then load spirits-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
// Staff-entered products start as "+ Add": tap it first, then type the amount.
const fillQty = async (pg, rowSel, v) => { if (await pg.$(`${rowSel} button.padd`)) { await pg.click(`${rowSel} button.padd`); await pg.waitForSelector(`${rowSel} .qty-input`); } await pg.fill(`${rowSel} .qty-input`, v); };
const has = (p, sel, t, ms = 8000) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const sec = (name) => `.psec:has(.psec-t b:text-is("${name}"))`;
const row = (scope, n) => `${scope} article.prow:has(h3:text-is("${n}"))`;

(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const P = await ctx.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Sam'); await P.click('.sheet .btn.primary');
  ok(await has(P, '.lane:has-text("Bar")', '1 areas') || await has(P, '.lane:has-text("Bar")', 'Not started'), 'home: sections are not counted as separate areas');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('text=/Start (full|closing) restock/'); await P.waitForSelector('article.prow');

  // Back bench visible straight away; sections collapsed
  const bench = await P.$$eval('.area > .prows article.prow h3', (els) => els.map((e) => e.textContent));
  ok(JSON.stringify(bench) === JSON.stringify(['42 Below', 'Bacardi Carta Blanca', "Jack Daniel's", 'Jim Beam']), 'Back bench products shown first: ' + bench.join(', '));
  ok(await P.locator('.area-btn').count() === 0 && await has(P, '.area-head h2', 'Back bench'), 'one area, so no area list: Back bench is the heading (sections live inside it)');
  ok(await P.locator(`${sec('Other FOH spirits')} article.prow`).count() === 0 && await P.locator(`${sec('Spirits cupboard')} article.prow`).count() === 0, 'other FOH spirits and the cupboard start collapsed');
  ok(await has(P, sec('Spirits cupboard'), 'Optional'), 'cupboard marked Optional');

  // Enter on the back bench
  await fillQty(P, `${row('.area > .prows', 'Jim Beam')}`, '2');
  await fillQty(P, `${row('.area > .prows', '42 Below')}`, '1');
  // Other FOH spirits
  await P.click(`${sec('Other FOH spirits')} .psec-h`);
  await fillQty(P, `${row(sec('Other FOH spirits'), "Hendrick's")}`, '1');
  // Cupboard: expand, see the double-count hint, add extra
  await P.click(`${sec('Spirits cupboard')} .psec-h`);
  ok(await has(P, `${sec('Spirits cupboard')} .psec-hint`, 'Only add extra'), 'cupboard explains: only add extra stock');
  ok(await has(P, row(sec('Spirits cupboard'), 'Jim Beam'), 'Already 2 for Back bench'), 'cupboard row shows what was already entered for Back bench');
  await fillQty(P, `${row(sec('Spirits cupboard'), 'Jim Beam')}`, '3');
  ok(await has(P, '.dock', '3 to collect') && await has(P, '.area-head', '4 entered').then((x) => !x), 'bottom bar: 3 products to collect (Jim Beam merged), no repeated "entered" count');

  // Collection: one line per product, quantities consolidated, from the Alcohol storeroom
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  const jim = await P.textContent('.line[data-line="Jim Beam"]');
  ok(await P.locator('.line[data-line="Jim Beam"]').count() === 1 && jim.includes('5') && jim.includes('Back bench 2') && jim.includes('Spirits cupboard 3'), 'Jim Beam: one line of 5 (Back bench 2 · Spirits cupboard 3)');
  ok(await has(P, '.room-h', 'Alcohol Storeroom'), 'collected from the Alcohol storeroom');
  ok(await P.locator('.col-note').count() === 0 && !(await P.textContent('main')).includes('not checked'), 'no "products not checked" warning: untouched products are not outstanding work');
  ok(await has(P, '.line .l-few', 'Got fewer'), 'collection buttons read "Got fewer" and "Got all"');
  await P.screenshot({ path: (process.env.E2E_OUT || 'tests/e2e/out') + '/p8-collect.png' });
  // Partial collection + shortage on the merged line still works
  await P.click('.line[data-line="Jim Beam"] .l-few'); await P.fill(`.line[data-line="Jim Beam"] .fewer .qty-input`, String(Number(await P.textContent(`.line[data-line="Jim Beam"] .l-amt b`)) - 1));
  ok(await has(P, '.line[data-line="Jim Beam"] .short-txt', 'Short 1'), 'shortage recorded on the merged line');
  await P.click('.line[data-line="Jim Beam"] .fw-ok');
  while (await P.$('.line.todo .l-all')) { await P.click('.line.todo .l-all >> nth=0'); await P.waitForTimeout(100); }
  await P.click('.dock .dock-acts button:has-text("Review")');
  await P.waitForSelector('.dock button:has-text("Finish restock"):not([disabled])');
  ok(true, 'finish unlocks without opening or completing any section');
  await P.click('.dock button:has-text("Finish restock")'); await P.waitForSelector('.finish-hero');
  const [s] = await waitDb(() => sql`select status from restock_sessions`, (r) => r[0]?.status === 'finished');
  ok(s?.status === 'finished', 'finished cleanly (not "with exceptions")');
  const rows = await waitDb(() => sql`select a.name as area, i.product_name, i.requested_qty, i.collected_mode, i.collected_qty from session_items i join check_areas a on a.id = i.check_area_id where i.product_name = 'Jim Beam' order by a.sort_order`, (r) => r.length === 2 && r.every((x) => x.collectedMode));
  ok(rows.length === 2 && Number(rows[0].requestedQty) === 2 && Number(rows[1].requestedQty) === 3, 'history keeps each section’s amount separately: ' + rows.map((r) => `${r.area} ${r.requestedQty}`).join(', '));
  const [sh] = await sql`select product_name, shortfall_qty from shortages`;
  ok(sh && sh.productName === 'Jim Beam' && Number(sh.shortfallQty) === 1, 'shortage recorded once for the product');
  const prods = await sql`select count(*)::int as n from products where name = 'Jim Beam'`;
  ok(prods[0].n === 1, 'no duplicate catalogue products');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); process.exit(1); });
