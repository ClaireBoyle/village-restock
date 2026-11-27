// Finish screen, Gold Class Bar and Kitchen: "Short last night", folded until opened. What the previous full restock
// finished short of (storeroom shortages, not "Not sure"), and where each stands tonight:
//   Grey Goose     out last night, short again tonight   → "Still … tonight" (first)
//   Vanilla Syrup  out last night, not entered tonight   → "Not on tonight's list: check if it's back in stock"
//   Red Claw       out last night, entered, not collected → "On tonight's list, not collected yet"
//   Patron Silver  low last night, collected tonight      → "Restocked tonight" (last)
//   Heineken       "Not sure" last night                  → left out
//   Curatif        short at an older full restock only   → left out (only the most recent full restock counts)
// Candy Bar: not shown. Phone.
// Before running: reset the test database, then load gcbar-refill-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const crypto = require('crypto');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const line = (n) => `.line[data-line="${n}"]`;
const gone = (P, sel, ms = 6000) => P.locator(sel).first().waitFor({ state: 'detached', timeout: ms }).then(() => true, () => false);
const text = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const label = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

async function quick(P, dept, picks) {
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click(`.dcard2:has-text("${dept}") >> nth=0`); await P.click('text=Start stock top-up'); await P.waitForSelector('#qsearch');
  for (const [n, q] of picks) {
    await P.fill('#qsearch', n); await P.waitForTimeout(250);
    await P.fill(`.qpanel .qrow:has(b:text-is("${n}")) .q-num >> nth=0`, String(q)); await P.waitForSelector(`.picked .qrow:has-text("${n}")`);
  }
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.rooms');
}
const toFinish = async (P) => { await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.finish-title'); await P.waitForTimeout(1200); };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const dept = async (name) => (await sql`select id from departments where name = ${name}`)[0].id;
  const bar = await dept('Gold Class Bar'), candy = await dept('Candy Bar');
  const prevFull = async (d, n, list) => {
    const id = crypto.randomUUID();
    await sql`insert into restock_sessions (id, department_id, kind, trading_date, status, people, started_at, finished_at)
      values (${id}, ${d}, 'full', ${day(n)}, 'finished', '{Sam}', now() - ${`${n} days`}::interval, now() - ${`${n} days`}::interval + interval '2 hours')`;
    for (const [name, st] of list) {
      await sql`insert into shortages (session_id, department_id, product_id, product_name, unit_plural, shortfall_qty, reason, status, stock_status)
        select ${id}, ${d}, p.id, p.name, p.unit_plural, 2, 'insufficient', 'open', ${st} from products p where p.name = ${name} and p.department_id = ${d}`;
    }
  };
  await prevFull(bar, 3, [['Curatif Negroni', 'out']]);
  await prevFull(bar, 1, [['Grey Goose', 'out'], ['Patron Silver', 'low'], ['Red Claw Shiraz', 'out'], ['Vanilla Syrup', 'out'], ['Heineken', 'unconfirmed']]);
  await prevFull(candy, 1, [['Maltesers', 'out']]);

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');

  // Gold Class Bar: Grey Goose short again, Patron collected, Red Claw left to collect.
  await quick(P, 'Bar', [['Grey Goose', 1], ['Patron Silver', 1], ['Red Claw Shiraz', 2]]);
  await P.click(`${line('Patron Silver')} .l-all`);
  await P.click(`${line('Grey Goose')} .l-few`); await P.waitForSelector(`${line('Grey Goose')} .fewer`);
  await P.click(`${line('Grey Goose')} .fw-ok`); await gone(P, `${line('Grey Goose')} .fewer`);
  await toFinish(P);
  await P.waitForSelector('.lastnight', { timeout: 8000 });
  ok((await text(P, '.ln-h')).startsWith('Short last night') && (await text(P, '.ln-h')).includes(`${label(day(1))} · 4 items`), `"Short last night · ${label(day(1))} · 4 items": ` + await text(P, '.ln-h'));
  ok(await P.locator('.ln-list').count() === 0 && await P.locator('.ln-h[aria-expanded="false"]').count() === 1, 'folded until opened');
  await P.click('.ln-h');
  const rows = await P.$$eval('.ln-row', (e) => e.map((x) => [x.dataset.last, x.querySelector('small').textContent.replace(/\s+/g, ' ').trim()]));
  ok(JSON.stringify(rows.map((r) => r[0])) === JSON.stringify(['Grey Goose', 'Vanilla Syrup', 'Red Claw Shiraz', 'Patron Silver']), 'still short first, restocked last: ' + rows.map((r) => r[0]).join(', '));
  const said = Object.fromEntries(rows);
  ok(/^Out last night · Still (out|short) tonight$/.test(said['Grey Goose']), 'Grey Goose: ' + said['Grey Goose']);
  ok(said['Vanilla Syrup'] === 'Out last night · Not on tonight’s list: check if it’s back in stock', 'Vanilla Syrup: ' + said['Vanilla Syrup']);
  ok(said['Red Claw Shiraz'] === 'Out last night · On tonight’s list, not collected yet', 'Red Claw: ' + said['Red Claw Shiraz']);
  ok(said['Patron Silver'] === 'Low last night · Restocked tonight', 'Patron: ' + said['Patron Silver']);
  ok(!rows.some((r) => /Heineken|Curatif/.test(r[0])), '"Not sure" and older restocks left out');
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no sideways scrolling');
  await P.locator('.lastnight').scrollIntoViewIfNeeded();
  await P.screenshot({ path: `${OUT}/p35-bar.png`, fullPage: true });
  await P.click('.ln-h'); ok(await P.locator('.ln-list').count() === 0, 'tap again: folded');

  // Candy Bar: not shown (even with shortages the night before).
  await P.click('.dock .save-exit'); await P.waitForTimeout(500);
  await quick(P, 'Candy Bar', [['Maltesers', 2]]);
  await P.click(`${line('Maltesers')} .l-all`); await toFinish(P);
  ok(await P.locator('.lastnight').count() === 0, 'Candy Bar: no "Short last night"');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
