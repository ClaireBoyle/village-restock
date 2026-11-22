// Gold Class Kitchen: one next action through every area, like the bar. Defrost "Continue → Freezer 1", then
// "Done → <next area>" on each (counts first where a target needs one), and only after Dry stock the collection
// list (or Finish when nothing is on it). No jumping straight to the collection list from an area.
// Before running: reset the test database. The test applies the Gold Class Kitchen update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const primary = (P) => P.locator('.dock .dock-acts .btn.primary');
const primaryText = async (P) => (await primary(P).innerText()).replace(/\s+/g, ' ').trim();
const cur = (P) => P.locator('.area-btn.cur b').innerText();

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`delete from check_areas where department_id = ${k.id}`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2), ('Dry storage', 4) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact', 'freezer-1-first',
    'no-walk-in-desserts', 'walk-in-third-shelf', 'relish-prep', 'walk-in-fresh-produce', 'bottom-sauce-shelf', 'prep-checklist', 'dry-stock']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('.area-btn.cur');
  const areas = await P.$$eval('.area-btn b', (e) => e.map((x) => x.textContent));
  ok(areas.join(' → ') === 'Defrost → Freezer 1 → Freezer 2 → Chest freezer → Walk in fridge → Dry stock', 'areas: ' + areas.join(' → '));

  // Defrost: Continue → Freezer 1 (nothing set: that's fine).
  ok(await primaryText(P) === 'Continue → Freezer 1', 'Defrost: "Continue → Freezer 1"');
  await primary(P).click(); await P.waitForSelector('.area-btn.cur:has-text("Freezer 1")');
  ok(await cur(P) === 'Freezer 1', 'Continue: on to Freezer 1');

  const seen = ['Defrost'];
  for (let n = 0; n < 12; n++) {
    const here = await cur(P); const t = await primaryText(P);
    if (/^Count \d+ left/.test(t)) {
      // Target-level products (e.g. the ice creams): counted first, like the bar.
      ok(true, `${here}: "${t}" before moving on`);
      for (const r of await P.locator('article.prow.m-par button.pquick:not(.on)').all()) { await r.click(); await P.waitForTimeout(150); }
      await P.waitForTimeout(300); continue;
    }
    const m = t.match(/^Done → (.+)$/);
    ok(!!m || seen.length === areas.length, `${here}: "${t}"`);
    if (!m) break;
    seen.push(here);
    await primary(P).click(); await P.waitForTimeout(400);
    if (!areas.includes(m[1])) break;
    await P.waitForSelector(`.area-btn.cur:has-text("${m[1]}")`);
  }
  ok(seen.join(' → ') === areas.join(' → '), 'walked every area in order with the one button: ' + seen.join(' → '));
  ok(await P.locator('.finish-title, .line, .empty').first().waitFor({ timeout: 6000 }).then(() => true, () => false), 'after Dry stock: on to the next step (collection list or Finish), never before');
  await P.screenshot({ path: `${OUT}/p24-after-walk.png` });
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
