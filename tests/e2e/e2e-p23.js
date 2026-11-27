// Gold Class Kitchen Prep checklist: opened from the Kitchen screen with no restock in progress, grouped jobs (the
// confirmed list), Unchecked → Ready / Needs prep, an optional note, shared between two devices on the same
// service, the Needs prep filter (marking Ready when done), Needs prep never reaching the opener, Leave for morning
// on the opener's handover (Done there), the next service starting fresh, and Admin → Morning prep.
// Before running: reset the test database. The test applies the Gold Class Kitchen update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 8000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const job = (n) => `.pcl-job[data-job="${n}"]`;
// Every job is a chip: tap → Needs prep → Ready → clear; "Rest ready" on a heading marks the others Ready.
const chip = (n) => `.pcl-chip[data-chip="${n}"]`;
const st = (P, n) => P.evaluate((n) => {
  const c = document.querySelector(`.pcl-chip[data-chip="${n}"]`);
  if (c) return c.classList.contains('s-ready') ? 'Ready' : c.classList.contains('s-needs') ? 'Needs prep' : 'Unchecked';
  return document.querySelector(`.pcl-job[data-job="${n}"] .pcl-st`).textContent.split('·')[0].trim();
}, n);
const items = (P) => P.$$eval('.pcl-chip', (e) => e.map((x) => x.dataset.chip));

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

  const groups = await A.$$eval('.pcl-group', (els) => els.map((g) => `${g.querySelector('h2 span').textContent}: ${[...g.querySelectorAll('.pcl-chip')].map((j) => j.dataset.chip).join(', ')}`));
  ok(JSON.stringify(groups) === JSON.stringify([
    'Cut veg for Harvest Hommus: Carrot, Cucumber, Celery, Radish', 'Portion bao: Bao meat portioning',
    'Portion sauces: BBQ sauce, Sweet chilli sauce, Tomato sauce',
    'Make sauces: Vodka sauce, Sriracha mayo, Burger sauce, Hollandaise dressing, Tartare, Maple aioli, Sesame mayo',
  ]), 'grouped by shelf, in the current task order (only one lone job, so it keeps its heading):\n  ' + groups.join('\n  '));
  ok((await items(A)).length === 15 && await A.locator('.pcl-chip.s-ready, .pcl-chip.s-needs').count() === 0, 'all 15 start Unchecked (lamb, cauliflower popcorn, Fisherman’s Baskets not on it)');
  ok((await A.locator('.pcl-hint').innerText()).includes('Tap what needs prep, then Rest ready'), 'a hint: "Tap what needs prep, then Rest ready…"');
  ok((await A.locator('.pcl-sum').innerText()).startsWith('0 of 15 checked'), '"0 of 15 checked"');
  ok(await A.locator('.pcl-job input, .pcl-job .qty-input').count() === 0, 'no amounts anywhere');

  // Before a busy Friday: sauces checked.
  await A.click(chip('BBQ sauce')); await A.click(chip('BBQ sauce'));
  await A.click(chip('Burger sauce'));
  await A.click(chip('Carrot'));
  await A.waitForSelector('.pcl-chip-x .pcl-job[data-job="Carrot"]');
  ok(await A.locator('.pcl-chip-x .pcl-job').count() === 2, 'the two Needs prep chips get a slim line for a note / Leave for morning');
  await A.click(`${job('Burger sauce')} .pcl-add-note`); await A.fill(`${job('Burger sauce')} .pcl-note-in`, 'Double batch for the Friday rush'); await A.press(`${job('Burger sauce')} .pcl-note-in`, 'Enter');
  await A.waitForTimeout(300);
  ok(await st(A, 'BBQ sauce') === 'Ready' && await st(A, 'Burger sauce') === 'Needs prep' && await st(A, 'Sweet chilli sauce') === 'Unchecked', 'Ready / Needs prep / Unchecked');
  ok((await A.locator('.pcl-sum').innerText()).includes('3 of 15 checked') && (await A.locator('.pcl-sum').innerText()).includes('2 need prep'), '"3 of 15 checked · 2 need prep"');
  for (let i = 0; i < 3; i++) await A.click(chip('Sweet chilli sauce'));
  await A.waitForTimeout(200);
  ok(await st(A, 'Sweet chilli sauce') === 'Unchecked', 'tap three times: Needs prep, Ready, back to Unchecked');
  // Rest ready: the others in the group, in one tap.
  await A.click('.pcl-group[aria-label="Cut veg for Harvest Hommus"] .pcl-all');
  await A.waitForSelector(`${chip('Radish')}.s-ready`);
  ok(await st(A, 'Carrot') === 'Needs prep' && await st(A, 'Cucumber') === 'Ready' && await st(A, 'Celery') === 'Ready', 'Rest ready: the others Ready, Carrot still Needs prep');
  await A.click(chip('Cucumber')); await A.click(chip('Celery')); await A.click(chip('Radish')); // Ready → clear
  await A.waitForSelector(`${chip('Radish')}.s-none`);
  ok(await A.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no sideways scrolling');
  await A.screenshot({ path: `${OUT}/p23-checklist-phone.png`, fullPage: true });
  await waitDb(() => sql`select count(*)::int as n from prep_checks where status is not null`, (r) => r[0].n === 3);

  // A second device on the same service sees it.
  const T = await (await b.newContext({ ...devices['iPad (gen 7)'] })).newPage(); T.on('pageerror', (e) => errs.push(e.message));
  await T.goto(B + '/'); await T.waitForSelector('.dcard2');
  await T.click('.who'); await T.fill('#staffname', 'Sam'); await T.click('.sheet .btn.primary');
  await T.goto(`${B}/d/${k.id}/prep`); await T.waitForSelector('.pcl-group');
  await T.waitForSelector(`${chip('Burger sauce')}.s-needs`);
  ok(await st(T, 'Burger sauce') === 'Needs prep' && await sees(T, `${job('Burger sauce')} .pcl-note`, 'Double batch'), 'iPad: Burger sauce Needs prep, with the note');
  // The person doing the prep: Needs prep only, then Ready when done.
  await T.click('.pcl-filter button:has-text("Needs prep")');
  const todo = await items(T);
  ok(JSON.stringify(todo) === JSON.stringify(['Carrot', 'Burger sauce']), 'Needs prep filter: ' + todo.join(', '));
  await T.click(chip('Burger sauce')); await T.waitForTimeout(300);
  ok(await st(T, 'Burger sauce') === 'Ready' && (await items(T)).length === 2, 'doing the prep: one tap on a Needs prep chip → Ready; stays in view until the filter changes');
  await T.screenshot({ path: `${OUT}/p23-needs-prep-ipad.png` });
  await T.click('.pcl-filter button:text-is("All")'); await T.click('.pcl-filter button:has-text("Needs prep")');
  ok(JSON.stringify(await items(T)) === '["Carrot"]', 'filter again: only Carrot left');
  await waitDb(() => sql`select status from prep_checks pc join prep_tasks t on t.id = pc.task_id where t.name = 'Make burger sauce'`, (r) => r[0]?.status === 'ready');
  await A.reload(); await A.waitForSelector('.pcl-group');
  await A.waitForSelector(`${chip('Burger sauce')}.s-ready`, { timeout: 8000 }).catch(() => {});
  ok(await st(A, 'Burger sauce') === 'Ready', 'phone: sees Burger sauce Ready from the iPad');

  // Needs prep is for tonight: it never reaches the opener.
  await A.goto(`${B}/d/${k.id}`); await A.waitForSelector('.prep-link');
  ok(await A.locator('.prep-card').count() === 0, 'Needs prep (Carrot) is not on the morning handover');
  // Leave for morning: on the opener's handover.
  await A.goto(`${B}/d/${k.id}/prep`); await A.waitForSelector('.pcl-group');
  // A chip: Needs prep first, then Leave for morning on its line.
  await A.click(chip('Tartare'));
  await A.click(`${job('Tartare')} button.pcl-morning`);
  ok(await sees(A, `${job('Tartare')} .pcl-morning.on`, 'Left for morning') && await A.locator(`${chip('Tartare')} .ic`).count() >= 1, 'Leave for morning: tagged (a clock on the chip)');
  ok((await A.locator('.pcl-sum').innerText()).includes('1 for morning'), '"1 for morning"');
  await waitDb(() => sql`select count(*)::int as n from prep_checks where morning`, (r) => r[0].n === 1);

  // The next morning, on another device: last night's job is on the handover; the checklist starts fresh.
  const next = await b.newContext({ ...devices['iPad (gen 7)'] });
  await next.addInitScript(`{ const off = 24 * 3600 * 1000; const D = Date; class N extends D { constructor(...a) { if (a.length) super(...a); else super(D.now() + off); } static now() { return D.now() + off; } } globalThis.Date = N; }`);
  const M = await next.newPage(); M.on('pageerror', (e) => errs.push(e.message));
  await M.goto(`${B}/d/${k.id}`); await M.waitForSelector('.prep-card'); await M.click('.prep-card .pc-head'); // starts folded
  ok(await sees(M, '.prep-card', 'Make tartare') && await sees(M, '.prep-card .pc-sub', 'Left for morning on the'), 'opener: "Make tartare" on the handover, from the prep checklist');
  ok(!(await M.locator('.prep-card').innerText()).includes('burger') && !(await M.locator('.prep-card').innerText()).includes('carrot'), 'opener: nothing that was only Needs prep for last night');
  await M.click('.prep-card button.pc-done'); await waitDb(() => sql`select morning_done_at from prep_checks where morning`, (r) => !!r[0]?.morningDoneAt);
  ok(true, 'opener marks it Done (saved)');
  await M.goto(`${B}/d/${k.id}/prep`); await M.waitForSelector('.pcl-group');
  ok((await M.locator('.pcl-sum').innerText()).startsWith('0 of 15 checked') && await M.locator('.pcl-morning.on').count() === 0, 'next service: a fresh check (0 of 15)');

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
  await A.reload(); await A.waitForSelector('.pcl-group'); await A.waitForTimeout(500); await A.reload(); await A.waitForSelector('.pcl-group');
  ok(await A.locator('.pcl-group:has(h2:has-text("Make sauces")) .pcl-chip[data-chip="Garlic butter"]').count() === 1, 'staff see Garlic butter under Make sauces');

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
