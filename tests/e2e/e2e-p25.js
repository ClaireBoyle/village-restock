// Candy Bar confection stand, side by side: a Side A / Side B switch (the side stays on, entries saved, either side
// editable, each side its own shade of blue, a +5 button), no "Enter what this side needs." note, one collection line per product with the total and the split (kept
// after Got all), Got fewer with staff choosing where the units go, then the Fill step (a panel per side, Mark filled)
// before Finish, and the same switch in Quick Restock. Phone.
// Before running: reset the test database, then load candy-fixture.sql and candy-area-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 6000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 15000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const card = (n) => `.acard:has(h2:text-is("${n}"))`;
const row = (n) => `.stand-sides article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const side = (P, s) => P.click(`.side-switch button:has-text("${s}")`);
const setQty = async (P, n, v) => {
  const r = row(n);
  if (await P.locator(`${r} button.padd`).count()) { await P.click(`${r} button.padd`); await P.waitForTimeout(250); }
  await P.fill(`${r} .qty-input`, String(v)); await P.locator(`${r} .qty-input`).blur(); await P.waitForTimeout(250);
};
const txt = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql.file('db/updates/2026-11-candy-bar-confection-sides.sql'); await sql.file('db/updates/2026-11-candy-bar-confection-sides.sql');
  // Re-adding the old wording first, so the clean-up script is tested on it.
  await sql`update check_areas set guide_text = 'Enter what this side needs.' where name = 'Confection stand'`;
  for (const f of ['sides', 'less-text', 'less-text']) await sql.file(`db/updates/2026-11-candy-bar-confection-${f}.sql`);
  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Candy Bar")'); await P.click(`${card('Confection stand')} button:has-text("Start")`); await P.waitForSelector('.side-switch');

  // 1. Check the stand, one side at a time.
  ok((await P.$$eval('.side-switch button b', (e) => e.map((x) => x.textContent))).join('|') === 'Side A|Side B', 'a Side A / Side B switch at the top of the list');
  const main = await P.textContent('main');
  ok(!/Enter what (this|each) side needs|both sides|water stand next/i.test(main), 'no "Enter what this side needs." or "check both sides" note');
  const tint = () => P.$eval('.stand-sides', (e) => getComputedStyle(e).backgroundColor);
  const tintA = await tint();
  // +5: from untouched straight to 5, then 5 more, then − back to 9.
  await P.click(`${row('Snickers')} button.p5`); await P.waitForTimeout(250);
  ok(await P.locator(`${row('Snickers')} .qty-input`).inputValue() === '5', '+5 from untouched: 5');
  await P.click(`${row('Snickers')} button.p5`); await P.click(`${row('Snickers')} button[aria-label="One less Snickers"]`); await P.waitForTimeout(250);
  ok(await P.locator(`${row('Snickers')} .qty-input`).inputValue() === '9', '+5 again then −: 9');
  await setQty(P, 'Snickers', 3);
  await side(P, 'Side B'); await P.waitForTimeout(300);
  ok(await P.locator('.side-switch button.on:has-text("Side B")').count() === 1 && await P.locator(`${row('Snickers')} button.padd`).count() === 1, 'Side B: its own list (Snickers not entered here yet)');
  const tintB = await tint();
  ok(tintA !== tintB && !/rgba\(0, 0, 0, 0\)/.test(tintA), `each side its own shade (Side A ${tintA}, Side B ${tintB})`);
  await P.screenshot({ path: `${OUT}/p25-side-b.png`, fullPage: true });
  await setQty(P, 'Snickers', 2); await setQty(P, 'Kit Kat', 1);
  await side(P, 'Side A'); await P.waitForTimeout(300);
  ok(await P.locator(`${row('Snickers')} .qty-input`).inputValue() === '3' && await sees(P, '.side-switch button:has-text("Side A")', '1 entered') && await sees(P, '.side-switch button:has-text("Side B")', '2 entered'),
    'switching sides keeps what was entered (Side A: Snickers 3 · Side B: 2 entered)');
  await P.screenshot({ path: `${OUT}/p25-side-a.png`, fullPage: true });
  // The side stays on when the screen comes back.
  await P.reload(); await P.waitForSelector('.side-switch');
  await side(P, 'Side B'); await P.reload(); await P.waitForSelector('.side-switch');
  ok(await P.locator('.side-switch button.on:has-text("Side B")').count() === 1, 'the chosen side stays on (remembered on this device)');

  // 2. Collect: each product once, the total first, the split underneath.
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector(line('Snickers'));
  ok(await P.locator(line('Snickers')).count() === 1 && (await txt(P, `${line('Snickers')} .l-qty b`)) === '5', 'Snickers: one line, collect 5');
  ok((await txt(P, `${line('Snickers')} .l-split-sides`)) === 'Side A · 3 Side B · 2', 'split underneath: "Side A · 3  Side B · 2"');
  ok((await txt(P, `${line('Kit Kat')} .l-split-sides`)) === 'Side B · 1', 'Kit Kat: "Side B · 1"');
  // Got all keeps the split in view.
  await P.click(`${line('Kit Kat')} .l-all`); await P.waitForSelector(`${line('Kit Kat')}.done`);
  ok((await txt(P, `${line('Kit Kat')} .l-split-sides`)) === 'Side B · 1' && await sees(P, line('Kit Kat'), 'Collected'), 'after Got all: still "Side B · 1"');
  // Got fewer: 4 of 5, staff choose where they go.
  await P.click(`${line('Snickers')} .l-few`); await P.fill(`${line('Snickers')} .qty-input`, '4');
  ok(await sees(P, `${line('Snickers')} .fw-sides`, 'Where do the 4 go?'), 'fewer: "Where do the 4 go?"');
  const n = async (s) => (await P.locator(`${line('Snickers')} .fw-side:has(b:text-is("${s}")) .fw-n`).innerText()).trim();
  ok(await n('Side A') === '3' && await n('Side B') === '1', 'default: Side A 3, Side B 1');
  await P.click(`${line('Snickers')} button[aria-label="One more for Side B"]`);
  ok(await n('Side A') === '2' && await n('Side B') === '2', 'moved one: Side A 2, Side B 2');
  await P.screenshot({ path: `${OUT}/p25-fewer.png` });
  await P.click(`${line('Snickers')} .fw-ok`); await P.waitForTimeout(400);
  ok((await txt(P, `${line('Snickers')} .l-why`)).startsWith('4 collected of 5 requested'), '"4 collected of 5 requested"');
  ok((await txt(P, `${line('Snickers')} .l-split-sides`)) === 'Side A requested 3 · gets 2 Side B requested 2 · gets 2', 'both: requested 3 / 2, gets 2 / 2');
  const got = await waitDb(() => sql`select c.name, i.collected_qty::float as q from session_items i join product_placements x on x.id = i.placement_id join check_areas c on c.id = x.check_area_id
    join products p on p.id = x.product_id where p.name = 'Snickers' and i.collected_mode = 'partial' order by c.name`, (r) => r.length === 2);
  ok(got.map((r) => `${r.name.split(' · ')[1]} ${r.q}`).join(', ') === 'Side A 2, Side B 2', 'saved per side: ' + got.map((r) => `${r.name} ${r.q}`).join(', '));

  // 3. Fill the stand: its own step after Collect (Check → Collect → Fill → Finish), one panel per side with
  //    what was collected for it, and "Mark filled".
  ok(await P.locator('.fill-sides').count() === 0, 'Collect: no Fill Side A / B buttons (it has its own step)');
  ok((await P.$$eval('.rbar .stage .lg', (e) => e.map((x) => x.textContent))).join(' › ') === 'What’s needed › Collect › Fill › Finish', 'steps: What’s needed › Collect › Fill › Finish');
  await P.click('.dock .btn.primary:has-text("Fill the stand")'); await P.waitForSelector('.stand-panel');
  const panel = async (sd) => P.$$eval(`.stand-panel:has(h3:text-is("${sd}")) li`, (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const a = await panel('Side A'), bl = await panel('Side B');
  ok(a.length === 1 && /^Snickers ?2/.test(a[0]), 'Side A: Snickers 2 (what it gets): ' + a.join(' | '));
  ok(bl.length === 2 && bl.some((x) => /^Snickers ?2/.test(x)) && bl.some((x) => /^Kit Kat ?1/.test(x)), 'Side B: Snickers 2, Kit Kat 1: ' + bl.join(' | '));
  await P.click('.stand-panel:has(h3:text-is("Side A")) .stand-mark');
  ok(await P.locator('.stand-panel[data-filled="true"]:has(h3:text-is("Side A"))').count() === 1, 'Side A: "Mark filled" → filled');
  await P.screenshot({ path: `${OUT}/p25-fill.png`, fullPage: true });
  await P.click('.dock .btn.primary:has-text("Review and finish")'); await P.waitForSelector('.finish-title');
  await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');

  // Quick Restock: the same switch for the confection stand.
  await P.click('.dock button:has-text("Back to home")').catch(() => {}); await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.dcard2:has-text("Candy Bar")'); await P.click('.quick-link:has-text("Stock top-up")'); await P.waitForSelector('#qsearch');
  await P.click('.chip:has-text("Confection stand")');
  ok(await P.locator('.q-sides button').count() === 2 && await P.locator('.qpanel .qrow:has(b:text-is("Snickers"))').count() === 1, 'Quick Restock: Side A / Side B switch, one side at a time');
  await P.click('.q-sides button:has-text("Side B")');
  await P.fill('.qpanel .qrow:has(b:text-is("Maltesers")) .q-num', '2'); await P.waitForSelector('.picked .qrow:has-text("Maltesers")');
  ok(await sees(P, '.picked .qrow:has-text("Maltesers")', 'Side B') && await sees(P, '.q-sides button:has-text("Side B")', '1 on your list'), 'Quick Restock: Maltesers 2 for Side B on Your list');
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector(line('Maltesers'));
  ok((await txt(P, `${line('Maltesers')} .l-split-sides`)) === 'Side B · 2', 'Quick Restock collect: "Side B · 2"');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
