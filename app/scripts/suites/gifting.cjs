// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
//
// Gifting: a record started from a company card, delivery location,
// gift policy + over-limit warning, per-person preferences, a gift logged
// to a contact landing as a touch on their Reached board WITHOUT changing
// their disposition, ideas, persistence, and delete removing the touch.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const P = BASE; let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 950 }, timezoneId: 'America/Chicago' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const unlockScanner = async () => {
    const f = page.locator('input[aria-label="Scanner password"]');
    if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
  };
  await page.goto(P);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(900);

  const csv = `First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Looking at Dynamics 365 Business Central for 40 users and want a partner
Marco,Reyes,Office Manager,Ridgeline Orthopedics,marco@ridgelineortho.com,(312) 555-0111,Front desk`;
  await page.keyboard.press('Shift+J'); await sleep(800); await unlockScanner();
  await page.setInputFiles('input[type=file]', { name: 'g.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await sleep(1800);

  // Sidebar entry exists and the empty state is clear
  await page.click('.side-nav-btn:has-text("Gifting")'); await sleep(700);
  let t = await page.locator('main').innerText();
  ok('Gifting is in the sidebar and opens', /Gifting/.test(t) && /No gifting records yet/.test(t));

  // Start from the company card
  await page.click('.side-nav-btn:has-text("Companies")'); await sleep(800);
  await page.locator('td', { hasText: 'Ridgeline Orthopedics' }).first().click(); await sleep(600);
  t = await page.locator('main').innerText();
  ok('company card shows a gifting summary', /No gifting record yet/.test(t));
  await page.click('button:has-text("Start gifting record")'); await sleep(800);
  t = await page.locator('main').innerText();
  ok('lands on the new record', /🎁 Ridgeline Orthopedics/.test(t) && /Delivery location/.test(t));

  // Location + time zone from the typed state
  const field = label => page.locator('.gifting-field', { hasText: label }).locator('input, textarea').first();
  await field('City').fill('Chicago'); await field('City').press('Tab');
  await field('State').fill('IL'); await field('State').press('Tab'); await sleep(400);
  await field('Street address').fill('200 W Madison St, Suite 900'); await field('Street address').press('Tab'); await sleep(300);
  t = await page.locator('main').innerText();
  ok('location shows in the header', /Chicago, IL/.test(t));
  ok('their local time resolves from the state', /C[DS]T/.test(t));

  // Policy
  await field('Per-gift limit').fill('25'); await field('Per-gift limit').press('Tab'); await sleep(400);
  t = await page.locator('main').innerText();
  ok('policy pill reads the limit', /Limit \$25/.test(t));

  // People & preferences from a contact at the company
  await page.locator('select[aria-label="Add a contact"]').selectOption({ label: 'Dana Whitfield (IT Director)' });
  await page.click('button:has-text("+ Add person")'); await sleep(400);
  const person = page.locator('.gifting-person', { hasText: 'Dana Whitfield' });
  ok('person added from Contacts', await person.count() === 1);
  const dietary = person.locator('.gifting-field', { hasText: 'Dietary' }).locator('input');
  await dietary.fill('Nut allergy'); await dietary.press('Tab'); await sleep(400);
  const fav = person.locator('.gifting-field', { hasText: 'Favorites' }).locator('input');
  await fav.fill("Lou Malnati's"); await fav.press('Tab'); await sleep(400);
  t = await page.locator('main').innerText();
  ok('dietary banner surfaces the allergy', /Dietary \/ allergies:[\s\S]*Dana Whitfield: Nut allergy/.test(t));

  // Over-limit gift to Dana: warning, then logged anyway
  await page.locator('input[aria-label="What was sent"]').fill('Deep dish lunch for 10');
  await page.locator('input[aria-label="Vendor"]').fill("Lou Malnati's");
  await page.locator('input[aria-label="Cost"]').fill('$140');
  await page.locator('select[aria-label="For"]').selectOption({ label: 'Dana Whitfield' });
  await page.locator('select[aria-label="Relationship stage"]').selectOption('meeting-held');
  t = await page.locator('main').innerText();
  ok('over-limit warning shows before logging', /Over this company's \$25 gift limit/.test(t));
  await page.click('button:has-text("Log anyway")'); await sleep(700);
  ok('stage recorded on the gift row', await page.locator('.table-card select[aria-label="Stage"]').first().inputValue() === 'meeting-held');
  await page.locator('.table-card select[aria-label="How it landed"]').first().selectOption('meeting-booked'); await sleep(400);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download gift log")')]);
  const csvText = require('fs').readFileSync(await dl.path(), 'utf8');
  ok('gift log CSV has the expected header', csvText.startsWith('Company,Date sent,Gift,Vendor,Cost,Occasion,Relationship stage,For,How it landed'), csvText.slice(0, 160));
  ok('gift log CSV row carries stage, landing and address', /Ridgeline Orthopedics,\d{4}-\d{2}-\d{2},Deep dish lunch for 10,Lou Malnati's,140,Thank-you,Meeting held,Dana Whitfield,Meeting booked/.test(csvText) && /200 W Madison/.test(csvText), csvText);
  ok('confirm was asked before logging over the limit', dialogs.some(m => /Log this gift anyway/.test(m)));
  t = await page.locator('.table-card').innerText();
  ok('gift row is in the log with an over flag', /Deep dish lunch for 10/.test(t) && /\$140/.test(t) && /over/.test(t));

  // Ideas
  await page.locator('input[placeholder^="e.g. Portillo"]').fill('Cookie tray after go-live');
  await page.click('button:has-text("+ Add idea")'); await sleep(300);
  t = await page.locator('main').innerText();
  ok('idea added', /Cookie tray after go-live/.test(t) && /Ideas \(1 open\)/.test(t));

  // Reload: everything persisted
  await page.reload(); await sleep(400);
  if (await page.locator('input[aria-label="Email"]').count()) {
    await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
    await page.click('button:has-text("Unlock")');
  }
  await sleep(900);
  await page.click('.side-nav-btn:has-text("Gifting")'); await sleep(800);
  t = await page.locator('main').innerText();
  ok('record survives reload', /Ridgeline Orthopedics/.test(t) && /Deep dish lunch for 10/.test(t) && /Nut allergy/.test(t) && /Cookie tray after go-live/.test(t) && /Limit \$25/.test(t) && /200 W Madison/.test(await page.locator('main').evaluate(el => [...el.querySelectorAll('input')].map(i => i.value).join('|'))));

  // Touch landed on Dana's Reached board, disposition untouched
  await page.click('.side-nav-btn:has-text("Contacts")'); await sleep(800);
  await page.locator('td', { hasText: 'Dana Whitfield' }).first().click(); await sleep(800);
  t = await page.locator('.reached-board').innerText();
  ok('gift shows as a touch on the Reached board', /Gift sent|🎁/.test(t) && /Deep dish lunch/.test(t), t.slice(0, 300));
  ok('a gift is not counted as reaching them', /0[\s\S]{0,30}reached them/i.test(t));
  const dana = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const q = r.result.transaction('contacts').objectStore('contacts').getAll();
      q.onsuccess = () => { const c = q.result.find(x => x.email === 'dana@ridgelineortho.com'); r.result.close(); res({ disposition: c.disposition || 'none', calls: c.callCount || 0, emails: c.emailCount || 0 }); };
    };
  }));
  ok('disposition and call/email counts untouched by the gift', dana.disposition === 'none' && dana.calls === 0 && dana.emails === 0, JSON.stringify(dana));
  ok('gift is not offered in the Reached board quick-log picker', !(await page.locator('.reached-board').evaluate(el => el.innerHTML)).includes('value="gift"'));
  await page.click('button:has-text("+ Log attempt")'); await sleep(300);
  const chans = await page.locator('.reached-form select').first().locator('option').allTextContents();
  ok('quick-log channels are call/email/LinkedIn only', chans.length === 3 && !chans.some(c => /gift/i.test(c)), chans.join(','));
  await page.locator('button', { hasText: '✕' }).first().click(); await sleep(400);

  // Company card summary reflects the record
  await page.click('.side-nav-btn:has-text("Companies")'); await sleep(800);
  await page.locator('td', { hasText: 'Ridgeline Orthopedics' }).first().click(); await sleep(600);
  t = await page.locator('main').innerText();
  ok('company card summary counts the gift', /1 sent · \$140/.test(t) && /Open in Gifting/.test(t));
  await page.click('button:has-text("Open in Gifting")'); await sleep(700);

  // Deleting the gift removes the touch too
  await page.locator('.table-card button[aria-label="Delete gift"]').click(); await sleep(700);
  t = await page.locator('main').innerText();
  ok('gift deleted from the log', /Nothing logged yet/.test(t));
  await page.click('.side-nav-btn:has-text("Contacts")'); await sleep(800);
  await page.locator('td', { hasText: 'Dana Whitfield' }).first().click(); await sleep(800);
  t = await page.locator('.reached-board').innerText();
  ok('touch removed with the gift', !/Deep dish lunch/.test(t));
  await page.locator('button', { hasText: '✕' }).first().click(); await sleep(300);

  ok('no console errors', !errs.length, errs.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
