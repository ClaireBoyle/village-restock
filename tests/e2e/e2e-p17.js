// Gold Class Bar, a night where nothing is needed: "Checked · nothing needed" vs "Unchecked", the empty-list
// wording while checks are pending, upstairs spots with nothing to grab, and straight to sign-off.
// Before running: reset the test database, then load gcbar-refill-fixture.sql. The test applies the update script.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const sees = (P, sel, t, ms = 6000) => P.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: ms }).then(() => true, () => false);
const primary = (P) => P.locator('.dock .dock-acts .btn.primary');
const primaryText = async (P) => (await primary(P).innerText()).replace(/\s+/g, ' ').trim();

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await sql.file('db/updates/2026-11-gold-class-bar-refill-foh.sql');
  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');

  ok(await sees(P, '.area-btn', 'Unchecked') && await P.locator('.area-btn:has-text("Checked · nothing needed")').count() === 0, 'to start: every area "Unchecked"');
  ok(await sees(P, '.dock', 'Nothing added to the collection list'), 'bottom bar: "Nothing added to the collection list"');
  // The downstairs list while checks are pending: not "everything is at target".
  await P.click('.rbar .stage:has-text("Collect")'); await P.waitForSelector('.empty');
  ok(await sees(P, '.empty', 'Nothing added to the collection list yet') && !(await P.textContent('main')).includes('at target'), 'empty list while checks pending: "Nothing added to the collection list yet"');
  await P.click('.rbar .stage:has-text("FOH")'); await P.waitForSelector('article.prow');

  // Done through the bar with nothing entered.
  const bar = await P.$$eval('.area-btn b', (e) => e.map((x) => x.textContent));
  for (let i = 0; i < bar.length; i++) {
    const t = await primaryText(P);
    ok(t === `Done → ${i < bar.length - 1 ? bar[i + 1] : 'BOH'}`, `${bar[i]}: "${t}"`);
    if (i === 0) {
      await primary(P).click(); await P.waitForSelector(`.area-btn.cur:has-text("${bar[1]}")`);
      ok(await sees(P, `.area-btn:has-text("${bar[0]}")`, 'Checked · nothing needed') && await sees(P, `.area-btn:has-text("${bar[2]}")`, 'Unchecked'),
        `"${bar[0]}: Checked · nothing needed" while "${bar[2]}" is still "Unchecked"`);
      await P.screenshot({ path: `${OUT}/p17-checked-unchecked.png` });
      continue;
    }
    await primary(P).click(); await P.waitForTimeout(250);
  }
  // Upstairs: nothing to grab, so each spot is just the top-up check.
  await P.waitForSelector('.area-btn.cur:has-text("BOH bar fridge")');
  ok(await P.locator('.grab').count() === 0 && await sees(P, '.bring-h', 'Bring up from downstairs'), 'nothing to grab: straight to "Bring up from downstairs"');
  await primary(P).click(); await P.waitForSelector('.area-btn.cur:has-text("Walk in fridge")');
  await primary(P).click(); await P.waitForSelector('.area-btn.cur:has-text("Upstairs cupboards")');
  ok(await primaryText(P) === 'Done → Finish', 'nothing on the downstairs list: "Done → Finish"');
  await primary(P).click(); await P.waitForSelector('.finish-title');
  ok(await P.locator('#completed-by').count() === 1, 'straight to sign-off (Completed by)');
  await P.click('.dock button.good:has-text("Finish restock")'); await P.waitForSelector('.finish-hero');
  let s; for (let k = 0; k < 60; k++) { [s] = await sql`select status from restock_sessions where kind = 'full'`; if (s?.status === 'finished') break; await new Promise((r) => setTimeout(r, 300)); }
  ok(s?.status === 'finished', 'finished with nothing collected');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
