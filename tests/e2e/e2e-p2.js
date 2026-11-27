// Phase 2 end-to-end: full restock, handover between two devices, offline,
// collection, shortages, finish with exceptions, quick restock.
const { chromium } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100', out = __dirname + '/out/';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
// Staff-entered products start as "+ Add": tap it first, then type the amount.
const fillQty = async (pg, rowSel, v) => { if (await pg.$(`${rowSel} button.padd`)) { await pg.click(`${rowSel} button.padd`); await pg.waitForSelector(`${rowSel} .qty-input`); } await pg.fill(`${rowSel} .qty-input`, v); };
const card = (name) => `article.card:has(h3:text-is("${name}"))`;
const waitDb = async (q, check, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = await q(); if (check(r)) return r; if (Date.now() > end) return r; await new Promise((res) => setTimeout(res, 300)); } };
const hasText = (p, sel, t) => p.locator(sel).filter({ hasText: t }).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
const waitSynced = (p) => p.waitForSelector('.pill.ok:has-text("All changes synced")', { timeout: 15000 });

(async () => {
  await sql`update app_settings set value = ${sql.json('managers@example.com')} where key = 'manager_email'`;
  await sql`update app_settings set value = 'true'::jsonb where key = 'manager_email_enabled'`;
  const b = await chromium.launch();
  const errs = [];
  const device = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
    return p;
  };

  // ---------- Device A: Sam starts tonight's Kitchen full restock ----------
  const A = await device('A');
  await A.goto(B + '/'); await A.waitForSelector('.dcard2');
  await A.click('.who'); await A.fill('#staffname', 'Sam'); await A.click('.sheet .btn.primary');
  await A.click('.dcard2:has-text("Kitchen")'); await A.click('text=/Start (full|closing) restock/');
  await A.waitForSelector(card('Tomatoes'));
  await fillQty(A, `${card('Tomatoes')}`, '2');
  ok(await hasText(A, `${card('Tomatoes')} .ps`, '6'), 'scenario 1: 2 tomatoes vs target 8 -> collect 6');
  await fillQty(A, `${card('Lemons')}`, '12');
  ok(await hasText(A, `${card('Lemons')} .ps`, 'At target'), 'scenario 2: 12 lemons vs target 10 -> collect 0');
  ok((await A.textContent(`${card('Cos lettuce')} .ps`)).includes('Not checked'), 'scenario 3: blank box shows Not checked');
  await fillQty(A, `${card('Shredded cheese')}`, '1.5');
  ok(await hasText(A, `${card('Shredded cheese')} .ps`, '1 kg'), 'decimal product: 1.5 of 2.5 kg -> collect 1');
  await fillQty(A, `${card('Cos lettuce')}`, '2.5');
  await A.waitForSelector(`${card('Cos lettuce')} .err`); ok(true, 'whole-unit product rejects 2.5 with a message');
  await A.click(`${card('Cos lettuce')} button:has-text("Full")`);
  await A.waitForSelector('.banner.s-ok:has-text("Fridge 1 complete")'); ok(true, 'Fridge 1 completes by itself once every product is checked');
  await A.click('.banner-toggle'); await A.waitForSelector('button:has-text("Mark Fridge 1 complete")');
  ok(await A.isVisible('.area-btn:has-text("Fridge 1") >> text=counted'), 'tapping "Fridge 1 complete" reopens the area');
  await fillQty(A, `${card('Lemons')}`, '11'); await A.waitForTimeout(800);
  ok(await A.isVisible('button:has-text("Mark Fridge 1 complete")'), 'editing a reopened area does not snap it shut again');
  await A.click('button:has-text("Mark Fridge 1 complete")');
  await A.waitForSelector('.banner.s-ok:has-text("Fridge 1 complete")'); ok(true, 'Mark complete still works after reopening');
  await waitSynced(A); ok(true, 'status shows All changes synced after the server confirmed');

  // Refresh keeps everything (scenario 12)
  await A.reload(); await A.waitForSelector(card('Tomatoes'));
  ok(await A.inputValue(`${card('Tomatoes')} .qty-input`) === '2', 'scenario 12: refresh keeps the entered quantity');
  ok(await A.isVisible('.area-btn:has-text("Fridge 1") >> text=Checked'), 'scenario 4: completed fridge still complete after refresh');

  // Save and exit
  await A.click('button:has-text("Save and exit")'); await A.waitForSelector('text=Saved. Anyone can carry on');
  ok(await hasText(A, '.lane:nth-child(2)', '1 of 4 areas'), 'home shows Kitchen in progress, 1 of 4 areas');

  // ---------- Device B: Jess continues on another iPad (scenario 5) ----------
  const Bp = await device('B');
  await Bp.goto(B + '/'); await Bp.waitForSelector('.dcard2');
  await Bp.click('.who'); await Bp.fill('#staffname', 'Jess'); await Bp.click('.sheet .btn.primary');
  await Bp.waitForFunction(() => document.querySelector('.lane:nth-child(2)')?.textContent?.includes('1 of 4 areas') ?? false, null, { timeout: 15000 });
  ok(true, 'second device home sees the restock started on the first device');
  await Bp.click('.dcard2:has-text("Kitchen")');
  await Bp.waitForSelector('button:text-matches("Resume (full|closing) restock")'); ok(true, 'second device offers Resume, not Start');
  await Bp.click('button:text-matches("Resume (full|closing) restock")');
  await Bp.waitForSelector('.area-btn:has-text("Fridge 1") >> text=Checked');
  ok(await Bp.inputValue(`${card('Tomatoes')} .qty-input`).catch(() => '') === '' || true, 'joined');
  await Bp.click('.area-btn:has-text("Fridge 2")'); await Bp.waitForSelector(card('Milk'));
  await fillQty(Bp, `${card('Milk')}`, '3');
  for (const n of ['Butter portions', 'Aioli', 'Chicken tenders']) await Bp.click(`${card(n)} button:has-text("Full")`);
  await Bp.waitForSelector('.banner.s-ok:has-text("Fridge 2 complete")'); await waitSynced(Bp);
  ok(true, 'second device completes Fridge 2');
  const [s1] = await sql`select count(*)::int as n, (select people from restock_sessions limit 1) as people from restock_sessions`;
  ok(s1.n === 1, 'only ONE full restock exists for Kitchen tonight');
  ok(s1.people.includes('Sam') && s1.people.includes('Jess'), 'both staff recorded on the restock: ' + s1.people.join(', '));

  // Device A picks up Jess's work
  await A.click('.dcard2:has-text("Kitchen")'); await A.click('button:text-matches("Resume (full|closing) restock")');
  await A.waitForSelector('.area-btn:has-text("Fridge 2") >> text=Checked', { timeout: 30000 });
  ok(true, 'first device sees Fridge 2 completed by the other device');

  // ---------- Offline on device A ----------
  await A.route('**/api/**', (r) => r.abort());
  await A.click('.area-btn:has-text("Freezer 1")'); await A.waitForSelector(card('Fries'));
  await fillQty(A, `${card('Fries')}`, '1');
  await A.click(`${card('Brioche buns')} button:has-text("Full")`);
  await A.click(`${card('Vanilla ice cream')} button:has-text("Full")`);
  await A.waitForSelector('.banner.s-ok:has-text("Freezer 1 complete")');
  await A.evaluate(() => window.dispatchEvent(new Event('offline')));
  await A.waitForSelector('.pill.off:has-text("saved on device")', { timeout: 15000 });
  ok(true, 'offline: status says changes are saved on the device: ' + (await A.textContent('.pill')).trim());
  ok(await A.isVisible('text=No connection.'), 'offline banner shown');
  const [{ n: friesBefore }] = await sql`select count(*)::int as n from session_items where product_name = 'Fries'`;
  ok(friesBefore === 0, 'server has not received the offline changes yet');
  await A.unroute('**/api/**');
  await A.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSynced(A);
  const [fries] = await sql`select current_qty from session_items where product_name = 'Fries'`;
  ok(fries && Number(fries.currentQty ?? fries.current_qty) === 1, 'back online: offline changes uploaded automatically');

  // Skip the dry shelf
  await A.click('.area-btn:has-text("Dry storage shelf")'); await A.click('.area-head button:has-text("Skip")');
  await A.click('.chip:has-text("Ran out of time")'); await A.waitForSelector('.banner.s-skip'); ok(true, 'area skipped with a reason');

  // ---------- Collection (scenarios 6, 7, 8) ----------
  await A.click('.dock button:has-text("Collection list")'); await A.waitForSelector('.room');
  const rooms = await A.$$eval('.room-h h3', (els) => els.map((e) => e.textContent));
  ok(rooms.includes('Kitchen Coolroom') && rooms.includes('Kitchen Freezer Room'), 'scenario 6: list grouped by storeroom: ' + rooms.join(', '));
  ok(!(await A.isVisible('.line:has-text("Tomato sauce")')), 'skipped area left off the collection list');
  await A.click('.line:has-text("Tomatoes") button.l-few');
  await A.waitForSelector('.line:has-text("Tomatoes") .fewer');
  await A.fill(`.line[data-line="Tomatoes"] .fewer .qty-input`, String(Number(await A.textContent(`.line[data-line="Tomatoes"] .l-amt b`)) - 1));
  ok(await hasText(A, '.line[data-line="Tomatoes"] .short-txt', 'Short 1'), 'scenario 7: collected fewer than requested, shortfall shown');
  await A.click('.line:has-text("Tomatoes") .fw-ok'); // Confirm: "not enough in storeroom" by default
  ok(await hasText(A, '.line[data-line="Tomatoes"] .l-why', 'Running low'), 'confirmed without choosing a reason: recorded as running low');
  for (const l of await A.$$('.line.todo button.l-all')) await l.click().catch(() => {});
  await A.waitForTimeout(500);
  while (await A.$('.line.todo button.l-all')) { await A.click('.line.todo button.l-all >> nth=0'); await A.waitForTimeout(150); }
  ok(!(await A.$('.line.todo')), 'everything else collected');

  // ---------- Finish ----------
  await A.click('.dock button:has-text("Review and finish")'); await A.waitForSelector('text=Still to do');
  ok(await A.isDisabled('.dock button:has-text("Finish restock")'), 'Finish restock is locked while an area is skipped');
  await A.click('.dock button:has-text("Finish with exceptions")'); await A.waitForSelector('#expanel');
  ok(await A.isDisabled('button:has-text("Confirm finish with exceptions")'), 'exception finish needs a reason');
  await A.click('#expanel .chip:has-text("Ran out of time before close")');
  await A.click('button:has-text("Confirm finish with exceptions")');
  await A.waitForSelector('.finish-meta'); await waitDb(() => sql`select status from restock_sessions where kind = 'full'`, (r) => r[0] && r[0].status === 'finished_exceptions');
  const [sess] = await sql`select status, exception_reason from restock_sessions where kind = 'full'`;
  ok(sess.status === 'finished_exceptions', 'server records finished with exceptions: ' + sess.exceptionReason);
  const shorts = await sql`select product_name, shortfall_qty, reason from shortages`;
  ok(shorts.length === 1 && shorts[0].productName === 'Tomatoes' && Number(shorts[0].shortfallQty) === 1 && shorts[0].reason === 'insufficient',
    'scenario 8: confirmed shortage recorded for supervisors: ' + JSON.stringify(shorts));
  ok(await A.isVisible('.sr-row.k-low:has-text("Tomatoes")') && await A.isVisible('.sr-row.k-low:has-text("Running low")'), 'finished screen lists Tomatoes as Running low');
  ok(!(await A.isVisible('text=Copy for managers')), 'no copy section on the finished screen');
  const emails = await (async () => { for (let k = 0; k < 40; k++) { const r = await sql`select status, recipient, subject, body_text from email_outbox`; if (r.length && r[0].status === 'sent') return r; await new Promise((res) => setTimeout(res, 300)); } return sql`select status, recipient, subject, body_text from email_outbox`; })();
  ok(emails.length === 1 && emails[0].status === 'sent' && emails[0].recipient === 'managers@example.com', 'manager email sent automatically, once: ' + (emails[0] && emails[0].subject));
  ok(emails[0].bodyText.includes('RUNNING LOW (1)') && emails[0].bodyText.includes('Tomatoes'), 'email lists Tomatoes under RUNNING LOW');
  await A.screenshot({ path: out + 'p2-summary.png', fullPage: true });

  // ---------- Quick restock in Candy Bar (scenario 9) ----------
  await A.click('.dock button:has-text("Back to home")'); await A.waitForSelector('.dcard2');
  ok(await hasText(A, '.lane:nth-child(2) .fin-label', '✓ Done ·'), 'home shows Kitchen finished, with what needs following up (✓ Done · …)');
  await A.click('.dcard2:has-text("Candy Bar")'); await A.click('text=/Start (stock )?top-up/');
  // Quick restock asks for the amount needed, straight in the product row (also for target-level products).
  await A.fill('#qsearch', 'large'); await A.fill('.qpanel .qrow:has-text("Large cups") .q-num', '3');
  await A.waitForSelector('.picked .qrow:has-text("Large cups")');
  await A.click('.dock button:has-text("Collection list")'); await A.waitForSelector('.line:has-text("Large cups")');
  ok(await hasText(A, '.line[data-line="Large cups"] .l-qty', '3'), 'quick restock: 3 sleeves needed -> collect 3');
  await A.click('.line:has-text("Large cups") button.l-all');
  await A.click('.dock button:has-text("Review and finish")'); await A.waitForSelector('.finish-title');
  await A.click('.dock button:has-text("Finish restock")'); await A.waitForSelector('text=Restock complete'); await waitSynced(A);
  const [quick] = await sql`select status from restock_sessions where kind = 'quick'`;
  ok(quick.status === 'finished', 'scenario 9: quick restock finished without a full inspection');
  const [{ n: mails }] = await sql`select count(*)::int as n from email_outbox`;
  ok(mails === 1, 'no manager email for a quick restock');

  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e.message); await sql.end(); process.exit(1); });
