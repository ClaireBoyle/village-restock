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
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');
  ok(await sees(P, '.area-btn.cur', 'Defrost'), 'Defrost is still first');
  await addTwo(P, row('Pulled Beef (Bao)'), 'Pulled Beef (Bao)');
  await P.click(`.pull ${line('Pulled Beef (Bao)')} button.l-all`);

  // 1. The walk-in fridge, by location.
  await P.click('.area-btn:has-text("Walk in fridge")'); await P.waitForSelector('.area-btn.cur:has-text("Walk in fridge")');
  const secs = await P.locator('.psec-t b').allInnerTexts();
  ok(secs.join('|') === 'Cheeseboard tub|Bottom cheese shelf|Prep tubs|Spare produce|Dessert shelf|Sauces', `walk-in sections: ${secs.join(', ')}`);
  ok(await sees(P, '.psec:has(.psec-t b:text-is("Cheeseboard tub")) .psec-hint', 'Back wall, second shelf from the bottom: the white cheeseboard tub'), 'cheeseboard tub: where it is');
  ok(await P.locator(sec('Cheeseboard tub', 'Brie')).count() === 1 && await P.locator(sec('Bottom cheese shelf', 'Portioned Napoli Cheese')).count() === 1, 'cheeses in their places');
  ok(await P.locator(sec('Dessert shelf', 'Sticky Date')).count() === 1 && await P.locator(sec('Dessert shelf', 'Brownie')).count() === 1, 'desserts on the right-hand dessert shelf');
  const [dup] = await sql`select count(*)::int as n from products where department_id = ${k.id} and name = 'Sticky Date'`;
  ok(dup.n === 1, 'desserts reuse the Defrost products (no duplicates)');
  ok(await P.locator(sec('Prep tubs', 'Cut Radish')).count() === 1 && await P.locator(sec('Spare produce', 'Radishes')).count() === 1, 'prep tubs and the spare produce underneath');
  const sauces = await P.locator('.psec:has(.psec-t b:text-is("Sauces")) article.prow h3').allInnerTexts();
  ok(sauces.length === 10 && sauces.includes('Vodka Sauce') && sauces.includes('BBQ Sauce') && !sauces.some((s) => /green goddess/i.test(s)), `10 sauces, no Green Goddess (${sauces.join(', ')})`);
  await addTwo(P, sec('Prep tubs', 'Cut Carrot'), 'Cut Carrot');
  ok(await sees(P, `${sec('Prep tubs', 'Cut Carrot')} .ps`, '2 tubs for morning prep'), 'cut carrot: "2 tubs for morning prep"');
  await P.click(`${sec('Cheeseboard tub', 'Brie')} button.padd`);
  await P.screenshot({ path: `${OUT}/p19-walk-in.png`, fullPage: true });

  // 2. Collect: brie from downstairs; cut carrot is for the morning team, not collected.
  await P.click('.rbar .stage:has-text("Collect")'); await P.waitForSelector('.line');
  ok(await P.locator(line('Brie')).count() === 1 && await P.locator(line('Cut Carrot')).count() === 0, 'collection list: brie, not the cut carrot');
  ok(await P.locator(line('Pulled Beef (Bao)')).count() === 1, 'the 2 bags pulled for defrost are replaced from downstairs');
  for (const n of ['Brie', 'Pulled Beef (Bao)']) await P.click(`${line(n)} button.l-all`);
  const [{ n: itemsBefore }] = await sql`select count(*)::int as n from session_items`;

  // 3. Finish: Morning prep needed, answered before finishing.
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('#morning-prep');
  ok(await P.locator('.dock button.good').isDisabled() && await sees(P, '.prep-sum', 'Not answered yet'), 'not answered yet: Finish waits');
  const groups = await P.locator('.prep-group legend').allTextContents();
  ok(groups.join('|') === 'Vegetables|Proteins|Sauces|Other', `grouped: ${groups.join(', ')}`);
  ok((await P.locator('.prep-row').count()) === 15, '15 tasks on the checklist');
  ok(await sees(P, task('Cut carrots for Harvest Hommus'), 'Stock check: 2 tubs') && await sees(P, task('Portion defrosted pulled beef'), 'Stock check: 2 bags'), 'stock entered tonight is shown beside its task');
  await P.check(`${task('Cut carrots for Harvest Hommus')} input[type=checkbox]`);
  ok(await P.inputValue(`${task('Cut carrots for Harvest Hommus')} .prep-qty`) === '2 tubs', 'ticking it fills in the amount (can be changed)');
  await P.check(`${task('Portion defrosted pulled beef')} input[type=checkbox]`);
  await P.check(`${task('Make vodka sauce')} input[type=checkbox]`);
  await P.fill(`${task('Make vodka sauce')} .prep-qty`, '1 batch'); await P.fill(`${task('Make vodka sauce')} .prep-note`, 'Double the chilli'); await P.keyboard.press('Enter');
  await P.fill('#prep-other', 'Clean the slicer'); await P.click('.prep-add button');
  ok(await sees(P, '.prep-sum', 'Cut carrots for Harvest Hommus') && await sees(P, '.prep-sum', 'Double the chilli') && await sees(P, '.prep-sum-g h5', 'Other'), 'handover summary, grouped, with amounts and notes');
  ok(await P.waitForSelector('.dock button.good:not([disabled])', { timeout: 6000 }).then(() => true, () => false), 'answered: Finish is available');
  // "No morning prep needed" is its own answer (and clears the ticks).
  await P.click('.prep-none'); ok(await sees(P, '.prep-sum', 'No morning prep needed') && (await P.locator('.prep-row.on').count()) === 0, '"No morning prep needed" clears the tasks');
  await P.click('.prep-none'); ok(await sees(P, '.prep-sum', 'Not answered yet'), 'tapped again: not answered');
  for (const t of ['Cut carrots for Harvest Hommus', 'Portion defrosted pulled beef', 'Make vodka sauce']) await P.check(`${task(t)} input[type=checkbox]`);
  await P.fill(`${task('Make vodka sauce')} .prep-note`, 'Double the chilli'); await P.keyboard.press('Enter');
  await P.fill('#prep-other', 'Clean the slicer'); await P.click('.prep-add button');
  await P.screenshot({ path: `${OUT}/p19-finish-prep.png`, fullPage: true });
  const [{ n: itemsAfter }] = await sql`select count(*)::int as n from session_items`;
  ok(itemsAfter === itemsBefore, 'choosing prep tasks only changes the handover (no restock items)');
  await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');
  ok(await sees(P, '.prep.done-view', 'Clean the slicer'), 'finished: the handover is shown');
  const [h] = await waitDb(() => sql`select h.status, s.status as restock from prep_handovers h join restock_sessions s on s.id = h.session_id`, (r) => r[0]?.restock === 'finished');
  const its = await waitDb(() => sql`select name, qty, note, task_id, done_at from prep_handover_items order by sort_order`, (r) => r.length === 4);
  ok(h?.status === 'needed' && h.restock === 'finished' && its.length === 4, `saved: 4 tasks, restock finished (${its.map((i) => i.name).join(', ')})`);
  ok(its.find((i) => i.name === 'Make vodka sauce')?.note === 'Double the chilli' && its.find((i) => i.name === 'Clean the slicer')?.taskId === null, 'note kept; typed task saved');

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
