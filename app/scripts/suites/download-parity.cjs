// Per Jack: the Custom Scanner's post-scan download must line up with the
// Main Scanner's, column for column. Nothing here touches the Main Scanner
// — it is the reference, downloaded live and compared against.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const samples = require('../fixtures/smc-samples.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
const esc = v => `"${String(v).replace(/"/g, '""')}"`;
const header = t => t.split('\n')[0].replace(/\r$/, '').match(/("([^"]|"")*"|[^,]*)/g).filter(x => x !== '').map(c => c.replace(/^"|"$/g, '').replace(/\r$/, ''));

const mainCsv = ['Company,Full Name,Title,Email,Phone,Comments'].concat([
  ['Alpine Freight', 'Dana Reyes', 'Ops Director', 'dana@alpinefreight.com', '312-555-0101', 'Looking at Dynamics 365 Business Central for 40 users this year.'],
  ['Borden Labs', 'Reed Okafor', 'IT Manager', 'reed@bordenlabs.com', '312-555-0201', 'Need to migrate from Google Workspace to Microsoft 365, bringing in a partner.'],
].map(r => r.map(esc).join(','))).join('\n');

const HEAD = ['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename','statuscodename','revenue','numberofemployees','campaignidname','companyname','description','estimatedclosedate'];
const CAMPS = ['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~US~FY26~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~US~FY26~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const smcCsv = [HEAD.join(',')].concat(samples.map((d, i) => [
  'US', d, 'real' + i + '@corp.com', 'Pat Vance ' + i, 'IT Director', '312-555-90' + i, '312-555-10' + i,
  'ACCT-' + i + ' (CRM record)', 'corp.com', 'Chicago', 'IL', 'Seg', 'Tech', 'Open', '100', '250',
  CAMPS[i] || 'NULL', 'Real Company ' + i, 'second desc', '2026-12-01',
].map(esc).join(','))).join('\n');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1300);

  console.log('\n== Main Scanner download (the reference) ==');
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'main.csv', mimeType: 'text/csv', buffer: Buffer.from(mainCsv) });
  await sleep(2600);
  const [d1] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('.dl-strip button.btn-primary').first().click(),
  ]);
  const f1 = path.join(os.tmpdir(), 'parity-main.csv'); await d1.saveAs(f1);
  const mainCols = header(fs.readFileSync(f1, 'utf8'));
  ok('Main Scanner still exports its own columns, untouched',
     JSON.stringify(mainCols) === JSON.stringify(['First Name','Last Name','Title','Company Name','Email','Work Direct Phone','Mobile Phone','Number of Employees','Product Area','Notes']),
     JSON.stringify(mainCols));

  console.log('\n== Custom Scanner download ==');
  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'smc.csv', mimeType: 'text/csv', buffer: Buffer.from(smcCsv) });
  await sleep(3000);
  const [d2] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('button[aria-label="Download All High priority leads"]').click(),
  ]);
  const f2 = path.join(os.tmpdir(), 'parity-custom.csv'); await d2.saveAs(f2);
  const custText = fs.readFileSync(f2, 'utf8');
  const custCols = header(custText);

  // Jack's call, revised: IDENTICAL to the Main Scanner, Last Name included,
  // so the column letters line up on every scanner — he works to "column I
  // and J", which only holds at ten columns. A full-name source is split
  // instead of dropping the column.
  ok('Custom Scanner columns are exactly the Main Scanner\'s, same order',
     JSON.stringify(custCols) === JSON.stringify(mainCols), `${JSON.stringify(custCols)} vs ${JSON.stringify(mainCols)}`);
  ok('ten columns exactly', custCols.length === 10, String(custCols.length));
  ok('Product Area is column I and Notes is column J',
     custCols[8] === 'Product Area' && custCols[9] === 'Notes', custCols.slice(8).join(','));

  console.log('\n== the data under those headings is real ==');
  const rows = custText.split('\n').slice(1).filter(Boolean);
  ok('at least one Strong Signal row downloaded', rows.length > 0, String(rows.length));
  const cells = rows[0].match(/("([^"]|"")*"|[^,]*)/g).filter(x => x !== '').map(c => c.replace(/^"|"$/g, ''));
  const at = n => cells[custCols.indexOf(n)] || '';
  ok('Name is a person, not a CRM record id', /^[A-Za-z]/.test(at('First Name')) && !/ACCT-/.test(at('First Name')), at('First Name'));
  ok('Company Name is the company, not the account column', !/ACCT-|CRM record/.test(at('Company Name')) && at('Company Name').length > 0, at('Company Name'));
  ok('Email present', /@/.test(at('Email')), at('Email'));
  ok('Work and Mobile phone are different columns, not the same number',
     at('Work Direct Phone') !== '' && at('Mobile Phone') !== '' && at('Work Direct Phone') !== at('Mobile Phone'),
     `${at('Work Direct Phone')} vs ${at('Mobile Phone')}`);
  ok('Number of Employees filled', /^\d+$/.test(at('Number of Employees')), at('Number of Employees'));
  ok('Product Area is a real product line', ['Dynamics 365', 'M365 / Azure'].includes(at('Product Area')), at('Product Area'));
  ok('Notes carries the reason', at('Notes').length > 10, at('Notes').slice(0, 60));
  ok('no COE / EA renewal campaign text in Notes', !/COE|True Up|EA Renewal/i.test(at('Notes')), at('Notes').slice(0, 80));

  console.log('\n== errors ==');
  ok('no page or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
