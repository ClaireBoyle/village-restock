// Opening a full restock isn't starting it: home and the department page say "Not started" (Start, not Resume; no
// names or "since" time) until something is entered. Then "In progress" as before. Gold Class Bar, phone.
// Before running: reset the test database, then load gcbar-refill-fixture.sql.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const text = async (P, sel) => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const lane = '.lane:has-text("Bar"):not(:has-text("Candy")):not(:has-text("Kitchen"))';

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');

  // Open the full restock, enter nothing, go back.
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.waitForSelector('.type-full');
  await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');
  const [d] = await sql`select id from departments where name = 'Gold Class Bar'`;
  for (let k = 0; k < 30; k++) { const [s] = await sql`select id from restock_sessions where department_id = ${d.id} and kind = 'full'`; if (s) break; await P.waitForTimeout(300); }
  await P.goto(B + '/'); await P.waitForSelector(lane);
  ok((await text(P, lane)).includes('Not started') && !(await text(P, lane)).includes('Mia') && !(await text(P, lane)).includes('since'), 'home: opened but nothing entered → "Not started" (no name, no time): ' + await text(P, lane));
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.waitForSelector('.type-full');
  ok(await P.locator('.type-full .badge:has-text("Not started tonight")').count() === 1 && /^Start (full|closing) restock/.test(await text(P, '.type-full button.btn.primary')), 'department page: "Not started tonight", "Start full restock"');
  ok(!(await text(P, '.dhero')).includes('in progress') && await P.locator('.type-full .apills').count() === 0, 'no "Full restock in progress", no area pills');
  await P.screenshot({ path: `${OUT}/p36-not-started.png` });

  // Enter one thing: now it's started.
  await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');
  await P.click('article.prow button.padd >> nth=0'); await P.waitForTimeout(600);
  await P.goto(B + '/'); await P.waitForSelector(lane);
  ok((await text(P, lane)).includes('In progress') && (await text(P, lane)).includes('Mia'), 'home: one item entered → "In progress · Mia": ' + await text(P, lane));
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.waitForSelector('.type-full');
  ok(await P.locator('.type-full .badge:has-text("In progress since")').count() === 1 && /^Resume (full|closing) restock/.test(await text(P, '.type-full button.btn.primary')), 'department page: "In progress since …", "Resume full restock"');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
