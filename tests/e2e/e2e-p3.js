// Phase 3: clashing counts between two devices, supervisor screens, overnight roll-over.
const { chromium } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100', out = __dirname + '/out/';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
// Staff-entered products start as "+ Add": tap it first, then type the amount.
const fillQty = async (pg, rowSel, v) => { if (await pg.$(`${rowSel} button.padd`)) { await pg.click(`${rowSel} button.padd`); await pg.waitForSelector(`${rowSel} .qty-input`); } await pg.fill(`${rowSel} .qty-input`, v); };
const card = (name) => `article.card:has(h3:text-is("${name}"))`;
const waitSynced = (p) => p.waitForSelector('.pill.ok:has-text("All changes synced")', { timeout: 20000 });
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const hasText = (p, sel, t, timeout = 10000) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout }).then(() => true, () => false);

(async () => {
  await sql`insert into admins (email, display_name, password_hash) values ('supervisor@example.com', 'Claire', ${await bcrypt.hash('correct-horse-1', 10)})`;
  const b = await chromium.launch();
  const errs = [];
  const device = async (name, staff) => {
    const p = await (await b.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
    p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
    await p.goto(B + '/'); await p.waitForSelector('.dcard2');
    await p.click('.who'); await p.fill('#staffname', staff); await p.click('.sheet .btn.primary');
    return p;
  };
  const A = await device('A', 'Sam');
  await A.click('.dcard2:has-text("Kitchen")'); await A.click('text=Start full restock'); await A.waitForSelector(card('Tomatoes'));
  await waitSynced(A);
  const Bp = await device('B', 'Jess');
  await Bp.click('.dcard2:has-text("Kitchen")'); // Nothing entered on A yet: it still says Start, and joins the same restock.
  await Bp.click('.type-full button:has-text("Start full restock")'); await Bp.waitForSelector(card('Tomatoes'));

  // Same device editing quickly is never a clash
  await fillQty(A, `${card('Lemons')}`, '3');
  await waitDb(() => sql`select current_qty from session_items where product_name = 'Lemons'`, (r) => r[0] && Number(r[0].currentQty) === 3);
  await fillQty(A, `${card('Lemons')}`, '4');
  await waitDb(() => sql`select current_qty from session_items where product_name = 'Lemons'`, (r) => r[0] && Number(r[0].currentQty) === 4);
  const [lem] = await sql`select current_qty, conflict from session_items where product_name = 'Lemons'`;
  ok(Number(lem.currentQty) === 4 && !lem.conflict, 'the same person changing their own count is not a clash');

  // Two people, two different counts for Tomatoes
  await A.route('**/api/**', (r) => r.abort());
  await fillQty(A, `${card('Tomatoes')}`, '5');
  await fillQty(Bp, `${card('Tomatoes')}`, '3');
  await waitDb(() => sql`select current_qty from session_items where product_name = 'Tomatoes'`, (r) => r[0] && Number(r[0].currentQty) === 3);
  await A.unroute('**/api/**'); await A.evaluate(() => window.dispatchEvent(new Event('online')));
  const [tom] = await waitDb(() => sql`select current_qty, conflict, updated_by from session_items where product_name = 'Tomatoes'`, (r) => r[0]?.conflict);
  ok(Number(tom.currentQty) === 3 && tom.conflict && tom.conflict.mine === 5 && tom.conflict.theirs === 3,
    `server kept Jess's 3, recorded Sam's 5 as a clash (nothing overwritten): ${JSON.stringify(tom.conflict)}`);
  ok(await hasText(A, card('Tomatoes'), 'Two different counts'), 'device A shows the clash on the Tomatoes card');
  ok(await hasText(A, card('Tomatoes'), 'Jess'), 'clash card names who entered each count');
  await Bp.evaluate(() => window.dispatchEvent(new Event('online')));
  ok(await hasText(Bp, card('Tomatoes'), 'Two different counts', 30000), 'device B also shows the clash');
  await A.screenshot({ path: out + 'p3-clash.png' });

  // Finish is blocked until someone decides
  await A.click('.stage:has-text("Finish")'); await A.waitForSelector('text=Still to do');
  ok(await hasText(A, '.exlist', 'needs a decision'), 'finish screen lists "1 product needs a decision"');
  await A.click('.stage:has-text("Check stock")'); await A.waitForSelector(card('Tomatoes'));

  // Resolve: Sam recounts and chooses 5
  await A.click(`${card('Tomatoes')} button:has-text("Use 5")`);
  const [tom2] = await waitDb(() => sql`select current_qty, conflict from session_items where product_name = 'Tomatoes'`, (r) => r[0] && !r[0].conflict);
  ok(Number(tom2.currentQty) === 5 && !tom2.conflict, 'choosing "Use 5" saves 5 and clears the clash on the server');
  ok(await hasText(A, `${card('Tomatoes')} .ps`, '3'), 'device A shows collect 3 (8 - 5)');
  await Bp.evaluate(() => window.dispatchEvent(new Event('online')));
  await Bp.waitForFunction(() => !document.body.textContent.includes('Two different counts'), null, { timeout: 30000 });
  ok(true, 'device B picks up the decision and the clash disappears');

  // Finish with a confirmed shortage
  for (const n of ['Cos lettuce', 'Shredded cheese']) await A.click(`${card(n)} button:has-text("Full")`);
  await A.waitForSelector('.banner.s-ok:has-text("Fridge 1 complete")');
  for (const area of ['Fridge 2', 'Freezer 1', 'Dry storage shelf']) {
    await A.click(`.area-btn:has-text("${area}")`); await A.click('.area-head button:has-text("Skip")'); await A.click('.chip:has-text("Not in use tonight")');
    await A.waitForSelector('.banner.s-skip');
  }
  await A.click('.dock button:has-text("Collection list")'); await A.waitForSelector('.line');
  await A.click('.line[data-line="Tomatoes"] button.l-few');
  await A.fill(`.line[data-line="Tomatoes"] .fewer .qty-input`, String(Number(await A.textContent(`.line[data-line="Tomatoes"] .l-amt b`)) - 1));
  await A.click('.line[data-line="Tomatoes"] .fw-ok');
  while (await A.$('.line.todo button.l-all')) { await A.click('.line.todo button.l-all >> nth=0'); await A.waitForTimeout(150); }
  await A.click('.dock button:has-text("Review and finish")'); await A.click('.dock button:has-text("Finish with exceptions")');
  await A.click('#expanel .chip:has-text("Ran out of time before close")'); await A.click('button:has-text("Confirm finish with exceptions")');
  await waitDb(() => sql`select status from restock_sessions where kind = 'full'`, (r) => r[0]?.status === 'finished_exceptions', 30000);
  await waitSynced(A);

  // Overnight roll-over: an old restock never finished
  const [dept] = await sql`select id from departments where name = 'Candy Bar'`;
  await sql`insert into restock_sessions (id, department_id, kind, trading_date, status, people) values (gen_random_uuid(), ${dept.id}, 'full', current_date - 2, 'open', ${['Alex']})`;

  // ---------- Supervisor ----------
  const S = await (await b.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  S.on('pageerror', (e) => errs.push(`S: ${e.message}`));
  await S.goto(B + '/admin/login'); await S.fill('#email', 'supervisor@example.com'); await S.fill('#password', 'correct-horse-1'); await S.click('button.btn.primary');
  await S.waitForURL(B + '/admin');
  ok(await hasText(S, '.panel', 'Finished with exceptions'), 'overview shows tonight’s Kitchen restock finished with exceptions');
  ok(await hasText(S, '.stat', 'Open shortages'), 'overview shows open shortages');
  ok(await hasText(S, '.stat', 'Unfinished restocks'), 'overview shows unfinished restocks');
  await S.screenshot({ path: out + 'p3-overview.png', fullPage: true });
  const [old] = await sql`select status from restock_sessions where trading_date = current_date - 2`;
  ok(old.status === 'unfinished', 'restock left open past the cut-off is marked Unfinished');

  await S.click('.admin-nav >> text=Restocks'); await S.waitForSelector('text=Unfinished');
  ok(await hasText(S, '.row', 'Candy Bar'), 'restocks list shows the unfinished Candy Bar restock');
  await S.click('.row:has-text("Gold Class Kitchen") >> text=Details'); await S.waitForSelector('.rtable');
  ok(await hasText(S, '.rtable', 'Not enough in storeroom'), 'restock detail lists the shortage reason');
  ok((await S.inputValue('#restock-summary')).includes('RUNNING LOW (1)'), 'restock detail has the copyable summary');
  await S.screenshot({ path: out + 'p3-detail.png', fullPage: true });

  await S.click('.admin-nav >> text=Shortages'); await S.waitForSelector('text=Open (1)');
  ok(await hasText(S, '.row', 'Tomatoes'), 'shortages page lists Tomatoes');
  await S.fill('input[name=note]', 'Ordered for Monday'); await S.click('button:has-text("Mark resolved")');
  await S.waitForSelector('text=Open (0)');
  ok(await hasText(S, '.muted-row', 'Ordered for Monday'), 'shortage resolved with a note, shown under Resolved');
  await S.screenshot({ path: out + 'p3-shortages.png', fullPage: true });

  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e.message); await sql.end(); process.exit(1); });
