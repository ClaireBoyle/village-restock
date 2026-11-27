// Gold Class Kitchen trial: containers to take downstairs, Avocado (frozen) and Sopressa, and pizza cheese as one
// prepared product in two places. Phone.
//   * Freezer 1 has enough patties: no reminder. Patties needed from downstairs: "Take tubs and boxes for the
//     burger patties" at the top of the collection list, above the first storeroom (no tap); gone once collected.
//   * Avocado (frozen): checked in Freezer 1, 1 pack from the downstairs walk-in freezer, "For Freezer 1".
//   * Sopressa: on the fourth shelf of the walk-in fridge, no target; staff enter 2 → from the downstairs walk-in fridge.
//   * Pizza cheese (portioned bags): the fridge needs 3 → one pickup of 3 bags from Freezer 2, with the spot
//     ("Lower-right compartment, beside the zucchini wedges"); the Freezer 2 check is "Add prep", never collected.
//   * Prep checklist: "Portion pizza cheese into bags and freeze", no amount. Quick Restock: the same reminder.
// Before running: reset the test database. The test applies the Gold Class Kitchen update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const primary = (P) => P.locator('.dock .dock-acts .btn.primary');
const primaryText = async (P) => (await primary(P).innerText()).replace(/\s+/g, ' ').trim();
const cur = (P) => P.locator('.area-btn.cur b').innerText();
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const text = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const PIZZA = 'Pizza cheese (portioned bags)';

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`delete from check_areas where department_id = ${k.id}`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2), ('Dry storage', 4) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact', 'freezer-1-first',
    'no-walk-in-desserts', 'walk-in-third-shelf', 'relish-prep', 'walk-in-fresh-produce', 'bottom-sauce-shelf', 'prep-checklist', 'dry-stock', 'trial', 'trial']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);
  const pz = await sql`select c.name, x.location_id is not null as from_store, x.prep_task_id is not null as prep from product_placements x join products p on p.id = x.product_id
    join check_areas c on c.id = x.check_area_id where p.name = ${PIZZA} order by c.name`;
  ok(pz.length === 2 && pz[0].name === 'Freezer 2 · Check remaining spare stock' && pz[0].prep && pz[1].name === 'Walk in fridge · Fourth shelf' && pz[1].fromStore,
    'script (run twice): renamed once, a Freezer 2 prep check and the fridge row from Freezer 2: ' + pz.map((x) => x.name).join(', '));

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('.area-btn.cur');
  const areas = await P.$$eval('.area-btn b', (e) => e.map((x) => x.textContent));
  const qty = async (n, v) => { await P.click(`${row(n)} .padd`); await P.waitForTimeout(200); if (v !== 1) { await P.fill(`${row(n)} .qty-input`, String(v)); await P.locator(`${row(n)} .qty-input`).blur(); } await P.waitForTimeout(300); };

  // Walk the areas with the one button.
  for (let n = 0; n < 14; n++) {
    const here = await cur(P); const t = await primaryText(P);
    if (/^Count \d+ left/.test(t)) {
      for (const r of await P.locator('article.prow.m-par button.pquick:not(.on)').all()) { await r.click(); await P.waitForTimeout(150); }
      await P.waitForTimeout(300); continue;
    }
    if (here === 'Freezer 1' && !(await P.locator(`${row('Avocado (frozen)')} .qty-input`).count())) {
      ok(await P.locator(row('Avocado (frozen)')).count() === 1 && (await text(P, row('Avocado (frozen)'))).includes('keep 1 spare pack'), 'Freezer 1: Avocado (frozen), "keep 1 spare pack here"');
      await qty('Avocado (frozen)', 1);
      ok(await P.inputValue(`${row('Avocado (frozen)')} .qty-input`) === '1', 'spare pack gone: one tap, 1 pack');
      // The patties: Freezer 1 has enough (nothing entered).
    }
    if (here === 'Freezer 2' && !(await P.locator(`${row(PIZZA)} .padd-prep.on`).count())) {
      const r = row(PIZZA);
      ok(await P.locator(r).count() === 1 && await P.locator(`${r} .padd-prep`).count() === 1 && await P.locator(`${r} .qty-input`).count() === 0, 'Freezer 2: pizza cheese, "Add prep" (no amount)');
      ok((await text(P, r)).includes('beside the zucchini wedges'), 'Freezer 2: "lower right beside the zucchini wedges"');
      const order = await P.$$eval('article.prow h3', (e) => e.map((x) => x.textContent));
      ok(order.indexOf(PIZZA) === order.indexOf('Zucchini Wedges') + 1, 'listed just after the zucchini wedges');
      await P.click(`${r} .padd-prep`); await P.waitForSelector(`${r} .padd-prep.on`);
    }
    if (here === 'Walk in fridge' && !(await P.locator(`${row('Sopressa')} .qty-input`).count())) {
      ok((await text(P, row('Sopressa'))).includes('Beside the sour cream') && await P.locator(`${row('Sopressa')} .pquick`).count() === 0, 'Sopressa: in the walk-in fridge, "Beside the sour cream", no target');
      await qty('Sopressa', 2);
      ok((await text(P, row(PIZZA))).includes('Defrosted bags'), 'fridge: pizza cheese "Defrosted bags (optional…)": ' + await text(P, row(PIZZA)));
      await qty(PIZZA, 3);
      ok(await P.locator(row('Smoky Mozzarella')).count() === 1, 'Smoky Mozzarella: still its own product');
      await P.screenshot({ path: `${OUT}/p26-walk-in.png`, fullPage: true });
    }
    const m = t.match(/^(?:Done|Continue) → (.+)$/);
    if (!m) break;
    await primary(P).click(); await P.waitForTimeout(400);
    if (!areas.includes(m[1])) break;
    await P.waitForSelector(`.area-btn.cur:has-text("${m[1]}")`);
  }
  await P.waitForSelector(line(PIZZA));

  // Collection list: no patties, so no reminder.
  ok(await P.locator('.take-down').count() === 0, 'Freezer 1 had enough patties: no container reminder');
  const rooms = await P.$$eval('.room', (els) => els.map((r) => [r.querySelector('h3').textContent, [...r.querySelectorAll('.line')].map((l) => l.dataset.line)]));
  const roomOf = (n) => rooms.find(([, ls]) => ls.includes(n))?.[0];
  ok(roomOf('Avocado (frozen)') === 'Walk in freezer(Downstairs)' && (await text(P, line('Avocado (frozen)'))).includes('For Freezer 1'), 'Avocado: 1 pack from the downstairs walk-in freezer, "For Freezer 1"');
  ok(roomOf('Sopressa') === 'Walk in fridge(Downstairs)' && (await text(P, `${line('Sopressa')} .l-qty b`)) === '2', 'Sopressa: 2 from the downstairs walk-in fridge');
  ok(roomOf(PIZZA) === 'Freezer 2' && await P.locator(line(PIZZA)).count() === 1 && (await text(P, `${line(PIZZA)} .l-qty`)) === '3 bags', 'pizza cheese: one pickup, 3 bags from Freezer 2 (the prep check isn\'t collected)');
  ok((await text(P, `${line(PIZZA)} .l-where`)) === 'Lower-right compartment, beside the zucchini wedges' && (await text(P, line(PIZZA))).includes('For Walk in fridge · Fourth shelf'),
    'pizza cheese: "Lower-right compartment, beside the zucchini wedges", for the fridge');
  await P.screenshot({ path: `${OUT}/p26-collect.png`, fullPage: true });
  await P.click(`${line(PIZZA)} .l-all`); await P.waitForSelector(`${line(PIZZA)}.done`);
  ok(await P.locator(`${line(PIZZA)} .l-where`).count() === 0, 'collected: the spot folds away');

  // Back to Freezer 1: the patties need collecting from downstairs.
  await P.click('.rbar .stage:has-text("Check")'); await P.click('.area-btn:has-text("Freezer 1")'); await P.waitForSelector(row('Beef Patties'));
  await qty('Beef Patties', 2);
  await P.click('.rbar .stage:has-text("Collect")'); await P.waitForSelector('.rooms');
  const first = await P.$$eval('.rooms > *', (els) => els.slice(0, 2).map((e) => e.className.split(' ')[0]));
  ok(first[0] === 'take-down' && first[1] === 'room', 'reminder at the top, above the first storeroom');
  ok((await P.textContent('.take-down h3')) === 'Before you go' && JSON.stringify(await P.$$eval('.take-down li', (e) => e.map((x) => x.textContent))) === '["Take tubs and boxes for the burger patties"]', 'no tap: "Before you go · Take tubs and boxes for the burger patties" (no number: not confirmed)');
  ok(await P.evaluate(() => document.querySelector('.take-down').getBoundingClientRect().top < window.innerHeight), 'visible on the phone without scrolling');
  await P.screenshot({ path: `${OUT}/p26-take-down.png` });
  await P.setViewportSize({ width: 834, height: 1194 }); await P.waitForTimeout(200);
  await P.screenshot({ path: `${OUT}/p26-take-down-ipad.png` });
  await P.setViewportSize(devices['iPhone 13'].viewport);
  await P.click(`${line('Beef Patties')} .l-all`); await P.waitForTimeout(300);
  ok(await P.locator('.take-down').count() === 0, 'patties collected: the reminder goes');

  // Finish: the prep flag goes on the handover.
  for (let n = 0; n < 30 && await P.locator('.line:not(.done) .l-all').count(); n++) { await P.locator('.line:not(.done) .l-all').first().click(); await P.waitForTimeout(200); }
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.finish-title');
  await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');
  const [prep] = await sql`select count(*)::int as n from prep_handover_items i join prep_tasks t on t.id = i.task_id where t.name = 'Portion pizza cheese into bags and freeze'`;
  ok(prep.n === 1, 'finished: "Portion pizza cheese into bags and freeze" on the morning handover');

  // Prep checklist: the job, quantity-free.
  await P.goto(`${B}/d/${k.id}/prep`); await P.waitForSelector('.pcl-group');
  const job = '.pcl-chip[data-chip="Portion pizza cheese into bags and freeze"]';
  const where = await P.$eval(job, (e) => e.closest('.pcl-group').getAttribute('aria-label'));
  ok(['Portion cheese', 'Other prep'].includes(where) && await P.locator('.pcl input[inputmode]').count() === 0, `Prep checklist: "Portion pizza cheese into bags and freeze" (${where}), no amount`);
  await P.click(job); await P.waitForSelector(`${job}.s-needs`);
  ok(true, 'flagged for this service: Needs prep');

  // Quick Restock: the same reminder.
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('text=Start stock top-up'); await P.waitForSelector('#qsearch');
  await P.fill('#qsearch', 'patties'); await P.waitForTimeout(300);
  await P.fill('.qrow:has(b:text-is("Beef Patties")) .q-num >> nth=-1', '1'); await P.waitForSelector('.picked .qrow:has-text("Beef Patties")');
  await P.fill('#qsearch', 'avocado'); await P.waitForTimeout(300);
  ok(await P.locator('.qpanel .qrow:has(b:text-is("Avocado (frozen)"))').count() >= 1, 'Quick Restock: Avocado (frozen) can be picked');
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.rooms');
  ok((await text(P, '.take-down')).includes('Take tubs and boxes for the burger patties'), 'Quick Restock: the reminder at the top of the collection list');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
