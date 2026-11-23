// M365 / Azure sub-categories: FOUR, and a lead lands in exactly one.
// Per Jack (2026-11-23): "for azure dont need to break it down that much
// mainly just migrations together with azure doc intelligence app builds and
// it support AND ONLY IT ONE NOT MULTIPLE SUB CATEORGIES JUST DO FOUR SUB
// CATEGORIES LICENSING COPILOT SECURITY DEVICE MANAGEMNET SHULD BE TOGETHER".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = (require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const FILE = path.join(os.tmpdir(), 'm365-topics.csv');
// One row per bucket, plus two rows that hit several signals so the single
// answer and its precedence are both exercised.
fs.writeFileSync(FILE, ['Company,Full Name,Title,Email,Phone,Comments',
  ['MIG CO', 'Mia Mig', 'CIO', 'mia@migco.com', '312-555-0301', 'Looking to move from Google Workspace to Microsoft 365 for 240 users this quarter.'],
  ['DOC CO', 'Dan Doc', 'COO', 'dan@docco.com', '312-555-0302', 'They want Azure Document Intelligence to digitize a backlog of paper records for 60 staff.'],
  ['SUP CO', 'Sue Sup', 'Owner', 'sue@supco.com', '312-555-0303', 'Want a partner for ongoing IT support and help desk across Microsoft 365, 80 users.'],
  ['LIC CO', 'Lou Lic', 'CFO', 'lou@licco.com', '312-555-0304', 'Want to purchase 60 Microsoft 365 Business Premium licenses.'],
  ['COP CO', 'Cal Cop', 'CTO', 'cal@copco.com', '312-555-0305', 'Rolling out Microsoft 365 Copilot to 120 users, want help with adoption.'],
  ['SEC CO', 'Sam Sec', 'IT Manager', 'sam@secco.com', '312-555-0306', 'Need a security assessment and Defender hardening for 90 users.'],
  ['DEV CO', 'Dee Dev', 'IT Director', 'dee@devco.com', '312-555-0307', 'Want to roll out Intune device management and Autopilot for 70 laptops.'],
  // Several signals at once: migration + licences -> Azure wins over Licensing.
  ['BOTH CO', 'Bo Both', 'CIO', 'bo@bothco.com', '312-555-0308', 'Migrating on-prem servers to Azure and need to renew 150 Microsoft 365 E3 licenses.'],
  // Copilot + licences -> Copilot wins over Licensing.
  ['COPLIC CO', 'Cam Coplic', 'CFO', 'cam@coplicco.com', '312-555-0309', 'Want to buy 40 Microsoft 365 Copilot licenses on top of our E3 seats.'],
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

  // Open the M365 / Azure product line so the sub-category row renders.
  await page.locator('.chip-btn', { hasText: /^M365 \/ Azure \(/ }).first().click(); await sleep(400);

  const LABELS = ['Azure & migrations', 'Licensing', 'Copilot', 'Security & device management'];
  const tab = label => page.locator('.seg-btn, .chip-btn', { hasText: label }).first();

  // Exactly four, and none of the old ten.
  for (const l of LABELS) ok(`tab present: ${l}`, await tab(l).count() > 0);
  // Anchored, because "Device management" is a substring of the new
  // "Security & device management" label.
  for (const gone of ['Other migrations', 'Document Intelligence / app builds', 'Azure infrastructure', 'IT support / MSP', 'Power BI / Fabric', 'Device management', 'Google → Microsoft']) {
    const re = new RegExp('^' + gone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\(');
    ok(`old tab gone: ${gone}`, await page.locator('.seg-btn, .chip-btn', { hasText: re }).count() === 0);
  }

  // Each bucket holds its lead, and the counts add up to the whole line.
  const counts = {};
  for (const l of LABELS) counts[l] = num(await tab(l).innerText());
  const line = num(await page.locator('.chip-btn', { hasText: /^M365 \/ Azure \(/ }).first().innerText());
  const summed = LABELS.reduce((a, l) => a + (counts[l] || 0), 0);
  ok('every sub-category count fits inside the product line', summed <= line, `${summed} > ${line}`);
  ok('nothing is double-counted (9 rows, 9 placements)', summed === 9, `summed ${summed}`);

  const companiesUnder = async label => {
    await tab(label).click(); await sleep(350);
    return page.locator('.data-table tbody tr').evaluateAll(rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  };
  const az = await companiesUnder('Azure & migrations');
  for (const c of ['MIG CO', 'DOC CO', 'SUP CO', 'BOTH CO']) ok(`Azure & migrations holds ${c}`, az.join(' ').includes(c), az.join(' | '));
  const li = await companiesUnder('Licensing');
  ok('Licensing holds LIC CO', li.join(' ').includes('LIC CO'));
  ok('Licensing does NOT hold BOTH CO (Azure wins)', !li.join(' ').includes('BOTH CO'));
  ok('Licensing does NOT hold COPLIC CO (Copilot wins)', !li.join(' ').includes('COPLIC CO'));
  const co = await companiesUnder('Copilot');
  for (const c of ['COP CO', 'COPLIC CO']) ok(`Copilot holds ${c}`, co.join(' ').includes(c), co.join(' | '));
  const se = await companiesUnder('Security & device management');
  for (const c of ['SEC CO', 'DEV CO']) ok(`Security & device management holds ${c}`, se.join(' ').includes(c), se.join(' | '));

  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
  console.log(`\n${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
