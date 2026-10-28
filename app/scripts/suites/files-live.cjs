// All leads → Files. Per Jack: "filter by the specific csv file and see what
// the months on all leads have file wise", "filter this however i want by
// which files and months", "strong signal or not dynamics or m365azure".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = rows => ['Company,Full Name,Title,Email,Comments'].concat(rows.map(r => r.map(q).join(','))).join('\n');
const DYN = 'Evaluating Dynamics 365 Business Central to replace QuickBooks for 25 users this quarter, want a partner to implement.';
const GOOG = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const WEAK = 'Mentioned Microsoft 365 in passing.';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-'));
const FOCT = path.join(dir, 'Book10-15-25.csv');
fs.writeFileSync(FOCT, csv([['OCT DYN CO', 'Ola Dee', 'CFO', 'ola@octdyn.com', DYN], ['OCT M365 CO', 'Oz Lee', 'CIO', 'oz@octm365.com', GOOG]]));
const FMAY = path.join(dir, 'Book5-2-26.csv');
fs.writeFileSync(FMAY, csv([['MAY DYN CO', 'Mae Roe', 'CFO', 'mae@maydyn.com', DYN], ['MAY WEAK CO', 'Wes Fox', 'IT', 'wes@mayweak.com', WEAK]]));
const FSEP = path.join(dir, 'Book9-20-26.csv');
fs.writeFileSync(FSEP, csv([['SEP DYN CO', 'Sal Poe', 'CFO', 'sal@sepdyn.com', DYN]]));

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
  for (const f of [FOCT, FMAY, FSEP]) {
    await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
    const start = page.locator('button', { hasText: 'Start over' });
    if (await start.count()) { await start.first().click(); await sleep(500); }
    await page.setInputFiles('input[type=file]', f);
    await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
    await sleep(500);
    await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  }
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(800);
  ok('the Uploaded file picker sits in the always-visible filter row', await page.locator('[aria-label="Main filters"] select[aria-label="Uploaded file"]').count() === 1);

  await page.locator('[role=tab]', { hasText: /^Files$/ }).click(); await sleep(600);
  const months = await page.$$eval('table[aria-label="Uploaded files"] tr[data-month]', rs => rs.map(r => r.getAttribute('data-month')));
  ok('files are grouped by the month they are dated, newest first', JSON.stringify(months) === JSON.stringify(['2026-09', '2026-05', '2025-10']), JSON.stringify(months));
  const row = async f => (await page.locator(`tr[data-file="${f}"]`).innerText()).replace(/\s+/g, ' ');
  ok('each file shows its date, scanner and lead count', /10\/15\/25/.test(await row('Book10-15-25.csv')) && /Main Scanner/.test(await row('Book10-15-25.csv')) && / 2 /.test(await row('Book10-15-25.csv')), await row('Book10-15-25.csv'));

  // Narrow to Strong Signal + Dynamics 365.
  await page.locator('[aria-label="Files grade"] button', { hasText: 'Strong Signal' }).click(); await sleep(300);
  await page.selectOption('select[aria-label="Files product line"]', 'Dynamics 365'); await sleep(400);
  const may = await row('Book5-2-26.csv');
  ok('grade + product line narrow each file\'s count', /Book5-2-26\.csv .* 1 1 0 0/.test(may), may);

  // Pick October and May by month, leave September out.
  await page.locator('input[aria-label="Pick every file in Oct 2025"]').check();
  await page.locator('input[aria-label="Pick every file in May 2026"]').check(); await sleep(200);
  await page.locator('button[aria-label="Open picked files in Leads"]').click(); await sleep(900);
  const t = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const body = (await page.locator('.all-leads-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('Open lands on Leads with the files picked', /Files: 2 picked/.test(t), (t.match(/Files[^·]{0,40}/) || [''])[0]);
  ok('  and the grade and product line carried over', /OCT DYN CO/.test(body) && /MAY DYN CO/.test(body) && !/OCT M365 CO|MAY WEAK CO|SEP DYN CO/.test(body), body.slice(0, 300));

  // The picker can still choose a single file.
  await page.selectOption('[aria-label="Main filters"] select[aria-label="Uploaded file"]', 'Book9-20-26.csv'); await sleep(500);
  const one = (await page.locator('.all-leads-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('the picker narrows to one file', /SEP DYN CO/.test(one) && !/OCT DYN CO|MAY DYN CO/.test(one), one.slice(0, 200));

  // Clicking a file name opens just that file.
  await page.locator('[role=tab]', { hasText: /^Files$/ }).click(); await sleep(500);
  await page.locator('tr[data-file="Book10-15-25.csv"] button').first().click(); await sleep(800);
  const oct = (await page.locator('.all-leads-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('clicking a file name opens only that file', /OCT M365 CO/.test(oct) && /OCT DYN CO/.test(oct) && !/MAY|SEP/.test(oct), oct.slice(0, 200));

  // Per Jack: "edit where it is stored with which month and delete", and
  // "rescan the files once in files".
  await page.locator('[role=tab]', { hasText: /^Files$/ }).click(); await sleep(500);
  await page.locator('[aria-label="Files grade"] button', { hasText: 'All grades' }).click(); await sleep(300);
  await page.locator('button[aria-label="Edit date for Book9-20-26.csv"]').click(); await sleep(200);
  await page.fill('input[aria-label="Date for Book9-20-26.csv"]', '2026-03-10');
  await page.locator('button[aria-label="Save date for Book9-20-26.csv"]').click(); await sleep(600);
  const moved = await page.$$eval('table[aria-label="Uploaded files"] tr[data-month]', rs => rs.map(r => r.getAttribute('data-month')));
  ok('editing a file\'s date moves it to that month', JSON.stringify(moved) === JSON.stringify(['2026-05', '2026-03', '2025-10']), JSON.stringify(moved));
  ok('  and marks it as set by hand', /03\/10\/26 · set/.test(await row('Book9-20-26.csv')), await row('Book9-20-26.csv'));
  await page.locator('tr[data-file="Book9-20-26.csv"] button').first().click(); await sleep(700);
  const strip = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  ok('  its leads move with it in the month strip', /Mar 2026/.test(strip) && !/Sep 2026/.test(strip), (strip.match(/All months.{0,160}/) || [''])[0]);
  await page.reload(); await sleep(1200);
  if (await page.locator('input[type=password]').count()) {
    await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
    await page.click('button:has-text("Unlock")'); await sleep(1200);
  }
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(800);
  await page.locator('[role=tab]', { hasText: /^Files$/ }).click(); await sleep(500);
  ok('  the date survives a reload', await page.locator('tr[data-month="2026-03"]').count() === 1);
  await page.locator('button[aria-label="Reset date for Book9-20-26.csv"]').click(); await sleep(500);
  ok('Reset puts it back on its own date', await page.locator('tr[data-month="2026-09"]').count() === 1 && await page.locator('tr[data-month="2026-03"]').count() === 0);

  await page.locator('button[aria-label="Rescan Book5-2-26.csv"]').click();
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 60000 });
  await sleep(600);
  const scan = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  ok('Rescan opens the file in the Main Scanner, same view as an upload', /MAY DYN CO/.test(scan) && /MAY WEAK CO|Needs review/i.test(scan) && /Book5-2-26\.csv/.test(scan), scan.slice(0, 300));
  ok('  with Save still to click', await page.locator('button[aria-label="Save to platform"]').count() >= 1);
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(700);
  await page.locator('[role=tab]', { hasText: /^Files$/ }).click(); await sleep(500);
  await page.locator('button[aria-label="Refresh notes with today\'s rules"]').click();
  await page.waitForFunction(() => /Rescanned/.test(document.querySelector('[aria-label="Rescan status"]')?.textContent || ''), null, { timeout: 60000 });
  const st = (await page.locator('[aria-label="Rescan status"]').innerText()).replace(/\s+/g, ' ');
  ok('Refresh notes rewrites every stored lead in place', /Rescanned 5 leads/.test(st), st);

  page.once('dialog', d => d.accept());
  await page.locator('button[aria-label="Delete Book5-2-26.csv"]').click(); await sleep(900);
  ok('Delete removes the file from Files', await page.locator('tr[data-file="Book5-2-26.csv"]').count() === 0);
  const stored = await page.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1'); q.onsuccess = () => r(q.result); });
    const all = await new Promise(r => { const q = db.transaction('leads').objectStore('leads').getAll(); q.onsuccess = () => r(q.result); });
    db.close(); return all.map(l => l.company);
  });
  ok('  and deletes its leads from storage, leaving the others', !stored.some(c => /^MAY /.test(c)) && stored.includes('OCT DYN CO') && stored.includes('SEP DYN CO'), JSON.stringify(stored));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
