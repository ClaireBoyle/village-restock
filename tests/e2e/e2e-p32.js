// Gold Class Kitchen Defrost, for a quick close: only what's needed is entered (blank = not needed, no need to touch
// the rest), then "All pulled" per compartment or for everything, in one tap; the footer then says nothing is left
// to pull upstairs and the main button carries on. Phone.
// Before running: reset the test database. The test applies the Gold Class Kitchen update scripts.
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const OUT = process.env.E2E_OUT || 'tests/e2e/out';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const row = (n) => `article.dline:has(h3:text-is('${n}'))`;
const pline = (n) => `.dp-line[data-line='${n}']`;
const primary = async (P) => (await P.locator('.dock .dock-acts .btn.primary').innerText()).replace(/\s+/g, ' ').trim();
const waitText = async (P, sel, want, ms = 6000) => { const end = Date.now() + ms; for (;;) { const t = (await P.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' '); if (t.includes(want) || Date.now() > end) return t; await P.waitForTimeout(150); } };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const [k] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  await sql`delete from check_areas where department_id = ${k.id}`;
  await sql`insert into storage_locations (name, sort_order) values ('Walk in freezer(Downstairs)', 3), ('Walk in fridge(Downstairs)', 2), ('Dry storage', 4) on conflict do nothing`;
  for (const f of ['defrost', 'upstairs-areas', 'defrost-pulls', 'freezers', 'walk-in-and-prep', 'walk-in-shelves', 'refills', 'portion-prep', 'defrost-compact', 'freezer-1-first',
    'no-walk-in-desserts', 'walk-in-third-shelf', 'relish-prep', 'walk-in-fresh-produce', 'bottom-sauce-shelf', 'prep-checklist', 'dry-stock', 'defrost-checks']) await sql.file(`db/updates/2026-11-gold-class-kitchen-${f}.sql`);

  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.who'); await P.fill('#staffname', 'Mia'); await P.click('.sheet .btn.primary');
  await P.click('.dcard2:has-text("Kitchen") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('.dline');
  ok(await P.locator('.area .aguide-line, .area .aguide').first().innerText().then((t) => t.includes('Blank means not needed')), 'says it: enter only what needs defrosting, blank means not needed');

  // Three things to defrost, two compartments: one tap each (+), nothing else touched.
  for (const n of ['Pulled Beef (Bao)', '9" Pizza Bases', 'Bao Buns']) { await P.click(`${row(n)} button[aria-label^="One more"]`); await P.waitForTimeout(250); }
  ok((await waitText(P, '.dock .dr-progress', '3 upstairs to pull')).includes('3 of 16 reviewed · 3 upstairs to pull'), 'footer: "3 of 16 reviewed · 3 upstairs to pull"');
  ok(/To pull \(3\)|View upstairs items to pull \(3\)/.test(await primary(P)), 'main button: to the pull list (3)');
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForTimeout(600);
  ok(await P.locator('.dp-all').innerText().then((t) => t.includes('All pulled (3)')), '"All pulled (3)"');
  const g = await P.$$eval('.dpull .grab-group h4', (e) => e.map((x) => x.childNodes[0].textContent.trim()));
  ok(g.join('|') === 'Freezer 1 · Lower left|Freezer 1 · Lower right', 'two compartments, in walking order: ' + g.join(', '));
  // One compartment at a time…
  await P.click('.dpull .grab-group:has(h4:has-text("Lower left")) .dp-all-g');
  ok((await waitText(P, '.dpull .sec-title small', '2 of 3')).includes('2 of 3 pulled') && await P.locator(`${pline('Pulled Beef (Bao)')}.s-ok`).count() === 1 && await P.locator(`${pline('9" Pizza Bases')}.s-ok`).count() === 1,
    'Lower left "All pulled": both there pulled, one tap');
  ok(await P.locator('.dp-all').count() === 0, 'one left: just its own Pulled (no "All pulled" for one)');
  await P.click(`${pline('Bao Buns')} .dp-ok`);
  ok((await waitText(P, '.dock .dr-progress', 'nothing upstairs')).includes('nothing upstairs to pull') && (await primary(P)).includes('Continue'), 'all pulled: "nothing upstairs to pull", Continue');
  // …or everything at once (undo and redo).
  for (const n of ['Pulled Beef (Bao)', '9" Pizza Bases', 'Bao Buns']) await P.click(`${pline(n)} .linkbtn:has-text("Undo")`);
  await P.waitForSelector('.dp-all'); await P.click('.dp-all');
  ok((await waitText(P, '.dpull .sec-title small', '3 of 3')).includes('3 of 3 pulled'), '"All pulled (3)": all three in one tap');
  const saved = await (async () => { const end = Date.now() + 15000; for (;;) { const r = await sql`select count(*)::int as n from session_items where upstairs_qty > 0`; if (r[0].n === 3 || Date.now() > end) return r[0].n; await new Promise((res) => setTimeout(res, 300)); } })();
  ok(saved === 3, 'saved: 3 pulled');
  await P.screenshot({ path: `${OUT}/p32-all-pulled.png`, fullPage: true });
  // Carry on: the rest left blank is fine (not needed), no "go back" prompt.
  await P.click('.dock .dock-acts .btn.primary'); await P.waitForSelector('.area-btn.cur:has-text("Freezer 1")');
  ok(true, 'Continue → Freezer 1 with 13 rows left blank');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
