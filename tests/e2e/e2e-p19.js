// Gold Class Kitchen: the upstairs walk-in fridge by location, stock made in morning prep, and the
// morning prep handover (Finish screen → Kitchen screen, each task marked Done by the morning team).
// Before running: reset the test database. The test applies the Gold Class Kitchen update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 6000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const row = (n) => `article.prow:has(h3:text-is('${n}'))`;
const sec = (c, n) => `.psec:has(.psec-t b:text-is("${c}")) ${row(n)}`;
const line = (n) => `.line[data-line='${n}']`;
const task = (n) => `.prep-row[data-task="${n}"]`;
// "+ Add", wait for it to save, then one more (as staff would).
const addTwo = async (P, r, name) => {
  await P.click(`${r} button.padd`);
  for (let i = 0; i < 40 && (await P.locator(`${r} .qty-input`).inputValue().catch(() => '')) !== '1'; i++) await P.waitForTimeout(100);
  await P.click(`${r} button[aria-label="One more ${name}"]`);
};
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  // As on the live site: the Kitchen starts with no areas; the downstairs walk-ins are storerooms.
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`delete from check_areas where department_id = ${k.id}`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.drow2');
  ok(await sees(P, '.area-btn.cur', 'Defrost'), 'Defrost is still first');
  const beef = "article.drow2:has(h3:text-is('Pulled Beef (Bao)'))";
  await P.click(`${beef} .dr-set`);
  for (let i = 0; i < 40 && (await P.locator(`${beef} .qty-input`).inputValue().catch(() => '')) !== '1'; i++) await P.waitForTimeout(100);
  await P.click(`${beef} button[aria-label="One more Pulled Beef (Bao)"]`);
  await P.click(".dp-line[data-line='Pulled Beef (Bao)'] .dp-ok");

  // 1. The walk-in fridge, on its confirmed shelves.
  await P.click('.area-btn:has-text("Walk in fridge")'); await P.waitForSelector('.area-btn.cur:has-text("Walk in fridge")');
  const secs = await P.locator('.psec-t b').allInnerTexts();
  ok(secs.join('|') === 'Top sauce shelf|Second sauce shelf|Cheeseboard tub|Bottom cheese shelf|Right rack top shelf|Prep tubs|Spare produce|Left rack lower shelves|Dessert shelf|Sauces (shelf to confirm)',
    `walk-in shelves: ${secs.join(', ')}`);
  // (case-insensitive: the test data's own "Tomato sauce" is reused)
  const names = async (c) => (await P.locator(`.psec:has(.psec-t b:text-is("${c}")) article.prow h3`).allInnerTexts()).map((n) => n.toLowerCase());
  ok((await names('Top sauce shelf')).join('|') === 'tomato sauce|garlic sauce / aioli|tzatziki|chipotle|vegan aioli|hollandaise dressing|sriracha|buttermilk ranch', 'top sauce shelf');
  ok((await names('Second sauce shelf')).join('|') === 'sweet chilli sauce|burger sauce|xo sauce|sesame mayo|sriracha mayo|tartare|bbq sauce|soy sauce'
    && await sees(P, `${sec('Second sauce shelf', 'Soy Sauce')} .pnote`, 'Far right of the shelf'), 'second sauce shelf, soy sauce at the far right');
  ok((await names('Sauces (shelf to confirm)')).join('|') === 'vodka sauce|maple aioli', 'vodka sauce and maple aioli: shelf to confirm');
  ok(await sees(P, '.psec:has(.psec-t b:text-is("Cheeseboard tub")) .psec-hint', 'the white cheeseboard tub, with the strawberries beside it') && await P.locator(sec('Cheeseboard tub', 'Strawberries')).count() === 1, 'cheeseboard tub, strawberries beside it');
  ok(await P.locator(sec('Bottom cheese shelf', 'Portioned Napoli Cheese')).count() === 1 && await P.locator(sec('Right rack top shelf', 'Buns (Portioned Tubs)')).count() === 1, 'cheeses; burger buns in tubs on the right rack');
  ok(await P.locator(sec('Spare produce', 'Tomatoes')).count() === 1 && await P.locator('.psec:has(.psec-t b:text-is("Left rack lower shelves")) article.prow h3').filter({ hasText: 'Hellmann' }).count() === 1, 'tomatoes; pickles and mayonnaise on the left rack');
  ok(await P.locator(sec('Dessert shelf', 'Sticky Date')).count() === 1 && await P.locator(row('Green Goddess')).count() === 0, 'desserts on their shelf; no Green Goddess');
  const [dup] = await sql`select count(*)::int as n from products where department_id = ${k.id} and name in ('Sticky Date', 'Buns (Portioned Tubs)', 'Vodka Sauce')`;
  ok(dup.n === 3, 'existing products reused (no duplicates)');
  const [vs] = await sql`select coalesce(x.location_id, q.default_location_id) as loc from product_placements x join products q on q.id = x.product_id where q.name = 'Vodka Sauce'`;
  ok(vs.loc === null, 'prepared sauces: no assumed collection source');
  // A prepared sauce: entering how much to make adds its prep task, with that amount.
  await addTwo(P, sec('Sauces (shelf to confirm)', 'Vodka Sauce'), 'Vodka Sauce');
  ok(await sees(P, `${sec('Sauces (shelf to confirm)', 'Vodka Sauce')} .ps`, '2 tubs for morning prep'), 'vodka sauce: "2 tubs for morning prep"');
  await P.click(`${sec('Sauces (shelf to confirm)', 'Vodka Sauce')} button[aria-label="One more Vodka Sauce"]`);
  await addTwo(P, sec('Prep tubs', 'Cut Carrot'), 'Cut Carrot');
  // Entered then cleared: the task goes again.
  await P.click(`${sec('Prep tubs', 'Cut Radish')} button.padd`); await P.waitForTimeout(400);
  await P.click(`${sec('Prep tubs', 'Cut Radish')} button[aria-label="One less Cut Radish"]`); await P.waitForTimeout(300);
  await P.click(`${sec('Prep tubs', 'Cut Radish')} button[aria-label="Clear Cut Radish"]`);
  await P.click(`${sec('Cheeseboard tub', 'Brie')} button.padd`);
  await P.click(`${sec('Second sauce shelf', 'Soy Sauce')} button.padd`);
  await P.screenshot({ path: `${OUT}/p19-walk-in.png`, fullPage: true });

  // 2. Collect: brie and soy sauce (bottles, storeroom still to set); not the prepared sauce or cut carrot.
  await P.click('.rbar .stage:has-text("Collect")'); await P.waitForSelector('.line');
  ok(await P.locator(line('Brie')).count() === 1 && await P.locator(line('Cut Carrot')).count() === 0 && await P.locator(line('Vodka Sauce')).count() === 0, 'collection list: brie, not the prepared sauce or cut carrot');
  ok(await sees(P, `.room:has(h3:text-is("No storeroom set")) ${line('Soy Sauce')}`, 'bottle'), 'soy sauce: 1 bottle, under "No storeroom set" until its storeroom is confirmed');
  ok(await P.locator(line('Pulled Beef (Bao)')).count() === 1, 'the 2 bags pulled for defrost are replaced from downstairs');
  for (const n of ['Brie', 'Pulled Beef (Bao)', 'Soy Sauce']) await P.click(`${line(n)} button.l-all`);
  const [{ n: itemsBefore }] = await sql`select count(*)::int as n from session_items`;

  // 3. Finish: Morning prep needed.
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('#morning-prep');
  const groups = await P.locator('.prep-group legend').allTextContents();
  ok(groups.join('|') === 'Vegetables|Proteins|Sauces|Other', `grouped: ${groups.join(', ')}`);
  ok((await P.locator('.prep-row').count()) === 18, '18 tasks on the checklist');
  ok(await sees(P, '.prep-group:has(legend:text-is("Proteins"))', 'Portion lamb') && await sees(P, '.prep-group:has(legend:text-is("Proteins"))', "Portion Fisherman's Baskets")
    && await sees(P, '.prep-group:has(legend:text-is("Vegetables"))', 'Portion cauliflower popcorn'), 'portion tasks: lamb and Fisherman\'s Baskets (proteins), cauliflower popcorn (vegetables)');
  // Entered to prepare: already ticked, with the amount. Cleared again: not there.
  ok(await P.isChecked(`${task('Make vodka sauce')} input[type=checkbox]`) && await P.isChecked(`${task('Cut carrots for Harvest Hommus')} input[type=checkbox]`), 'vodka sauce and cut carrots: ticked from the stock check');
  ok(await P.locator('.prep-qty').count() === 0 && !(await P.textContent('#morning-prep')).includes('tubs'), 'no amount fields, no amounts filled in');
  ok(!(await P.isChecked(`${task('Cut radish for Harvest Hommus')} input[type=checkbox]`)), 'cut radish: entered then cleared, so not ticked');
  await P.check(`${task('Portion defrosted pulled beef')} input[type=checkbox]`);
  ok(await P.locator(`${task('Portion defrosted pulled beef')} .prep-note`).count() === 1, 'ticked: just an optional note');
  await P.fill(`${task('Make vodka sauce')} .prep-note`, 'Double the chilli'); await P.keyboard.press('Enter');
  await P.fill('#prep-other', 'Clean the slicer'); await P.click('.prep-add button');
  ok(await sees(P, '.prep-sum', 'Cut carrots for Harvest Hommus') && await sees(P, '.prep-sum', 'Double the chilli') && await sees(P, '.prep-sum-g h5', 'Other'), 'handover summary, grouped, with amounts and notes');
  ok(await P.waitForSelector('.dock button.good:not([disabled])', { timeout: 6000 }).then(() => true, () => false), 'answered: Finish is available');
  // "No morning prep needed" is its own answer (and clears the ticks); tapped again, not answered.
  await P.click('.prep-none'); ok(await sees(P, '.prep-sum', 'No morning prep needed') && (await P.locator('.prep-row.on').count()) === 0, '"No morning prep needed" clears the tasks');
  await P.click('.prep-none'); ok(await sees(P, '.prep-sum', 'Not answered yet') && await P.waitForSelector('.dock button.good[disabled]', { timeout: 6000 }).then(() => true, () => false), 'not answered: Finish waits');
  for (const t of ['Cut carrots for Harvest Hommus', 'Portion defrosted pulled beef', 'Make vodka sauce']) await P.check(`${task(t)} input[type=checkbox]`);
  await P.fill(`${task('Make vodka sauce')} .prep-note`, 'Double the chilli'); await P.keyboard.press('Enter');
  await P.fill('#prep-other', 'Clean the slicer'); await P.click('.prep-add button');
  await P.screenshot({ path: `${OUT}/p19-finish-prep.png`, fullPage: true });
  const [{ n: itemsAfter }] = await sql`select count(*)::int as n from session_items`;
  ok(itemsAfter === itemsBefore, 'choosing prep tasks only changes the handover (no restock items)');
  await P.waitForSelector('.dock button.good:not([disabled])'); await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');
  ok(await sees(P, '.prep.done-view', 'Clean the slicer'), 'finished: the handover is shown');
  const [h] = await waitDb(() => sql`select h.status, s.status as restock from prep_handovers h join restock_sessions s on s.id = h.session_id`, (r) => r[0]?.restock === 'finished');
  const its = await waitDb(() => sql`select name, qty, note, task_id, done_at from prep_handover_items order by sort_order`, (r) => r.length === 4);
  ok(h?.status === 'needed' && h.restock === 'finished' && its.length === 4, `saved: 4 tasks, restock finished (${its.map((i) => i.name).join(', ')})`);
  ok(its.find((i) => i.name === 'Make vodka sauce')?.note === 'Double the chilli' && its.find((i) => i.name === 'Clean the slicer')?.taskId === null, 'note kept; typed task saved');
  ok(its.every((i) => i.qty === null), 'no amounts saved');

  // 4. The morning team, on another device: the Kitchen screen, each task marked Done.
  const M = await (await b.newContext({ ...devices['iPad (gen 7)'] })).newPage(); M.on('pageerror', (e) => errs.push(e.message));
  await M.goto(B + '/'); await M.waitForSelector('.dcard2');
  await M.click('.who'); await M.fill('#staffname', 'Jo'); await M.click('.sheet .btn.primary');
  await M.click('.dcard2:has-text("Kitchen") >> nth=0'); await M.waitForSelector('.prep-card', { timeout: 15000 });
  ok(await sees(M, '.prep-card .pc-n', '0 of 4 done') && await sees(M, '.prep-card', 'Double the chilli'), 'Kitchen screen: Morning prep, 0 of 4 done');
  await M.click('.prep-card [data-prep="Cut carrots for Harvest Hommus"] .pc-done');
  ok(await sees(M, '.prep-card .pc-n', '1 of 4 done') && await sees(M, '.prep-card [data-prep="Cut carrots for Harvest Hommus"]', 'Done · Jo'), 'marked Done by Jo');
  await M.screenshot({ path: `${OUT}/p19-morning.png`, fullPage: true });
  const [d] = await waitDb(() => sql`select done_by, done_at from prep_handover_items where name = 'Cut carrots for Harvest Hommus'`, (r) => r[0]?.doneBy === 'Jo');
  ok(d?.doneBy === 'Jo' && d.doneAt, 'saved on the server');
  const [s2] = await sql`select status, finished_at from restock_sessions`;
  ok(s2.status === 'finished', 'the restock is unchanged (tracked separately)');
  // The closing device sees it too, after a sync.
  await P.click('.dock button:has-text("Back to home")').catch(() => {});
  await P.goto(`${B}/d/${k.id}`); await P.waitForSelector('.prep-card');
  ok(await sees(P, '.prep-card .pc-n', '1 of 4 done', 15000), 'the closing device sees "1 of 4 done"');

  // 5. Admin: add a task to the checklist.
  await sql`insert into admins (email, display_name, password_hash) values ('admin@example.com', 'Admin', ${await bcrypt.hash('correct-horse-1', 10)}) on conflict do nothing`;
  const A = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); A.on('pageerror', (e) => errs.push(e.message));
  await A.goto(B + '/admin/login'); await A.fill('#email', 'admin@example.com'); await A.fill('#password', 'correct-horse-1'); await A.click('button.btn.primary'); await A.waitForURL(/\/admin$/);
  await A.goto(B + '/admin/prep');
  ok(await sees(A, '.panel', 'Make sesame mayo') && await sees(A, '.panel h2', 'Vegetables'), 'admin: the checklist, by group');
  await A.fill('#pt-new', 'Cut lettuce for burgers'); await A.selectOption('#pg-new', 'vegetables'); await A.click('button:has-text("Add task")');
  const [nt] = await waitDb(() => sql`select grp from prep_tasks where name = 'Cut lettuce for burgers'`, (r) => !!r[0]);
  ok(nt?.grp === 'vegetables', 'admin: new task added');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
