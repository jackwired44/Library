// "Already on a list" filter, live. Per Jack: "filter out leads added to a
// list so if i upload a csv to scan i can remove ones i added to a list or
// even in all leads". Approved: lists he built count, smart lists don't, and
// hiding them also keeps them out of downloads.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const samples = require('../fixtures/smc-samples.json');
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'listhide-leads.csv');
fs.writeFileSync(LEADS, csv(HEAD, [
  ['ALPHA CO','Ada Brant','IT Director','ada@alpha.com','312-555-0101', SIGNAL],
  ['BETA CO','Ben Cole','CFO','ben@beta.com','312-555-0102', SIGNAL],
  ['GAMMA CO','Nia Rowe','CIO','nia@gamma.com','312-555-0103', SIGNAL],
  ['DELTA CO','Rae Lin','CFO','rae@delta.com','312-555-0104', SIGNAL],
]));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL ' + name + (detail ? '  — ' + detail : '')); } };

(async () => {
  const browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('skipFileNameBox', '1'); } catch {} });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 60000 });
  await sleep(800);
  const rows = () => page.locator('.data-table tbody tr').count();
  const allSignal = async () => Number((await page.locator('.dl-strip button', { hasText: 'All Strong Signal' }).locator('.dl-count').innerText()).trim());
  const total = await rows();
  const dlBefore = await allSignal();
  ok('no list yet: no list dropdown', await page.locator('select[aria-label="Leads already on a list"]').count() === 0);

  // Put two leads on a hand-built list.
  const strip = page.locator('[role=group][aria-label="Add to list"]');
  const boxes = page.locator('.data-table tbody tr input[type=checkbox]');
  await boxes.nth(0).check(); await boxes.nth(1).check(); await sleep(200);
  await strip.locator('select').selectOption('__new__');
  await strip.locator('input[aria-label="New list name"]').fill('Called last week');
  await strip.locator('button').click(); await sleep(600);
  // Untick so the table is back to every row.
  await boxes.nth(0).uncheck(); await boxes.nth(1).uncheck(); await sleep(200);

  const sel = page.locator('select[aria-label="Leads already on a list"]');
  ok('dropdown appears once leads are on a list', await sel.count() === 1);
  ok('  defaults to showing them', (await sel.evaluate(el => el.selectedOptions[0].textContent)).includes('Show 2 already on a list'));
  ok('  each listed row carries "On a list"', await page.locator('.data-table tbody [data-on-list]').count() === 2);
  ok('  the scan details line counts them', /2 already on a list/.test(await page.locator('.scan-fold summary').innerText()));
  const opts = await sel.locator('option').allInnerTexts();
  ok('  offers hide on any list and the named list', opts.some(o => /Hide 2 on any list/.test(o)) && opts.some(o => /Hide 2 on Called last week/.test(o)), opts.join(' | '));

  await sel.selectOption('any'); await sleep(500);
  ok(`hiding takes them out of the table (${total} to ${total - 2})`, await rows() === total - 2, String(await rows()));
  ok('  and out of the downloads', await allSignal() === dlBefore - 2, `${dlBefore} -> ${await allSignal()}`);
  ok('  the details line says how many are hidden', /\(2 hidden\)/.test(await page.locator('.scan-fold summary').innerText()));
  const left = await page.locator('.data-table tbody').innerText();
  ok('  the two on the list are the ones gone', !/Ada Brant|Ben Cole/.test(left) && /Nia Rowe/.test(left));

  await sel.selectOption('off'); await sleep(400);
  ok('show brings them back', await rows() === total && await allSignal() === dlBefore);

  // Save the batch, then All leads.
  await page.locator('button[aria-label="Save to platform"]').click(); await sleep(1200);
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(1200);
  const count = async () => Number((await page.locator('.toolbar-row span b').first().innerText()).replace(/,/g, ''));
  const before = await count();
  const asel = page.locator('select[aria-label="Leads already on a list"]');
  ok('All leads offers the same dropdown', await asel.count() === 1);
  await asel.selectOption('any'); await sleep(600);
  ok(`All leads hides the two on a list (${before} to ${before - 2})`, await count() === before - 2, String(await count()));
  ok('  with a chip saying so', /Hiding leads on a list/.test(await page.locator('main').innerText()));
  const listId = await asel.locator('option', { hasText: 'Called last week' }).getAttribute('value');
  await asel.selectOption(listId); await sleep(500);
  ok('  picking the one list hides the same two', await count() === before - 2);
  await asel.selectOption('all'); await sleep(500);
  ok('  show brings them back', await count() === before);

  // Custom Scanner: same matcher. Ada (on the list, by email) and two others.
  const SHEAD = ['address1_country', 'description', 'emailaddress1', 'fullname', 'jobtitle', 'mobilephone',
    'telephone1', 'accountidname', 'websiteurl', 'address1_city', 'address1_stateorprovince', 'msdyn_segmentidname',
    'industrycodename', 'statuscodename', 'revenue', 'numberofemployees', 'campaignidname', 'companyname', 'estimatedclosedate'];
  const srows = [['Ada Brant', 'ada@alpha.com', 'ALPHA CO'], ['Ola Fenn', 'ola@kappa.com', 'KAPPA CO'], ['Ivo Hart', 'ivo@lambda.com', 'LAMBDA CO']];
  const scsv = [SHEAD.join(',')].concat(srows.map(([n, e, co], i) => [
    'US', samples[3], e, n, 'IT Director', `312-555-90${i}`, `312-555-10${i}`, `ACCT-${i}`, '', 'Chicago', 'IL', 'Seg', 'Tech', 'Open', '100', '250',
    'US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2', co, '2026-12-01',
  ].map(q).join(','))).join('\n');
  await page.locator('button[aria-label="Retired scanners"][aria-expanded="false"]').click({ timeout: 2000 }).catch(() => {}); await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'smc.csv', mimeType: 'text/csv', buffer: Buffer.from(scsv) });
  await sleep(3000);
  const ssel = page.locator('select[aria-label="Leads already on a list"]');
  ok('Custom Scanner offers the dropdown', await ssel.count() === 1);
  ok('  and says one row is already on a list', /1 of these rows is already on a list/.test(await page.locator('[aria-label="Already on a list"]').innerText()));
  const sBefore = (await page.locator('table.data-table tbody').innerText());
  await ssel.selectOption('any'); await sleep(600);
  const sAfter = (await page.locator('table.data-table tbody').innerText());
  ok('  hiding takes Ada out of the table', /Ada Brant/.test(sBefore) && !/Ada Brant/.test(sAfter) && /Ola Fenn/.test(sAfter), sAfter.slice(0, 200));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
