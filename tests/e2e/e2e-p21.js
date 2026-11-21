// A database update run while the previous release was still live: the device saved a copy of the catalogue
// without the new setting, at the current version. A new release must replace that copy (it used to be kept
// forever as "unchanged"), and an unchanged copy from the same release is still a tiny "unchanged" reply.
// Before running: reset the test database, then load gcbar-refill-fixture.sql. The test applies the update scripts.
const { chromium } = require('playwright');
const postgres = require('postgres');
const B = process.env.E2E_URL || 'http://localhost:3100';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };

(async () => {
  for (const f of ['refill-foh', 'back-bench-walk', 'foh-lap', 'coffee-cupboard', 'beer-fridge-area']) await sql.file(`db/updates/2026-11-gold-class-bar-${f}.sql`);
  await sql`update departments set none_left_check = true where lower(name) = 'gold class bar'`;
  const b = await chromium.launch(); const errs = [];
  const P = await (await b.newContext({ viewport: { width: 1000, height: 650 } })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  const replies = [];
  P.on('response', async (r) => { if (r.url().includes('/api/catalogue')) { try { replies.push({ url: r.url(), unchanged: (await r.json()).unchanged }); } catch { /* ignore */ } } });
  await P.goto(B + '/'); await P.waitForSelector('.dcard2'); await P.waitForTimeout(800);
  ok(replies.length >= 1 && replies[0].unchanged === false, 'first visit: full catalogue');
  // Pretend this copy came from the previous release: no release tag and no "None left here" setting.
  await P.evaluate(() => new Promise((res, rej) => {
    const o = indexedDB.open('village-restock');
    o.onsuccess = () => { const tx = o.result.transaction('kv', 'readwrite'); const st = tx.objectStore('kv'); const g = st.get('catalogue');
      g.onsuccess = () => { const v = g.result; delete v.value.catalogue.rev; for (const d of v.value.catalogue.departments) delete d.noneLeftCheck; st.put(v); };
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); };
    o.onerror = () => rej(o.error);
  }));
  replies.length = 0;
  await P.reload(); await P.waitForSelector('.dcard2'); await P.waitForTimeout(800);
  ok(replies[0] && /rev=&|rev=$/.test(replies[0].url) && replies[0].unchanged === false, 'old copy (same version, earlier release): replaced with a fresh one');
  const stored = await P.evaluate(() => new Promise((res) => { const o = indexedDB.open('village-restock'); o.onsuccess = () => { const g = o.result.transaction('kv').objectStore('kv').get('catalogue'); g.onsuccess = () => res(g.result.value.catalogue); }; }));
  ok(stored.rev && stored.departments.find((d) => d.name === 'Gold Class Bar').noneLeftCheck === true, 'the saved copy now has the release tag and the setting');
  replies.length = 0;
  await P.reload(); await P.waitForSelector('.dcard2'); await P.waitForTimeout(800);
  ok(replies[0] && replies[0].unchanged === true, 'same release, same version: "unchanged" (no re-download)');
  // And the tick is there.
  await P.click('.dcard2:has-text("Bar") >> nth=0'); await P.click('.type-full button.btn.primary'); await P.waitForSelector('article.prow');
  await P.click('.area-btn:has-text("Back bench")'); await P.waitForTimeout(400);
  await P.click('article.prow:has(h3:text-is("Noilly Prat")) .padd');
  ok(await P.locator('article.prow:has(h3:text-is("Noilly Prat")) .pnone').waitFor({ timeout: 4000 }).then(() => true, () => false), 'Back bench on a laptop: "None left here" on Noilly Prat');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
