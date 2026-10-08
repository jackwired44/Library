// The Campaigns screen, in a real browser: import the real 16-sequence
// Apollo snapshot, see the funnel, and survive a reload.
//
// Per Jack: "i need to oversee all the email campaigns here so i need to
// have full visibility into every lead that has been added to a sequence so
// i can see where they fall off", and "pull over the sequences i have
// worked from including the first wired cio russell made last year …
// including carlys".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SNAPSHOT = path.join(process.cwd(), '..', 'apollo-sequences-2026-10-08.csv');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const nav = async name => { await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); };
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await nav('Campaigns');
  ok('Campaigns is in the nav and opens', /Campaigns/.test(await main()));
  ok('empty state explains the two imports', /step funnel/.test(await main()));

  await page.setInputFiles('main input[type=file]', SNAPSHOT); await sleep(1200);
  let t = await main();
  ok('import reports 16 sequences', /16 sequences/.test(t), t.slice(0, 200));
  ok('no unmapped columns reported', !/Unmapped columns/.test(t));
  ok("Russell's Wired sequence listed", t.includes('Email only campaign - Wired'));
  ok("Carly's two sequences listed", t.includes('Carly Main Sequence') && t.includes('Carly Main Sequence Recycled'));

  // Live first: with nothing synced, the first card must be a live one.
  const firstCard = (await page.locator('.panel-head b').first().innerText()).trim();
  ok('a live sequence leads the list', /Jack Main Sequence|Carly Main Sequence|CSP Leads|Licensing|Backup|Recycled/.test(firstCard), firstCard);

  // An unknown total must not render as 0.
  const ewHead = (await page.locator('.panel-head', { hasText: 'Email only campaign - Wired' }).innerText()).replace(/\s+/g, ' ');
  ok('Wired sequence shows its 719 delivered', /719 delivered/.test(ewHead), ewHead);
  ok('Wired sequence does NOT claim 0 finished', !/0 finished/.test(ewHead), ewHead);

  // Open Jack Main and read the funnel.
  await page.locator('.panel-head', { hasText: 'Jack Main Sequence' }).first().click(); await sleep(500);
  t = await main();
  ok('Jack Main shows 6 step rows', (await page.locator('.panel-body table.data-table tbody tr').count()) === 6);
  ok('step 5 drop-off of 416 visible', /416/.test(t));
  ok('"loading" calls read as not ready, never 0', /not ready/.test(t));

  // Survives a reload.
  await page.reload(); await sleep(1200);
  const u = page.locator('input[aria-label="Email"]');
  if (await u.count()) {
    await u.fill('jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
    await page.click('button:has-text("Unlock")'); await sleep(1200);
  }
  await nav('Campaigns');
  t = await main();
  ok('funnels persist across reload', t.includes('Email only campaign - Wired') && t.includes('CSP Leads'));

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`campaigns-live ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
