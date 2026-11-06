// Moving a lead's grade by hand in All leads. Per Jack: "in all leads i want
// to be able to move needs review to strong signal or bad lead".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = rows => ['Company,Full Name,Title,Email,Comments'].concat(rows.map(r => r.map(q).join(','))).join('\n');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-'));
const F = path.join(dir, 'Book11-01-26.csv');
fs.writeFileSync(F, csv([
  ['Strong Co', 'Sam Strong', 'CFO', 'sam@strongco.com', 'Evaluating Dynamics 365 Business Central to replace QuickBooks for 25 users this quarter, want a partner to implement.'],
  ['Review One', 'Rae One', 'CFO', 'rae@reviewone.com', 'They are running Microsoft 365 E3 across the business.'],
  ['Review Two', 'Ray Two', 'CFO', 'ray@reviewtwo.com', 'They are running Microsoft 365 E3 across the business.'],
  ['Review Three', 'Rob Three', 'CFO', 'rob@reviewthree.com', 'They are running Microsoft 365 E3 across the business.'],
]));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(120000);
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', F);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(600);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  const openAll = async () => { await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(800); };
  await openAll();
  const signal = async (co) => (await page.locator('.all-leads-table tbody tr', { hasText: co }).first().locator('td[data-col="stored"]').innerText()).replace(/\s+/g, ' ').trim();
  ok('Review One starts as Needs Review', /Needs Review/.test(await signal('Review One')), await signal('Review One'));
  ok('Strong Co starts as Strong Signal', /Strong Signal/.test(await signal('Strong Co')));

  // --- one lead, from its record
  await page.locator('.all-leads-table tbody tr', { hasText: 'Review One' }).first().click(); await sleep(600);
  await page.selectOption('select[aria-label="Move grade"]', 'Strong Signal'); await sleep(500);
  ok('the record shows it was moved by hand', await page.locator('[data-moved]', { hasText: 'moved by hand' }).count() === 1);
  const opts = await page.locator('select[aria-label="Move grade"] option').allInnerTexts();
  ok('the record offers back to the scanner\'s grade', opts.some((o) => /Back to scanner's grade \(Needs Review\)/.test(o)), opts.join(' | '));
  await page.keyboard.press('Escape'); await sleep(400);
  ok('Review One now reads Strong Signal, tagged moved', /Strong Signal/.test(await signal('Review One')) && /moved/.test(await signal('Review One')), await signal('Review One'));
  // The table shows the note without its head; the full stored note is on hover.
  const note = (await page.locator('.all-leads-table tbody tr', { hasText: 'Review One' }).first().locator('td[data-col="notes"]').getAttribute('title')) || '';
  // 11/6: a bare Dynamics mention is Strong now ("anything to do with
  // microsoft dynamics is a strong lead"), so the Needs Review fixture is a
  // named M365 SKU with no ask. Its mark follows the hand grade.
  ok('its note mark follows the move', /Microsoft 365 E3/.test(note) && /▲/.test(note) && !/▸/.test(note), note);

  // --- bulk, ticked rows, to Bad Lead with a reason
  for (const co of ['Review Two', 'Review Three']) await page.locator('.all-leads-table tbody tr', { hasText: co }).first().locator('input[type=checkbox]').check();
  await page.locator('button[aria-label="More actions"]').click(); await sleep(300);
  await page.selectOption('select[aria-label="Move grade"]', 'Bad Lead'); await sleep(200);
  await page.fill('input[aria-label="Move grade reason"]', 'Already a customer');
  await page.locator('button', { hasText: /^Move 2$/ }).click(); await sleep(400);
  const box = page.locator('button', { hasText: /^(OK|Yes|Confirm|Move)/ });
  if (await box.count()) { await box.last().click().catch(() => {}); await sleep(500); }
  ok('bulk move: both now Bad Lead', /Bad Lead/.test(await signal('Review Two')) && /Bad Lead/.test(await signal('Review Three')), `${await signal('Review Two')} / ${await signal('Review Three')}`);
  const title = await page.locator('.all-leads-table tbody tr', { hasText: 'Review Two' }).first().locator('td[data-col="stored"]').getAttribute('title');
  ok('the reason and scanner grade are on hover', /Already a customer/.test(title || '') && /Scanner's grade: Needs Review/.test(title || ''), title);

  // --- the Grade switch follows the move
  await page.locator('.seg-btn', { hasText: /^Strong Signal/ }).first().click().catch(() => {}); await sleep(500);
  const strongRows = (await page.locator('.all-leads-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('Strong Signal view includes the moved lead', /Review One/.test(strongRows) && /Strong Co/.test(strongRows) && !/Review Two/.test(strongRows), strongRows.slice(0, 200));
  await page.locator('.seg-btn', { hasText: /^All/ }).first().click().catch(() => {}); await sleep(400);

  // --- survives a reload and a re-upload of the same file
  await page.reload(); await sleep(1500);
  if (await page.locator('input[aria-label="Email"]').count()) {
    await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
    await page.click('button:has-text("Unlock")'); await sleep(1200);
  }
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  const start = page.locator('button', { hasText: 'Start over' });
  if (await start.count()) { await start.first().click(); await sleep(500); }
  await page.setInputFiles('input[type=file]', F);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(600);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await openAll();
  ok('after reload + re-upload Review One is still Strong Signal', /Strong Signal/.test(await signal('Review One')) && /moved/.test(await signal('Review One')), await signal('Review One'));
  ok('  and Review Two still Bad Lead', /Bad Lead/.test(await signal('Review Two')));

  // --- back to the scanner's grade
  await page.locator('.all-leads-table tbody tr', { hasText: 'Review One' }).first().click(); await sleep(600);
  await page.selectOption('select[aria-label="Move grade"]', '__auto'); await sleep(500);
  await page.keyboard.press('Escape'); await sleep(400);
  ok('back to scanner\'s grade: Needs Review, no tag', /Needs Review/.test(await signal('Review One')) && !/moved/.test(await signal('Review One')), await signal('Review One'));
  const note2 = (await page.locator('.all-leads-table tbody tr', { hasText: 'Review One' }).first().locator('td[data-col="notes"]').getAttribute('title')) || '';
  { const newest = note2.split('\n')[0]; ok('  and its newest note is as the scanner wrote it', /▸/.test(newest) && !/▲/.test(newest) && /Microsoft 365 E3/.test(newest), note2); }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
