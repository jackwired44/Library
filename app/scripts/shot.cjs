const BASE = 'http://localhost:4188';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const samples = require('./fixtures/smc-samples.json');
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-Library/dd1348d8-8ff6-501c-af5d-361f8a90722b/scratchpad';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = v => `"${String(v).replace(/"/g, '""')}"`;

const CAMPS = ['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~FY24~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~FY24~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const smcCsv = ['companyname,description,campaignidname,emailaddress1,fullname,jobtitle,telephone1']
  .concat(samples.map((d,i)=>[esc(''),esc(d),esc(CAMPS[i]||'NULL'),esc(''),esc(''),esc(''),esc('')].join(','))).join('\n');

const mainCsv = ['Company,Full Name,Title,Email,Phone,Comments']
  .concat([
    ['Alpine Freight','Dana Reyes','Ops Director','dana@alpinefreight.com','312-555-0101','Looking at Dynamics 365 Business Central for 40 users this year.'],
    ['Borden Labs','Reed Okafor','IT Manager','reed@bordenlabs.com','312-555-0201','We need to migrate from Google Workspace to Microsoft 365, bringing in a partner.'],
    ['Cortez Medical','Mia Cortez','Owner','mia@cortezmed.com','312-555-0301','Not interested, happy with our current provider.'],
    ['Delta Works','Kim Alvarez','CFO','kim@deltaworks.com','312-555-0401','Evaluating Azure migration off on-prem, need a CSP partner for billing.'],
    ['Echo Retail','Sam Lee','VP IT','sam@echoretail.com','312-555-0501','Service-Microsoft 365 Business Standard-50 users renewal coming up.'],
  ].map(r=>r.map(esc).join(','))).join('\n');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE '+m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  // Main Scanner
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'main.csv', mimeType: 'text/csv', buffer: Buffer.from(mainCsv) });
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/ui-main.png`, fullPage: false });
  console.log('main scanner shot');

  // Custom Scanner
  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'smc.csv', mimeType: 'text/csv', buffer: Buffer.from(smcCsv) });
  await sleep(2800);
  await page.screenshot({ path: `${OUT}/ui-custom.png`, fullPage: false });
  console.log('custom scanner shot');

  // expanded setup
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(600);
  await page.screenshot({ path: `${OUT}/ui-custom-setup.png`, fullPage: false });
  console.log('setup shot');

  console.log('errors:', errs.length ? errs.slice(0,3) : 'none');
  await b.close();
})();
