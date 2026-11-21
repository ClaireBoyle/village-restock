// Gold Class Bar "None left here": the optional tick on items added to collect (off by default, easy to undo, gone when
// the item is removed), labels on the downstairs list, the Finish review (Out of stock first, Low stock · Still available,
// Top-up incomplete) with a correction, one-tap full collection, shortages recorded and the manager email wording.
// Before running: reset the test database, then load gcbar-refill-fixture.sql. The test applies the update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const primary = (P) => P.locator('.dock .dock-acts .btn.primary');
const text = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  for (const f of ['refill-foh', 'back-bench-walk', 'foh-lap', 'coffee-cupboard', 'beer-fridge-area']) await sql.file(`db/updates/2026-11-gold-class-bar-${f}.sql`);
  // Migration 020 switches this on for the live Gold Class Bar; the fixture is loaded after migrations.
  await sql`update departments set none_left_check = true where lower(name) = 'gold class bar'`;
  await sql`insert into app_settings (key, value) values ('manager_email', '"manager@example.com"'::jsonb), ('manager_email_enabled', 'true'::jsonb)
    on conflict (key) do update set value = excluded.value`;
  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  // Walk the bar; the cordials and honey are in the Coffee cupboard.
  const bar = await P.$$eval('.area-btn b', (e) => e.map((x) => x.textContent));
  for (const a of bar) {
    await P.waitForSelector(`.area-btn.cur:has-text("${a}")`); await P.waitForTimeout(150);
    if (a !== 'Coffee cupboard') { await primary(P).click(); continue; }
    const qty = async (n, v) => { await P.click(`${row(n)} .padd`); await P.fill(`${row(n)} .qty-input`, String(v)); await P.locator(`${row(n)} .qty-input`).blur(); };
    ok(await P.locator('.pnone').count() === 0 && await P.locator('.nl-hint').count() === 0, 'nothing added yet: no "None left here" and no hint');
    await qty('Raspberry Cordial', 3);
    const box = P.locator(`${row('Raspberry Cordial')} .pnone input`);
    ok(await box.count() === 1 && !(await box.isChecked()), 'added 3 Raspberry Cordial: "None left here" shown beside it, off by default');
    ok((await text(P, '.nl-hint')).includes('An open bottle that can still be used counts as stock'), 'one hint: an open bottle still in use counts as stock');
    const h = await box.evaluate((el) => el.closest('label').getBoundingClientRect().height);
    ok(h >= 32, `the tick is easy to hit (${Math.round(h)}px)`);
    await box.check(); ok(await P.locator(`${row('Raspberry Cordial')} .pnone.on`).count() === 1, 'ticked: None left here');
    await box.uncheck(); ok(!(await box.isChecked()), 'tap again to undo');
    await box.check();
    await P.screenshot({ path: `${OUT}/p20-none-left-here.png` });
    // Removing the item takes the tick with it.
    await qty('Lime Cordial', 1);
    await P.locator(`${row('Lime Cordial')} .pnone input`).check();
    await P.click(`${row('Lime Cordial')} button[aria-label^="One less"]`); await P.click(`${row('Lime Cordial')} button[aria-label^="Clear"]`);
    ok(await P.locator(`${row('Lime Cordial')} .pnone`).count() === 0, 'item removed: the tick goes too');
    await qty('Lime Cordial', 2); ok(!(await P.locator(`${row('Lime Cordial')} .pnone input`).isChecked()), 'added again: off again');
    await P.locator(`${row('Lime Cordial')} .pnone input`).check();
    await qty('Lemon Cordial', 2); // not ticked: nobody said it's empty
    await qty('Honey', 1);
    await P.waitForTimeout(400);
    await primary(P).click();
  }
  // Upstairs: nothing grabbed for these, so each spot is just its check.
  for (let k = 0; k < 3; k++) { await P.waitForTimeout(300); await primary(P).click(); }
  await P.waitForSelector(line('Raspberry Cordial'));

  // Downstairs: Honey in one tap; the cordials short.
  await P.click(`${line('Honey')} .l-all`);
  ok(await P.waitForSelector(`${line('Honey')}.done`, { timeout: 4000 }).then(() => true, () => false), 'a full collection is still one tap');
  const fewer = async (n, got) => { await P.click(`${line(n)} .l-few`); await P.fill(`${line(n)} .qty-input`, String(got)); await P.click(`${line(n)} .fw-ok`); await P.waitForTimeout(350); };
  await fewer('Raspberry Cordial', 0); await fewer('Lime Cordial', 1); await fewer('Lemon Cordial', 0);
  ok((await text(P, `${line('Raspberry Cordial')} .l-why`)).startsWith('Out of stock · 3 bottles short'), 'Raspberry Cordial: ticked empty, none collected → "Out of stock · 3 bottles short"');
  ok((await text(P, `${line('Lime Cordial')} .l-why`)).startsWith('Low stock · Still available · 1 bottle short'), 'Lime Cordial: 1 collected → "Low stock · Still available"');
  ok((await text(P, `${line('Lemon Cordial')} .l-why`)).startsWith('Top-up incomplete · 2 bottles short'), 'Lemon Cordial: not ticked, none collected → "Top-up incomplete"');
  await P.screenshot({ path: `${OUT}/p20-collect.png` });

  // Finish review: out of stock first.
  await primary(P).click(); await P.waitForSelector('.sreport');
  const names = await P.$$eval('.sreport .sr-row', (els) => els.map((e) => e.getAttribute('data-outcome')));
  ok(JSON.stringify(names) === JSON.stringify(['Raspberry Cordial', 'Lime Cordial', 'Lemon Cordial']), 'Finish: out of stock first, then low, then incomplete: ' + names.join(', '));
  const r = (n) => text(P, `.sr-row[data-outcome="${n}"] small`);
  ok((await r('Raspberry Cordial')).startsWith('Out of stock · 3 bottles short'), 'Finish: "Out of stock · 3 bottles short"');
  ok((await r('Lime Cordial')).startsWith('Low stock · 1 bottle short · 1 bottle collected'), 'Finish: "Low stock · 1 bottle short · 1 bottle collected"');
  ok((await r('Lemon Cordial')).startsWith('Top-up incomplete · 2 bottles short · Upstairs stock not confirmed'), 'Finish: "Top-up incomplete · 2 bottles short · Upstairs stock not confirmed"');
  ok(await P.locator('.sr-row[data-outcome="Lime Cordial"] .sr-change').count() === 0, 'some collected: always Low stock (no Change)');
  // Correct Lemon Cordial: someone remembers there's an open bottle on the back bench.
  await P.click('.sr-row[data-outcome="Lemon Cordial"] .sr-change');
  await P.screenshot({ path: `${OUT}/p20-finish-change.png` });
  await P.click('.sr-row[data-outcome="Lemon Cordial"] .sr-fix .chip:has-text("Still available")');
  await P.waitForSelector('.sr-row.k-low[data-outcome="Lemon Cordial"]');
  ok((await r('Lemon Cordial')).startsWith('Low stock · 2 bottles short · Still available upstairs · Changed'), 'changed on Finish: "Low stock · 2 bottles short · Still available upstairs · Changed"');
  // And back again (choosing what the checks said clears the change).
  await P.click('.sr-row[data-outcome="Lemon Cordial"] .sr-change'); await P.click('.sr-row[data-outcome="Lemon Cordial"] .sr-fix .chip:has-text("Not sure")');
  await P.waitForSelector('.sr-row.k-unc[data-outcome="Lemon Cordial"]');
  ok(!(await r('Lemon Cordial')).includes('Changed'), 'back to what the checks said: no "Changed"');
  await P.click('.sr-row[data-outcome="Lemon Cordial"] .sr-change'); await P.click('.sr-row[data-outcome="Lemon Cordial"] .sr-fix .chip:has-text("Still available")');
  await P.waitForSelector('.sr-row.k-low[data-outcome="Lemon Cordial"]');
  await P.screenshot({ path: `${OUT}/p20-finish.png`, fullPage: true });

  await P.click('.dock button.good:has-text("Finish restock")'); await P.waitForSelector('.finish-hero');
  const sh = await waitDb(() => sql`select product_name, shortfall_qty::float as q, stock_status from shortages order by product_name`, (x) => x.length === 3);
  ok(JSON.stringify(sh.map((x) => `${x.productName} ${x.q} ${x.stockStatus}`)) === JSON.stringify(['Lemon Cordial 2 low', 'Lime Cordial 1 low', 'Raspberry Cordial 3 out']),
    'shortages recorded with the number short and their status: ' + sh.map((x) => `${x.productName} ${x.q} ${x.stockStatus}`).join(', '));
  const ticks = await sql`select product_name, none_left_here, status_override from session_items where product_name like '%Cordial' order by product_name`;
  ok(ticks.map((x) => `${x.productName}:${x.noneLeftHere}:${x.statusOverride}`).join(' ') === 'Lemon Cordial:false:low Lime Cordial:true:null Raspberry Cordial:true:null', 'ticks and the correction saved');
  const [mail] = await waitDb(() => sql`select subject, body_text as text from email_outbox order by created_at desc limit 1`, (x) => x.length === 1);
  ok(/: 1 out of stock, 2 low stock$/.test(mail?.subject ?? ''), 'email subject: ' + mail?.subject);
  ok(mail.text.includes('OUT OF STOCK (1)\n- Raspberry Cordial: Out of stock · 3 bottles short · None left upstairs or downstairs'), 'email: Out of stock · 3 bottles short');
  ok(mail.text.includes('LOW STOCK · STILL AVAILABLE (2)') && mail.text.includes('- Lime Cordial: Low stock · 1 bottle short · 1 bottle collected')
    && mail.text.includes('- Lemon Cordial: Low stock · 2 bottles short · Still available upstairs (changed on Finish)'), 'email: Low stock · Still available, with the change noted');
  await P.click('.dcard2:has-text("Bar") >> nth=0').catch(() => {});
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
