// Admin "Reset restock" and "Clear test activity": server, several devices, offline queues.
// Before running: reset the test database, then load candy-fixture.sql and candy-area-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const has = (p, sel, t, ms = 8000) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 30000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 400)); } };
const fillQty = async (pg, rowSel, v) => { if (await pg.$(`${rowSel} button.padd`)) { await pg.click(`${rowSel} button.padd`); await pg.waitForSelector(`${rowSel} .qty-input`); } await pg.fill(`${rowSel} .qty-input`, v); };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const card = (n) => `.acard:has(h2:text-is("${n}"))`;
const sessionsOf = (dept) => sql`select s.id, s.kind, s.status, (select count(*)::int from session_items i where i.session_id = s.id) as items
  from restock_sessions s join departments d on d.id = s.department_id where d.name = ${dept} order by s.started_at`;
const syncNow = (p) => p.evaluate(() => window.dispatchEvent(new Event('online')));

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql`insert into admins (email, display_name, password_hash) values ('admin@example.com', 'Admin', ${await bcrypt.hash('correct-horse-1', 10)}) on conflict do nothing`;
  const [bar] = await sql`select id from departments where name = 'Gold Class Bar'`;
  const [kit] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  const [candy] = await sql`select id from departments where name = 'Candy Bar'`;
  const b = await chromium.launch(); const errs = [];
  const dev = async (name, opts = devices['iPhone 13']) => {
    const c = await b.newContext(opts); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
    await p.goto(B + '/'); await p.waitForSelector('.dcard2');
    await p.click('.who'); await p.fill('#staffname', name); await p.click('.sheet .btn.primary');
    return { c, p };
  };
  const S = await dev('Sam'); const T = await dev('Tia'); const U = await dev('Uma');
  const A = await dev('Admin', { viewport: { width: 1280, height: 900 } });
  await A.p.goto(B + '/admin/login'); await A.p.fill('#email', 'admin@example.com'); await A.p.fill('#password', 'correct-horse-1'); await A.p.click('button.btn.primary');
  await A.p.waitForURL(/\/admin$/);

  // ---------- 1. Open full restock, two devices; another department untouched ----------
  await S.p.goto(`${B}/d/${kit.id}`); await S.p.click('button:has-text("Start full restock")'); await S.p.waitForSelector('article.prow'); // Kitchen restock must survive
  await S.p.goto(`${B}/d/${bar.id}`); await S.p.click('button:has-text("Start full restock")'); await S.p.waitForSelector('article.prow');
  await fillQty(S.p, row('Heineken'), '3');
  await T.p.goto(`${B}/d/${bar.id}`); await T.p.click('button:has-text("full restock")'); await T.p.waitForSelector(row('Heineken'));
  await waitDb(() => sessionsOf('Gold Class Bar'), (r) => r.length === 1 && r[0].items === 1);
  ok(await S.p.locator('.amenu').count() === 0, 'staff (not signed in as admin) never see the reset menu');
  const denied = await S.p.evaluate(async (d) => (await fetch('/api/admin/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ departmentId: d, kind: 'full', tradingDate: '2026-01-01', confirm: [] }) })).status, bar.id);
  ok(denied === 401, 'the server refuses a reset from a non-admin (401)');

  // T goes offline and keeps entering: these queued changes must never come back
  await T.c.setOffline(true);
  await fillQty(T.p, row('Lemonade'), '6');

  // Admin resets it
  await A.p.goto(`${B}/d/${bar.id}`); await A.p.waitForSelector('.type-full .amenu');
  await A.p.click('.type-full .amenu-btn'); await A.p.click('.amenu-pop button:has-text("Reset restock")');
  await A.p.waitForSelector('.rs-list li');
  const sheet = await A.p.textContent('.sheet');
  ok(sheet.includes('Gold Class Bar') && sheet.includes('Full restock') && /day \d/.test(sheet) && sheet.includes('In progress') && sheet.includes('1 product entered'),
    'confirmation names the department, restock type, date and what will be erased');
  ok(await A.p.isDisabled('.sheet button.danger'), 'reset stays disabled until "I understand" is ticked');
  await A.p.waitForTimeout(600); await A.p.screenshot({ path: `${OUT}/p10-confirm.png` });
  await A.p.check('.rs-sure input'); await A.p.click('.sheet button.danger');
  ok(await has(A.p, '.toast', 'Restock reset'), 'admin sees "Restock reset"');
  ok((await sessionsOf('Gold Class Bar')).length === 0, 'server: the bar restock and its entries are gone');
  ok((await sessionsOf('Gold Class Kitchen')).length === 1, 'server: the kitchen restock was not touched');
  ok(await has(A.p, '.type-full', 'Not started tonight'), 'department page shows the full restock as not started');

  // S was on the restock screen: it goes back to the start with a notice, and the old entry is gone
  await syncNow(S.p);
  ok(await has(S.p, '.reset-note', 'reset by an admin', 30000), 'staff device: notice that an admin reset the restock');
  ok(await S.p.locator('.type-full').count() === 1 && await has(S.p, '.type-full', 'Not started tonight'), 'staff device leaves the reset restock and shows it as not started');
  await S.p.click('.reset-note .linkbtn');
  await S.p.click('button:has-text("Start full restock")'); await S.p.waitForSelector(row('Heineken'));
  ok(await S.p.inputValue(`${row('Heineken')} .qty-input`) === '', 'a fresh restock starts straight away, empty, the same day');
  await fillQty(S.p, row('Heineken'), '1');
  const fresh = await waitDb(() => sessionsOf('Gold Class Bar'), (r) => r.length === 1 && r[0].items === 1);
  ok(fresh.length === 1, 'server: one new restock (not the old one)');

  // T comes back online: its queued Lemonade change is dropped, not uploaded into anything
  await T.c.setOffline(false); await syncNow(T.p);
  ok(await has(T.p, '.reset-note', 'reset by an admin', 30000), 'offline device: on reconnecting, told the restock was reset');
  const [lem] = await sql`select count(*)::int as n from session_items where product_name = 'Lemonade'`;
  ok(lem.n === 0, 'offline device: its queued changes were discarded, never uploaded');
  const pending = await T.p.locator('.pill').textContent();
  ok(!/attention/i.test(pending), 'offline device: no "needs attention" left behind: ' + pending.trim());

  // A device that STARTED a restock while offline, before the reset, can't bring old work back
  await U.p.goto(`${B}/d/${bar.id}`); await U.p.waitForSelector('.type-full');
  await U.c.setOffline(true);
  await U.p.click('.type-full button.btn.primary'); await U.p.waitForSelector(row('Heineken'));
  await fillQty(U.p, row('Sparkling wine piccolo'), '9');
  await A.p.reload(); await A.p.waitForSelector('.type-full .amenu'); await A.p.click('.type-full .amenu-btn'); await A.p.click('.amenu-pop button:has-text("Reset restock")');
  await A.p.waitForSelector('.rs-list li'); await A.p.check('.rs-sure input'); await A.p.click('.sheet button.danger'); await has(A.p, '.toast', 'Restock reset');
  await U.c.setOffline(false); await syncNow(U.p);
  await U.p.waitForSelector('.reset-note', { timeout: 30000 });
  const tonic = await waitDb(() => sql`select count(*)::int as n from session_items where product_name = 'Sparkling wine piccolo'`, () => false, 4000);
  ok(tonic[0].n === 0 && (await sessionsOf('Gold Class Bar')).length === 0, 'a restock started offline before the reset is rejected (old work never returns)');

  // ---------- 2. Finished area restock with a shortage (Candy Bar) ----------
  await S.p.goto(`${B}/d/${candy.id}`); await S.p.click(`${card('Confection stand')} button:has-text("Start")`); await S.p.waitForSelector('article.prow');
  await S.p.click(`${row('Maltesers')} button.padd`); await S.p.click(`${row('Kit Kat')} button.padd`); await S.p.click(`${row('Kit Kat')} button[aria-label="One more Kit Kat"]`);
  await S.p.click('.dock .dock-acts button:has-text("Collect")'); await S.p.waitForSelector('.line');
  await S.p.click('.line[data-line="Maltesers"] .l-all');
  await S.p.click('.line[data-line="Kit Kat"] .l-few'); await S.p.fill(`.line[data-line="Kit Kat"] .fewer .qty-input`, String(Number(await S.p.textContent(`.line[data-line="Kit Kat"] .l-amt b`)) - 1)); await S.p.click('.line[data-line="Kit Kat"] .fw-ok');
  await S.p.click('.dock .dock-acts button:has-text("Review")'); await S.p.click('.dock button.good:has-text("Finish")'); await S.p.waitForSelector('.finish-hero');
  await waitDb(() => sql`select count(*)::int as n from shortages`, (r) => r[0].n === 1);
  await S.p.click('.dock button:has-text("Back to Candy Bar")'); await S.p.waitForSelector('.acard');
  ok(await has(S.p, card('Confection stand'), 'Restocked'), 'staff: confection stand finished, with a shortage');

  await A.p.goto(`${B}/d/${candy.id}`); await A.p.waitForSelector(`${card('Confection stand')} .amenu`);
  ok(await A.p.locator(`${card('FOH drinks fridge')} .amenu`).count() === 0, 'reset is only offered where there is something to reset');
  await A.p.click(`${card('Confection stand')} .amenu-btn`); await A.p.click('.amenu-pop button:has-text("Reset restock")');
  await A.p.waitForSelector('.rs-list li');
  const s2 = await A.p.textContent('.sheet');
  ok(s2.includes('Confection stand restock') && s2.includes('Finished') && s2.includes('1 shortage'), 'confirmation for a finished area restock shows it was finished and has a shortage');
  await A.p.check('.rs-sure input'); await A.p.click('.sheet button.danger'); await has(A.p, '.toast', 'Restock reset');
  ok((await sql`select count(*)::int as n from shortages`)[0].n === 0 && (await sql`select count(*)::int as n from email_outbox`)[0].n === 0, 'its shortage (and any email record) are gone too');
  ok((await sessionsOf('Candy Bar')).length === 0, 'server: the finished area restock is gone');
  await syncNow(S.p);
  ok(await has(S.p, card('Confection stand'), 'Not restocked tonight', 30000), 'staff picker updates: confection stand not restocked tonight');
  await S.p.click(`${card('Confection stand')} button:has-text("Start")`); await S.p.waitForSelector('article.prow');
  ok(await S.p.locator(`${row('Maltesers')} button.padd`).count() === 1, 'and a fresh confection stand restock starts empty');
  await S.p.click(`${row('Pods')} button.padd`);
  await waitDb(() => sessionsOf('Candy Bar'), (r) => r.length === 1 && r[0].items === 1);

  // Stock Insights no longer sees the reset data
  await A.p.goto(`${B}/admin/insights`);
  ok(!(await A.p.textContent('main')).includes('Kit Kat'), 'Stock Insights has nothing from the reset restock');

  // ---------- 3. Quick restock on the admin's own device ----------
  await A.p.goto(`${B}/d/${kit.id}`); await A.p.click('button:has-text("Start quick restock")'); await A.p.waitForSelector('.qrow');
  await A.p.fill('.qpanel .qrow:has-text("Milk") .q-num', '2'); await A.p.waitForSelector('.picked .qrow:has-text("Milk")');
  await waitDb(() => sql`select count(*)::int as n from restock_sessions where kind = 'quick'`, (r) => r[0].n === 1);
  await A.p.goto(`${B}/d/${kit.id}`); await A.p.waitForSelector('.type-quick .amenu');
  await A.p.click('.type-quick .amenu-btn'); await A.p.click('.amenu-pop button:has-text("Reset restock")');
  await A.p.waitForSelector('.rs-list li'); await A.p.check('.rs-sure input'); await A.p.click('.sheet button.danger'); await has(A.p, '.toast', 'Restock reset');
  ok((await sql`select count(*)::int as n from restock_sessions where kind = 'quick'`)[0].n === 0 && await has(A.p, '.type-quick', 'Start quick restock'), 'quick restock reset: gone from the server and this device');
  ok((await sessionsOf('Gold Class Kitchen')).length === 1, 'kitchen full restock still untouched');

  // ---------- Offline admin: a shared reset needs the server ----------
  await A.p.goto(`${B}/d/${candy.id}`); await A.p.waitForSelector(`${card('Confection stand')} .amenu`);
  await A.c.setOffline(true);
  await A.p.click(`${card('Confection stand')} .amenu-btn`); await A.p.click('.amenu-pop button:has-text("Reset restock")');
  ok(await has(A.p, '.sheet', 'Connect to the internet to reset', 15000) && await A.p.locator('.sheet button.danger').count() === 0, 'offline admin: told to connect; no reset button');
  ok((await sessionsOf('Candy Bar')).length === 1, 'nothing was reset while offline');
  await A.p.click('.sheet button:has-text("Cancel")'); await A.c.setOffline(false);

  // ---------- 4. Clear test activity ----------
  await A.p.goto(`${B}/admin/settings`); await A.p.click('a:has-text("Clear test activity")'); await A.p.waitForSelector('h1:has-text("Clear test activity")');
  ok(await A.p.locator('input[name="session"]').count() === 2 && await A.p.locator('input[name="session"]:checked').count() === 0, 'lists the remaining test restocks, none ticked to start with');
  await A.p.waitForTimeout(800); await A.p.screenshot({ path: `${OUT}/p10-clear.png`, fullPage: true });
  await A.p.click('label.row:has-text("Gold Class Kitchen") input');
  await A.p.click('button:has-text("Clear 1 selected")');
  ok(await has(A.p, '.banner.s-bad', 'Tick “I understand”'), 'clearing needs the explicit confirmation');
  await A.p.check('input[name="understand"]'); await A.p.click('button:has-text("Clear 1 selected")');
  ok(await has(A.p, '.banner.s-ok', 'Cleared 1 restock'), 'cleared only the selected record');
  ok((await sessionsOf('Gold Class Kitchen')).length === 0 && (await sessionsOf('Candy Bar')).length === 1, 'the unselected Candy Bar restock is kept');
  const [cfg] = await sql`select (select count(*) from products)::int as p, (select count(*) from check_areas)::int as a, (select count(*) from storage_locations)::int as l, (select count(*) from product_placements)::int as pl`;
  ok(cfg.p > 0 && cfg.a > 0 && cfg.l > 0 && cfg.pl > 0, 'catalogue untouched: products, areas, storerooms and targets all still there');

  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e.message); process.exit(1); });
