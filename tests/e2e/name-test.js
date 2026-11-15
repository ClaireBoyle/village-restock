const { chromium, devices } = require('playwright');
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS:', m); };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  await p.goto('http://localhost:3100/'); await p.waitForSelector('.dcard2');
  await p.click('.who');
  await p.waitForSelector('#staffname');
  const box = await p.locator('.sheet').boundingBox();
  ok(box.height > 200, `name panel is fully visible (${Math.round(box.height)}px tall)`);
  ok(await p.evaluate(() => document.activeElement?.id === 'staffname'), 'name box is ready to type in');
  await p.screenshot({ path: __dirname + '/out/name-sheet.png' });
  await p.locator('#staffname').pressSequentially('Jess');
  await p.tap('.sheet button.btn.primary');
  await p.waitForSelector('.who .avatar:has-text("J")');
  ok(true, 'typed name shows straight away in the top bar');
  await p.click('.dcard2:has-text("Kitchen")'); await p.click('text=Start full restock'); await p.waitForSelector('article.card');
  const pg = require('postgres')(process.env.E2E_DATABASE_URL || 'postgres://vr:vr@localhost:5432/village_restock', { onnotice: () => {} });
  let people = [];
  for (let k = 0; k < 40 && !people.includes('Jess'); k++) { [{ people } = { people: [] }] = await pg`select people from restock_sessions`; await p.waitForTimeout(250); }
  await pg.end();
  ok(people.includes('Jess'), 'the restock is recorded under the new name');
  await p.click('.who'); await p.fill('#staffname', 'Alex'); await p.waitForTimeout(300); await p.keyboard.press('Enter');
  await p.waitForSelector('.who .avatar:has-text("A")');
  ok(await p.locator('.sheet').count() === 0, 'Enter on the keyboard saves and closes');
  await p.click('.pill'); await p.waitForSelector('.sheet:has-text("Sync status")');
  ok((await p.locator('.sheet').boundingBox()).height > 150, 'sync status panel is fully visible too');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
