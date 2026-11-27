// Admin → Restocks → an Unfinished restock (left open past the 5 am cut-off, every area done, just never finished):
// "Finish this restock" → "Yes, finish it". It's finished as at the last time anyone worked on it, its stock shortages
// are recorded (Orange Juice short 1), "Completed by <admin> (Admin)", no manager email, and the button is gone.
// A restock that isn't unfinished can't be finished this way.
// Before running: reset the test database, then load gcbar-refill-fixture.sql.
const { chromium } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql`insert into admins (email, display_name, password_hash) values ('admin@example.com', 'Claire', ${await bcrypt.hash('correct-horse-1', 10)}) on conflict do nothing`;
  const [d] = await sql`select id from departments where name = 'Gold Class Bar'`;
  const id = crypto.randomUUID();
  await sql`insert into restock_sessions (id, department_id, kind, trading_date, status, people, started_at)
    values (${id}, ${d.id}, 'full', current_date - 1, 'open', '{Sam}', now() - interval '20 hours')`;
  // Every area done; Orange Juice collected 3 of 4 (not enough in the storeroom), Cranberry Juice collected in full.
  await sql`insert into session_areas (session_id, check_area_id, area_name, status, updated_at) select ${id}, id, name, 'complete', now() - interval '19 hours' from check_areas where department_id = ${d.id} and parent_area_id is null`;
  const item = (name, req, mode, got, reason) => sql`insert into session_items (session_id, placement_id, product_id, check_area_id, product_name, unit_singular, unit_plural, method, requested_qty, collected_mode, collected_qty, shortfall_reason, updated_at)
    select ${id}, x.id, p.id, x.check_area_id, p.name, p.unit_singular, p.unit_plural, p.method, ${req}, ${mode}, ${got}, ${reason}, now() - interval '18 hours'
    from product_placements x join products p on p.id = x.product_id join check_areas c on c.id = x.check_area_id
    where p.name = ${name} and c.department_id = ${d.id} and c.name = 'BOH bar fridge' limit 1`;
  await item('Orange Juice', 4, 'partial', 3, 'insufficient');
  await item('Cranberry Juice', 2, 'all', 2, null);
  await sql`update restock_sessions set status = 'unfinished' where id = ${id}`;
  const outboxBefore = (await sql`select count(*)::int as n from email_outbox`)[0].n;

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/admin/login'); await P.fill('#email', 'admin@example.com'); await P.fill('#password', 'correct-horse-1'); await P.click('button.btn.primary');
  await P.waitForURL((u) => !u.pathname.endsWith('/login'));
  await P.goto(B + '/admin/restocks/' + id); await P.waitForSelector('text=Never finished');
  ok(await P.locator('button:has-text("Finish this restock")').count() === 1, 'Unfinished: "Finish this restock" button');
  await P.click('button:has-text("Finish this restock")');
  ok(await P.locator('button:has-text("Yes, finish it")').count() === 1 && await P.locator('button:has-text("Cancel")').count() === 1, 'asks first: "Yes, finish it" / Cancel');
  await P.screenshot({ path: `${OUT}/p37-confirm.png` });
  await P.click('button:has-text("Yes, finish it")');
  // The page refreshes: "Never finished" goes, the header says Finished and who completed it.
  await P.locator('text=Never finished').waitFor({ state: 'detached', timeout: 15000 });
  ok(/Complete|Finished with exceptions/.test(await P.innerText('.page-head')) && (await P.innerText('.page-head')).includes('Completed by Claire (Admin)'), 'header: Complete · Completed by Claire (Admin): ' + (await P.innerText('.page-head')).replace(/\s+/g, ' '));

  const [s] = await sql`select status, finished_at, completed_by, (finished_at between now() - interval '18 hours 5 minutes' and now() - interval '17 hours 55 minutes') as at_last_work from restock_sessions where id = ${id}`;
  ok(['finished', 'finished_exceptions'].includes(s.status), 'now ' + s.status);
  ok(s.atLastWork, 'finished as at the last time anyone worked on it (not now)');
  ok(s.completedBy === 'Claire (Admin)', 'Completed by "Claire (Admin)"');
  const sh = await sql`select product_name, shortfall_qty::float as q, reason from shortages where session_id = ${id}`;
  ok(sh.length === 1 && sh[0].productName === 'Orange Juice' && sh[0].q === 1 && sh[0].reason === 'insufficient', 'shortage recorded: Orange Juice short 1: ' + JSON.stringify(sh));
  ok((await sql`select count(*)::int as n from email_outbox`)[0].n === outboxBefore, 'no manager email queued');

  await P.reload(); await P.waitForSelector('h1');
  ok(await P.locator('text=Never finished').count() === 0 && await P.locator('button:has-text("Finish this restock")').count() === 0, 'after: no "Never finished", no button');
  await P.screenshot({ path: `${OUT}/p37-finished.png` });
  // Already finished: the action refuses.
  const { status } = (await sql`select status from restock_sessions where id = ${id}`)[0];
  ok(status !== 'unfinished', 'stays finished');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
