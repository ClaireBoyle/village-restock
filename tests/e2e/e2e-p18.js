// Gold Class Kitchen → Defrost: every item its own row (Pull or Not needed), where to grab it, where it
// goes, suggestions from tomorrow's admits, "Pull now" freezer by freezer, and what was pulled
// suggested for each freezer's top-up from downstairs.
// Before running: reset the test database. The test applies the update scripts and sets the targets.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 6000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const row = (n) => `article.prow:has(h3:text-is('${n}'))`;
const line = (n) => `.line[data-line='${n}']`;
const drow = (n) => `article.drow2:has(h3:text-is('${n}'))`;
const pline = (n) => `.dp-line[data-line='${n}']`;
const primaryText = async (P) => (await P.locator('.dock .dock-acts .btn.primary').innerText()).replace(/\s+/g, ' ').trim();
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  // As on the live site: the Kitchen starts with no areas, and the downstairs walk-in freezer is a storeroom.
  await sql`delete from check_areas where department_id = (select id from departments where name = 'Gold Class Kitchen')`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact', 'defrost-pulls', 'freezers', 'refills', 'portion-prep', 'defrost-compact', 'freezer-1-first', 'refills', 'freezer-1-first', 'no-walk-in-desserts', 'no-walk-in-desserts', 'walk-in-shelves', 'refills', 'walk-in-third-shelf', 'walk-in-fresh-produce', 'bottom-sauce-shelf', 'dry-stock', 'defrost-checks', 'defrost-checks', 'portioning-in-drawers', 'defrost-walk-in', 'defrost-walk-in']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);
  // Targets on two items (the rest have none: manual entry). Beef: 8 portions a 1 kg bag.
  await sql`update product_placements x set ready_targets = '[{"min":0,"max":150,"qty":24},{"min":151,"qty":36}]'::jsonb
    from products p, check_areas a where p.id = x.product_id and a.id = x.check_area_id and a.name = 'Defrost' and p.name = '9" Pizza Bases'`;
  await sql`update product_placements x set ready_targets = '[{"min":0,"qty":40}]'::jsonb, ready_per = 8
    from products p, check_areas a where p.id = x.product_id and a.id = x.check_area_id and a.name = 'Defrost' and p.name = 'Pulled Beef (Bao)'`;
  // Buns in tubs have a separate count unit but no conversion: manual, even with a target.
  await sql`update product_placements x set ready_targets = '[{"min":0,"qty":30}]'::jsonb
    from products p, check_areas a where p.id = x.product_id and a.id = x.check_area_id and a.name = 'Defrost' and p.name = 'Buns (Portioned Tubs)'`;

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.drow2');

  // 1. Defrost is the first section, every item its own row.
  ok(await sees(P, '.area-btn.cur', 'Defrost') && (await P.locator('.area-btn b').allInnerTexts()).join(' → ') === 'Defrost → Freezer 1 → Freezer 2 → Chest freezer → Walk in fridge → Dry stock',
    'opens on Defrost, then Freezer 1 (overflow) → Freezer 2 (refills) → Chest freezer → Walk in fridge → Dry stock');
  const names = await P.locator('article.drow2 h3').allInnerTexts();
  ok(names.length === 16 && names.includes('Bao Buns') && names.includes('Buns (Portioned Tubs)') && names.includes('Sticky Date'), `16 rows, bao buns and portioned buns separate (${names.length})`);
  ok(await P.locator('article.drow2 .pphoto.ph').count() === 0, 'no placeholder pictures');
  // Grouped by where ready stock is checked; one compact row each (name and the one instruction that matters).
  const heads = await P.$$eval('.area .phead', (e) => e.map((x) => x.textContent.trim()));
  ok(JSON.stringify(heads.slice(0, 3)) === JSON.stringify(['Under-salad-bar bench fridge', 'Upstairs walk-in fridge', 'Upstairs walk-in fridge · Dessert shelf']), 'grouped by where it\'s checked: ' + heads.join(' | '));
  ok(await P.locator(`.dgroup:has(.phead:text-is("Under-salad-bar bench fridge")) .dline h3, .dlist:has(${drow('Pulled Beef (Bao)')}) .dline h3`).allTextContents().then((t) => t.includes('Pulled Beef (Bao)') && t.includes('Beef Patties')), 'pulled beef and patties: under-salad-bar bench fridge');
  ok(await sees(P, `${drow('Pulled Beef (Bao)')} .dr-check`, 'Check portioned beef first') && await sees(P, `${drow('Beef Patties')} .dr-check`, 'Check the right side'), 'kept in view: "Check portioned beef first", "Check the right side"');
  ok(await P.locator('.dline').count() === 16 && await P.locator('.dlist .dline .dr-route').count() === 0, 'one compact row per product, no route on each row');
  ok(await sees(P, `.dgroup:has(${drow('Sticky Date')}) > .dr-route`, 'Downstairs walk-in freezer→Upstairs walk-in fridge · dessert shelf') && await P.locator(`${drow('Sticky Date')} .dr-route`).count() === 0,
    'desserts: one list, the route said once above it (downstairs walk-in freezer → dessert shelf)');
  ok(await P.locator(`.dgroup:has(${drow('Sticky Date')}) .dline`).count() === 9, 'the 9 desserts in one list');
  ok(await P.locator(`${drow('Beef Patties')}`).filter({ hasText: 'containers' }).count() === 0, 'the "if empty" route is hidden until it\'s needed');
  ok(await sees(P, '.admits', 'Gold Class admits'), 'admits box (targets exist)');
  await P.screenshot({ path: `${OUT}/p18-defrost-rows.png` });

  // 2. Set amount or Not needed (planning only: nothing is pulled yet).
  // The box shows the saved amount a moment after a tap or a typed number.
  const qv = async (n, want) => { const end = Date.now() + 4000; for (;;) { const v = await P.locator(`${drow(n)} .dr-step .qty-input`).inputValue(); if (want === undefined || v === want || Date.now() > end) return v; await P.waitForTimeout(100); } };
  ok((await P.locator(`${drow('Bao Buns')} .dr-b`).allInnerTexts()).join('|') === 'Not needed' && await qv('Bao Buns') === '' && await P.isDisabled(`${drow('Bao Buns')} button[aria-label="One less Bao Buns"]`),
    'untouched: − (off) – + beside "Not needed", no "Set amount" step');
  ok((await P.locator(`${drow('Bao Buns')} .dr-unit`).innerText()) === 'buns', 'the unit beside the box: "buns"');
  await P.click(`${drow('Bao Buns')} button[aria-label="One more Bao Buns"]`);
  await P.click(`${drow('Bao Buns')} button[aria-label="One more Bao Buns"]`);
  ok(await qv('Bao Buns', '2') === '2' && (await P.textContent(`${drow('Bao Buns')} .ps`)).includes('2 buns to pull'), 'Bao buns: + + → 2 buns to pull');
  await P.click(`${drow('Brownie')} .dr-nn`);
  await P.click(`${drow('Sticky Date')} button[aria-label="One more Sticky Date"]`); await P.click(`${drow('Sticky Date')} button[aria-label="One more Sticky Date"]`);
  ok(await P.locator(`${drow('Brownie')} .dr-nn.on`).count() === 1 && await P.locator(`${drow('Brownie')} .dr-step`).count() === 0, 'Brownie: "✓ Not needed" (the amount goes)');
  await P.fill(`${drow('Grilled Chicken')} #q-${await P.getAttribute(drow('Grilled Chicken'), 'data-placement')}`, '6'); await P.keyboard.press('Tab');
  ok(await qv('Grilled Chicken', '6') === '6', 'Grilled chicken: typed 6 straight into the box');

  // 3. Admits: suggestions from targets and what's ready (pizza bases 24 − 10 = 14; beef 40 − 12 = 28 portions → 4 bags).
  await P.fill('#admits-in', '120'); await P.keyboard.press('Enter');
  ok(await sees(P, `${drow('9" Pizza Bases')} .ps`, 'Count what'), 'with admits but no ready count: asks to count what\'s ready');
  const rid = async (n) => `#r-${await P.getAttribute(drow(n), 'data-placement')}`;
  await P.fill(await rid('9" Pizza Bases'), '10'); await P.keyboard.press('Tab');
  ok(await sees(P, `${drow('9" Pizza Bases')} .ps`, '14 bases'), 'pizza bases: target 24, 10 ready → 14 bases (suggested)');
  ok(await sees(P, `${drow('9" Pizza Bases')} .dr-work`, 'Target 24 bases for 0–150 admits'), 'shows how it was worked out');
  await P.fill(await rid('Pulled Beef (Bao)'), '12'); await P.keyboard.press('Tab');
  ok(await sees(P, `${drow('Pulled Beef (Bao)')} .ps`, '4 × 1 kg bags') && await sees(P, `${drow('Pulled Beef (Bao)')} .dr-work`, '28 portions → 4 × 1 kg bags'), 'pulled beef: 40 − 12 = 28 portions → 4 bags');
  ok(await P.locator(`${drow('Buns (Portioned Tubs)')} .dr-ready`).count() === 0, 'portioned buns: no conversion set, so manual (no ready count)');
  await P.click(`${drow('9" Pizza Bases')} button[aria-label="One more 9\\" Pizza Bases"]`);
  ok(await qv('9" Pizza Bases', '15') === '15' && await sees(P, `${drow('9" Pizza Bases')} .dr-work`, 'suggested 14'), 'changed to 15 (suggested 14 still shown)');
  await P.fill('#admits-in', '200'); await P.keyboard.press('Enter');
  ok(await sees(P, `${drow('Pulled Beef (Bao)')} .ps`, '4 × 1 kg bags'), 'admits 200: beef still 4 bags (one range)');
  await P.click(`${drow('9" Pizza Bases')} .dr-back`);
  ok(await sees(P, `${drow('9" Pizza Bases')} .ps`, '26 bases'), 'back to suggested: 36 − 10 = 26 for 200 admits');
  const [s] = await waitDb(() => sql`select forecast_admits from restock_sessions where kind = 'full'`, (r) => r[0]?.forecastAdmits === 200);
  ok(s?.forecastAdmits === 200, 'admits saved on the restock (200)');
  // The footer: progress, then Continue → Freezer 1 (the collection list is secondary).
  ok(await sees(P, '.dock .dr-progress', '6 of 16') && await sees(P, '.dock .dr-progress', '4 upstairs to pull'), 'footer: "6 of 16 reviewed · 4 upstairs to pull"');
  // Opened fresh, at the top: the pull list first (it's out of view).
  await P.reload(); await P.waitForSelector('article.drow2'); await P.evaluate(() => window.scrollTo(0, 0)); await P.waitForTimeout(400);
  ok(/^(View upstairs items to pull|To pull) \(4\)$/.test(await primaryText(P)) && await P.locator('.dock .dr-list').count() === 1, 'main action "View upstairs items to pull (4)" ("To pull (4)" on a phone), collection list secondary: ' + await primaryText(P));
  // Mark the rest not needed, then undo (untouched rows stay unchecked until then).
  await P.click('.dr-rest-b');
  ok(await sees(P, '.dr-rest', '10 marked not needed') && await sees(P, '.dock .dr-progress', '16 of 16'), '"Mark the remaining 10 not needed": 16 of 16 reviewed');
  await P.click('.dr-rest .linkbtn');
  ok(await sees(P, '.dock .dr-progress', '6 of 16') && await qv('Beef Patties', '') === '' && await P.locator(`${drow('Beef Patties')} .dr-nn.on`).count() === 0, 'Undo: back to 6 of 16, untouched rows unchecked again');
  // The main action goes to the pull list first; once it's in view, Continue → Freezer 1.
  await P.reload(); await P.waitForSelector('article.drow2'); await P.evaluate(() => window.scrollTo(0, 0)); await P.waitForTimeout(400);
  ok(/To pull|View upstairs/.test(await primaryText(P)), 'reopened at the top: the pull list first');
  await P.click('.dock .dock-acts .btn.primary');
  for (let k = 0; k < 30 && !(await primaryText(P)).includes('Continue'); k++) await P.waitForTimeout(150);
  ok((await primaryText(P)).includes('Continue') && (await primaryText(P)).includes('Freezer 1') && await P.locator('#pull-h').isVisible(), 'tapped: the pull list in view, then "Continue → Freezer 1"');
  await P.screenshot({ path: `${OUT}/p18-defrost-suggested.png`, fullPage: true });

  // 4. Pull for defrost: grouped by where it's collected, destination kept; Pulled only once moved.
  ok(await sees(P, '.dpull .sec-title', 'Pull for defrost'), '"Pull for defrost" on the Defrost page');
  const groups = await P.$$eval('.dpull .grab-group h4', (e) => e.map((x) => x.childNodes[0].textContent.replace(/\s+/g, ' ').trim()));
  ok(groups.join('|') === 'Freezer 1 · Lower left|Freezer 1 · Lower right|Freezer 2', `walking order, by compartment: ${groups.join(', ')}`);
  ok(await sees(P, `.dpull .grab-group:has(h4:text-is("Freezer 2")) ${pline('Grilled Chicken')}`, '6') && await sees(P, `${pline('Pulled Beef (Bao)')} .dp-to`, '→ Upstairs walk-in fridge'), 'each item with its destination beside it');
  ok(await sees(P, `${pline('Grilled Chicken')} .dp-spot`, 'Above the arancini drawer'), 'and where exactly to grab it (above the arancini drawer)');
  ok(await P.locator(pline('Sticky Date')).count() === 0 && await sees(P, '.dp-down', 'Sticky Date') && await sees(P, '.dp-down', 'collection list') && await P.locator(pline('Brownie')).count() === 0,
    'desserts from downstairs: not on the pull list, "on the collection list"');
  ok((await P.locator(`${pline('Bao Buns')} .dr-b`).allInnerTexts()).map((t) => t.trim()).join('|') === 'Not upstairs|Only some|Pulled', 'each pull: Not upstairs · Only some · Pulled');
  for (const n of ['Bao Buns', '9" Pizza Bases']) await P.click(`${pline(n)} .dp-ok`);
  // None of the beef upstairs: one tap. All of it comes from downstairs (and the freezer still gets its 4 back).
  await P.click(`${pline('Pulled Beef (Bao)')} .dp-none`);
  ok(await sees(P, pline('Pulled Beef (Bao)'), 'Not upstairs · all 4 × 1 kg bags from Downstairs walk-in freezer (on the collection list)') && await sees(P, `${drow('Pulled Beef (Bao)')} .ps`, 'Not upstairs'),
    'not upstairs: "Not upstairs · all 4 bags from Downstairs walk-in freezer"');
  // Freezer 2 only had 4 chicken: the other 2 come from downstairs (not a shortage).
  await P.click(`${pline('Grilled Chicken')} .dp-few`);
  await P.fill(`${pline('Grilled Chicken')} .dp-edit input`, '4'); await P.click(`${pline('Grilled Chicken')} .dp-edit .btn.primary`);
  ok(await sees(P, pline('Grilled Chicken'), 'Pulled 4') && await sees(P, pline('Grilled Chicken'), '2 packets more from Downstairs walk-in freezer (on the collection list)'), 'not enough upstairs: 4 pulled, 2 more from downstairs');
  ok(await sees(P, `${drow('Grilled Chicken')} .ps`, 'Pulled 4 of 6') && await sees(P, `${drow('Bao Buns')} .ps`, 'Pulled 2 buns'), 'rows say what was pulled');
  ok(await sees(P, '.dpull .sec-title small', '4 of 4 pulled') && await sees(P, '.dock .dr-progress', 'nothing upstairs to pull'), 'all four dealt with: "nothing upstairs to pull"');
  await P.screenshot({ path: `${OUT}/p18-defrost-pull.png`, fullPage: true });

  // 5. Freezer 1 / Freezer 2: what was actually pulled is suggested, to bring up from downstairs.
  await P.click('.area-btn:has-text("Freezer 1")'); await P.waitForSelector('.area-btn.cur:has-text("Freezer 1")');
  ok(await P.locator('.taken-h').count() === 0 && await sees(P, `.psec:has(.psec-t b:text-is("Lower left")) ${row('Pulled Beef (Bao)')} .pnote`, 'Added from Defrost'),
    'Freezer 1: the replacement in its usual compartment row (Lower left), "Added from Defrost"');
  ok(!(await P.textContent('main')).includes('After refilling Freezer 2'), 'Freezer 1 guide no longer says "after refilling Freezer 2"');
  ok(await sees(P, `${row('9" Pizza Bases')} .ps`, '26 bases') && await sees(P, `${row('Pulled Beef (Bao)')} .ps`, '4 × 1 kg bags') && await sees(P, `${row('Bao Buns')} .ps`, '2 buns'),
    'Freezer 1: 26 bases, 4 bags of beef (none was upstairs: still 4 back), 2 bao buns suggested');
  ok(await P.locator(`${row('Brownie')}.suggested`).count() === 0, 'Freezer 1: nothing suggested for what wasn\'t needed');
  ok(await P.locator('.admits, .drow2').count() === 0 && await sees(P, `${row('Beef Patties')} button.padd`, 'Add'), 'Freezer 1 is a normal top-up screen (+ Add), not Defrost rows');
  const comps1 = await P.locator('.psec-t b').allInnerTexts();
  ok(comps1.join('|') === "Upper left|Upper right|Lower left|Lower right|Fisherman's Basket spares", `Freezer 1 compartments: ${comps1.join(', ')}`);
  ok(await P.locator(`.psec:has(.psec-t b:text-is("Lower left")) ${row('Pulled Beef (Bao)')}`).count() === 1 && await P.locator(row('Pulled Beef (Bao)')).count() === 1,
    'beef: in its usual compartment (Lower left), once');
  ok(await sees(P, `.psec:has(.psec-t b:text-is("Lower right")) ${row('Naan Bread')} .pnote`, 'Lower-left tub'), 'naan: "Lower-left tub" beside it');
  // Freezer 1 stock (portioning is a separate morning prep task): check the level, order from downstairs.
  const f1 = (c, n) => `.psec:has(.psec-t b:text-is("${c}")) ${row(n)}`;
  ok(await P.locator(f1('Lower right', 'Portioned Lamb')).count() === 1
    && await P.locator('.psec:has(.psec-t b:text-is("Fisherman\'s Basket spares")) article.prow h3').filter({ hasText: "Fisherman's Basket" }).count() === 1, 'lamb (lower right) and Fisherman\'s Baskets (with their spares) are Freezer 1 stock');
  await P.click(`${f1('Lower right', 'Cauliflower Popcorn')} button.padd`);
  ok(await sees(P, `${f1('Lower right', 'Cauliflower Popcorn')} .ps`, 'to collect'), 'cauliflower popcorn: "1 portion to collect" (from downstairs)');
  ok(await P.locator(row('Brownie')).count() === 0 && await P.locator(row('Potato Coins')).count() === 0, 'no desserts or potato coins in Freezer 1');
  await P.screenshot({ path: `${OUT}/p18-freezer1.png`, fullPage: true });
  // Staff change one: 2 bao buns → 0 (removed).
  await P.click(`${row('Bao Buns')} button[aria-label="One less Bao Buns"]`); await P.click(`${row('Bao Buns')} button[aria-label="One less Bao Buns"]`);
  await P.click('.area-btn:has-text("Freezer 2")'); await P.waitForSelector('.area-btn.cur:has-text("Freezer 2")');
  const sec = (c, n) => `.psec:has(.psec-t b:text-is("${c}")) ${row(n)}`;
  ok((await P.locator('.psec-t b').allInnerTexts()).join('|') === 'Refill working drawers and tubs|Check remaining spare stock', 'Freezer 2: refill working drawers and tubs, then check remaining spare stock');
  ok(await P.locator('.taken-h').count() === 0 && await sees(P, `${sec('Check remaining spare stock', 'Grilled Chicken')} .ps`, '6 packets'), 'grilled chicken: the 6 going to defrost, suggested in place in the spare stock check (after the refills)');
  // 5b. Refills: one tap, the source shown in full under each.
  const R = (n) => sec('Refill working drawers and tubs', n), S = (n) => sec('Check remaining spare stock', n);
  ok(await P.locator('.psec:has(.psec-t b:text-is("Refill working drawers and tubs")) article.rrow').count() === 10, '10 working drawers and tubs');
  // Lamb, cauliflower popcorn and Fisherman's Baskets: no Freezer 2 stock row (that's Freezer 1), just a portioning check.
  const drawerOrder = await P.$$eval('.psec:has(.psec-t b:text-is("Refill working drawers and tubs")) article.prow h3', (e) => e.map((x) => x.textContent));
  ok(await P.locator('.psec:has(.psec-t b:text-is("Refill working drawers and tubs")) .phead').filter({ hasText: 'Check the portioning' }).count() === 0
    && await P.locator('.psec:has(.psec-t b:text-is("Refill working drawers and tubs")) article.pcrow').count() === 3
    && drawerOrder[0] === 'Portioned Lamb' && drawerOrder.indexOf("Fisherman's Basket") === drawerOrder.indexOf('Prawn Twisters') + 1
    && drawerOrder.indexOf('Cauliflower Popcorn') === drawerOrder.indexOf('Fish') + 1
    && await P.locator(S('Portioned Lamb')).count() === 0, 'Freezer 2: the 3 portioning checks in drawer order (no separate group), no stock rows for them: ' + drawerOrder.join(', '));
  await P.click(`${R('Portioned Lamb')} .pc-tick`);
  ok(await sees(P, `${R('Portioned Lamb')} .ps`, 'On the prep checklist') && await sees(P, `${R('Portioned Lamb')} .ps`, 'Portion lamb'), 'portioning selection acknowledged');
  const checklist = await P.context().newPage();
  const [kitchen] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await checklist.goto(B + '/d/' + kitchen.id + '/prep');
  const portions = checklist.getByRole('region', { name: 'Portioning from restock' });
  await portions.getByText('Portion lamb', { exact: true }).waitFor();
  const zucchini = P.getByRole('button', { name: 'Zucchini wedges: needs portioning' });
  await zucchini.click();
  await portions.getByRole('button', { name: 'Portion zucchini wedges: mark ready' }).click();
  await portions.getByRole('button', { name: 'Portion zucchini wedges: mark needs prep' }).waitFor();
  await zucchini.click();
  await portions.getByText('Portion zucchini wedges', { exact: true }).waitFor({ state: 'detached' });
  await checklist.close();
  const [{ n: noItem }] = await sql`select count(*)::int as n from session_items i join product_placements x on x.id = i.placement_id join products q on q.id = x.product_id where q.name = 'Portioned Lamb'`;
  ok(noItem === 0, 'the tick only updates the handover (nothing in the restock)');
  ok(await P.locator(`${R('Arancini')} button.padd`).count() === 0 && (await P.locator(`${R('Arancini')} .rr-b`).allInnerTexts()).join('|') === 'Stocked|Needs stock', 'drawer: just Stocked · Needs stock (no Add)');
  const refillSec = '.psec:has(.psec-t b:text-is("Refill working drawers and tubs"))';
  const nDrawers = await P.locator(`${refillSec} article.rrow`).count();
  ok(await P.locator(`${refillSec} .rr-b.on`).count() === 0 && (await P.locator(`${refillSec} .psec-h small`).innerText()) === `0 of ${nDrawers} checked`, `starts unselected: "0 of ${nDrawers} checked"`);
  ok(await P.locator(`${refillSec} article.rrow .rr-src, ${refillSec} article.rrow .rr-note, ${refillSec} > .psec-hint`).count() === 0, 'no subtext: just each drawer\'s name, Stocked and Needs stock');
  await P.click(`${R('Arancini')} .rr-b.k-stocked`); await P.click(`${R('Nuggets')} .rr-b.k-stocked`); await P.click(`${R('Chicken tenders')} .rr-b.k-needs_stock`);
  await P.waitForSelector(`${R('Chicken tenders')} .rr-b.k-needs_stock.on`); await P.waitForSelector(`${R('Nuggets')} .rr-b.k-stocked.on`);
  ok(await P.locator(`${R('Arancini')} .rr-b.k-stocked.on`).count() === 1 && await P.locator(`${R('Chicken tenders')} .rr-b.k-needs_stock.on`).count() === 1 && await P.locator(`${R('Arancini')} .rr-need`).count() === 0, 'one tap each');
  ok((await P.locator(`${refillSec} .psec-h small`).innerText()) === `3 of ${nDrawers} checked`, `"3 of ${nDrawers} checked"`);
  ok(await P.locator(`${R('Chicken tenders')} .qty-input, ${R('Chicken tenders')} .rr-note`).count() === 0, 'Needs stock: just the answer (no amount, no extra text)');
  // 5c. Then the spare stock: the total needed from downstairs, entered once.
  await P.click(`${S('Arancini')} button.padd`);
  await P.click(`${S('Vegetarian Spring Rolls')} button.padd`);
  await P.screenshot({ path: `${OUT}/p18-freezer2.png`, fullPage: true });
  // 5d. Walk-in fridge: no dessert shelf (desserts are on Defrost only); burger buns still linked to Defrost.
  await P.click('.area-btn:has-text("Walk in fridge")'); await P.waitForSelector('.area-btn.cur:has-text("Walk in fridge")');
  ok(await sees(P, `${sec('Right rack top shelf', 'Buns (Portioned Tubs)')} .ps`, 'Not planned in Defrost yet'), 'burger buns: linked to Defrost too');
  ok(!(await P.locator('.psec-t b').allInnerTexts()).includes('Dessert shelf') && await P.locator(row('Sticky Date')).count() === 0 && await P.locator(row('Brownie')).count() === 0,
    'walk-in fridge: no dessert shelf, no desserts (not doubled up with Defrost)');

  // 6. The collection list is the downstairs run.
  await P.click('.rbar .stage:has-text("Collect")'); await P.waitForSelector('.line');
  const rooms = await P.locator('.room-h h3').allInnerTexts();
  ok(rooms.join('|') === 'Walk in freezer(Downstairs)', `collection list: downstairs only (${rooms.join(', ')})`);
  ok(await sees(P, line('9" Pizza Bases'), '26') && await sees(P, `${line('Grilled Chicken')} .l-qty`, '8') && await sees(P, `${line('Pulled Beef (Bao)')} .l-qty`, '8'), 'pizza 26, chicken 8, beef 8 from downstairs');
  const split = async (n) => (await P.locator(`${line(n)} .l-split small`).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const beef = await split('Pulled Beef (Bao)'), chick = await split('Grilled Chicken');
  ok(beef.join(' | ') === '4 to defrost → Upstairs walk-in fridge | 4 back into Freezer 1 · Lower left', 'beef, one line: ' + beef.join(' | '));
  ok(chick.length === 2 && chick[0] === '2 to defrost → Upstairs walk-in fridge' && chick[1] === '6 back into Freezer 2 spare stock', 'chicken, one line: ' + chick.join(' | '));
  ok(await sees(P, line('Sticky Date'), '2') && await P.locator(line('Sticky Date')).count() === 1 && await sees(P, `${line('Sticky Date')} .dr-dest`, 'Upstairs walk-in fridge'), 'sticky date: one line of 2, from Defrost (not doubled)');
  ok(await sees(P, `.room:has(h3:text-is("Walk in freezer(Downstairs)")) ${line('Cauliflower Popcorn')}`, '1'), 'cauliflower popcorn: on the downstairs list (walk-in freezer)');
  ok(await sees(P, line('Arancini'), '1') && await P.locator(line('Chicken tenders')).count() === 0 && await P.locator(line('Nuggets')).count() === 0, 'drawers add nothing: only the spare stock amount (arancini 1)');
  ok(await sees(P, '.rr-pending', 'Chicken tenders') && await sees(P, '.rr-pending', 'Tender box in Freezer 2, lower left'), 'after collecting: "Back upstairs: refill" lists the tenders drawer');
  ok(await P.locator(line('Bao Buns')).count() === 0, 'bao buns removed on Freezer 1: not on the list');
  await P.screenshot({ path: `${OUT}/p18-defrost-collect.png`, fullPage: true });
  ok(await P.locator(line('Grilled Chicken')).count() === 1 && await P.locator(line('Pulled Beef (Bao)')).count() === 1, 'one line each (not a defrost line and a freezer line)');
  for (const n of ['Grilled Chicken', 'Pulled Beef (Bao)', '9" Pizza Bases', 'Sticky Date', 'Arancini', 'Vegetarian Spring Rolls', 'Cauliflower Popcorn']) {
    for (let k = 0; k < 3 && await P.locator(`${line(n)} button.l-all`).count(); k++) { await P.locator(`${line(n)} button.l-all`).first().click(); await P.waitForTimeout(400); }
  }
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  // Still to refill: shown before finishing, one tap.
  ok(await sees(P, '.rr-pending', 'Chicken tenders'), 'Finish: the tenders refill still shown');
  await P.click('.rr-pending [data-refill="Chicken tenders"] button');
  const [rf] = await waitDb(() => sql`select refill_status from session_items i join product_placements x on x.id = i.placement_id join products q on q.id = x.product_id where q.name = 'Chicken tenders' and i.refill_status is not null`, (r) => r[0]?.refillStatus === 'refilled');
  ok(rf?.refillStatus === 'refilled', 'refilled: saved (the task only)');
  ok(await P.locator('.prep-row[data-task="Portion cauliflower popcorn"]').count() === 1 && !(await P.isChecked('.prep-row[data-task="Portion cauliflower popcorn"] input[type=checkbox]')),
    'Morning prep: "Portion cauliflower popcorn" on the checklist, not ticked by the stock amount');
  ok(await P.isChecked('.prep-row[data-task="Portion lamb"] input[type=checkbox]') && await sees(P, '.prep-sum', 'Portion lamb'), 'Morning prep: "Portion lamb" ticked (from the Freezer 2 portioning check)');
  await P.waitForSelector('.dock button.good:not([disabled])'); await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');
  const [f] = await waitDb(() => sql`select status from restock_sessions where kind = 'full'`, (r) => r[0]?.status === 'finished');
  ok(f?.status === 'finished', 'finished');

  // 7. Admin: change an item's targets, and add a new item to Defrost.
  await sql`insert into admins (email, display_name, password_hash) values ('admin@example.com', 'Admin', ${await bcrypt.hash('correct-horse-1', 10)}) on conflict do nothing`;
  const A = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); A.on('pageerror', (e) => errs.push(e.message));
  await A.goto(B + '/admin/login'); await A.fill('#email', 'admin@example.com'); await A.fill('#password', 'correct-horse-1'); await A.click('button.btn.primary'); await A.waitForURL(/\/admin$/);
  const [pz] = await sql`select p.id, x.check_area_id from products p join product_placements x on x.product_id = p.id
    join check_areas a on a.id = x.check_area_id and a.name = 'Defrost' where p.name = '9" Pizza Bases'`;
  await A.goto(`${B}/admin/products/${pz.id}`);
  const tgt = `#tgt_${pz.checkAreaId}`;
  ok(await A.inputValue(tgt) === '0-150: 24\n151+: 36' && await A.inputValue(`#grab_${pz.checkAreaId}`) === 'The labelled 9" Pizza Bases drawer', 'admin: defrost details shown for the area');
  await A.fill(tgt, '0-100: 20\n101-200: 30\n201+: 40'); await A.click('button.btn.primary:has-text("Save changes")'); await A.waitForURL(/saved=/);
  const [pz2] = await sql`select ready_targets, pickup_suggest from product_placements where product_id = ${pz.id} and check_area_id = ${pz.checkAreaId}`;
  ok(pz2.pickupSuggest, 'admin save keeps the freezer top-up suggestion');
  ok(pz2.readyTargets.map((t) => `${t.min}-${t.max}:${t.qty}`).join(' ') === '0-100:20 101-200:30 201-null:40', 'admin: targets saved');
  await A.goto(`${B}/admin/products/${pz.id}`); await A.fill(tgt, '0-100: 20\n50-200: 30'); await A.click('button.btn.primary:has-text("Save changes")');
  ok(await sees(A, '[role="alert"], .banner, .err', 'overlap'), 'admin: overlapping ranges refused');
  // A new item, ticked into Defrost as "staff enter" (no notes needed to be a Defrost row).
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await A.goto(`${B}/admin/products/new?dept=${k.id}`);
  await A.fill('#name', 'Croissants'); await A.fill('#unitSingular', 'croissant'); await A.fill('#unitPlural', 'croissants');
  await A.selectOption('#defaultLocationId', { label: 'Freezer 1' });
  await A.check('input[name="method"][value="manual"]'); await A.check(`input[name="area"][value="${pz.checkAreaId}"]`);
  await A.click('button.btn.primary:has-text("Add product")'); await A.waitForURL(/saved=1/);
  const [cr] = await sql`select x.sort_order, x.grab_note from product_placements x join products p on p.id = x.product_id where p.name = 'Croissants'`;
  ok(cr && cr.grabNote === null, 'admin: new Defrost item added (at the end)');
  // A fresh night on another device (tonight's restock is finished).
  await sql`delete from shortages`; await sql`delete from session_items`; await sql`delete from session_areas`; await sql`delete from restock_sessions`;
  const P2 = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P2.on('pageerror', (e) => errs.push(e.message));
  await P2.goto(B + '/'); await P2.waitForSelector('.dcard2'); await P2.click('.who'); await P2.fill('#staffname', 'Jo'); await P2.click('.sheet .btn.primary');
  await P2.click('.dcard2:has-text("Kitchen") >> nth=0'); await P2.click('.type-full button.btn.primary'); await P2.waitForSelector(drow('Croissants'));
  ok(await P2.locator(`${drow('Croissants')} .dr-nn`).count() === 1, 'new item: Pull or Not needed, like the rest');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
