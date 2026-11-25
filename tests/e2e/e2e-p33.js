// Start over (one area): from the ⋯ menu on the area heading, a sheet says what will be cleared and by whom
// ("2 entries (1 by Mia, 1 by Sam)") and what's kept (already collected); Start over clears it, Undo puts it back,
// and the clear reaches the other device. Gold Class Kitchen, Freezer 1. Two phones.
// Before running: reset the test database. The test applies the Gold Class Kitchen update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const row = (n) => `article.prow:has(h3:text-is('${n}'))`;
const line = (n) => `.line[data-line='${n}']`;
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const qty = (n) => sql`select i.requested_qty::float as q, i.collected_mode as c, i.updated_by as by from session_items i where i.product_name = ${n}`;

async function open(b, name) {
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', name); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('.area-btn');
  await P.click('.area-btn:has-text("Freezer 1")'); await P.waitForSelector('.area-btn.cur:has-text("Freezer 1")'); await P.waitForTimeout(400);
  return P;
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`delete from check_areas where department_id = ${k.id}`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2), ('Dry storage', 4) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact', 'freezer-1-first',
    'no-walk-in-desserts', 'walk-in-third-shelf', 'relish-prep', 'walk-in-fresh-produce', 'bottom-sauce-shelf', 'prep-checklist', 'dry-stock']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);

  const b = await chromium.launch(); const errs = [];
  const M = await open(b, 'Mia'); M.on('pageerror', (e) => errs.push(e.message));
  ok(await M.locator('.so-end').count() === 0, 'nothing entered here yet: no Start over');
  // Mia: patties and 7" bases; Sam (another phone): gluten-free bases.
  await M.click(`${row('Beef Patties')} button.padd`); await M.click(`${row('7" Pizza Bases')} button.padd`);
  await waitDb(() => qty('7" Pizza Bases'), (r) => r[0]?.q === 1);
  const S = await open(b, 'Sam'); S.on('pageerror', (e) => errs.push(e.message));
  await S.click(`${row('Gluten-Free Pizza Bases')} button.padd`);
  await waitDb(() => qty('Gluten-Free Pizza Bases'), (r) => r[0]?.q === 1);
  // The patties are collected already (downstairs list).
  await M.click('.rbar .stage:has-text("Collect")'); await M.waitForSelector(line('Beef Patties'));
  await M.click(`${line('Beef Patties')} .l-all`); await waitDb(() => qty('Beef Patties'), (r) => r[0]?.c === 'all');
  await M.click('.rbar .stage:has-text("Check")'); await M.click('.area-btn:has-text("Freezer 1")'); await M.waitForTimeout(1500);
  await M.reload(); await M.waitForSelector('.area-btn.cur:has-text("Freezer 1")'); await M.waitForTimeout(1500);

  // Start over: what's cleared (by whom) and what's kept.
  ok(await M.locator('.so-end').isVisible(), 'phone: "Start over" at the end of the list (no area heading on a phone)');
  await M.click('.so-end');
  const txt = (await M.locator('.sheet').innerText()).replace(/\s+/g, ' ');
  ok(txt.includes('Clears what’s entered in Freezer 1: 2 entries (1 by Mia, 1 by Sam)'), 'sheet: "Clears what’s entered in Freezer 1: 2 entries (1 by Mia, 1 by Sam)": ' + txt);
  ok(txt.includes('Kept: 1 already collected or pulled') && txt.includes('undo it straight after'), 'sheet: the collected patties kept; undo offered');
  await M.waitForTimeout(500); await M.screenshot({ path: `${OUT}/p33-sheet.png` });
  await M.click('.sheet .so-go');
  await M.waitForSelector(`${row('Gluten-Free Pizza Bases')} button.padd`, { timeout: 6000 }).catch(() => {});
  ok(await M.locator(`${row('7" Pizza Bases')} button.padd`).count() === 1 && await M.locator(`${row('Gluten-Free Pizza Bases')} button.padd`).count() === 1, 'cleared: both back to + Add');
  ok(await M.locator('.so-toast').innerText().then((t) => t.includes('Freezer 1 started over')), 'toast: "Freezer 1 started over · Undo"');
  // Undo puts it all back.
  await M.click('.so-toast .so-undo'); await M.waitForSelector(`${row('Gluten-Free Pizza Bases')} .qty-input`, { timeout: 6000 }).catch(() => {});
  ok(await M.locator(`${row('7" Pizza Bases')} .qty-input`).count() === 1 && await M.locator(`${row('Gluten-Free Pizza Bases')} .qty-input`).count() === 1, 'Undo: both entries back');
  // For real this time: it reaches the server and the other phone.
  await M.click('.so-end'); await M.click('.sheet .so-go');
  const gf = await waitDb(() => qty('Gluten-Free Pizza Bases'), (r) => r[0]?.q === null);
  ok(gf[0]?.q === null && (await qty('7" Pizza Bases'))[0]?.q === null, 'saved: both cleared on the server');
  const pat = await qty('Beef Patties');
  ok(pat[0]?.q === 2 || pat[0]?.c === 'all', 'the collected patties untouched');
  await S.reload(); await S.waitForSelector('.area-btn'); await S.click('.area-btn:has-text("Freezer 1")'); await S.waitForTimeout(1500);
  ok(await S.locator(`${row('Gluten-Free Pizza Bases')} button.padd`).count() === 1, 'Sam’s phone: cleared there too');
  // iPad / laptop: the ⋯ menu on the area heading.
  const L = await (await b.newContext({ viewport: { width: 1180, height: 820 } })).newPage(); L.on('pageerror', (e) => errs.push(e.message));
  await L.goto(B + '/'); await L.waitForSelector('.dcard2'); await L.click('.who'); await L.fill('#staffname', 'Jo'); await L.click('.sheet .btn.primary');
  await L.click('.dcard2:has-text("Kitchen") >> nth=0'); await L.click('.type-full button.btn.primary'); await L.waitForSelector('.area-btn');
  await L.click('.area-btn:has-text("Freezer 1")'); await L.waitForTimeout(800);
  ok(await L.locator('.area-head .amenu-btn').isVisible() && await L.locator('.so-end').isHidden(), 'iPad: ⋯ on the area heading (Start over inside), not at the end');
  await L.click('.area-head .amenu-btn'); ok((await L.locator('.amenu-pop .so-item').innerText()).trim() === 'Start over', 'menu: "Start over"');
  await L.screenshot({ path: `${OUT}/p33-menu.png` });
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
