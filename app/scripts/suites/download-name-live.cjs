// Every download asks for a file name first. Per Jack: "need to be able to
// name the csv before i download and export the file".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'dlname-leads.csv');
fs.writeFileSync(LEADS, csv(HEAD, [
  ['ALPHA CO','Ada Brant','IT Director','ada@alpha.com','312-555-0101', SIGNAL],
  ['BETA CO','Ben Cole','CFO','ben@beta.com','312-555-0102', SIGNAL],
  ['GAMMA CO','Nia Rowe','CIO','nia@gamma.com','312-555-0103', SIGNAL],
  ['DELTA CO','Rae Lin','CFO','rae@delta.com','312-555-0104', 'Mentioned Dynamics 365 in passing.'],
]));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL ' + name + (detail ? '  — ' + detail : '')); } };

(async () => {
  const browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
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

  const dl = page.locator('.dl-strip button', { hasText: 'All Strong Signal' }).first();
  await dl.click(); await sleep(300);
  const box = page.locator('[role=dialog][aria-label="Name the file"]');
  ok('a download asks for a file name first', await box.count() === 1);
  const input = box.locator('input[aria-label="File name"]');
  const suggested = await input.inputValue();
  ok('  pre-filled with the suggested name, extension shown apart', suggested.length > 3 && !/\.csv$/i.test(suggested) && /\.csv/.test(await box.innerText()), suggested);
  await box.locator('button', { hasText: 'Cancel' }).click(); await sleep(300);
  ok('  Cancel downloads nothing and closes it', await box.count() === 0);

  await dl.click(); await sleep(300);
  await input.fill('Jack picks: Oct 17');
  const [d1] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), input.press('Enter')]);
  ok('  Enter downloads under the typed name, made safe, .csv kept', d1.suggestedFilename() === 'Jack picks- Oct 17.csv', d1.suggestedFilename());

  // Per Jack: "need to be able to rename the csv when i download it". It
  // asks every time; there is no way to switch it off from the page.
  await page.evaluate(() => localStorage.setItem('askFileName', '0'));
  await dl.click(); await sleep(300);
  ok('  there is no "Don\'t ask again" to switch it off', await box.count() === 1 && await box.locator('input[type=checkbox]').count() === 0);
  ok('  an old "don\'t ask" setting no longer hides it', await box.count() === 1);
  const [d2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), box.locator('button', { hasText: 'Download' }).click()]);
  ok('  Download with the name untouched uses the suggested name', d2.suggestedFilename() === suggested + '.csv', d2.suggestedFilename());
  await dl.click(); await sleep(300);
  ok('  and the next download asks again', await box.count() === 1);
  await box.locator('button', { hasText: 'Cancel' }).click(); await sleep(200);
  ok('no page errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
