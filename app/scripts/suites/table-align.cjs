// Column alignment: the header and every body row must have the same number
// of cells. The results table has been reordered several times and its cells
// come out of an IIFE fragment, which is exactly where a row silently ends up
// one cell short and every value after it shows under the wrong heading.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const samples = require('../fixtures/smc-samples.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
const esc = v => `"${String(v).replace(/"/g, '""')}"`;
const HEAD = ['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','numberofemployees','campaignidname','companyname','description_1','estimatedclosedate'];
const CAMPS = ['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~FY24~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13'];
// Deliberately ragged: some rows carry CSV identity, some carry none, so the
// "—" fallbacks are exercised as well as the populated cells.
const csv = [HEAD.join(',')].concat(samples.map((d, i) => {
  const bare = i % 2 === 0;
  return ['US', d, bare ? '' : `p${i}@corp.com`, bare ? '' : `Pat Vance ${i}`, bare ? '' : 'IT Director',
    bare ? '' : `3125550${i}`, bare ? '' : `3124440${i}`, `ACCT-${i}`, '', bare ? '' : '250',
    CAMPS[i % CAMPS.length], bare ? '' : `Corp ${i}`, 'second desc', '2026-12-01'].map(esc).join(',');
})).join('\n');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1300);
  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'ragged.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await sleep(2800);

  const shape = await page.evaluate(() => {
    const t = document.querySelector('.data-table');
    const headers = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
    const rows = [...t.querySelectorAll('tbody tr')].map(r => [...r.children].length);
    return { headers, rows };
  });
  console.log('  headers:', shape.headers.join(' | '));
  ok(`every row has exactly ${shape.headers.length} cells, matching the header`,
     shape.rows.every(n => n === shape.headers.length), `row cell counts: ${[...new Set(shape.rows)].join(',')}`);

  // The nine download columns plus Tier, and nothing else masquerading as data.
  const expected = ['Name','Company','Tier','Product line','Notes','Title','Email','Work phone','Mobile','Employees','Curate'];
  ok('headers are the nine download fields plus Tier, then the Curate action',
     JSON.stringify(shape.headers) === JSON.stringify(expected), JSON.stringify(shape.headers));

  // A value must sit under its own heading: check a known lead cell by cell.
  const col = n => shape.headers.indexOf(n);
  const rowFor = async name => page.evaluate((n) => {
    const t = document.querySelector('.data-table');
    const row = [...t.querySelectorAll('tbody tr')].find(r => r.children[0].textContent.includes(n));
    return row ? [...row.children].map(c => c.textContent.trim()) : null;
  }, name);
  const r = await rowFor('Christopher Hallski');
  ok('a known lead row was found', !!r);
  if (r) {
    ok('Name holds a person', /Christopher Hallski/.test(r[col('Name')]), r[col('Name')]);
    ok('Company holds the company', /New Leaf Publishing/.test(r[col('Company')]), r[col('Company')]);
    ok('Tier holds a tier label', /Strong Signal|Needs Review|Bad Leads|No Signal/.test(r[col('Tier')]), r[col('Tier')]);
    ok('Product line holds a product line', /Dynamics 365|M365 \/ Azure|—/.test(r[col('Product line')]), r[col('Product line')]);
    ok('Email holds an email or a dash', /@|—/.test(r[col('Email')]), r[col('Email')]);
    ok('Work phone is not an email', !/@/.test(r[col('Work phone')]), r[col('Work phone')]);
    ok('Employees is a number or a dash', /^\d+$|^—$/.test(r[col('Employees')]), r[col('Employees')]);
    ok('Curate holds the actions', /Keep/.test(r[col('Curate')]), r[col('Curate')]);
  }

  // Same check on every tier tab, since each renders a different mix of rows.
  for (const tab of ['Strong Signal', 'Needs Review', 'Bad Leads', 'No Signal']) {
    const btn = page.locator('.seg-btn', { hasText: new RegExp(`^${tab} \\(`) }).first();
    if (await btn.count() === 0) continue;
    await btn.click(); await sleep(500);
    const counts = await page.evaluate(() => {
      const t = document.querySelector('.data-table');
      const h = t.querySelectorAll('thead th').length;
      return [...t.querySelectorAll('tbody tr')].map(r => [...r.children].length).filter(n => n !== h && n !== 1);
    });
    ok(`${tab} tab: no misaligned rows`, counts.length === 0, JSON.stringify(counts));
  }

  ok('no page or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
