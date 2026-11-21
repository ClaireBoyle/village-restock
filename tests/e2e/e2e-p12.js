// Gold Class Bar categories, Whipping Cream, and the simpler shortage + finish flow.
// Before running: reset the test database, then load gcbar-fixture.sql (a copy of the live Gold Class Bar
// catalogue). The test applies the two db/updates scripts itself.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const has = (p, sel, t, ms = 8000) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const add = async (P, n, qty = 1) => { await P.click(`${row(n)} button.padd`); for (let k = 1; k < qty; k++) await P.click(`${row(n)} button[aria-label="One more ${n}"]`); };
const goArea = async (P, n) => { await P.click(`.area-btn:has-text("${n}")`); await P.waitForSelector(`.area-btn.cur:has-text("${n}")`); await P.waitForTimeout(150); };
const reasonOf = async (n, check = () => true) => (await waitDb(() => sql`select shortfall_reason, collected_mode, collected_qty, flagged from session_items where product_name = ${n} order by updated_at desc limit 1`, (r) => r.length && check(r[0])))[0];
// WCAG contrast of an element's text against its row background laid over the dark theme
const contrast = (P, sel) => P.$eval(sel, (el) => {
  // "rgb(…)", "rgba(…)" or "color(srgb r g b)" (0–1 values)
  const rgb = (s) => { const n = (s.match(/[\d.]+/g) || []).map(Number); return s.startsWith('color(') ? [...n.slice(0, 3).map((x) => x * 255), n[3] ?? 1] : n; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const base = [33, 26, 18]; // Gold Class backdrop
  const bgEl = el.closest('.sr-row'); const [r, g, b, a = 1] = rgb(getComputedStyle(bgEl).backgroundColor);
  const bg = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
  const fg = rgb(getComputedStyle(el).color).slice(0, 3);
  const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05);
});

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql.file('db/updates/2026-11-gold-class-bar-categories.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-categories.sql');
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ ...devices['iPhone 13'] }); const P = await c.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  // 1–2. BOH bar fridge
  const boh = await P.$$eval('.area > .prows > *', (els) => els.map((e) => (e.classList.contains('phead') ? `# ${e.textContent}` : e.querySelector('h3')?.textContent)));
  const items = boh.filter((x) => !x.startsWith('#'));
  ok(items.indexOf('Whipping Cream') === items.indexOf('Whipped Cream') + 1, '1. Whipping Cream sits directly after Whipped Cream');
  ok(items.length === 25 && boh[0] === '# Mixers, Water & Milk' && boh.filter((x) => x.startsWith('#')).length === 2 && items[0] === 'Cranberry Juice' && items[13] === 'Heineken Zero' && items[24] === 'Suntory -196 Lemon',
    '2. fridge organisation intact: two subheadings, 25 products, same order');
  // 3. Other areas
  await goArea(P, 'Walk in fridge'); await P.waitForSelector('.phead');
  const wif = await P.$$eval('.area > .prows > .phead', (els) => els.map((e) => e.textContent));
  ok(JSON.stringify(wif) === JSON.stringify(['Sparkling & Champagne', 'White Wine', 'Rosé & Chilled Shiraz']), '3. Walk in fridge headings: ' + wif.join(' | '));
  await add(P, 'Chandon NV');
  await goArea(P, 'Back bench'); await P.waitForSelector('.phead');
  const bench = await P.$$eval('.area > .prows > .phead', (els) => els.map((e) => e.textContent.replace(/\d.*$/, '').trim()));
  ok(bench[0] === 'Red Wines' && bench[1].startsWith('Popular Spirits'), '3. Back bench: Red Wines, then Popular Spirits');
  ok(await P.locator('.area-btn').filter({ hasText: 'Spirits cupboard' }).count() === 0 && await has(P, '.psec.optional', 'Spirits cupboard') && await has(P, '.psec.optional', 'Optional'), '3. Spirits cupboard is an optional section of the Back bench (not its own step)');
  ok(await P.locator('.psec.optional article.prow').count() === 0, '3. ...collapsed by default');
  const spiritsBefore = await P.locator('.area > .prows > article.prow').count();
  await P.click('.phead.fold:has-text("Popular Spirits")');
  ok(await P.locator('.area > .prows > article.prow').count() === spiritsBefore - 31 && await has(P, '.phead.fold', '31 products'), '3. a long group (31 spirits) can be folded; starts open');
  await P.click('.phead.fold:has-text("Popular Spirits")');
  await P.click('.psec.optional .psec-h');
  const cup = await P.$$eval('.psec.optional .prows > .phead', (els) => els.map((e) => e.textContent.replace(/\d.*$/, '').trim()));
  ok(JSON.stringify(cup) === JSON.stringify(['Vodka', 'Gin & Tequila', 'Whisky & Bourbon', 'Rum', 'Liqueurs']), '3. Spirits cupboard headings: ' + cup.join(' | '));
  await P.screenshot({ path: `${OUT}/p12-bench.png` });

  // 17. Tablet and desktop
  for (const [name, vp] of [['tablet', { width: 834, height: 1194 }], ['desktop', { width: 1366, height: 900 }]]) {
    const c2 = await b.newContext({ viewport: vp }); const T = await c2.newPage(); T.on('pageerror', (e) => errs.push(e.message));
    await T.goto(B + '/'); await T.waitForSelector('.dcard2'); await T.click('.dcard2:has-text("Bar") >> nth=0');
    await T.click('.type-full button.btn.primary'); await T.waitForSelector('article.prow');
    await goArea(T, 'Back bench'); await T.waitForSelector('.phead');
    ok(await T.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `17. ${name}: no sideways scrolling`);
    await T.screenshot({ path: `${OUT}/p12-${name}.png` });
    await c2.close();
  }
  // Enter what's needed in the BOH fridge
  await goArea(P, 'BOH bar fridge'); await P.waitForSelector(row('Kirin Ichiban'));
  for (const [n, q] of [['Orange Juice', 1], ['Whipped Cream', 1], ['Whipping Cream', 2], ['Kirin Ichiban', 3], ['James Squire Ginger Beer', 1], ['Guinness', 2], ['Heineken', 2]]) await add(P, n, q);
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  ok(await has(P, '.dock', '0 of 8 resolved'), '10. untouched lines are not resolved: 0 of 8 resolved');
  ok(await P.locator('.col-note').count() === 0, 'no "not checked" warning');
  // 4. Full collection
  for (const n of ['Orange Juice', 'Whipped Cream', 'Whipping Cream', 'Chandon NV']) await P.click(`${line(n)} .l-all`);
  ok(await has(P, `${line('Whipping Cream')}.done`, 'Collected') && await has(P, `${line('Whipped Cream')}.done`, 'Collected'), '4. Whipped and Whipping Cream collected separately');
  // 5. Partial: no reason to pick
  await P.click(`${line('Kirin Ichiban')} .l-few`);
  ok(await has(P, `${line('Kirin Ichiban')} .fewer`, 'How many did you get?') && await P.inputValue(`${line('Kirin Ichiban')} .fewer .qty-input`) === ''
    && await P.isDisabled(`${line('Kirin Ichiban')} .fw-ok`) && await P.locator(`${line('Kirin Ichiban')} .chip, ${line('Kirin Ichiban')} .flag`).count() === 0,
    '5. Got fewer: "How many did you get?", blank amount, Confirm waits for it, reasons and Flag tucked under More options');
  ok((await reasonOf('Kirin Ichiban')).collectedMode === null, '5. opening Got fewer saves nothing');
  await P.click(`${line('Kirin Ichiban')} .fw-x`);
  ok(await P.locator(`${line('Kirin Ichiban')} .fewer`).count() === 0 && await P.locator(`${line('Kirin Ichiban')}.todo .l-all`).count() === 1
    && (await reasonOf('Kirin Ichiban')).collectedMode === null
    && await P.waitForFunction(() => document.activeElement?.closest('.line')?.dataset.line === 'Kirin Ichiban', null, { timeout: 3000 }).then(() => true, () => false),
    '5. Cancel: back on the same row, unchanged (an accidental tap does nothing)');
  await P.click(`${line('Kirin Ichiban')} .l-few`); await P.fill(`${line('Kirin Ichiban')} .fewer .qty-input`, '2');
  ok(await has(P, `${line('Kirin Ichiban')} .fewer`, 'of 3') && await has(P, `${line('Kirin Ichiban')} .short-txt`, 'Short 1 pack'), '5. typed 2 of 3: Short 1 pack');
  await P.screenshot({ path: `${OUT}/p12-editor.png` });
  ok((await reasonOf('Kirin Ichiban')).shortfallReason === null && !(await has(P, '.dock', '1 shortage', 500)), '5. not a shortage until confirmed');
  await P.click(`${line('Kirin Ichiban')} .fw-ok`);
  let k = await reasonOf('Kirin Ichiban', (x) => x.shortfallReason === 'insufficient');
  ok(k.shortfallReason === 'insufficient' && Number(k.collectedQty) === 2 && await has(P, `${line('Kirin Ichiban')} .l-why`, 'Running low'), '5. Confirm records "not enough in storeroom" automatically');
  // 6. Zero collected
  await P.click(`${line('James Squire Ginger Beer')} .l-few`); await P.fill(`${line('James Squire Ginger Beer')} .fewer .qty-input`, '0'); await P.click(`${line('James Squire Ginger Beer')} .fw-ok`);
  ok((await reasonOf('James Squire Ginger Beer', (x) => !!x.shortfallReason)).shortfallReason === 'insufficient' && await has(P, `${line('James Squire Ginger Beer')} .l-why`, 'Out of stock'), '6. zero collected, confirmed: Out of stock');
  // 7. Couldn't access stock
  await P.click(`${line('Guinness')} .l-few`); await P.fill(`${line('Guinness')} .fewer .qty-input`, '1'); await P.click(`${line('Guinness')} .fw-more`);
  ok(await P.locator(`${line('Guinness')} .chip`).count() === 3 && await P.locator(`${line('Guinness')} .flag`).count() === 1, '7. More options: the other reasons and Flag for manager');
  await P.click(`${line('Guinness')} .chip:has-text("Couldn’t access stock")`); await P.click(`${line('Guinness')} .fw-ok`);
  ok((await reasonOf('Guinness', (x) => !!x.shortfallReason)).shortfallReason === 'access' && await has(P, `${line('Guinness')} .l-why`, 'access'), '7. Couldn’t access stock recorded');
  // 8. Interrupted
  await P.click(`${line('Heineken')} .l-few`); await P.click(`${line('Heineken')} button[aria-label="One less"]`);
  ok(await P.inputValue(`${line('Heineken')} .fewer .qty-input`) === '0', '8. − from blank gives 0');
  await P.click(`${line('Heineken')} .fw-more`); await P.click(`${line('Heineken')} .chip:has-text("Interrupted")`); await P.click(`${line('Heineken')} .fw-ok`);
  const h = await reasonOf('Heineken', (x) => !!x.shortfallReason);
  ok(h.shortfallReason === 'time' && Number(h.collectedQty) === 0, '8. Interrupted / ran out of time recorded (0 collected)');
  // 9. Change an existing result: amount and reason
  await P.click(`${line('Kirin Ichiban')} .linkbtn:has-text("Change")`); await P.click(`${line('Kirin Ichiban')} button[aria-label="One less"]`);
  await P.click(`${line('Kirin Ichiban')} .fw-more`); await P.click(`${line('Kirin Ichiban')} .flag`); await P.click(`${line('Kirin Ichiban')} .fw-ok`);
  k = await reasonOf('Kirin Ichiban', (x) => x.flagged && Number(x.collectedQty) === 1);
  ok(Number(k.collectedQty) === 1 && k.shortfallReason === 'insufficient' && k.flagged, '9. changed Kirin to 1 collected, still "not enough", flagged for a manager');
  await P.click(`${line('Guinness')} .linkbtn:has-text("Change")`); await P.click(`${line('Guinness')} .fw-more`);
  await P.click(`${line('Guinness')} .chip:has-text("Interrupted")`); await P.click(`${line('Guinness')} .fw-ok`);
  ok((await reasonOf('Guinness', (x) => x.shortfallReason === 'time')).shortfallReason === 'time', '9. changed Guinness reason to Interrupted');
  // 10. Progress wording
  ok(await has(P, '.dock', '8 of 8 resolved') && await has(P, '.dock .short-tag', '2 shortages') && !(await P.textContent('.dock')).includes('collected'),
    '10. footer: "8 of 8 resolved" and 2 confirmed shortages (operational exceptions not counted as shortages)');
  await P.screenshot({ path: `${OUT}/p12-collect.png` });

  // 11, 13, 14. Finish with shortages
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  const main = await P.textContent('main');
  ok(!/ready to finish/i.test(main) && !/ready to finish/i.test(await P.textContent('.dock')), '13. no "Ready to finish" panel or text');
  const rowTxt = async (n) => P.textContent(`.sr-row:has(b:text-is("${n}"))`);
  ok((await rowTxt('James Squire Ginger Beer')).includes('Out of stock · Short 1 pack'), '11. James Squire Ginger Beer: Out of stock · Short 1 pack');
  ok((await rowTxt('Kirin Ichiban')).includes('Running low · Collected 1 of 3 packs') && (await rowTxt('Kirin Ichiban')).includes('Flagged'), '11. Kirin Ichiban: Running low · Collected 1 of 3 packs (flagged)');
  ok(await has(P, '#sr-short', 'Stock shortages') && await has(P, '#sr-inc', 'Collection incomplete') && (await rowTxt('Guinness')).includes('Collection incomplete · Interrupted') && (await rowTxt('Heineken')).includes('2 packs not collected'),
    '11. operational exceptions listed separately as Collection incomplete');
  ok(!(await P.textContent('#sr-short + ul')).includes('Guinness'), '11. Guinness is not called a stock shortage');
  for (const s of ['.sr-row.k-out .sr-t b', '.sr-row.k-out .sr-t small', '.sr-row.k-low .sr-t small', '.sr-row.k-inc .sr-t small']) {
    const r = await contrast(P, s); ok(r >= 4.5, `14. readable text (${s}): contrast ${r.toFixed(1)}:1`);
  }
  ok(await P.getAttribute('#finish-note', 'placeholder') === 'Anything managers should know?' && !main.includes('For example'), 'comments: just "Anything managers should know?"');
  ok(await P.isEnabled('.dock button.good:has-text("Finish restock")') && await P.locator('.dock .save-exit').count() === 1, 'Finish restock prominent; Save & exit kept');
  await P.screenshot({ path: `${OUT}/p12-finish.png`, fullPage: true });
  await P.click('.dock button.good:has-text("Finish restock")'); await P.waitForSelector('.finish-hero');
  const [s] = await waitDb(() => sql`select status, exception_reason from restock_sessions where kind = 'full'`, (r) => r[0]?.status !== 'open');
  ok(s.status === 'finished_exceptions' && s.exceptionReason === 'Collection incomplete', 'finished; the operational exceptions mark it "Collection incomplete"');
  const sh = await waitDb(() => sql`select product_name, shortfall_qty, reason, flagged from shortages order by product_name`, (r) => r.length >= 2);
  ok(sh.length === 2 && sh[0].productName === 'James Squire Ginger Beer' && sh[1].productName === 'Kirin Ichiban' && sh.every((x) => x.reason === 'insufficient') && Number(sh[1].shortfallQty) === 2,
    'manager shortages: only the two confirmed stock shortages (Guinness/Heineken are not stock shortages)');

  // 12. Finish without shortages (quick restock)
  await P.click('.dock button:has-text("Back to home")'); await P.waitForSelector('.dcard2');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('button:has-text("Start quick restock")'); await P.waitForSelector('#qsearch');
  await P.fill('#qsearch', 'Orange'); await P.click('.qpanel .qrow:has-text("Orange Juice") button[aria-label^="Add one"]'); await P.waitForSelector('.picked .qrow:has-text("Orange Juice")');
  await P.click('.dock button:has-text("Collect")'); await P.click(`${line('Orange Juice')} .l-all`);
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  ok(await P.locator('.sreport, .stock-panel, .ready').count() === 0 && !/nothing low|ready to finish/i.test(await P.textContent('main')), '12. no shortages: no success panel, nothing to fill space');
  await P.screenshot({ path: `${OUT}/p12-finish-clean.png` });
  await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');

  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '17. phone: no sideways scrolling');

  // Walk in fridge: fresh produce and juices on top, then the wines (applied twice: no change)
  await sql.file('db/updates/2026-11-gold-class-bar-walk-in-fridge.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-walk-in-fridge.sql');
  const cw = await b.newContext({ ...devices['iPhone 13'] }); const W = await cw.newPage(); W.on('pageerror', (e) => errs.push(e.message));
  await sql`delete from shortages`; await sql`delete from restock_sessions`; // tonight's full restock was finished above
  await W.goto(B + '/'); await W.waitForSelector('.dcard2'); await W.click('.dcard2:has-text("Bar") >> nth=0');
  await W.click('.type-full button.btn.primary'); await W.waitForSelector('article.prow');
  await goArea(W, 'Walk in fridge');
  const wl = await W.$$eval('.area > .prows > *', (els) => els.map((e) => (e.classList.contains('phead') ? `# ${e.textContent}` : e.querySelector('h3')?.textContent)));
  ok(JSON.stringify(wl.slice(0, 12)) === JSON.stringify(['# Top shelf · Fruit & Juices', 'Maraschino Cherries', 'Orange Juice', 'Pineapple Juice', 'Apple Juice', 'Cranberry Juice',
    'Limes', 'Lemons', 'Oranges', 'Strawberries', 'Passionfruit', '# Middle shelf · Wine']) && wl[12] === 'Dunes & Greene Split Pick Moscato' && wl.includes('# Bottom shelf · Water & Wine')
    && wl[wl.indexOf('# Bottom shelf · Water & Wine') + 1] === 'Mount Franklin Still Water',
    'Walk in fridge follows the shelves: ' + wl.slice(0, 13).join(' | ') + ' … ' + wl.slice(wl.indexOf('# Bottom shelf · Water & Wine'), wl.indexOf('# Bottom shelf · Water & Wine') + 3).join(' | '));
  const [{ n: oj }] = await sql`select count(*)::int as n from products p join departments d on d.id = p.department_id where d.name = 'Gold Class Bar' and p.name = 'Orange Juice' and p.status = 'active'`;
  ok(oj === 1, 'the juices are the same products as in the BOH bar fridge (no duplicates)');
  // Back shelves: the spirits get their own area after the Back bench (applied twice)
  await sql.file('db/updates/2026-11-gold-class-bar-back-shelves.sql');
  await sql.file('db/updates/2026-11-gold-class-bar-back-shelves.sql');
  await sql`delete from restock_sessions`;
  await W.reload(); await W.waitForSelector('.dcard2, article.prow, .type-full');
  await W.goto(B + '/'); await W.waitForSelector('.dcard2'); await W.click('.dcard2:has-text("Bar") >> nth=0');
  await W.click('.type-full button.btn.primary'); await W.waitForSelector('article.prow');
  const tabs = await W.$$eval('.area-btn b', (els) => els.map((e) => e.textContent));
  ok(tabs.indexOf('Back shelves') === tabs.indexOf('Back bench') + 1 && !tabs.includes('Spirits cupboard'), 'Back shelves is its own area, right after the Back bench: ' + tabs.join(', '));
  await goArea(W, 'Back bench');
  const bb = await W.$$eval('.area > .prows > *', (els) => els.map((e) => (e.classList.contains('phead') ? `# ${e.textContent}` : e.querySelector('h3')?.textContent)));
  ok(bb[0] === '# Red Wines' && bb.filter((x) => !x.startsWith('#')).length === 11 && await W.locator('.psec').count() === 0, 'Back bench: just the red wines');
  await goArea(W, 'Back shelves');
  const bs = await W.$$eval('.area > .prows > .phead', (els) => els.map((e) => e.textContent.replace(/\d.*$/, '').trim()));
  ok(JSON.stringify(bs) === JSON.stringify(['Vodka', 'Gin & Tequila', 'Whisky & Bourbon', 'Rum', 'Liqueurs']) && await has(W, '.psec.optional', 'Spirits cupboard'),
    'Back shelves: spirits by category, with the optional Spirits cupboard section');
  await cw.close();
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e.message); process.exit(1); });
