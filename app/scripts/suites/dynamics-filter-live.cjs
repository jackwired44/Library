// All leads: Strong Signal → Dynamics 365 → the Dynamics breakdown. Per Jack:
// "need to be able to filter in strong leads into dynamics then the
// breakdowns as it follows with erp bc and sales crm then eveyrhting".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = rows => ['Company,Full Name,Title,Email,Comments'].concat(rows.map(r => r.map(q).join(','))).join('\n');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynf-'));
const F = path.join(dir, 'Book10-29-26.csv');
fs.writeFileSync(F, csv([
  ['BC Co', 'Bea Cole', 'CFO', 'bea@bcco.com', 'Evaluating Dynamics 365 Business Central to replace QuickBooks for 25 users this quarter, want a partner to implement.'],
  ['Sales Co', 'Sam Hale', 'VP Sales', 'sam@salesco.com', 'Evaluating Dynamics 365 Sales to replace Salesforce for 40 users, want a partner to implement it this quarter.'],
  ['FO Co', 'Fay Orr', 'CFO', 'fay@foco.com', 'Evaluating Dynamics 365 Finance and Operations to replace SAP for 200 users, want a partner to implement it this year.'],
  ['M365 Co', 'Mo Kent', 'IT Director', 'mo@m365co.com', 'Looking to move from Google Workspace to Microsoft 365 for 120 users and want a partner to run it.'],
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

  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(800);
  ok('the Dynamics view only appears once Dynamics is picked', await page.locator('select[aria-label="Dynamics view"]').count() === 0);
  await page.locator('.seg-btn', { hasText: /^Strong Signal/ }).first().click(); await sleep(400);
  const lineVal = await page.locator('select[aria-label="Product line"] option', { hasText: 'Dynamics 365' }).first().getAttribute('value');
  await page.selectOption('select[aria-label="Product line"]', lineVal); await sleep(500);
  const dyn = page.locator('select[aria-label="Dynamics view"]');
  ok('picking Dynamics 365 shows the Dynamics view', await dyn.count() === 1);
  const opts = (await dyn.locator('option').allInnerTexts()).join(' | ');
  ok('  with the three breakdowns and their counts', /All Dynamics 365 \(3\)/.test(opts) && /Business Central \/ ERP \(1\)/.test(opts) && /Sales \/ CRM \/ Customer Service \(1\)/.test(opts) && /Everything else \(F&O, supply chain\) \(1\)/.test(opts), opts);
  const rows = async () => (await page.locator('.all-leads-table tbody').innerText()).replace(/\s+/g, ' ');
  await dyn.selectOption('bc'); await sleep(400);
  let t = await rows();
  ok('Business Central / ERP shows just the BC lead', /BC Co/.test(t) && !/Sales Co|FO Co|M365 Co/.test(t), t.slice(0, 200));
  await dyn.selectOption('sales'); await sleep(400);
  t = await rows();
  ok('Sales / CRM shows just the Sales lead', /Sales Co/.test(t) && !/BC Co|FO Co/.test(t), t.slice(0, 200));
  await dyn.selectOption('other'); await sleep(400);
  t = await rows();
  ok('Everything else shows just the F&O lead', /FO Co/.test(t) && !/BC Co|Sales Co/.test(t), t.slice(0, 200));
  ok('  and it shows as a filter chip', /Everything else \(F&O, supply chain\) ✕/.test((await page.locator('main').innerText())));
  await page.selectOption('select[aria-label="Product line"]', 'all'); await sleep(400);
  ok('leaving Dynamics clears the breakdown', await dyn.count() === 0 && /M365 Co/.test(await rows()));
  await sleep(1500);
  const readStored = () => page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1'); r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('leads', 'readonly').objectStore('leads').getAll(); tx.onsuccess = () => res(tx.result.filter((l) => l.dynamicsView).map((l) => `${l.company}:${l.dynamicsView}`).sort().join(','));
    }; r.onerror = () => res('error'); r.onblocked = () => res('blocked'); setTimeout(() => res('timeout'), 5000);
  }));
  let stored = '';
  for (let i = 0; i < 3; i++) { try { stored = await readStored(); break; } catch { await sleep(1500); } }
  ok('the scan stores each Dynamics lead\'s breakdown', stored === 'BC Co:bc,FO Co:other,Sales Co:sales', stored);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
