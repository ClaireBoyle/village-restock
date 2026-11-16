// Candy Bar restocked area by area: each area is its own quick restock (enter what's needed, collect, finish).
// Before running: reset the test database, then load candy-fixture.sql and candy-area-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
// Staff-entered products start as "+ Add": tap it first, then type the amount.
const fillQty = async (pg, rowSel, v) => { if (await pg.$(`${rowSel} button.padd`)) { await pg.click(`${rowSel} button.padd`); await pg.waitForSelector(`${rowSel} .qty-input`); } await pg.fill(`${rowSel} .qty-input`, v); };
const has = (p, sel, t, ms = 8000) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const card = (n) => `.acard:has(h2:text-is("${n}"))`;

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const P = await ctx.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Ana'); await P.click('.sheet .btn.primary');
  ok(await has(P, '.dcard2:has-text("Candy Bar")', 'Choose an area'), 'home: Candy Bar card says "Choose an area"');
  await P.click('.dcard2:has-text("Candy Bar")');
  await P.waitForSelector('.acard');
  ok(await P.locator('.acard').count() === 2 && await has(P, card('Confection stand'), 'Not restocked tonight') && await has(P, card('FOH drinks fridge'), 'Not restocked tonight'), 'picker: one card per area, neither restocked yet');
  await P.screenshot({ path: `${OUT}/p9-picker.png` });

  // ---- Confection stand on its own ----
  await P.click(`${card('Confection stand')} button:has-text("Start")`); await P.waitForSelector('article.prow');
  ok(await P.locator('.rail').count() === 0 && await has(P, '.area-head h2', 'Confection stand'), 'only the confection stand: no area list, its name is the heading');
  ok(await has(P, '.aguide-line', 'Check both sides of the stand. Enter the total quantity needed.') && await P.locator('.aguide').count() === 0, 'short one-line instruction (no large card)');
  ok(!(await P.textContent('main')).includes('Dry storage'), 'no storeroom or opened-box instructions while checking');
  ok(await P.locator('article.prow:has-text("Monster")').count() === 0, 'no drinks fridge products on the confection stand');
  const order = await P.$$eval('article.prow h3', (els) => els.slice(0, 3).map((e) => e.textContent));
  ok(JSON.stringify(order) === JSON.stringify(["Milk M&M's", "Peanut M&M's", "Crispy M&M's"]), 'products in physical stand order (not alphabetical): ' + order.join(', '));
  ok(await P.locator(`${row('Maltesers')} .qty-input`).count() === 0 && await P.locator(`${row('Maltesers')} button.padd`).count() === 1, 'untouched product shows only "+ Add"');
  ok(await P.locator('article.prow .pphoto').count() === await P.locator('article.prow').count(), 'every row has the same photo slot (placeholder when no photo)');
  // Add → 1, + → 2
  await P.click(`${row('Maltesers')} button.padd`);
  await P.waitForSelector(`${row('Maltesers')} .qty-input`);
  ok(await P.inputValue(`${row('Maltesers')} .qty-input`) === '1', 'Add records 1 and reveals − 1 +');
  await P.click(`${row('Maltesers')} button[aria-label="One more Maltesers"]`);
  await P.click(`${row('Kit Kat')} button.padd`); await P.click(`${row('Kit Kat')} button[aria-label="One more Kit Kat"]`); await P.click(`${row('Kit Kat')} button[aria-label="One more Kit Kat"]`);
  // Explicit zero, then back to untouched
  await P.click(`${row('Skittles')} button.padd`); await P.click(`${row('Skittles')} button[aria-label="One less Skittles"]`);
  ok(await has(P, row('Skittles'), 'None needed') && await P.locator(`${row('Skittles')}.s-ok`).count() === 1, 'explicit 0 shows "None needed" (different from untouched)');
  await P.click(`${row('Twix')} button.padd`); await P.click(`${row('Twix')} button[aria-label="One less Twix"]`); await P.click(`${row('Twix')} button[aria-label="Clear Twix"]`);
  ok(await P.locator(`${row('Twix')} button.padd`).waitFor({ timeout: 5000 }).then(() => true, () => false), 'clearing a 0 returns the product to untouched');
  ok(await has(P, '.dock', '2 to collect') && !(await P.textContent('.dock')).includes('entered'), 'bottom bar: just "2 to collect" (no repeated "entered" count)');
  await P.screenshot({ path: `${OUT}/p9-check.png` });
  // Typed amounts still work
  await fillQty(P, `${row('Kit Kat')}`, '4');
  const items = await waitDb(() => sql`select product_name, requested_qty from session_items order by product_name`, (r) => r.length === 4 && r.some((x) => x.productName === 'Kit Kat' && Number(x.requestedQty) === 4) && r.some((x) => x.productName === 'Twix' && x.requestedQty === null));
  ok(items.find((x) => x.productName === 'Skittles')?.requestedQty !== null && Number(items.find((x) => x.productName === 'Skittles').requestedQty) === 0 && items.find((x) => x.productName === 'Twix')?.requestedQty === null,
    'server keeps 0 (Skittles) apart from cleared/untouched (Twix)');

  // Save and exit, then resume: nothing lost
  await P.click('.dock button[aria-label="Save and exit"]'); await P.waitForSelector('.acard');
  ok(await has(P, card('Confection stand'), 'In progress') && await has(P, card('Confection stand'), '2 to collect'), 'picker shows the confection stand in progress (2 to collect)');
  await P.click(`${card('Confection stand')} button:has-text("Resume")`); await P.waitForSelector('article.prow');
  ok(await P.inputValue(`${row('Kit Kat')} .qty-input`) === '4' && await P.inputValue(`${row('Maltesers')} .qty-input`) === '2', 'resumed with every amount kept');

  // Collect: only this area's products, storeroom reminder once, no "For Confection stand" on each line
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  ok(await P.locator('.line').count() === 2, 'collection list has only the confection stand products');
  ok(await has(P, '.room-h', 'Candy Bar BOH') && await P.locator('.room-note').count() === 1 && await has(P, '.room-note', 'Use opened boxes in Candy Bar BOH first'), 'opened-boxes reminder shown once, under Candy Bar BOH');
  ok(!(await P.textContent('.rooms')).includes('For Confection stand'), 'no "For Confection stand" repeated on each line');
  await P.click('.line[data-line="Kit Kat"] .l-few'); 
  await P.click('.line[data-line="Kit Kat"] .fw-ok');
  await P.click('.line[data-line="Maltesers"] .l-all');
  ok(await has(P, '.line.done', 'Maltesers'), 'collected line has a done state');
  await P.click('.line[data-line="Maltesers"] .linkbtn:has-text("Undo")');
  ok(await P.locator('.line.done[data-line="Maltesers"]').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false), 'undo works');
  await P.click('.line[data-line="Maltesers"] .l-all'); await P.waitForSelector('.line.done[data-line="Maltesers"]'); await P.waitForTimeout(500);
  await P.screenshot({ path: `${OUT}/p9-collect.png` });
  await P.click('.dock .dock-acts button:has-text("Review")');
  ok(await has(P, '.finish-title', 'Finish Confection stand'), 'finish screen names the area');
  await P.waitForSelector('.dock button:has-text("Finish"):not([disabled])');
  await P.click('.dock button.good:has-text("Finish")'); await P.waitForSelector('.finish-hero');
  ok(await has(P, '.finish-hero', 'Confection stand restocked'), 'finished: "Confection stand restocked"');
  const [s1] = await waitDb(() => sql`select kind, status, area_name from restock_sessions where kind = 'area' and status <> 'open'`, (r) => r.length === 1);
  ok(s1?.kind === 'area' && s1.areaName === 'Confection stand' && s1.status === 'finished', 'saved as an area restock of the Confection stand, finished cleanly');
  const sh = await waitDb(() => sql`select product_name, shortfall_qty from shortages`, (r) => r.length === 1);
  ok(sh.length === 1 && sh[0].productName === 'Kit Kat', 'the confirmed Kit Kat shortage is reported');
  const mail = await waitDb(() => sql`select subject from email_outbox`, (r) => r.length === 1, 8000);
  ok(!mail.length || mail[0].subject.includes('Confection stand'), 'manager email (if set up) names the area');

  // Back to the picker: confection stand done, drinks fridge untouched
  await P.click('.dock button:has-text("Back to Candy Bar")'); await P.waitForSelector('.acard');
  ok(await has(P, card('Confection stand'), 'Restocked') && await has(P, card('FOH drinks fridge'), 'Not restocked tonight'), 'picker: confection stand restocked, drinks fridge still to do (no need to do both)');

  // ---- FOH drinks fridge, later, nothing needed: finish straight away ----
  await P.click(`${card('FOH drinks fridge')} button:has-text("Start")`); await P.waitForSelector('article.prow');
  ok(await P.locator('article.prow:has-text("Maltesers")').count() === 0, 'drinks fridge shows only drinks');
  ok(await has(P, '.dock', 'Nothing to collect yet'), 'nothing entered: no collection needed');
  await P.click('.dock .dock-acts button.primary'); await P.waitForSelector('.finish-title');
  await P.click('.dock button.good:has-text("Finish")'); await P.waitForSelector('.finish-hero');
  ok(await has(P, '.finish-hero', 'FOH drinks fridge restocked'), 'an area with nothing needed finishes without an empty collection step');
  await P.click('.dock button:has-text("Back to Candy Bar")'); await P.waitForSelector('.acard');

  // Offline: restock the confection stand again with no connection; it all uploads once back online
  await ctx.setOffline(true);
  await P.click(`${card('Confection stand')} button:has-text("Restock again")`); await P.waitForSelector('article.prow');
  await P.click(`${row('Pods')} button.padd`); await P.waitForSelector(`${row('Pods')} .qty-input`);
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  await P.click('.line[data-line="Pods"] .l-all'); await P.click('.dock .dock-acts button:has-text("Review")');
  await P.waitForSelector('.dock button.good:not([disabled])'); await P.click('.dock button.good:has-text("Finish")'); await P.waitForSelector('.finish-hero');
  ok(await has(P, '.dock', 'Finished on this device'), 'offline: finished and kept on this device');
  await ctx.setOffline(false);
  const two = await waitDb(() => sql`select s.id from restock_sessions s where s.kind = 'area' and s.area_name = 'Confection stand' and s.status = 'finished'
    and exists (select 1 from session_items i where i.session_id = s.id and i.product_name = 'Pods' and i.collected_mode = 'all')`, (r) => r.length === 1, 30000);
  ok(two.length === 1, 'back online: the second confection stand restock uploaded, separate from the first');
  await P.click('.dock button:has-text("Back to Candy Bar")'); await P.waitForSelector('.acard');

  // Home: both areas shown, the department counts as restocked
  await P.goto(B + '/'); await P.waitForSelector('.lane');
  ok(await has(P, '.lane:has-text("Candy Bar")', 'Confection stand ✓') && await has(P, '.lane:has-text("Candy Bar")', 'Restocked'), 'home: Candy Bar lane shows each area and is restocked');

  // Gold Class departments keep the full restock
  await P.click('.dcard2:has-text("Bar") >> nth=0');
  ok(await has(P, 'main', 'Start full restock'), 'other departments keep the full restock (not area by area)');

  // Tablet and desktop: same flow, two columns of rows on wide screens
  for (const [name, vp] of [['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1366, height: 900 }]]) {
    const c2 = await b.newContext({ viewport: vp }); const T = await c2.newPage(); T.on('pageerror', (e) => errs.push(e.message));
    await T.goto(B + '/'); await T.waitForSelector('.dcard2'); await T.click('.dcard2:has-text("Candy Bar")');
    await T.click(`${card('Confection stand')} button:has-text("Restock again")`); await T.waitForSelector('article.prow');
    await T.click(`${row('Pods')} button.padd`);
    const cols = await T.$eval('.area .prows', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    ok(name === 'desktop' ? cols === 2 : true, `${name}: rows laid out in ${cols} column(s)`);
    const box = await T.$$eval('article.prow', (els) => els.slice(0, 6).map((e) => { const r = e.querySelector('.pc').getBoundingClientRect(); const t = e.getBoundingClientRect(); return Math.round(t.right - r.right); }));
    ok(new Set(box).size === 1, `${name}: controls line up on the right of every row`);
    await T.screenshot({ path: `${OUT}/p9-${name}.png` });
    await c2.close();
  }
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e.message); process.exit(1); });
