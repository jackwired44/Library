// Product-line chip counts must equal what the chip opens.
// Per Jack: "counts are off strong signal says 1810 but doesnt add up" —
// M365 / Azure read 4 while its download held 15, because the Google tab
// stayed selected after clicking back to All and the chip counted only it.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const FILE = path.join(os.tmpdir(), 'chip-counts.csv');
fs.writeFileSync(FILE, ['Company,Full Name,Title,Email,Phone,Comments',
  ['GOOG CO', 'Gia Goog', 'CIO', 'gia@googco.com', '312-555-0201', 'Looking to move from Google Workspace to Microsoft 365 for 240 users this quarter.'],
  ['LIC CO', 'Lou Lic', 'CFO', 'lou@licco.com', '312-555-0202', 'Want to purchase 60 Microsoft 365 Business Premium licenses.'],
  ['SEC CO', 'Sam Sec', 'IT Manager', 'sam@secco.com', '312-555-0203', 'They want a partner for ongoing Microsoft 365 support and security hardening, 80 users.'],
  ['BC CO', 'Bea Bc', 'Controller', 'bea@bcco.com', '312-555-0204', 'Evaluating Dynamics 365 Business Central for 40 users to replace QuickBooks.'],
  ['CRM CO', 'Cal Crm', 'VP Sales', 'cal@crmco.com', '312-555-0205', 'Wants Dynamics 365 Sales for their 25 person sales team, would like a demo.'],
].map((r, i) => i === 0 ? r : r.map(q).join(',')).join('\n'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };
const num = s => Number((String(s).match(/\((\d+)\)/) || [])[1]);

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(60000);
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'));
  await sleep(700);
  const chip = label => page.locator('.chip-btn', { hasText: label }).first();
  const rows = async () => page.locator('.data-table tbody tr').count();

  const all0 = num(await chip(/^All \(/).innerText());
  const m0 = num(await chip('M365 / Azure').innerText());
  const d0 = num(await chip('Dynamics 365').innerText());
  ok('chips add up: Dynamics + M365 / Azure = All', d0 + m0 === all0, `${d0} + ${m0} vs ${all0}`);

  // Jack's path: open M365 / Azure, pick the Google tab, go back to All.
  await chip('M365 / Azure').click(); await sleep(300);
  await page.locator('button', { hasText: /Google → Microsoft/ }).first().click(); await sleep(300);
  const googleRows = await rows();
  ok('Google tab narrows the table', googleRows > 0 && googleRows < m0, `${googleRows} of ${m0}`);
  await chip(/^All \(/).click(); await sleep(300);
  const m1 = num(await chip('M365 / Azure').innerText());
  ok('back on All, M365 / Azure still counts the whole line', m1 === m0, `${m1} vs ${m0}`);
  ok('  and the chips still add up', num(await chip('Dynamics 365').innerText()) + m1 === num(await chip(/^All \(/).innerText()));
  await chip('M365 / Azure').click(); await sleep(300);
  ok('clicking it opens exactly that many rows (View tab reset to All)', await rows() === m1, `${await rows()} vs ${m1}`);

  // Same on the Dynamics side.
  await chip('Dynamics 365').click(); await sleep(300);
  await page.locator('button', { hasText: /Business Central \/ ERP/ }).first().click(); await sleep(300);
  await chip(/^All \(/).click(); await sleep(300);
  const d1 = num(await chip('Dynamics 365').innerText());
  ok('Dynamics chip ignores a remembered Business Central tab', d1 === d0, `${d1} vs ${d0}`);
  await chip('Dynamics 365').click(); await sleep(300);
  ok('  and opens exactly that many rows', await rows() === d1);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
