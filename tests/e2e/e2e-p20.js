// Gold Class Bar shortages: "Some left" / "None left" beside a top-up (Some left chosen when the amount is typed in,
// kept when it changes, cleared with it), the whole restock used at Finish, and the manager email. The two cases:
//   Maraschino Cherries: an open jar upstairs, 1 extra requested, Some left left as it is, 0 downstairs
//     → "Low stock · 1 jar short · Still available upstairs" (only the amount entered).
//   The last bottle moved to the bar: the back bench needs 3 Red Claw Shiraz, the Wine cupboard has 1 (grabbed),
//     the cupboard is then empty, 0 downstairs → "Low stock · 2 bottles short · Still available at the bar".
// Plus: None left at the bar and 0 downstairs → "Out of stock · 3 bottles short"; a full collection isn't listed.
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
const left = async (P, n) => P.$$eval(`${row(n)} .pleft-b.on`, (e) => e.map((x) => x.textContent.trim()));

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  for (const f of ['refill-foh', 'back-bench-walk', 'foh-lap', 'coffee-cupboard', 'beer-fridge-area']) await sql.file(`db/updates/2026-11-gold-class-bar-${f}.sql`);
  await sql`update departments set none_left_check = true where lower(name) = 'gold class bar'`;
  await sql`insert into app_settings (key, value) values ('manager_email', '"manager@example.com"'::jsonb), ('manager_email_enabled', 'true'::jsonb)
    on conflict (key) do update set value = excluded.value`;
  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');
  const qty = async (n, v) => { if (await P.locator(`${row(n)} .padd`).count()) await P.click(`${row(n)} .padd`); await P.fill(`${row(n)} .qty-input`, String(v)); await P.locator(`${row(n)} .qty-input`).blur(); await P.waitForTimeout(300); };

  // Check the bar: walk every area; entries on the Back bench and in the Coffee cupboard.
  const bar = await P.$$eval('.area-btn b', (e) => e.map((x) => x.textContent));
  for (const a of bar) {
    await P.waitForSelector(`.area-btn.cur:has-text("${a}")`); await P.waitForTimeout(150);
    if (a === 'Back bench') {
      ok(await P.locator('.pleft').count() === 0, 'nothing entered: no Some left / None left');
      await qty('Red Claw Shiraz', 3);
      ok(JSON.stringify(await left(P, 'Red Claw Shiraz')) === '["Some left"]', 'typed 3: "Some left" chosen straight away');
      await P.click(`${row('Red Claw Shiraz')} .pleft-b.none`); await P.waitForTimeout(250);
      ok(JSON.stringify(await left(P, 'Red Claw Shiraz')) === '["None left"]', 'bench empty: one tap, "None left"');
    }
    if (a === 'Coffee cupboard') {
      await qty('Raspberry Cordial', 3); await P.click(`${row('Raspberry Cordial')} .pleft-b.none`);
      await qty('Honey', 1);
      // Changing the amount keeps the choice.
      await qty('Raspberry Cordial', 4); await qty('Raspberry Cordial', 3);
      ok(JSON.stringify(await left(P, 'Raspberry Cordial')) === '["None left"]', 'amount changed: the choice is kept');
      await P.screenshot({ path: `${OUT}/p20-left-here.png`, fullPage: true });
    }
    await primary(P).click();
  }

  // Upstairs: the Wine cupboard has only 1 Shiraz (the last bottle, taken to the bench); an open jar of cherries in the walk-in.
  for (let k = 0; k < 6; k++) {
    await P.waitForTimeout(400);
    const here = await P.locator('.area-btn.cur b').innerText().catch(() => '');
    if (here === 'Walk in fridge') {
      await qty('Maraschino Cherries', 1);
      ok(JSON.stringify(await left(P, 'Maraschino Cherries')) === '["Some left"]', 'Maraschino Cherries: 1 jar, "Some left" already chosen (open jar)');
    }
    if (here === 'Upstairs cupboards') {
      const grab = `.grab ${line('Red Claw Shiraz')}`;
      await P.click(`${grab} .l-few`); await P.fill(`${grab} .qty-input`, '1'); await P.click(`${grab} .fw-ok`); await P.waitForTimeout(400);
      const cup = row('Red Claw Shiraz'); // at the top: "Replace what you grabbed"
      ok((await text(P, cup)).includes('2 still needed for Back bench (not enough here)'), 'cupboard: "2 still needed for Back bench (not enough here)"');
      ok((await left(P, 'Red Claw Shiraz')).length === 0, 'a suggested amount: nothing chosen for it');
      await P.click(`${cup} .pleft-b.none`); await P.waitForTimeout(250);
      await P.screenshot({ path: `${OUT}/p20-cupboard.png`, fullPage: true });
    }
    if (await P.locator('.line').count() && !(await P.locator('.grab').count()) && !(await P.locator('article.prow').count())) break;
    await primary(P).click();
    if (await P.locator('.rbar .stage.cur:has-text("Collect"), .rooms').count()) break;
  }
  await P.waitForSelector(line('Maraschino Cherries'));

  // Downstairs: none of the cherries, Shiraz or raspberry cordial; the honey all there.
  await P.click(`${line('Honey')} .l-all`);
  const none = async (n) => { await P.click(`${line(n)} .l-few`); await P.fill(`${line(n)} .qty-input`, '0'); await P.click(`${line(n)} .fw-ok`); await P.waitForTimeout(350); };
  ok((await text(P, `${line('Red Claw Shiraz')} .l-qty b`)) === '2', 'downstairs: 2 Shiraz (what the bench still needs)');
  await none('Maraschino Cherries'); await none('Red Claw Shiraz'); await none('Raspberry Cordial');

  // Finish: the whole restock.
  await primary(P).click(); await P.waitForSelector('.sreport');
  const r = (n) => text(P, `.sr-row[data-outcome="${n}"] small`);
  const names = await P.$$eval('.sreport .sr-row', (els) => els.map((e) => e.getAttribute('data-outcome')));
  ok(names[0] === 'Raspberry Cordial' && names.includes('Maraschino Cherries') && names.includes('Red Claw Shiraz') && !names.includes('Honey'), 'out of stock first; the honey (collected in full) not listed: ' + names.join(', '));
  ok((await r('Maraschino Cherries')).startsWith('Low stock · 1 jar short · Still available upstairs'), 'Maraschino Cherries: "Low stock · 1 jar short · Still available upstairs"');
  ok((await r('Red Claw Shiraz')).startsWith('Low stock · 2 bottles short · Still available at the bar'), 'last bottle moved to the bar: "Low stock · 2 bottles short · Still available at the bar"');
  ok((await r('Raspberry Cordial')).startsWith('Out of stock · 3 bottles short'), 'None left and nothing downstairs: "Out of stock · 3 bottles short"');
  ok(await P.locator('.sr-row.k-low[data-outcome="Maraschino Cherries"]').count() === 1 && await P.locator('.sr-row.k-out[data-outcome="Raspberry Cordial"]').count() === 1, 'amber Low stock, red Out of stock');
  // Correct it on Finish (someone finds an open bottle of raspberry cordial).
  await P.click('.sr-row[data-outcome="Raspberry Cordial"] .sr-change'); await P.click('.sr-row[data-outcome="Raspberry Cordial"] .sr-fix .chip:has-text("Still available")');
  await P.waitForSelector('.sr-row.k-low[data-outcome="Raspberry Cordial"]');
  ok((await r('Raspberry Cordial')).includes('Changed'), 'corrected on Finish: Low stock, "Changed"');
  await P.click('.sr-row[data-outcome="Raspberry Cordial"] .sr-change'); await P.click('.sr-row[data-outcome="Raspberry Cordial"] .sr-fix .chip:has-text("Out of stock")');
  await P.waitForSelector('.sr-row.k-out[data-outcome="Raspberry Cordial"]');
  await P.screenshot({ path: `${OUT}/p20-finish.png`, fullPage: true });

  await P.click('.dock button.good:has-text("Finish restock")'); await P.waitForSelector('.finish-hero');
  const [mail] = await waitDb(() => sql`select subject, body_text as text from email_outbox order by created_at desc limit 1`, (x) => x.length === 1);
  ok(mail.text.includes('- Maraschino Cherries: Low stock · 1 jar short · Still available upstairs'), 'email: Maraschino Cherries, still available upstairs');
  ok(mail.text.includes('- Red Claw Shiraz: Low stock · 2 bottles short · Still available at the bar'), 'email: Red Claw Shiraz, still available at the bar');
  ok(mail.text.includes('OUT OF STOCK (1)\n- Raspberry Cordial: Out of stock · 3 bottles short'), 'email: Raspberry Cordial out of stock');
  const saved = await sql`select product_name, left_here, none_left_here from session_items where product_name in ('Maraschino Cherries', 'Red Claw Shiraz', 'Raspberry Cordial') order by product_name, left_here`;
  ok(saved.some((x) => x.productName === 'Maraschino Cherries' && x.leftHere === 'some') && saved.filter((x) => x.productName === 'Red Claw Shiraz').every((x) => x.leftHere === 'none'),
    'saved: ' + saved.map((x) => `${x.productName} ${x.leftHere}`).join(', '));
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
