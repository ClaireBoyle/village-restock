// Gold Class Kitchen Prep checklist, in two steps: 1 Check (tap what needs prepping, tap again to undo; nothing else
// to choose), then 2 To prep (only those jobs, each with a big green tick for Done, and "1 of 2 done"). Shared
// between two devices on the same service, a note on a job, Needs prep never reaching the opener on its own (there's
// no Leave for morning here: the closers' morning prep list is separate), the next service starting fresh, and
// Admin → Morning prep. Before running: reset the test database. The test applies the Gold Class Kitchen update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 8000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const chip = (n) => `.pcl-chip[data-chip="${n}"]`;
const todo = (n) => `.pcl-tr[data-todo="${n}"]`;
const st = (P, n) => P.evaluate((n) => { const c = document.querySelector(`.pcl-chip[data-chip="${n}"]`);
  return c.classList.contains('s-ready') ? 'Done' : c.classList.contains('s-needs') ? 'Needs prep' : 'Not needed'; }, n);
const items = (P) => P.$$eval('.pcl-chip', (e) => e.map((x) => x.dataset.chip));
const todos = (P) => P.$$eval('.pcl-tr', (e) => e.map((x) => x.dataset.todo));
const step = (P, n) => P.click(`.pcl-steps button:has-text("${n}")`);

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`delete from check_areas where department_id = ${k.id}`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact', 'freezer-1-first', 'no-walk-in-desserts', 'walk-in-third-shelf', 'walk-in-fresh-produce', 'bottom-sauce-shelf', 'prep-checklist', 'prep-checklist']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);

  const b = await chromium.launch(); const errs = [];
  const A = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); A.on('pageerror', (e) => errs.push(e.message));
  await A.goto(B + '/'); await A.waitForSelector('.dcard2');
  await A.click('.who'); await A.fill('#staffname', 'Mia'); await A.click('.sheet .btn.primary');
  await A.click('.dcard2:has-text("Kitchen") >> nth=0'); await A.waitForSelector('.prep-link');
  ok((await A.locator('.prep-link').innerText()).includes('Check what’s ready and what still needs prepping for service.'), 'Kitchen screen: Prep checklist with its description');
  ok(await A.locator('.type-full .badge:has-text("Not started")').count() === 1 && await A.locator('.prep-card').count() === 0, 'no restock in progress and no morning handover');
  await A.click('.prep-link'); await A.waitForSelector('.pcl-group');

  // 1. Check: grouped jobs, nothing chosen yet.
  ok(await A.locator('.pcl-steps button.on:has-text("Check")').count() === 1, 'opens on 1 Check');
  const groups = await A.$$eval('.pcl-group', (els) => els.map((g) => `${g.querySelector('h2 span').textContent}: ${[...g.querySelectorAll('.pcl-chip')].map((j) => j.dataset.chip).join(', ')}`));
  ok(JSON.stringify(groups) === JSON.stringify([
    'Harvest hummus veg: Carrot, Cucumber, Celery, Radish', 'Portion bao: Bao meat portioning',
    'Portion sauces: BBQ sauce, Sweet chilli sauce, Tomato sauce',
    'Make sauces: Vodka sauce, Sriracha mayo, Burger sauce, Hollandaise dressing, Tartare, Maple aioli, Sesame mayo',
  ]), 'grouped by shelf:\n  ' + groups.join('\n  '));
  ok((await items(A)).length === 15 && await A.locator('.pcl-chip.s-needs, .pcl-chip.s-ready').count() === 0, 'all 15 jobs, none chosen');
  ok((await A.locator('.pcl-hint').first().innerText()).includes('Tap anything that needs prepping'), 'hint: "Tap anything that needs prepping. Leave the rest."');
  ok(await A.locator('.pcl-all, .pcl-ready, .pcl-needs, .pcl-morning').count() === 0, 'no Ready / Rest ready / Leave for morning to choose');
  ok(await A.locator('.pcl-go button:has-text("Nothing to prep yet")').isDisabled(), 'nothing chosen: "Nothing to prep yet"');

  // Tap what needs prepping (one tap); tap again to undo.
  await A.click(chip('Burger sauce')); await A.click(chip('Carrot'));
  await A.click(chip('Sweet chilli sauce')); await A.click(chip('Sweet chilli sauce'));
  await A.waitForSelector(`${chip('Carrot')}.s-needs`); await A.waitForTimeout(300);
  ok(await st(A, 'Burger sauce') === 'Needs prep' && await st(A, 'Carrot') === 'Needs prep' && await st(A, 'Sweet chilli sauce') === 'Not needed', 'one tap: Needs prep; tapped again: undone');
  ok(await sees(A, '.pcl-group[aria-label="Make sauces"] h2', '1 to prep') && await sees(A, '.pcl-go button', 'Start prepping (2)'), 'heading "1 to prep"; "Start prepping (2)"');
  ok(await A.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no sideways scrolling');
  await A.screenshot({ path: `${OUT}/p23-check-phone.png`, fullPage: true });

  // 2. To prep: only those two, each with a tick.
  await A.click('.pcl-go button'); await A.waitForSelector('.pcl-tr');
  ok(JSON.stringify(await todos(A)) === JSON.stringify(['Carrot', 'Burger sauce']), 'To prep: just Carrot and Burger sauce: ' + (await todos(A)).join(', '));
  ok((await A.innerText(`${todo('Carrot')} small`)).trim() === 'Harvest hummus veg' && (await A.locator('.pcl-prog').innerText()).includes('0 of 2 done'), 'each says where it is from; "0 of 2 done"');
  await A.click(`${todo('Burger sauce')} .pcl-add-note`); await A.fill(`${todo('Burger sauce')} .pcl-note-in`, 'Double batch for the Friday rush'); await A.press(`${todo('Burger sauce')} .pcl-note-in`, 'Enter');
  await waitDb(() => sql`select count(*)::int as n from prep_checks where status = 'needs'`, (r) => r[0].n === 2);
  await waitDb(() => sql`select note from prep_checks pc join prep_tasks t on t.id = pc.task_id where t.name = 'Make burger sauce'`, (r) => !!r[0]?.note);

  // A second device on the same service: straight to To prep, ticks Burger sauce done.
  const T = await (await b.newContext({ ...devices['iPad (gen 7)'] })).newPage(); T.on('pageerror', (e) => errs.push(e.message));
  await T.goto(B + '/'); await T.waitForSelector('.dcard2');
  await T.click('.who'); await T.fill('#staffname', 'Sam'); await T.click('.sheet .btn.primary');
  await T.goto(`${B}/d/${k.id}/prep#prep`); await T.waitForSelector('.pcl-tr');
  ok(await sees(T, `${todo('Burger sauce')} .pcl-note`, 'Double batch'), 'iPad: To prep, with the note on Burger sauce');
  await T.click(`${todo('Burger sauce')} .pcl-tick`); await T.waitForSelector(`${todo('Burger sauce')}.done`);
  ok((await T.innerText(`${todo('Burger sauce')} small`)).startsWith('Done · Sam') && (await T.locator('.pcl-prog').innerText()).includes('1 of 2 done'), 'green tick: "Done · Sam", "1 of 2 done"');
  await T.screenshot({ path: `${OUT}/p23-to-prep-ipad.png` });
  await T.click(`${todo('Burger sauce')} .pcl-tick`); await T.waitForSelector(`${todo('Burger sauce')}:not(.done)`);
  ok(true, 'tick again: undone');
  await T.click(`${todo('Burger sauce')} .pcl-tick`); await T.waitForSelector(`${todo('Burger sauce')}.done`);
  await waitDb(() => sql`select status from prep_checks pc join prep_tasks t on t.id = pc.task_id where t.name = 'Make burger sauce'`, (r) => r[0]?.status === 'ready');
  // The phone sees it: Burger sauce Done on Check too.
  await A.reload(); await A.waitForSelector('.pcl-tr');
  ok(await A.locator('.pcl-steps button.on:has-text("To prep")').count() === 1 && await A.locator(`${todo('Burger sauce')}.done`).count() === 1, 'phone, reloaded: stays on To prep, sees Burger sauce Done');
  await step(A, 'Check'); await A.waitForSelector('.pcl-group');
  await A.waitForSelector(`${chip('Burger sauce')}.s-ready`, { timeout: 8000 }).catch(() => {});
  ok(await st(A, 'Burger sauce') === 'Done' && await sees(A, chip('Burger sauce'), 'Done'), 'phone: Burger sauce shows Done on Check');

  // Needs prep is for this service only: it never reaches the opener by itself.
  await A.goto(`${B}/d/${k.id}`); await A.waitForSelector('.prep-link');
  ok(await A.locator('.prep-card').count() === 0, 'Carrot (still to prep) is not on the morning handover by itself');

  // The next morning, on another device: the checklist starts fresh.
  const next = await b.newContext({ ...devices['iPad (gen 7)'] });
  await next.addInitScript(`{ const off = 24 * 3600 * 1000; const D = Date; class N extends D { constructor(...a) { if (a.length) super(...a); else super(D.now() + off); } static now() { return D.now() + off; } } globalThis.Date = N; }`);
  const M = await next.newPage(); M.on('pageerror', (e) => errs.push(e.message));
  await M.goto(`${B}/d/${k.id}/prep`); await M.waitForSelector('.pcl-group');
  ok(await M.locator('.pcl-chip.s-needs, .pcl-chip.s-ready').count() === 0, 'next service: a fresh check');

  // Admin → Morning prep: one list for both; a job added there is on the checklist too.
  await sql`insert into admins (email, display_name, password_hash) values ('admin@example.com', 'Admin', ${await bcrypt.hash('correct-horse-1', 10)}) on conflict do nothing`;
  const AD = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); AD.on('pageerror', (e) => errs.push(e.message));
  await AD.goto(B + '/admin/login'); await AD.fill('#email', 'admin@example.com'); await AD.fill('#password', 'correct-horse-1'); await AD.click('button.btn.primary'); await AD.waitForURL(/\/admin$/);
  await AD.goto(`${B}/admin/prep?dept=${k.id}`); await AD.waitForSelector('.panel');
  ok(await sees(AD, '.row', 'Prep checklist: Make sauces · Burger sauce') && await sees(AD, '.row', 'Not on the Prep checklist'), 'Admin shows where each job appears');
  const form = AD.locator('.panel:last-of-type form');
  await form.locator('input[name="name"]').fill('Make garlic butter'); await form.locator('select[name="group"]').selectOption('sauces');
  await form.locator('input[name="checklistGroup"]').fill('Make sauces'); await form.locator('input[name="checklistName"]').fill('Garlic butter');
  await form.locator('button:has-text("Add task")').click();
  const [added] = await waitDb(() => sql`select on_checklist, checklist_group, checklist_name, active from prep_tasks where name = 'Make garlic butter'`, (r) => r.length === 1);
  ok(added?.onChecklist && added.checklistGroup === 'Make sauces' && added.checklistName === 'Garlic butter' && added.active, 'added once: on the morning handover and the Prep checklist');
  await A.goto(`${B}/d/${k.id}/prep`); await A.waitForSelector('.pcl-group'); await A.waitForTimeout(500); await A.reload(); await A.waitForSelector('.pcl-group');
  ok(await A.locator('.pcl-group:has(h2:has-text("Make sauces")) .pcl-chip[data-chip="Garlic butter"]').count() === 1, 'staff see Garlic butter under Make sauces');

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
