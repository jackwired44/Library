// The Home dashboard, the strong-signal views, the dense lead table and the
// company roll-up — driven in a real browser.
//
// Per Jack: "redo the metrics part make it more like power bi … clearer
// for visibility", "a filter for strong signals that have never been
// contacted and strong signals that have been attempted to reach but not
// contacted", "see at a high level like 50-100 on a screen", and "how many
// emails we sent that contact how many calls … if there's multiple
// contacts we've made at the company."
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;

const STRONG = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const rows = [
  ['NORTHWIND CO', 'Ada Brant', 'IT Director', 'ada@northwind.com', '312-555-0101', STRONG],
  ['NORTHWIND CO', 'Ben Cole', 'CFO', 'ben@northwind.com', '312-555-0102', STRONG],
  ['FABRIKAM CO', 'Cy Webb', 'IT Manager', 'cy@fabrikam.com', '312-555-0103', STRONG],
  ['CONTOSO CO', 'Di Park', 'Owner', 'di@contoso.com', '312-555-0104', 'Mentioned Dynamics 365 in passing.'],
];
const FILE = path.join(os.tmpdir(), 'dashboard-live-main.csv');
fs.writeFileSync(FILE, ['Company,Full Name,Title,Email,Phone,Comments'].concat(rows.map(r => r.map(q).join(','))).join('\n'));
const SYNC = path.join(os.tmpdir(), 'dashboard-live-sync.csv');
fs.writeFileSync(SYNC, [
  'Email,Name,Company,Sequences,Call Count,Emails Sent,Outcomes,Last Outcome,Last Call',
  'ada@northwind.com,Ada Brant,NORTHWIND CO,Jack Main Sequence:active:3,5,2,No Answer x5,No Answer,2026-10-02',
  'ben@northwind.com,Ben Cole,NORTHWIND CO,Jack Main Sequence:active:1,0,0,,,',
  'cy@fabrikam.com,Cy Webb,FABRIKAM CO,Jack Main Sequence:finished:5,3,4,No Answer x2; Call Back Scheduled x1,Call Back Scheduled,2026-10-05',
].join('\n'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(60000);
  const nav = async name => { await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); };
  const text = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const kpi = async (label) => (await page.locator('.viz-kpi', { hasText: label }).first().innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1500);

  console.log('\n== Home: Power BI-style dashboard ==');
  await nav('Home');
  ok('KPI tiles render', (await page.locator('.viz-kpi').count()) >= 6);
  ok('Leads tile counts every stored lead', /^Leads 4\b/.test(await kpi('Leads')), await kpi('Leads'));
  ok('strong signal never contacted counts the top tier', /never contacted 3\b/.test(await kpi('never contacted')), await kpi('never contacted'));
  ok('every chart card has a title', (await page.locator('.viz-card .viz-title').count()) >= 9);
  // Slicers scope everything.
  await page.locator('[role=group][aria-label="Scanner"] button', { hasText: 'CSP' }).click(); await sleep(500);
  ok('the Scanner slicer re-scopes the tiles (CSP -> 0 leads)', /^Leads 0\b/.test(await kpi('Leads')), await kpi('Leads'));
  ok('  and says how many are in view', /0 of 4 leads in view/.test(await text()));
  await page.locator('button', { hasText: 'Reset' }).click(); await sleep(400);
  ok('Reset brings them back', /^Leads 4\b/.test(await kpi('Leads')));
  // Table view on a chart.
  const statusCard = page.locator('.viz-card', { hasText: 'Where every lead stands' });
  await statusCard.locator('.viz-toggle', { hasText: 'Table' }).click(); await sleep(300);
  ok('a chart switches to its table view', (await statusCard.locator('table.viz-table tbody tr').count()) === 11);
  await statusCard.locator('.viz-toggle', { hasText: 'Chart' }).click(); await sleep(300);
  // Hover tooltip.
  await statusCard.locator('.viz-barrow:has(.viz-barlabel:text-is("Qualified"))').hover(); await sleep(200);
  ok('hovering a bar shows a tooltip with its value', /\b3\b/.test(await statusCard.locator('[role=tooltip]').innerText().catch(() => '')));

  console.log('\n== sync, then the strong-signal views ==');
  await nav('All leads');
  await page.setInputFiles('main label:has-text("Import sync") input[type=file]', SYNC); await sleep(900);
  await nav('Home');
  ok('after the sync: strong signal tried, not reached = 1 (Ada)', /tried, not reached 1\b/.test(await kpi('tried, not reached')), await kpi('tried, not reached'));
  ok('  and never contacted = 1 (Ben: in a sequence, nothing logged)', /never contacted 1\b/.test(await kpi('never contacted')), await kpi('never contacted'));
  await page.locator('.viz-kpi', { hasText: 'tried, not reached' }).click(); await sleep(800);
  let t = await text();
  ok('the tile opens Leads on that exact view', /\b1 of 4\b/.test(t) && /NORTHWIND CO/.test(t) && /Ada Brant/.test(t), t.slice(0, 400));
  ok('  with the view button shown as active', (await page.locator('button[aria-pressed="true"]', { hasText: 'tried, not reached' }).count()) === 1);
  await page.locator('button[aria-pressed="true"]', { hasText: 'tried, not reached' }).click(); await sleep(400);
  await page.locator('button', { hasText: 'Strong signal · never contacted' }).click(); await sleep(400);
  t = await text();
  ok('"Strong signal · never contacted" finds Ben', /\b1 of 4\b/.test(t) && /Ben Cole/.test(t), t.slice(0, 400));
  await page.locator('button[aria-pressed="true"]', { hasText: 'never contacted' }).click(); await sleep(400);

  console.log('\n== the dense table ==');
  const rowH = await page.locator('.dense-table tbody tr').first().evaluate((el) => el.getBoundingClientRect().height);
  ok('rows are one line (~30px), so 50-100 fit a scroll', rowH <= 36, String(rowH));
  ok('100 rows per page by default', (await page.locator('select:has(option[value="500"])').inputValue()) === '100');
  const row = async (name) => (await page.locator('.dense-table tbody tr', { hasText: name }).first().innerText()).replace(/\s+/g, ' ');
  let r = await row('Ada Brant');
  ok('Ada: attempted, 5 calls, 2 emails, in Jack Main at step 3', /Attempted, not reached/.test(r) && /Jack Main Sequence · active · step 3/.test(r) && /\b5 2 No Answer/.test(r), r);
  ok('  her company shows both contacts, one worked', /\b2 · 1 worked\b/.test(r), r);
  r = await row('Cy Webb');
  ok('Cy: contact made (a call back is a real conversation), 4 emails', /Contact made/.test(r) && /\b3 4 Call Back Scheduled/.test(r), r);
  r = await row('Di Park');
  ok('Di: no Apollo record reads as Not in Apollo, never as never-contacted', /Not in Apollo/.test(r), r);
  ok('the position column reads the title', /Owner \/ C-suite/.test(r), r);
  await page.selectOption('select[aria-label="Outreach"]', 'attempted'); await sleep(400);
  ok('the Contact filter narrows to the attempted lead', /\b1 of 4\b/.test(await text()) && /Ada Brant/.test(await text()));
  await page.selectOption('select[aria-label="Outreach"]', 'all'); await sleep(300);

  console.log('\n== the profile: emails, and everyone at the company ==');
  await page.locator('.dense-table tbody tr', { hasText: 'Ada Brant' }).first().click(); await sleep(700);
  let dt = (await page.locator('[role=dialog]').innerText()).replace(/\s+/g, ' ');
  ok('emails sent shows on the profile', /Emails sent: 2/.test(dt), dt.match(/Emails sent.{0,40}/)?.[0]);
  ok('the company section lists both contacts with totals', /At NORTHWIND CO/i.test(dt) && /2 contacts · 1 worked · 0 reached · 5 calls · 2 emails/.test(dt), dt.match(/At NORTHWIND.{0,120}/i)?.[0]);
  await page.locator('[role=dialog] .viz-table tr', { hasText: 'Ben Cole' }).click(); await sleep(500);
  dt = (await page.locator('[role=dialog]').innerText()).replace(/\s+/g, ' ');
  ok('clicking a colleague opens their profile', /Ben Cole/.test(dt.slice(0, 200)) && /Ben Cole \(this lead\)/.test(dt), dt.slice(0, 200));
  await page.keyboard.press('Escape'); await sleep(300);

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`dashboard-live ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
