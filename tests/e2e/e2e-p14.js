// Candy Bar "None on display": collecting less than needed is Low stock with how many short (also at zero);
// at zero, "None on display" makes it Out of stock on Collect and Review. Gold Class rules are unchanged.
// Before running: reset the test database, then load candy-fixture.sql and candy-area-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 6000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const gone = (P, sel, ms = 6000) => P.locator(sel).first().waitFor({ state: 'detached', timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const card = (n) => `.acard:has(h2:text-is("${n}"))`;
const add = async (P, n, qty) => { await P.click(`${row(n)} button.padd`); for (let k = 1; k < qty; k++) await P.click(`${row(n)} button[aria-label="One more ${n}"]`); };
// Got fewer, step down to `got`, Confirm
const fewer = async (P, n, total, got) => {
  await P.click(`${line(n)} .l-few`); await P.waitForSelector(`${line(n)} .fewer`);
  for (let k = total - 1; k > got; k--) await P.click(`${line(n)} button[aria-label="One less"]`);
  await P.click(`${line(n)} .fw-ok`); await gone(P, `${line(n)} .fewer`);
};

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql`update departments set none_on_display = true where name = 'Candy Bar'`;
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ ...devices['iPhone 13'] }); const P = await c.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Ana'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Candy Bar")'); await P.waitForSelector('.acard');
  await P.click(`${card('Confection stand')} button:has-text("Start")`); await P.waitForSelector('article.prow');
  await add(P, 'Maltesers', 4); await add(P, 'Kit Kat', 3); await add(P, 'Twix', 2);
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');

  // Collected none: Low stock, short 4, with "None on display" underneath
  await fewer(P, 'Maltesers', 4, 0);
  ok(await sees(P, `${line('Maltesers')} .l-why`, 'Low stock') && await sees(P, `${line('Maltesers')} .l-why`, 'short 4'), 'collected none: "Low stock · short 4" (not Out of stock)');
  ok(await P.locator(`${line('Maltesers')} button.l-none`).count() === 1, '...with a "None on display" button underneath');
  // Collected some: Low stock with how many short, no button
  await fewer(P, 'Kit Kat', 3, 1);
  ok(await sees(P, `${line('Kit Kat')} .l-why`, 'Low stock') && await sees(P, `${line('Kit Kat')} .l-why`, 'short 2'), 'collected 1 of 3: "Low stock · short 2"');
  ok(await P.locator(`${line('Kit Kat')} button.l-none`).count() === 0, '...no "None on display" when some was collected');
  await P.screenshot({ path: `${OUT}/p14-low.png`, fullPage: true });

  // None on display → Out of stock (and back)
  await P.click(`${line('Maltesers')} button.l-none`);
  ok(await sees(P, `${line('Maltesers')} .l-why`, 'Out of stock') && await P.getAttribute(`${line('Maltesers')} button.l-none`, 'aria-pressed') === 'true', 'None on display: status changes to "Out of stock"');
  await P.click(`${line('Maltesers')} button.l-none`);
  ok(await sees(P, `${line('Maltesers')} .l-why`, 'Low stock'), 'tap again: back to Low stock');
  await P.click(`${line('Maltesers')} button.l-none`);
  await sees(P, `${line('Maltesers')} .l-why`, 'Out of stock');
  const db1 = await waitDb(() => sql`select none_on_display from session_items where product_name = 'Maltesers'`, (r) => r[0]?.noneOnDisplay === true);
  ok(db1[0]?.noneOnDisplay === true, 'saved on the server');
  await P.click(`${line('Twix')} button.l-all`);
  await P.screenshot({ path: `${OUT}/p14-out.png`, fullPage: true });

  // Changing the amount clears it (only means something at zero)
  await P.click(`${line('Maltesers')} .l-link:has-text("Change")`); await P.waitForSelector(`${line('Maltesers')} .fewer`);
  await P.click(`${line('Maltesers')} button[aria-label="One more"]`);
  await P.click(`${line('Maltesers')} .fw-ok`); await gone(P, `${line('Maltesers')} .fewer`);
  ok(await sees(P, `${line('Maltesers')} .l-why`, 'Low stock') && await P.locator(`${line('Maltesers')} button.l-none`).count() === 0, 'collected 1 after all: Low stock again, no button');
  await P.click(`${line('Maltesers')} .l-link:has-text("Change")`); await P.waitForSelector(`${line('Maltesers')} .fewer`);
  await P.click(`${line('Maltesers')} button[aria-label="One less"]`);
  await P.click(`${line('Maltesers')} .fw-ok`); await gone(P, `${line('Maltesers')} .fewer`);
  ok(await sees(P, `${line('Maltesers')} .l-why`, 'Low stock') && await P.getAttribute(`${line('Maltesers')} button.l-none`, 'aria-pressed') === 'false', 'back to none collected: Low stock until tapped again');
  await P.click(`${line('Maltesers')} button.l-none`); await sees(P, `${line('Maltesers')} .l-why`, 'Out of stock');

  // Review
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  ok(await sees(P, '.sr-row.k-out', 'Maltesers') && await sees(P, '.sr-row.k-out', 'Out of stock · None on display · Short 4'), 'Review: Maltesers "Out of stock · None on display · Short 4 packets"');
  ok(await sees(P, '.sr-row.k-low', 'Kit Kat') && await sees(P, '.sr-row.k-low', 'Low stock · Short 2'), 'Review: Kit Kat "Low stock · Short 2 · Collected 1"');
  await P.screenshot({ path: `${OUT}/p14-review.png`, fullPage: true });
  await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');
  const sh = await waitDb(() => sql`select product_name, none_on_display, shortfall_qty from shortages order by product_name`, (r) => r.length === 2);
  ok(sh.length === 2 && sh.find((x) => x.productName === 'Maltesers')?.noneOnDisplay === true && sh.find((x) => x.productName === 'Kit Kat')?.noneOnDisplay === false, 'Shortages: Maltesers out of stock (none on display), Kit Kat low');
  const [mail] = await waitDb(() => sql`select subject, body_text as text from email_outbox order by created_at desc limit 1`, (r) => r.length === 1, 4000);
  ok(!mail || (mail.text.includes('none on display') && mail.text.includes('Kit Kat')), 'manager email says "none on display"');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
