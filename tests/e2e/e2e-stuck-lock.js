// A stuck database connection holding a lock must not make the app say "Offline" or lose work.
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const postgres = require('postgres');
const DB = process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock';
const B = process.env.E2E_URL || 'http://localhost:3100';
const sql = postgres(DB, { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
// Staff-entered products start as "+ Add": tap it first, then type the amount.
const fillQty = async (pg, rowSel, v) => { if (await pg.$(`${rowSel} button.padd`)) { await pg.click(`${rowSel} button.padd`); await pg.waitForSelector(`${rowSel} .qty-input`); } await pg.fill(`${rowSel} .qty-input`, v); };
const row = (n) => `article.prow:has(h3:text-is("${n}"))`;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  await p.goto(B + '/'); await p.waitForSelector('.dcard2');
  await p.click('.dcard2:has-text("Kitchen")'); await p.click('text=/Start (full|closing) restock/'); await p.waitForSelector('article.prow');
  await p.waitForSelector('.pill.ok', { timeout: 20000 });
  const [s] = await sql`select id from restock_sessions`;
  // Another connection locks tonight's restock for 25 s (like a hung query)
  const locker = spawn('psql', [DB, '-qc', `begin; select id from restock_sessions where id = '${s.id}' for update; select pg_sleep(25); commit;`]);
  await new Promise((r) => setTimeout(r, 1000));
  await fillQty(p, `${row('Tomatoes')}`, '3');
  await fillQty(p, `${row('Lemons')}`, '9');
  await p.waitForTimeout(12000);
  const pill = await p.textContent('.pill');
  ok(!/offline/i.test(pill) && /Retrying|attention|Syncing/i.test(pill), `while the lock is held the app doesn't claim to be offline: "${pill.trim()}"`);
  ok(await p.locator('.net').count() === 0, 'no "No connection" banner');
  await new Promise((r) => locker.on('exit', r));
  await p.waitForSelector('.pill.ok', { timeout: 40000 });
  const items = await sql`select product_name, current_qty from session_items order by product_name`;
  ok(items.length === 2 && Number(items.find((i) => i.productName === 'Tomatoes').currentQty) === 3, 'once the lock clears, everything uploads by itself');
  await b.close(); await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
