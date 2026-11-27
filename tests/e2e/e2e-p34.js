// Collection list, less to look at: a storeroom folds up a moment after its last item is ticked (tap its heading to
// open it again; it opens by itself if something in it goes back to "to collect"), then "Fill the stand" is the next
// step. Candy Bar confection stand, phone.
// Before running: reset the test database, then load candy-fixture.sql and candy-area-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const row = (n) => `.stand-sides article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  for (const f of ['sides', 'less-text']) await sql.file(`db/updates/2026-11-candy-bar-confection-${f}.sql`);
  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Candy Bar")'); await P.click('.acard:has(h2:text-is("Confection stand")) button:has-text("Start")'); await P.waitForSelector('.side-switch');
  await P.click(`${row('Snickers')} button.p5`);
  await P.click('.side-switch button:has-text("Side B")'); await P.waitForTimeout(300);
  await P.click(`${row('Kit Kat')} button.padd`); await P.waitForTimeout(300);
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector(line('Snickers'));

  // The storeroom with both on its list.
  const room = `.room:has(${line('Snickers')})`;
  const name = (await P.locator(`${room} .room-h h3`).innerText()).trim();
  const R = `.room:has(.room-h h3:text-is("${name}"))`;
  ok(await P.locator(`${R} ${line('Kit Kat')}`).count() === 1, `Snickers and Kit Kat both from ${name}`);
  await P.click(`${line('Snickers')} .l-all`); await P.waitForTimeout(1600);
  ok(await P.locator(`${R} .line`).count() === 2, 'one of two ticked: the storeroom stays open');
  await P.click(`${line('Kit Kat')} .l-all`); await P.waitForTimeout(300);
  ok(await P.locator(`${R} .line`).count() === 2 && await P.locator(`${line('Kit Kat')}.done`).count() === 1, 'last one ticked: still open for a moment (the tick shows, Undo is there)');
  await P.waitForTimeout(1500);
  ok(await P.locator(`${R} .line`).count() === 0 && await P.locator(`${R} .room-h[aria-expanded="false"]`).count() === 1, 'then the storeroom folds up');
  ok((await P.locator(`${R} .room-n`).innerText()).trim() === '2 of 2', 'its heading still says "2 of 2"');
  await P.screenshot({ path: `${OUT}/p34-folded.png`, fullPage: true });
  // Opened again by hand: stays open (no snapping shut).
  await P.click(`${R} .room-h`); await P.waitForTimeout(1600);
  ok(await P.locator(`${R} .line`).count() === 2, 'tap the heading: open again, and it stays open');
  // Undo one: still open; fold it, then a line back to "to collect" opens it by itself.
  await P.click(`${line('Kit Kat')} .l-link:has-text("Undo")`); await P.waitForTimeout(300);
  ok(await P.locator(`${line('Kit Kat')}.done`).count() === 0, 'Undo: Kit Kat back to collect');
  await P.click(`${line('Kit Kat')} .l-all`); await P.waitForTimeout(1700);
  ok(await P.locator(`${R} .line`).count() === 0, 'ticked again: folds up again');

  // Fill the stand: its own step now (not on the collection list).
  ok(await P.locator('.fill-sides').count() === 0 && await P.locator('.dock .btn.primary:has-text("Fill the stand")').count() === 1, 'Collect: "Fill the stand" is the next step');
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no sideways scrolling');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
