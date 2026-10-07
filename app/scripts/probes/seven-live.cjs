// Reproduce Jack's seven-file Main Scanner upload in a real browser and
// read EVERY number off the screen.
//
// He reported: Rows scanned 2,216 / Strong Signal 959 / Needs review 711 /
// Bad leads 546, on a fresh upload of seven files totalling 5,599 raw rows.
// Headless, scanParsedFiles returns rowsScanned = 5,599 and the identical
// tier counts, so the classification is right and only the row count is in
// question. handleFiles DOES pass rowsScanned through, so reasoning about
// the code was not settling it — this drives the real app instead.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIR = '/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b';
const FILES = [
  '1261f659-Book9-30.csv',
  'aaf4a246-Book9-20_1.csv',
  '4fb61679-Book9-14_1.csv',
  '8b918ba7-Book8-10-26.csv',
  'c6d90c01-Book8-21-26.csv',
  'bb31c527-Book8-26-26.csv',
  'd119ae44-Book9-4-26.csv',
].map(f => `${DIR}/${f}`);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(300000);

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  const sc = page.locator('input[aria-label="Scanner password"]');
  if (await sc.count()) { await sc.fill('changeme'); await page.click('button:has-text("Unlock")'); await sleep(900); }

  console.log('\n== uploading all seven at once, exactly as Jack did ==');
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', FILES);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 300000 });
  await sleep(4000);
  console.log(`  scan completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const main = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const n = (re) => { const m = re.exec(main); return m ? Number(m[1].replace(/,/g, '')) : null; };
  const ni = (label) => n(new RegExp(label.replace(/ /g, '\\s+') + '\\s+([\\d,]+)', 'i'));

  console.log('\n== the KPI tiles, as shown ==');
  const tile = ni('Rows scanned');
  const signal = ni('Strong Signal');
  const review = ni('Needs review');
  const bad = ni('Bad leads');
  console.log(`  Rows scanned   ${tile}`);
  console.log(`  Strong Signal  ${signal}`);
  console.log(`  Needs review   ${review}`);
  console.log(`  Bad leads      ${bad}`);

  console.log('\n== the accounting line, verbatim ==');
  const acct = /([\d,]+)\s+read[^A-Z]{0,200}/i.exec(main);
  console.log(acct ? `  ${acct[0].trim().slice(0, 240)}` : '  (no accounting line found)');
  const dupes = ni('duplicates merged') ?? n(/([\d,]+) duplicates/i);
  const nosig = n(/([\d,]+) (?:had )?no signal/i);
  console.log(`  parsed from it -> duplicates ${dupes}, no signal ${nosig}`);

  console.log('\n== verdict ==');
  ok('Rows scanned reads the TRUE raw total (5,599)', tile === 5599, `tile=${tile}`);
  ok('  and is NOT the processed count (2,216)', tile !== 2216, `tile=${tile}`);
  ok('Strong Signal matches the headless engine (959)', signal === 959, `${signal}`);
  ok('Needs review matches (711)', review === 711, `${review}`);
  ok('Bad leads matches (546)', bad === 546, `${bad}`);
  ok('the tier sum is BELOW rows scanned, as it must be',
     (signal + review + bad) < (tile || 0), `${signal}+${review}+${bad}=${signal + review + bad} vs ${tile}`);
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
