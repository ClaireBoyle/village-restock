// Gold Class Bar Full Restock: Check the bar → Upstairs (at each spot: Grab for the bar, then Bring up from downstairs,
// with what was grabbed suggested) → Collect downstairs → Finish.
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
const primaryIs = async (P, t) => { const end = Date.now() + 6000; while (Date.now() < end) { if ((await P.locator('.dock .dock-acts .btn.primary').innerText().catch(() => '')).replace(/\s+/g, ' ').trim() === t) return true; await P.waitForTimeout(150); } return false; };
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

  // Check the bar
  const steps = await P.$$eval('.rbar .stage .sm', (els) => els.map((e) => e.textContent));
  ok(JSON.stringify(steps) === JSON.stringify(['Bar', 'Up', 'Down', 'Finish']), 'four steps: ' + steps.join(' › '));
  ok(await sees(P, '.dock', 'Nothing added to the collection list'), 'nothing entered yet: "Nothing added to the collection list"');
  const foh = await rail(P);
  ok(foh[0] === 'FOH beer fridge' && !foh.includes('BOH bar fridge') && !foh.includes('Upstairs cupboards') && foh.includes('Back bench') && foh.includes('Confection'), 'Check the bar shows front-of-house areas only: ' + foh.join(', '));
  const heads = await P.$$eval('.area > .prows > .phead', (els) => els.map((e) => e.textContent));
  ok(JSON.stringify(heads) === JSON.stringify(['Beer, Cider & Hard Soda', 'Mixers & Water', 'Curatif Cocktails']), 'FOH beer fridge: ' + heads.join(' | '));
  ok(await P.locator('.area > .prows > article.prow').count() === 23, '12 beers, 2 Kirks, 2 waters, 7 Curatif');
  for (const [p, q] of [['Heineken', 3], ['Kirks Indian Tonic Water', 2], ['Mount Franklin Sparkling Water 330ml', 4], ['Mount Franklin Still Water', 6], ['Curatif Negroni', 2]]) await add(P, p, q);
  ok(await sees(P, `${row('Heineken')} .ps`, '3 bottles'), 'beers counted as single bottles in the FOH fridge (packs in the BOH fridge)');
  ok(await sees(P, `${row('Heineken')} .pnote`, 'Grab it from the BOH bar fridge'), 'says where to grab it');
  await goArea(P, 'Back bench');
  await add(P, 'Red Claw Shiraz'); await add(P, 'Vanilla Syrup');
  ok(await sees(P, `${row('Red Claw Shiraz')} .pnote`, 'Grab it from the Wine cupboard'), 'red wine: grab it from the Wine cupboard');
  await P.click(`${row('Sugar container')} .pseg button`);
  await goArea(P, 'Back shelves'); await add(P, 'Grey Goose'); await add(P, 'Patron Silver');
  // Checked with nothing needed vs not checked yet
  await goArea(P, 'FOH freezer'); await P.click('.dock .dock-acts .btn.primary');
  ok(await sees(P, '.area-btn:has-text("FOH freezer")', 'Checked · nothing needed') && await sees(P, '.area-btn:has-text("Popcorn boxes")', 'Unchecked'),
    '"Checked · nothing needed" (Done with nothing entered) vs "Unchecked"');
  await P.screenshot({ path: `${OUT}/p13-bar.png` });

  // Upstairs: one screen per spot
  await P.click('.rbar .stage:has-text("Upstairs")'); await P.waitForSelector('article.prow');
  ok(JSON.stringify(await rail(P)) === JSON.stringify(['BOH bar fridge', 'Walk in fridge', 'Upstairs cupboards']), 'Upstairs: the three spots, in order');
  await goArea(P, 'BOH bar fridge');
  const grabLines = (P) => P.$$eval('.grab .line', (els) => els.map((l) => `${l.querySelector('.l-amt b')?.textContent ?? '✓'} ${l.dataset.line}`));
  ok(JSON.stringify(await grabLines(P)) === JSON.stringify(['3 Heineken', '2 Kirks Indian Tonic Water', '4 Mount Franklin Sparkling Water 330ml'])
    && await sees(P, '.grab .line[data-line="Heineken"]', 'For FOH beer fridge'), 'BOH bar fridge: "Grab for the bar" first, with how many and where each goes');
  ok(await sees(P, '.bring-h', 'Bring up from downstairs') && await P.locator(`.prows ${row('Mount Franklin Sparkling Water 330ml')} button.padd`).count() === 1,
    '"Bring up from downstairs" below; nothing suggested until it\'s grabbed');
  await P.click(`.grab ${line('Mount Franklin Sparkling Water 330ml')} button.l-all`);
  ok(await valueIs(P, 'Mount Franklin Sparkling Water 330ml', '4') && await sees(P, `${row('Mount Franklin Sparkling Water 330ml')} .pnote`, 'Suggested: 4 taken for FOH beer fridge'),
    'ticked: 4 Sparkling suggested straight away, on the same screen');
  await P.click(`.grab ${line('Heineken')} button.l-all`); await P.click(`.grab ${line('Kirks Indian Tonic Water')} button.l-all`);
  ok(await P.locator(`.prows ${row('Heineken')} button.padd`).count() === 1, 'beers are not suggested (the fridge is counted in packs)');
  await add(P, 'Kirks Indian Tonic Water');
  ok(await sees(P, `.prows ${row('Kirks Indian Tonic Water')} .ps`, '1 pack'), 'and anything else that looks low can be added (Kirks, in packs)');
  await P.screenshot({ path: `${OUT}/p13-upstairs-fridge.png`, fullPage: true });
  ok(await primaryIs(P, 'Done → Walk in fridge'), '"Done → Walk in fridge"');
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.area-btn.cur:has-text("Walk in fridge")');
  await P.click(`.grab ${line('Mount Franklin Still Water')} button.l-all`);
  ok(await P.locator(`.prows ${row('Mount Franklin Still Water')} button.padd`).count() === 1 && await sees(P, `.prows ${row('Mount Franklin Still Water')}`, 'less than ¼'), 'Still Water: grabbed, not suggested; a slab only when under ¼ is left');
  await add(P, 'Mount Franklin Still Water');
  ok(await sees(P, `.prows ${row('Mount Franklin Still Water')} .ps`, '1 slab'), 'Still Water counted in slabs upstairs');
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.area-btn.cur:has-text("Upstairs cupboards")');
  const groups = await P.$$eval('.grab .grab-group', (els) => els.map((g) => [g.querySelector('.phead')?.textContent ?? '', [...g.querySelectorAll('.line')].map((l) => l.dataset.line)]));
  ok(JSON.stringify(groups) === JSON.stringify([['Upstairs cupboards', ['Sugar container']], ['Wine cupboard', ['Red Claw Shiraz']], ['Spirits cupboard', ['Grey Goose', 'Patron Silver']]]),
    'Upstairs cupboards: grab list by cupboard: ' + JSON.stringify(groups));
  ok(await sees(P, `.grab ${line('Sugar container')}`, 'fill it to the top'), 'sugar: refill instructions on the grab list');
  for (const n of ['Sugar container', 'Red Claw Shiraz', 'Patron Silver']) await P.click(`.grab ${line(n)} button.l-all`);
  // None left upstairs: Got fewer → 0 (just the amount)
  await P.click(`.grab ${line('Grey Goose')} .l-few`);
  ok(await sees(P, `.grab ${line('Grey Goose')} .fewer`, 'How many did you get?') && await P.locator(`.grab ${line('Grey Goose')} .fw-more`).count() === 0, 'Got fewer upstairs: just "How many did you get?"');
  await P.fill(`.grab ${line('Grey Goose')} .fewer .qty-input`, '0'); await P.click(`.grab ${line('Grey Goose')} .fw-ok`);
  ok(await sees(P, `.grab ${line('Grey Goose')} .l-why`, 'Grabbed 0 of 1') && await sees(P, '.grab .sec-title', '4 of 4'), 'Grey Goose: "Grabbed 0 of 1"; all 4 done');
  const top = await P.$$eval('.area > .prows > *', (els) => els.map((e) => (e.matches('.phead') ? `# ${e.querySelector('span')?.textContent ?? e.textContent}` : e.querySelector('h3')?.textContent)));
  ok(JSON.stringify(top.slice(0, 3)) === JSON.stringify(['# Replace what you grabbed', 'Red Claw Shiraz', 'Patron Silver']), 'Bring up: what was grabbed, first: ' + top.slice(0, 3).join(', '));
  ok(await P.locator(`.prows ${row('Grey Goose')} button.padd`).count() === 1, 'Grey Goose: none grabbed, so nothing suggested');
  ok(await valueIs(P, 'Red Claw Shiraz', '1'), 'Shiraz: took 1 from the Wine cupboard → 1 suggested');
  await P.click(`.prows ${row('Red Claw Shiraz')} button[aria-label="One more Red Claw Shiraz"]`); await P.click(`.prows ${row('Red Claw Shiraz')} button[aria-label="One more Red Claw Shiraz"]`);
  ok(await sees(P, `.prows ${row('Red Claw Shiraz')} .pnote`, '(suggested 1)') && await sees(P, `.prows ${row('Red Claw Shiraz')} .ps`, '3 bottles'), 'changed to 3: 3 in total');
  await P.click(`.prows ${row('Patron Silver')} button[aria-label="One less Patron Silver"]`);
  ok(await sees(P, `.prows ${row('Patron Silver')} .ps`, 'Removed'), 'Patron: suggestion removed (there was enough)');
  await P.click(`.prows ${row('Patron Silver')} button[aria-label="Back to the suggested 1 Patron Silver"]`);
  ok(await valueIs(P, 'Patron Silver', '1'), '...and can be brought back');
  await P.click(`.prows ${row('Patron Silver')} button[aria-label="One less Patron Silver"]`);
  await P.screenshot({ path: `${OUT}/p13-upstairs-cupboards.png`, fullPage: true });
  for (const [name, vp] of [['tablet', { width: 834, height: 1194 }], ['desktop', { width: 1366, height: 900 }]]) {
    await P.setViewportSize(vp); await P.waitForTimeout(250);
    ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) && await P.locator('.rbar .stage .lg:visible').count() === 4, `${name}: no sideways scrolling, full step names`);
    await P.screenshot({ path: `${OUT}/p13-upstairs-${name}.png` });
  }
  await P.setViewportSize(devices['iPhone 13'].viewport);
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no sideways scrolling');
  ok(await primaryIs(P, 'Done → Collect downstairs'), 'last spot: "Done → Collect downstairs"');
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.room');

  // Collect downstairs
  const r2 = await rooms(P);
  ok(JSON.stringify(r2.map(([a, l]) => [a.toLowerCase(), [...l].sort()])) === JSON.stringify([
    ['alcohol storeroom', ['1 bottle Vanilla Syrup', '2 cans Curatif Negroni', '3 bottles Red Claw Shiraz']],
    ['walk in fridge(downstairs)', ['1 pack Kirks Indian Tonic Water', '1 slab Mount Franklin Still Water', '4 bottles Mount Franklin Sparkling Water 330ml']]]), 'downstairs list: ' + JSON.stringify(r2));
  ok(!JSON.stringify(r2).includes('Heineken') && !JSON.stringify(r2).includes('Patron') && !JSON.stringify(r2).includes('Grey Goose'),
    'no beer singles; the removed Patron is off the list; nothing for the Grey Goose that wasn\'t there');
  for (const l of ['Red Claw Shiraz', 'Curatif Negroni', 'Vanilla Syrup', 'Kirks Indian Tonic Water', 'Mount Franklin Sparkling Water 330ml', 'Mount Franklin Still Water']) await P.click(`${line(l)} button.l-all`);
  ok(await sees(P, '.dock', '6 of 6 resolved'), 'all 6 collected');
  await P.screenshot({ path: `${OUT}/p13-collect.png`, fullPage: true });

  // Finish
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  await P.click('.dock button.good:has-text("Finish restock")'); await P.waitForSelector('.finish-hero');
  const [s] = await waitDb(() => sql`select status, exception_reason from restock_sessions where kind = 'full'`, (r) => r[0]?.status !== 'open');
  ok(s.status === 'finished', 'finished cleanly');
  const sp = await waitDb(() => sql`select si.requested_qty, si.collected_mode, si.collected_qty from session_items si join product_placements pl on pl.id = si.placement_id
    join check_areas a on a.id = pl.check_area_id where si.product_name = 'Mount Franklin Sparkling Water 330ml' and a.name = 'BOH bar fridge'`, (r) => r[0]?.collected_mode === 'all');
  ok(sp[0]?.requestedQty === null && Number(sp[0]?.collectedQty) === 4, 'the kept suggestion counted (4 collected) without staff typing it');
  const [{ c: shorts }] = await sql`select count(*)::int as c from shortages`;
  ok(shorts === 0, 'no shortages recorded (an upstairs Got fewer isn\'t a storeroom shortage)');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
