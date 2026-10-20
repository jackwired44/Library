// "Wants a partner" filter, Main Scanner and All leads.
// Per Jack: "in main scanner i want to be able to filter by and in all
// leads if someeone states they want a partner".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const FILE = path.join(os.tmpdir(), 'partner-filter.csv');
fs.writeFileSync(FILE, ['Company,Full Name,Title,Email,Phone,Comments',
  ['ASK CO', 'Abe Ask', 'CIO', 'abe@askco.com', '312-555-0101', 'Looking to move from Google Workspace to Microsoft 365 for 240 users. They would like to work with a partner for the rollout.'],
  ['MSP CO', 'Mia Msp', 'COO', 'mia@mspco.com', '312-555-0102', 'Evaluating Dynamics 365 Business Central for 40 users to replace QuickBooks. Want to work with an MSP for ongoing support.'],
  ['DIRECT CO', 'Dee Direct', 'CFO', 'dee@directco.com', '312-555-0103', 'Microsoft 365 E3 renewal for 200 users. Wants to buy direct from Microsoft going forward.'],
  ['PLAIN CO', 'Pat Plain', 'IT Manager', 'pat@plainco.com', '312-555-0104', 'Moving to Microsoft 365 Business Premium for 60 users from Google Workspace this quarter.'],
  ['NOT CO', 'Ned Not', 'CEO', 'ned@notco.com', '312-555-0105', 'Microsoft 365 Business Premium for 50 users. Not looking for a partner, they handle it in house.'],
].map((r, i) => i === 0 ? r : r.map(q).join(',')).join('\n'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(60000);
  const nav = async (name, sub) => {
    await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(500);
    if (sub) { await page.locator('.seg-btn', { hasText: sub }).first().click(); await sleep(500); }
  };
  const tableText = async () => (await page.locator('.data-table tbody').first().innerText()).replace(/\s+/g, ' ');
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  console.log('\n== Main Scanner ==');
  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'));
  await sleep(700);
  const allTab = page.locator('main button', { hasText: /^All \(5\)$/ }).first();
  if (await allTab.count()) { await allTab.click(); await sleep(300); }
  const btn = page.locator('button', { hasText: /wants a partner/i }).first();
  ok('a "Wants a partner" toggle is on the scanner', await btn.count() === 1);
  ok('  its count is the two stated asks', /\(2\)/.test(await btn.innerText()), await btn.innerText());
  await btn.click(); await sleep(400);
  let t = await tableText();
  ok('filters to the leads asking for a partner', /ASK CO/.test(t) && /MSP CO/.test(t), t.slice(0, 300));
  ok('  not the one buying direct, not "not looking for a partner", not a plain lead', !/DIRECT CO/.test(t) && !/NOT CO/.test(t) && !/PLAIN CO/.test(t), t.slice(0, 300));
  await btn.click(); await sleep(400);
  ok('toggling off shows them all again', /PLAIN CO/.test(await tableText()));
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  console.log('\n== All leads ==');
  await nav('All leads', 'Leads');
  const ab = page.locator('button.filter-btn', { hasText: /Wants a partner/ }).first();
  ok('All leads has the toggle', await ab.count() === 1);
  await ab.click(); await sleep(1200);
  t = await tableText();
  ok('filters All leads to the stated asks', /ASK CO/.test(t) && /MSP CO/.test(t) && !/DIRECT CO/.test(t) && !/PLAIN CO/.test(t) && !/NOT CO/.test(t), t.slice(0, 300));
  ok('  with its count on the button', /\(2\)/.test(await ab.innerText()), await ab.innerText());
  ok('  and a chip saying so', (await page.locator('main').innerText()).includes('⚑ Wants a partner'));
  await ab.click(); await sleep(500);
  ok('off again shows every lead', /PLAIN CO/.test(await tableText()));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
