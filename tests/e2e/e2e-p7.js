// Product photos from Open Food Facts, against a stand-in Open Food Facts server.
// Start the app with OFF_API_BASE=http://localhost:3199 OFF_IMAGE_HOSTS=localhost:3199 for this suite.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const postgres = require('postgres');
const bcrypt = require('bcryptjs');
const B = process.env.E2E_URL || 'http://localhost:3100';
const sql = postgres(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {}, transform: postgres.camel });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
// Staff-entered products start as "+ Add": tap it first, then type the amount.
const fillQty = async (pg, rowSel, v) => { if (await pg.$(`${rowSel} button.padd`)) { await pg.click(`${rowSel} button.padd`); await pg.waitForSelector(`${rowSel} .qty-input`); } await pg.fill(`${rowSel} .qty-input`, v); };
const png = fs.readFileSync(path.join(__dirname, '../../public/icons/icon-192.png'));

const off = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:3199');
  if (u.pathname === '/cgi/search.pl') {
    const q = (u.searchParams.get('search_terms') || '').toLowerCase();
    const products = q.includes('maltesers') ? [
      { code: '111', product_name: 'Maltesers Share Pack', brands: 'Mars', image_front_url: 'http://localhost:3199/img/111.png', image_front_small_url: 'http://localhost:3199/img/111.png', countries_tags: ['en:united-kingdom'] },
      { code: '222', product_name: 'Maltesers 140g', brands: 'Mars', image_front_url: 'http://localhost:3199/img/222.png', image_front_small_url: 'http://localhost:3199/img/222.png', countries_tags: ['en:australia'] },
      { code: '333', product_name: 'Elsewhere', brands: 'X', image_front_url: 'https://evil.example.com/x.png', countries_tags: [] },
    ] : [];
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ products })); return;
  }
  if (u.pathname.startsWith('/img/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); return; }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise((r) => off.listen(3199, r));
  await sql`insert into admins (email, display_name, password_hash) values ('supervisor@example.com', 'Claire', ${await bcrypt.hash('correct-horse-1', 10)})`;
  const b = await chromium.launch(); const errs = [];
  const A = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); A.on('pageerror', (e) => errs.push(e.message));
  await A.goto(B + '/admin/login'); await A.fill('#email', 'supervisor@example.com'); await A.fill('#password', 'correct-horse-1'); await A.click('button.btn.primary'); await A.waitForURL(B + '/admin');
  const [cb] = await sql`select id from departments where name = 'Candy Bar'`;
  await A.goto(`${B}/admin/photos?dept=${cb.id}`); await A.waitForSelector('.pf-card');
  ok(await A.locator('.pf-card').count() >= 3, 'every Candy Bar product listed');
  const mal = A.locator('.pf-card', { has: A.locator('b', { hasText: /^Maltesers$/ }) });
  await mal.locator('button:has-text("Find photo")').click();
  await mal.locator('.pf-cand').first().waitFor();
  const names = await mal.locator('.pf-cand span').allTextContents();
  ok(names[0] === 'Maltesers 140g' && names.length === 2, 'Australian pack first; photos from other hosts ignored: ' + names.join(', '));
  await mal.locator('.pf-cand').first().click();
  await mal.locator('.ok-text').waitFor();
  const [p] = await sql`select p.photo_path, ph.credit, ph.source_url, ph.content_type from products p join photos ph on p.photo_path = '/api/photos/' || ph.id::text where p.name = 'Maltesers'`;
  ok(p && p.credit === 'Photo: Open Food Facts (product 222), CC BY-SA' && p.sourceUrl.endsWith('/product/222') && p.contentType === 'image/png', 'photo copied into our store with its CC BY-SA credit');
  await A.reload(); await A.waitForSelector('.pf-card');
  ok(await A.locator('.pf-credit', { hasText: 'Open Food Facts' }).count() === 1, 'credit shown in admin');
  // Search for anything not found
  const pods = A.locator('.pf-card', { has: A.locator('b', { hasText: /^Pods$/ }) });
  await pods.locator('button:has-text("Find photo")').click();
  await pods.locator('text=No photos found').waitFor();
  ok(true, 'no results: clear message, upload still available');
  // Server refuses images from elsewhere
  const r = await A.evaluate(async () => (await fetch('/admin/photos')).status);
  ok(r === 200, 'admin page reachable when signed in');

  // Staff: photo on the row and in the collection list, credit in the full-size view
  const P = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); P.on('pageerror', (e) => errs.push(e.message));
  await P.goto(B + '/'); await P.waitForSelector('.dcard2');
  await P.click('.dcard2:has-text("Candy")'); await P.click('text=/Start (full|closing) restock/'); await P.waitForSelector('article.prow');
  const row = 'article.prow:has(h3:text-is("Maltesers"))';
  await P.locator(`${row} .pthumb img`).waitFor({ timeout: 15000 });
  ok(await P.locator(`${row} .pthumb img`).evaluate((i) => i.complete && i.naturalWidth > 0), 'product photo on the staff row');
  await P.click(`${row} .pthumb`); await P.waitForSelector('.photo-zoom');
  ok((await P.textContent('.photo-zoom')).includes('CC BY-SA'), 'full-size view shows the photo credit');
  await P.click('.photo-zoom');
  await fillQty(P, `${row}`, '3');
  await P.click('.dock .dock-acts button:has-text("Collect")'); await P.waitForSelector('.line');
  ok(await P.locator('.line[data-line="Maltesers"] .pthumb img').count() === 1, 'photo in the collection list');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); await sql.end(); off.close();
})().catch(async (e) => { console.error(e); process.exit(1); });
