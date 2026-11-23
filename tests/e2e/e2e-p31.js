// Finish screen: shortages already on the stock board (short at an earlier restock, not collected in full since,
// not resolved by a manager) say "Already on the board · short since …", and the heading counts what's new.
//   Maltesers: short 2 days ago and yesterday → "Already on the board · short since <2 days ago>".
//   Kit Kat: short 2 days ago, then collected in full yesterday → new.
//   Twix: short yesterday but resolved by a manager → new.
// Before running: reset the test database, then load candy-fixture.sql and candy-area-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const crypto = require('crypto');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const gone = (P, sel, ms = 6000) => P.locator(sel).first().waitFor({ state: 'detached', timeout: ms }).then(() => true, () => false);
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const card = (n) => `.acard:has(h2:text-is("${n}"))`;
const add = async (P, n, qty) => { await P.click(`${row(n)} button.padd`); for (let k = 1; k < qty; k++) await P.click(`${row(n)} button[aria-label="One more ${n}"]`); };
const fewer = async (P, n, got) => {
  await P.click(`${line(n)} .l-few`); await P.waitForSelector(`${line(n)} .fewer`);
  if (got) await P.fill(`${line(n)} .fewer .qty-input`, String(got));
  await P.click(`${line(n)} .fw-ok`); await gone(P, `${line(n)} .fewer`);
};
const text = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const day = (n) => { const d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 10); };
const label = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql.file('db/updates/2026-11-candy-bar-dry-storage.sql');
  const [d] = await sql`select id from departments where name = 'Candy Bar'`;
  // Two earlier finished quick restocks: 2 days ago and yesterday.
  const s1 = crypto.randomUUID(), s2 = crypto.randomUUID();
  for (const [id, n] of [[s1, 2], [s2, 1]]) {
    await sql`insert into restock_sessions (id, department_id, kind, trading_date, status, people, started_at, finished_at)
      values (${id}, ${d.id}, 'quick', ${day(n)}, 'finished', '{Sam}', now() - ${`${n} days`}::interval, now() - ${`${n} days`}::interval + interval '1 hour')`;
  }
  const short = (sid, name, status = 'open') => sql`insert into shortages (session_id, department_id, product_id, product_name, unit_plural, shortfall_qty, reason, status)
    select ${sid}, ${d.id}, p.id, p.name, p.unit_plural, 2, 'insufficient', ${status} from products p where p.name = ${name} and p.department_id = ${d.id}`;
  await short(s1, 'Maltesers'); await short(s2, 'Maltesers');
  await short(s1, 'Kit Kat');
  await short(s2, 'Twix', 'resolved');
  // Kit Kat collected in full yesterday.
  await sql`insert into session_items (session_id, placement_id, product_id, check_area_id, product_name, unit_singular, unit_plural, method, requested_qty, collected_mode, collected_qty)
    select ${s2}, x.id, p.id, x.check_area_id, p.name, p.unit_singular, p.unit_plural, p.method, 3, 'all', 3
    from product_placements x join products p on p.id = x.product_id join check_areas c on c.id = x.check_area_id
    where p.name = 'Kit Kat' and p.department_id = ${d.id} limit 1`;

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Ana'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Candy Bar")'); await P.waitForSelector('.acard');
  await P.click(`${card('Confection stand')} button:has-text("Start")`); await P.waitForSelector('article.prow');
  await add(P, 'Maltesers', 4); await add(P, 'Kit Kat', 3); await add(P, 'Twix', 2);
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  await fewer(P, 'Maltesers', 0); await fewer(P, 'Kit Kat', 1); await fewer(P, 'Twix', 0);
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.sreport');
  await P.waitForSelector('.sr-row.on-board', { timeout: 8000 }).catch(() => {});

  ok((await text(P, `.sr-row[data-outcome="Maltesers"] .sr-board`)) === `Already on the board · short since ${label(day(2))}`, `Maltesers: "Already on the board · short since ${label(day(2))}"`);
  ok(await P.locator('.sr-row[data-outcome="Kit Kat"] .sr-board').count() === 0, 'Kit Kat: collected in full since, so new');
  ok(await P.locator('.sr-row[data-outcome="Twix"] .sr-board').count() === 0, 'Twix: resolved by a manager, so new');
  ok((await text(P, '#sr-short .sr-new')) === '2 new · 1 already on the board', 'heading: "2 new · 1 already on the board"');
  await P.screenshot({ path: `${OUT}/p31-finish.png`, fullPage: true });

  // The API leaves out the restock being finished.
  let cur; for (let k = 0; k < 50 && !cur; k++) { [cur] = await sql`select id from restock_sessions where department_id = ${d.id} and id not in (${s1}, ${s2}) order by started_at desc limit 1`; if (!cur) await P.waitForTimeout(300); }
  const api = await (await fetch(`${B}/api/shortages/board?dept=${d.id}&session=${cur.id}`)).json();
  ok(JSON.stringify(api.items.map((i) => [i.productName, i.since, i.last])) === JSON.stringify([['Maltesers', day(2), day(1)]]), 'API: only Maltesers, since 2 days ago: ' + JSON.stringify(api.items));
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
