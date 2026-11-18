// Gold Class Bar Refill FOH: Check FOH → Refill FOH (grab upstairs) → Check BOH (suggestions) → Collect downstairs → Finish.
// Before running: reset the test database (migrations up to 012), then load gcbar-refill-fixture.sql
// (a copy of the live Gold Class Bar catalogue). The test applies the db/updates script itself, twice.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const add = async (P, n, qty = 1) => { await P.click(`${row(n)} button.padd`); for (let k = 1; k < qty; k++) await P.click(`${row(n)} button[aria-label="One more ${n}"]`); };
const goArea = async (P, n) => { await P.click(`.area-btn:has-text("${n}")`); await P.waitForSelector(`.area-btn.cur:has-text("${n}")`); await P.waitForTimeout(150); };
const rail = (P) => P.$$eval('.area-btn b', (els) => els.map((e) => e.textContent));
const text = (P, sel) => P.locator(sel).first().innerText();
// Waits for the screen to show it (rows update a moment after a tap).
const valueIs = async (P, n, v) => { const end = Date.now() + 6000; while (Date.now() < end) { if (await P.inputValue(`${row(n)} input.qty-input`).catch(() => '') === v) return true; await P.waitForTimeout(150); } return false; };
const sees = (P, sel, t) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: 6000 }).then(() => true, () => false);
const rooms = (P) => P.$$eval('.room', (els) => els.map((r) => [r.querySelector('h3').textContent,
  [...r.querySelectorAll('.line')].map((l) => `${l.querySelector('.l-amt b')?.textContent ?? '✓'} ${l.querySelector('.l-amt small')?.textContent ?? ''} ${l.dataset.line}`.replace(/\s+/g, ' ').trim())]));

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql.file('db/updates/2026-11-gold-class-bar-refill-foh.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-refill-foh.sql');
  const [{ n }] = await sql`select count(*)::int as n from product_placements pl join check_areas a on a.id = pl.check_area_id where a.name = 'FOH beer fridge'`;
  const [{ d }] = await sql`select count(*)::int as d from (select product_id from product_placements pl join check_areas a on a.id = pl.check_area_id where a.name = 'FOH beer fridge' group by 1 having count(*) > 1) x`;
  ok(n === 23 && d === 0, 'update script runs twice: 23 products in the FOH beer fridge, no duplicates');
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ ...devices['iPhone 13'] }); const P = await c.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  // Check FOH
  const steps = await P.$$eval('.rbar .stage .sm', (els) => els.map((e) => e.textContent));
  ok(JSON.stringify(steps) === JSON.stringify(['FOH', 'Refill', 'BOH', 'Collect', 'Finish']), 'five steps: ' + steps.join(' › '));
  const foh = await rail(P);
  ok(foh[0] === 'FOH beer fridge' && !foh.includes('BOH bar fridge') && !foh.includes('Upstairs cupboards') && foh.includes('Back bench') && foh.includes('Confection'), 'Check FOH shows front-of-house areas only: ' + foh.join(', '));
  const heads = await P.$$eval('.area > .prows > .phead', (els) => els.map((e) => e.textContent));
  ok(JSON.stringify(heads) === JSON.stringify(['Beer, Cider & Hard Soda', 'Mixers & Water', 'Curatif Cocktails']), 'FOH beer fridge: ' + heads.join(' | '));
  ok(await P.locator('.area > .prows > article.prow').count() === 23, '12 beers, 2 Kirks, 2 waters, 7 Curatif');
  for (const [p, q] of [['Heineken', 3], ['Kirks Indian Tonic Water', 2], ['Mount Franklin Sparkling Water 330ml', 4], ['Mount Franklin Still Water', 6], ['Curatif Negroni', 2]]) await add(P, p, q);
  ok(await sees(P, `${row('Heineken')} .ps`, '3 bottles'), 'beers counted as single bottles in the FOH fridge (packs in the BOH fridge)');
  ok(await sees(P, `${row('Heineken')} .pnote`, 'Grab it from the BOH bar fridge'), 'says where to grab it');
  await P.screenshot({ path: `${OUT}/p13-foh-fridge.png` });
  await goArea(P, 'Back bench');
  await add(P, 'Red Claw Shiraz'); await add(P, 'Vanilla Syrup');
  ok(await sees(P, `${row('Red Claw Shiraz')} .pnote`, 'Grab it from the Wine cupboard'), 'red wine: grab it from the Wine cupboard');
  ok(await P.locator(`${row('Vanilla Syrup')} .pnote`).count() === 0, 'syrups: no upstairs note (straight from downstairs)');
  await P.click(`${row('Sugar container')} .pseg button`);
  await goArea(P, 'Back shelves'); await add(P, 'Grey Goose');

  // Refill FOH
  await P.click('.rbar .stage:has-text("Refill")'); await P.waitForSelector('.room');
  const r1 = await rooms(P);
  ok(JSON.stringify(r1) === JSON.stringify([
    ['BOH bar fridge', ['3 bottles Heineken', '2 bottles Kirks Indian Tonic Water', '4 bottles Mount Franklin Sparkling Water 330ml']],
    ['Walk in fridge', ['6 bottles Mount Franklin Still Water']],
    ['Upstairs cupboards', ['✓ Sugar container']],
    ['Wine cupboard', ['1 bottle Red Claw Shiraz']],
    ['Spirits cupboard', ['1 bottle Grey Goose']]]), 'Refill FOH grouped by pickup spot: ' + JSON.stringify(r1));
  ok(!JSON.stringify(r1).includes('Curatif') && !JSON.stringify(r1).includes('Vanilla'), 'Curatif and syrups are not upstairs pickups');
  ok(await P.locator('.l-few').count() === 0, 'just a tick per line (no "Got fewer")');
  ok(await sees(P, `${line('Sugar container')}`, 'fill it to the top'), 'sugar: refill the container to the top');
  await P.click(`${line('Heineken')} button.l-all`); await P.click(`${line('Red Claw Shiraz')} button.l-all`);
  ok(await sees(P, '.dock', '2 of 7 grabbed'), 'progress: 2 of 7 grabbed');
  await P.screenshot({ path: `${OUT}/p13-refill.png`, fullPage: true });
  // Tablet and desktop: the same screen, wider
  for (const [name, vp] of [['tablet', { width: 834, height: 1194 }], ['desktop', { width: 1366, height: 900 }]]) {
    await P.setViewportSize(vp); await P.waitForTimeout(250);
    ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: no sideways scrolling on Refill FOH`);
    ok(await P.locator('.rbar .stage .lg:visible').count() === 5, `${name}: full step names`);
    await P.screenshot({ path: `${OUT}/p13-refill-${name}.png` });
  }
  await P.setViewportSize(devices['iPhone 13'].viewport);
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no sideways scrolling; five steps fit');

  // Check BOH
  await P.click('.dock .dock-acts button:has-text("Check BOH")'); await P.waitForSelector('article.prow');
  ok(JSON.stringify(await rail(P)) === JSON.stringify(['BOH bar fridge', 'Walk in fridge', 'Upstairs cupboards']), 'Check BOH: the three upstairs spots');
  await goArea(P, 'BOH bar fridge');
  ok(await valueIs(P, 'Mount Franklin Sparkling Water 330ml', '4') && await sees(P, `${row('Mount Franklin Sparkling Water 330ml')} .pnote`, 'Suggested: 4 taken for FOH beer fridge'), 'Sparkling 330ml: 4 suggested from what was taken');
  ok(await P.locator(`${row('Heineken')} button.padd`).count() === 1, 'beers are not suggested (the fridge is counted in packs)');
  await add(P, 'Kirks Indian Tonic Water');
  ok(await sees(P, `${row('Kirks Indian Tonic Water')} .ps`, '1 pack'), 'Kirks counted in packs in the BOH fridge');
  await goArea(P, 'Walk in fridge');
  ok(await P.locator(`${row('Mount Franklin Still Water')} button.padd`).count() === 1 && await sees(P, `${row('Mount Franklin Still Water')}`, 'less than ¼'), 'Still Water: not suggested; a slab only when under ¼ is left');
  await add(P, 'Mount Franklin Still Water');
  ok(await sees(P, `${row('Mount Franklin Still Water')} .ps`, '1 slab'), 'Still Water counted in slabs upstairs');
  await goArea(P, 'Upstairs cupboards');
  const top = await P.$$eval('.area > .prows > *', (els) => els.map((e) => (e.matches('.phead') ? `# ${e.querySelector('span')?.textContent ?? e.textContent}` : e.querySelector('h3')?.textContent)));
  ok(JSON.stringify(top.slice(0, 3)) === JSON.stringify(['# Taken for FOH', 'Red Claw Shiraz', 'Grey Goose']), 'taken for FOH listed first: ' + top.slice(0, 3).join(', '));
  ok(await P.locator(row('Red Claw Shiraz')).count() === 1 && await P.locator(row('Grey Goose')).count() === 1, '...and not repeated in the cupboard lists below');
  ok(await sees(P, `${row('Grey Goose')} .parea`, 'Spirits cupboard'), '...each saying which cupboard it is in');
  ok(await valueIs(P, 'Red Claw Shiraz', '1'), 'Shiraz taken from the Wine cupboard: 1 suggested');
  await P.click(`${row('Red Claw Shiraz')} button[aria-label="One more Red Claw Shiraz"]`); await P.click(`${row('Red Claw Shiraz')} button[aria-label="One more Red Claw Shiraz"]`);
  ok(await sees(P, `${row('Red Claw Shiraz')} .pnote`, '(suggested 1)') && await sees(P, `${row('Red Claw Shiraz')} .ps`, '3 bottles'), 'changed to 3: 3 in total, and it says it was 1 suggested');
  await P.click(`${row('Grey Goose')} button[aria-label="One less Grey Goose"]`);
  ok(await sees(P, `${row('Grey Goose')} .ps`, 'Removed'), 'suggestion removed (there was enough)');
  await P.click(`${row('Grey Goose')} button[aria-label="Back to the suggested 1 Grey Goose"]`);
  ok(await valueIs(P, 'Grey Goose', '1'), '...and can be brought back');
  await P.click(`${row('Grey Goose')} button[aria-label="One less Grey Goose"]`);
  ok(await P.locator('.area > .prows > .phead.taken-h').count() === 1 && await P.locator(row('Grey Goose')).count() === 1, 'a removed suggestion stays at the top (nothing jumps)');
  await P.screenshot({ path: `${OUT}/p13-boh.png`, fullPage: true });
  await P.setViewportSize({ width: 1366, height: 900 }); await P.waitForTimeout(250); await P.screenshot({ path: `${OUT}/p13-boh-desktop.png` });
  await P.setViewportSize(devices['iPhone 13'].viewport);

  // Collect downstairs
  await P.click('.rbar .stage:has-text("Collect")'); await P.waitForSelector('.room');
  const r2 = await rooms(P);
  ok(JSON.stringify(r2.map(([a, l]) => [a.toLowerCase(), [...l].sort()])) === JSON.stringify([
    ['alcohol storeroom', ['1 bottle Vanilla Syrup', '2 cans Curatif Negroni', '3 bottles Red Claw Shiraz']],
    ['walk in fridge(downstairs)', ['1 pack Kirks Indian Tonic Water', '1 slab Mount Franklin Still Water', '4 bottles Mount Franklin Sparkling Water 330ml']]]), 'downstairs list: ' + JSON.stringify(r2));
  ok(!JSON.stringify(r2).includes('Heineken') && !JSON.stringify(r2).includes('Grey Goose'), 'no beer singles; the removed Grey Goose is gone');
  for (const l of ['Red Claw Shiraz', 'Curatif Negroni', 'Vanilla Syrup', 'Kirks Indian Tonic Water', 'Mount Franklin Sparkling Water 330ml', 'Mount Franklin Still Water']) await P.click(`${line(l)} button.l-all`);
  ok(await sees(P, '.dock', '6 of 6 resolved'), 'all 6 collected');
  await P.screenshot({ path: `${OUT}/p13-collect.png`, fullPage: true });

  // Finish
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  await P.click('.dock button.good:has-text("Finish restock")'); await P.waitForSelector('.finish-hero');
  const [s] = await waitDb(() => sql`select status, exception_reason from restock_sessions where kind = 'full'`, (r) => r[0]?.status !== 'open');
  ok(s.status === 'finished', 'finished cleanly (unticked upstairs pickups never block finishing)');
  const sp = await waitDb(() => sql`select si.requested_qty, si.collected_mode, si.collected_qty from session_items si join product_placements pl on pl.id = si.placement_id
    join check_areas a on a.id = pl.check_area_id where si.product_name = 'Mount Franklin Sparkling Water 330ml' and a.name = 'BOH bar fridge'`, (r) => r[0]?.collected_mode === 'all');
  ok(sp[0]?.requestedQty === null && Number(sp[0]?.collectedQty) === 4, 'the kept suggestion counted (4 collected) without staff typing it');
  const [{ c: shorts }] = await sql`select count(*)::int as c from shortages`;
  ok(shorts === 0, 'no shortages recorded');

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
