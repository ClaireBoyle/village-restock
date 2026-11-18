// "Completed by" on the Finish screen, and finished states on the Home screen.
// Before running: reset the test database, then load candy-fixture.sql and candy-area-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const crypto = require('crypto');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 8000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
const line = (n) => `.line[data-line="${n}"]`;
const card = (n) => `.acard:has(h2:text-is("${n}"))`;
const lane = (n) => `.lane:has(.ln-name b:text-is("${n}"))`;
const dcard = (n) => `.dcard2:has(.dc2-name:text-is("${n}"))`;
const outlined = (P, sel) => P.$eval(sel, (e) => { const cs = getComputedStyle(e); return cs.outlineStyle === 'solid' && parseFloat(cs.outlineWidth) > 0 && parseFloat(cs.outlineWidth) <= 2; });
const colour = (P, sel) => P.$eval(sel, (e) => getComputedStyle(e).color);
const fewer = async (P, n, total, got) => {
  await P.click(`${line(n)} .l-few`); await P.waitForSelector(`${line(n)} .fewer`);
  for (let k = total - 1; k > got; k--) await P.click(`${line(n)} button[aria-label="One less"]`);
  await P.click(`${line(n)} .fw-ok`); await P.locator(`${line(n)} .fewer`).waitFor({ state: 'detached' });
};

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ ...devices['iPhone 13'] }); const P = await c.newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');

  // 1. Confection stand: nothing short. "Completed by" is there anyway, prefilled with the run's name.
  await P.click('.dcard2:has-text("Candy Bar")'); await P.waitForSelector('.acard');
  await P.click(`${card('Confection stand')} button:has-text("Start")`); await P.waitForSelector('article.prow');
  await P.click(`${row('Kit Kat')} button.padd`);
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  await P.click(`${line('Kit Kat')} button.l-all`);
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  ok(await P.locator('.sreport').count() === 0 && await P.inputValue('#completed-by') === 'Mia', 'no shortages: "Completed by" still shown, prefilled with "Mia"');
  // Leaving the run in progress keeps an edited name.
  await P.fill('#completed-by', 'Mia R'); await P.waitForTimeout(600);
  await P.click('.dock button[aria-label="Save and exit"]'); await P.waitForSelector('.acard');
  await P.click(`${card('Confection stand')} button:has-text("Resume")`); await P.waitForSelector('article.prow');
  await P.click('.rbar .stage:has-text("Finish")'); await P.waitForSelector('.finish-title');
  ok(await P.inputValue('#completed-by') === 'Mia R', 'left in progress and resumed: the edited name is kept');
  await P.screenshot({ path: `${OUT}/p16-completed-by.png` });
  await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');
  ok(await sees(P, '.finish-hero', 'Completed by Mia R'), 'finished: "Completed by Mia R" on the record');
  const [s1] = await waitDb(() => sql`select completed_by from restock_sessions where area_name = 'Confection stand'`, (r) => r[0]?.completedBy === 'Mia R');
  ok(s1?.completedBy === 'Mia R', 'saved on the server');

  // 2. The next run starts with the run's name again, not the last one typed.
  await P.click('.dock button:has-text("Back to Candy Bar")'); await P.waitForSelector('.acard');
  await P.click(`${card('FOH drinks fridge')} button:has-text("Start")`); await P.waitForSelector('article.prow');
  const drinks = await P.locator('article.prow h3').allInnerTexts();
  for (const n of drinks.slice(0, 2)) { await P.click(`${row(n)} button.padd`); await P.click(`${row(n)} button[aria-label="One more ${n}"]`); }
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  for (const n of drinks.slice(0, 2)) await fewer(P, n, 2, 1);
  await P.click('.dock .dock-acts button:has-text("Review")'); await P.waitForSelector('.finish-title');
  ok(await P.inputValue('#completed-by') === 'Mia', 'next run: the field starts fresh with the run\'s name ("Mia", not "Mia R")');
  // 3. Saving while offline: the name is kept on the record and uploads later.
  await P.fill('#completed-by', 'Sam');
  await c.setOffline(true);
  await P.click('.dock button.good'); await P.waitForSelector('.finish-hero');
  ok(await sees(P, '.finish-hero', 'Completed by Sam'), 'finished offline: "Completed by Sam" kept on this device');
  await c.setOffline(false);
  const [s2] = await waitDb(() => sql`select completed_by from restock_sessions where area_name = 'FOH drinks fridge'`, (r) => r[0]?.completedBy === 'Sam', 40000);
  ok(s2?.completedBy === 'Sam', '...and uploaded once back online');

  // 4. Home: a clean finished department "✓ Stocked" with a thin green outline; one with shortages in amber.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 5 * 3600e3));
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`insert into restock_sessions (id, department_id, kind, trading_date, started_at, finished_at, status, people)
    values (${crypto.randomUUID()}, ${k.id}, 'full', ${day}, now() - interval '1 hour', now(), 'finished', ${['Jo']})`;
  await P.goto(B + '/'); await P.waitForSelector(lane('Candy Bar'));
  ok(await sees(P, `${lane('Kitchen')} .fin-label`, '✓ Stocked') && await outlined(P, lane('Kitchen')), 'Home: Kitchen finished clean: "✓ Stocked", thin green outline');
  ok(await sees(P, `${lane('Candy Bar')} .fin-label`, '✓ Done · 2 shortages') && await outlined(P, lane('Candy Bar')), 'Home: Candy Bar finished with 2 shortages: "✓ Done · 2 shortages"');
  const ok1 = await colour(P, `${lane('Kitchen')} .fin-label`), warn1 = await colour(P, `${lane('Candy Bar')} .fin-label`);
  ok(ok1 !== warn1 && /246|242|194/.test(warn1), `shortages in amber (${warn1}), stocked in green (${ok1})`);
  ok(await sees(P, `${dcard('Candy Bar')} .fin-label`, '✓ Done · 2 shortages') && await sees(P, `${dcard('Kitchen')} .fin-label`, '✓ Stocked'), 'department cards say the same');
  ok(await sees(P, lane('Candy Bar'), 'FOH drinks fridge ✓') && await sees(P, lane('Candy Bar'), '2 short'), 'Candy Bar line shows which area had the shortages');
  ok(!(await P.$eval(lane('Gold Class Bar').replace('Gold Class Bar', 'Bar'), (e) => e.classList.contains('fin')).catch(() => false)), 'a department not finished has no outline');
  await P.screenshot({ path: `${OUT}/p16-home.png`, fullPage: true });
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
