// Carly signs in and lands on her own Reps view. Per Jack: "her user will be
// carly@wiredcio.com to log in and carly1 for password here", "she can view
// her leads at a high glance and view unclaimed leads also by filtering
// through csv dates and recent uploads", and the columns she should see.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const FILE = path.join(os.tmpdir(), 'carly-login.csv');
fs.writeFileSync(FILE, ['Company,Full Name,Title,Email,Phone,Mobile Phone,Comments',
  ['UNCLAIMED CO', 'Una Free', 'CIO', 'una@unclaimed.com', '312-555-0101', '312-555-0199', 'Moving off Google Workspace to Microsoft 365 for 240 users with a partner.'].map(q).join(',')].join('\n'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };
const signIn = async (page, email, pw) => {
  await page.fill('input[aria-label="Email"]', email);
  await page.fill('input[type=password]', pw);
  await page.click('button:has-text("Unlock")'); await sleep(1200);
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(60000);
  await page.goto(BASE); await sleep(700);

  await signIn(page, 'carly@wiredcio.com', 'wrong');
  ok('a wrong password for Carly is refused', /Wrong email or password/.test(await page.locator('body').innerText()));
  await signIn(page, 'carly@wiredcio.com', 'carly1');
  ok('Carly signs in with carly1', await page.locator('input[aria-label="Email"]').count() === 0);
  ok('  and lands on Reps with her own tab', /Reps/.test(await page.locator('main h2').first().innerText())
     && await page.locator('[aria-label="Rep"] [aria-selected="true"]').innerText() === 'Carly');
  ok('  the top bar names her', /Carly/.test(await page.locator('.topbar-user').innerText()));

  // Seed one unclaimed lead, then look at it the way she would.
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr')); await sleep(600);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await page.locator('.side-nav-btn', { hasText: 'Reps' }).first().click(); await sleep(600);
  await page.locator('[aria-label="Rep"] button', { hasText: 'Unassigned' }).click(); await sleep(500);
  const head = await page.locator('table[aria-label="Unassigned\'s leads"] thead').innerText();
  ok('her lead table shows first, last, company, email, phone, signal and scanned note',
     ['FIRST NAME', 'LAST NAME', 'COMPANY', 'EMAIL', 'PHONE', 'SIGNAL', 'SCANNED NOTE'].every(h => head.toUpperCase().includes(h)), head);
  const row = await page.locator('table[aria-label="Unassigned\'s leads"] tbody tr', { hasText: 'UNCLAIMED CO' }).innerText();
  ok('  the unclaimed lead is there with both phone numbers', /Una/.test(row) && /Free/.test(row) && /312-555-0101/.test(row) && /312-555-0199/.test(row), row);
  ok('  and its signal', /Strong Signal|Needs Review|Bad Lead/.test(row), row);
  for (const l of ['CSV month', 'Uploaded file', 'Stored as']) ok(`  filter: ${l}`, await page.locator(`select[aria-label="${l}"]`).count() === 1);
  await page.locator('label', { hasText: 'Not in any sequence' }).locator('input').check(); await sleep(300);
  ok('"Not in any sequence" keeps the unclaimed lead', /UNCLAIMED CO/.test(await page.locator('main').innerText()));

  await page.locator('button', { hasText: 'Sign out' }).first().click(); await sleep(800);
  await signIn(page, 'jack@wiredcio.com', 'changeme');
  ok('Jack still signs in and lands where he always did', !/^Reps$/.test((await page.locator('main h2').first().innerText()).trim()));
  ok('  and the top bar names him', /Jack/.test(await page.locator('.topbar-user').innerText()));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
