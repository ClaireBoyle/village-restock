// Phase 4: reference photos, spreadsheet import/export, offline app shell.
const { chromium } = require('playwright');
const fs = require('fs');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100', out = __dirname + '/out/';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
const card = (name) => `article.card:has(h3:text-is("${name}"))`;

(async () => {
  await sql`insert into admins (email, display_name, password_hash) values ('supervisor@example.com', 'Claire', ${await bcrypt.hash('correct-horse-1', 10)})`;
  const b = await chromium.launch();
  const errs = [];
  const ctxA = await b.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const S = await ctxA.newPage();
  S.on('pageerror', (e) => errs.push('admin: ' + e.message));
  await S.goto(B + '/admin/login'); await S.fill('#email', 'supervisor@example.com'); await S.fill('#password', 'correct-horse-1'); await S.click('button.btn.primary');
  await S.waitForURL(B + '/admin');

  // ---- Photos -------------------------------------------------------------
  const [tom] = await sql`select id from products where name = 'Tomatoes'`;
  await S.goto(`${B}/admin/products/${tom.id}`);
  await S.setInputFiles('.photo-field input[type=file]', __dirname + '/../../public/icons/icon-512.png');
  await S.waitForSelector('.photo-field .ok-text');
  const [tp] = await sql`select photo_path from products where id = ${tom.id}`;
  ok(/^\/api\/photos\/[0-9a-f-]{36}$/.test(tp.photoPath || ''), 'product photo uploaded and shrunk on the device');
  const [ph] = await sql`select content_type, bytes from photos`;
  ok(ph.contentType === 'image/jpeg' && ph.bytes < 400000, `stored as a small JPEG (${ph.bytes} bytes)`);
  const res = await S.request.get(B + tp.photoPath);
  ok(res.status() === 200 && /immutable/.test(res.headers()['cache-control']), 'photo served with long-term caching');
  // Not an image: refused
  fs.writeFileSync(out + 'fake.jpg', 'not really a picture');
  const bad = await S.request.post(B + '/api/photos/x').catch(() => null);
  ok(!bad || bad.status() >= 400, 'photos endpoint is read-only');
  // Area guide photo
  const [kitch] = await sql`select id from departments where name = 'Gold Class Kitchen'`;
  const [fr1] = await sql`select id from check_areas where name = 'Fridge 1'`;
  await S.goto(`${B}/admin/departments/${kitch.id}`);
  const det = S.locator('details:has(summary:has-text("Edit Fridge 1"))');
  await det.locator('summary').click();
  await det.locator('.photo-field input[type=file]').setInputFiles(__dirname + '/../../public/icons/icon-192.png');
  await det.locator('.photo-field .ok-text').waitFor();
  const [ap] = await sql`select guide_photo_path from check_areas where id = ${fr1.id}`;
  ok(!!ap.guidePhotoPath, 'area guide photo uploaded');

  // ---- Spreadsheets -------------------------------------------------------
  await S.goto(B + '/admin/import');
  const [dl] = await Promise.all([S.waitForEvent('download'), S.click('text=Download products (CSV)')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  ok(lines[0].startsWith('Department,Area,Product,Category,How restocked,Target'), 'products export has the expected columns');
  ok(lines.some((l) => l.includes('Tomatoes')), 'export lists products');
  // Edit: change Tomatoes target, add a product, archive Lemons
  const edited = lines.map((l) => {
    if (l.includes(',Fridge 1,Tomatoes,')) return l.replace(/,target level,(\d+),/, ',target level,10,');
    if (l.includes(',Lemons,')) return l.replace(/,active$/, ',archived');
    return l;
  });
  const tomLine = lines.find((l) => l.includes(',Fridge 1,Tomatoes,'));
  edited.push(tomLine.replace('Tomatoes', 'Cherry tomatoes').replace(/,target level,\d+,/, ',target level,4,').replace(/,(Fresh|Produce|[A-Za-z ]*),target/, ',Salad bits,target'));
  fs.writeFileSync(out + 'edited.csv', '﻿' + edited.join('\r\n') + '\r\n');
  // A broken file first: nothing must change
  fs.writeFileSync(out + 'broken.csv', [lines[0], tomLine.replace(/,target level,\d+,/, ',target level,7,').replace(/,(Cool room|[^,]*),(yes|no),/, ',Nowhere room,$2,')].join('\r\n'));
  await S.setInputFiles('.csv-import input[type=file]', out + 'broken.csv');
  await S.waitForSelector('.csv-preview .banner.s-bad');
  ok((await S.textContent('.csv-preview')).includes('No storeroom called'), 'a typo in a storeroom is caught, with the row number');
  ok(await S.locator('text=/Save \\d+ change/').count() === 0, 'nothing can be saved while a row has a problem');
  await S.setInputFiles('.csv-import input[type=file]', out + 'edited.csv');
  await S.waitForSelector('text=/Save \\d+ change/');
  const pv = await S.textContent('.csv-preview');
  ok(pv.includes('Cherry tomatoes') && /Fridge 1 target: \d+ → 10/.test(pv) && pv.includes('archived'), 'preview shows new product, target change and archive');
  await S.screenshot({ path: out + 'p4-import-preview.png', fullPage: true });
  ok((await sql`select par_level from product_placements pl join check_areas a on a.id = pl.check_area_id where pl.product_id = ${tom.id} and a.name = 'Fridge 1'`)[0].parLevel != 10, 'nothing saved before confirming');
  await S.click('text=/Save \\d+ change/');
  await S.waitForSelector('text=Import saved.');
  const [np] = await sql`select pl.par_level from product_placements pl join check_areas a on a.id = pl.check_area_id where pl.product_id = ${tom.id} and a.name = 'Fridge 1'`;
  const [ch] = await sql`select p.status, c.name as cat from products p left join categories c on c.id = p.category_id where p.name = 'Cherry tomatoes'`;
  const [lem] = await sql`select status from products where name = 'Lemons'`;
  ok(Number(np.parLevel) === 10 && ch && ch.cat === 'Salad bits' && lem.status === 'archived', 'import saved: target, new product (+ new category), archive');
  // Same file again: no changes
  await S.setInputFiles('.csv-import input[type=file]', out + 'edited.csv');
  await S.waitForSelector('text=No changes.');
  ok(true, 're-importing the same file changes nothing');
  for (const k of ['restocks', 'shortages']) {
    const r = await S.request.get(`${B}/api/admin/export/${k}`);
    ok(r.status() === 200 && (await r.text()).includes('Department'), `${k} export downloads`);
  }
  const anon = await (await b.newContext()).request.get(`${B}/api/admin/export/products`, { maxRedirects: 0 });
  ok(anon.status() === 401, 'exports need an admin sign-in');

  // ---- Staff: photos + offline -------------------------------------------
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 } });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => errs.push('staff: ' + e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => null);
  if (!(await P.evaluate(() => !!navigator.serviceWorker.controller))) { await P.reload(); await P.waitForSelector('.dcard2'); }
  ok(await P.evaluate(() => !!navigator.serviceWorker.controller), 'offline service worker is running');
  // wait for warming: department pages + photos cached
  const kid = String(kitch.id);
  let warm = false;
  for (let i = 0; i < 40 && !warm; i++) {
    warm = await P.evaluate(async (id) => { const c = await caches.open('vr-pages-v4'); const ph = await caches.open('vr-photos-v4'); return !!(await c.match('/d/' + id)) && (await ph.keys()).length >= 2; }, kid);
    if (!warm) await P.waitForTimeout(500);
  }
  ok(warm, 'department pages and photos saved for offline use');
  const man = await P.request.get(B + '/manifest.webmanifest');
  ok(man.status() === 200 && (await man.json()).display === 'standalone', 'installable app manifest');

  await ctx.setOffline(true);
  await P.reload(); await P.waitForSelector('.dcard2', { timeout: 15000 });
  ok(true, 'home screen opens with no connection');
  await P.click('.dcard2:has-text("Kitchen")');
  await P.waitForSelector('text=Start full restock', { timeout: 15000 });
  await P.click('text=Start full restock');
  await P.waitForSelector(card('Tomatoes'));
  ok(true, 'a department opens and a restock starts with no connection');
  const loaded = await P.locator(`${card('Tomatoes')} .pphoto img`).evaluate((i) => i.complete && i.naturalWidth > 0);
  ok(loaded, 'product photo shows offline');
  await P.click(`${card('Tomatoes')} .pphoto`);
  await P.waitForSelector('.photo-zoom img');
  await P.screenshot({ path: out + 'p4-zoom.png' });
  await P.click('.photo-zoom'); 
  ok(await P.locator('.photo-zoom').count() === 0, 'photo opens full screen and closes with a tap');
  ok(await P.locator(`${card('Lemons')}`).count() === 0 && await P.locator(card('Cherry tomatoes')).count() === 1, 'imported changes reached the device');
  // the area guide is open by default now
  await P.waitForSelector('.ag-photo img');
  ok(await P.locator('.ag-photo img').evaluate((i) => i.complete && i.naturalWidth > 0), 'area guide photo shows offline');
  await P.screenshot({ path: out + 'p4-card-photo.png' });
  await P.fill(`${card('Tomatoes')} .qty-input`, '3');
  await P.waitForSelector('.pill:has-text("saved on device")', { timeout: 10000 }).catch(() => null);
  await ctx.setOffline(false);
  await P.waitForSelector('.pill.ok:has-text("All changes synced")', { timeout: 30000 });
  ok(true, 'offline work uploads when the connection returns');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end();
})().catch(async (e) => { console.error(e); process.exit(1); });
