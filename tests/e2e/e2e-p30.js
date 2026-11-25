// Gold Class Bar: the malt powder container is a "Needs refill" task at the milkshake station; once ticked, the
// Coffee cupboard reminds staff at the top to refill it (ticked off there, not on the downstairs list). Malt powder
// stays a Coffee cupboard stock item, collected from downstairs as usual. Got fewer starts at 0, adjusted with + / −.
// Before running: reset the test database, then load gcbar-refill-fixture.sql. The test applies the update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const goArea = async (P, n) => { await P.click(`.area-btn:has-text("${n}")`); await P.waitForSelector(`.area-btn.cur:has-text("${n}")`); await P.waitForTimeout(250); };
const text = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const MC = 'Malt powder container';
const waitDb = async (q, check, ms = 15000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  for (const f of ['refill-foh', 'back-bench-walk', 'foh-lap', 'coffee-cupboard', 'beer-fridge-area', 'malt-refill', 'malt-refill']) await sql.file(`db/updates/2026-11-gold-class-bar-${f}.sql`);

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  // Before ticking: no reminder in the Coffee cupboard.
  await goArea(P, 'Coffee cupboard');
  ok(await P.locator('.area-remind').count() === 0, 'Coffee cupboard: no reminder until the container is ticked');

  await goArea(P, 'Milkshake station');
  const order = await P.$$eval('article.prow h3', (e) => e.map((x) => x.textContent));
  ok(order.indexOf(MC) === order.indexOf('Cadbury Flake container') + 1, 'Milkshake station: Malt powder container after the Flake container');
  ok((await P.locator(`${row(MC)} .pseg button`).first().innerText()).includes('Needs refill') && await P.locator(`${row(MC)} .qty-input`).count() === 0, '"Needs refill", no amount');
  await P.click(`${row(MC)} .pseg button >> nth=0`); await P.waitForTimeout(300);
  ok((await text(P, row(MC))).includes('Refill at the Coffee cupboard'), 'ticked: "Refill at the Coffee cupboard"');

  await goArea(P, 'Coffee cupboard');
  const first = await P.$$eval('.area > *', (els) => els.slice(0, 3).map((e) => e.className));
  ok(first.some((c) => c.includes('area-remind')) && first.indexOf(first.find((c) => c.includes('area-remind'))) <= 1, 'Coffee cupboard: the reminder at the top: ' + first.join(' | '));
  ok((await P.textContent('.area-remind h3')) === 'Refill while you’re here' && (await text(P, '.area-remind')).includes(MC) && (await text(P, '.area-remind')).includes('Refill it from the malt powder in the coffee cupboard'),
    '"Refill while you\'re here: Malt powder container"');
  ok(await P.locator(row('Malt powder')).count() === 1, 'Malt powder still a stock item here');
  await P.click(`${row('Malt powder')} .padd`); await P.waitForTimeout(300);
  await P.screenshot({ path: `${OUT}/p30-coffee-cupboard.png`, fullPage: true });
  await P.click(`.area-remind li[data-remind="${MC}"] .l-tick`); await P.waitForSelector(`.area-remind li[data-remind="${MC}"].done`);
  ok(true, 'refilled: ticked off in the reminder');
  const [it] = await waitDb(() => sql`select collected_mode from session_items where product_name = ${MC}`, (r) => r[0]?.collectedMode === 'all');
  ok(it?.collectedMode === 'all', 'saved as done');

  // Downstairs: the malt powder tin, not the container.
  await P.click('.rbar .stage:has-text("Collect"), .rbar .stage:has-text("Down")'); await P.waitForSelector('.rooms');
  ok(await P.locator(line('Malt powder')).count() === 1 && await P.locator(line(MC)).count() === 0, 'downstairs list: Malt powder (from the Alcohol storeroom), not the container');

  // Got fewer starts at 0; + / − adjust it.
  await P.click(`${line('Malt powder')} .l-few`);
  ok(await P.inputValue(`${line('Malt powder')} .qty-input`) === '0' && await P.isDisabled(`${line('Malt powder')} button[aria-label="One less"]`), 'Got fewer: 0 already in place (− can\'t go below it)');
  ok((await text(P, `${line('Malt powder')} .fewer`)).includes('Short 1 tin'), '…"Short 1 tin" straight away');
  await P.click(`${line('Malt powder')} button[aria-label="One more"]`);
  ok(await P.inputValue(`${line('Malt powder')} .qty-input`) === '1', '+ → 1');
  await P.click(`${line('Malt powder')} button[aria-label="One less"]`);
  await P.screenshot({ path: `${OUT}/p30-got-fewer.png` });
  await P.click(`${line('Malt powder')} .fw-ok`); await P.waitForTimeout(400);
  const [mp] = await waitDb(() => sql`select collected_mode, collected_qty::float as q from session_items where product_name = 'Malt powder'`, (r) => r[0]?.collectedMode === 'partial');
  ok(mp.collectedMode === 'partial' && mp.q === 0, 'confirmed at 0: none collected');

  // Quick Restock: the container isn't a pick (it's a walk reminder); the malt powder is.
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('text=Start stock top-up'); await P.waitForSelector('#qsearch');
  await P.fill('#qsearch', 'malt'); await P.waitForTimeout(300);
  ok(await P.locator(`.qpanel .qrow:has(b:text-is("Malt powder"))`).count() === 1 && await P.locator(`.qpanel .qrow:has(b:text-is("${MC}"))`).count() === 0, 'Quick Restock: Malt powder, not the container');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
