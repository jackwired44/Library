// A new upload is checked against everyone the Apollo syncs have named, so
// the CSV going back to Apollo is new people only.
//
// Per Jack: "i need to be able to see if i upload a new set of leads if any
// of those have been added in apollo already so i can remove them from the
// csv — set up a parallel here."
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';

const SEED = path.join(os.tmpdir(), 'roster-seed.csv');
fs.writeFileSync(SEED, csv(HEAD, [['SEED CO','Ada Brant','IT Director','ada@seed.com','312-555-0101', SIGNAL]]));
// The sync names three people. Only Ada is stored here; Zed and Lou are in
// Apollo but were never uploaded — exactly who a new upload must be
// checked against. Lou comes with a name and nothing else, as Apollo's task
// feed does.
const SYNC = path.join(os.tmpdir(), 'roster-sync.csv');
fs.writeFileSync(SYNC, ['Name,Email,Company,Sequences',
  'Ada Brant,ada@seed.com,SEED CO,Jack Main Sequence:active:2',
  'Zed Quinn,zed@newco.com,NEW CO,Carly Main Sequence:finished:5',
  'Lou Park,,,Jack Main Sequence:active:1'].join('\n'));
// The new batch: Zed (email match), Lou (name-only match), Nia (new).
const BATCH = path.join(os.tmpdir(), 'roster-batch.csv');
fs.writeFileSync(BATCH, csv(HEAD, [
  ['NEW CO','Zed Quinn','IT Manager','zed@newco.com','312-555-0301', SIGNAL],
  ['PARK INC','Lou Park','Owner','lou@parkinc.com','312-555-0302', SIGNAL],
  ['NIA LLC','Nia Rowe','CIO','nia@nia.com','312-555-0303', SIGNAL],
]));
const CSP_HEAD = ['customeridname','estimatedvalue','msp_forecastcomments','msp_licensingprogramname',
  'msp_partneraccountidname','fullname','telephone1','emailaddress1'];
const CSP = path.join(os.tmpdir(), 'roster-csp.csv');
fs.writeFileSync(CSP, csv(CSP_HEAD, [
  ['NEW CO','50000','JS - 1/Oct - Customer wants a partner for licensing.','CSP | Annual New Upfront Billing','NULL','Zed Quinn','312-555-0301','zed@newco.com'],
  ['OTHER CO','50000','JS - 1/Oct - Customer wants a partner for licensing.','CSP | Annual New Upfront Billing','NULL','Kim Lane','312-555-0401','kim@other.com'],
]));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const nav = async name => { const inApollo = name === 'In Apollo'; await page.locator('.side-nav-btn', { hasText: inApollo ? 'All leads' : name }).first().click(); await sleep(400); if (inApollo) await page.locator('.seg-btn', { hasText: 'Apollo standing' }).first().click(); await sleep(600); await page.evaluate(() => document.querySelectorAll('details.fold').forEach((d) => { d.open = true; })); await sleep(100); };
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const upload = async (scanner, file) => {
    await nav(scanner);
    if (await page.locator('button:has-text("Start over")').count()) { await page.locator('button:has-text("Start over")').first().click(); await sleep(800); }
    await page.setInputFiles('input[type=file]', file);
    await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
    await sleep(1200);
  };

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  console.log('\n== before any sync: says it has not checked ==');
  await upload('Main Scanner', SEED);
  ok('an upload with no sync on file says it was not checked', /Not checked against Apollo yet/.test(await main()));
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  console.log('\n== import the sync: every person joins the roster ==');
  await nav('All leads');
  await page.setInputFiles('main label:has-text("Import sync") input[type=file]', SYNC); await sleep(1200);
  ok('the sync imports', /of 3 rows matched/.test(await main()), (await main()).slice(0, 300));

  console.log('\n== a new batch is checked against it ==');
  await upload('Main Scanner', BATCH);
  let t = await main();
  ok('the scan details count who is already in Apollo', /2 already in Apollo/.test(t), t.slice(0, 600));
  ok('  and how each matched', /1 by email, 1 by name only/.test(t));
  const rows = async () => (await page.locator('.data-table tbody tr').allInnerTexts()).join(' | ');
  let r = await rows();
  ok('every lead stays in the table, Apollo matches included', /Nia Rowe/.test(r) && /Zed Quinn/.test(r) && /Lou Park/.test(r), r);
  const dl = async () => (await page.locator('.dl-strip').first().innerText()).replace(/\s+/g, ' ');
  ok('  but the downloads count only the new person', /M365 \/ Azure\s*1\b/.test(await dl()), await dl());
  const apolloSel = page.locator('select[aria-label="Leads already in Apollo"]');
  const picked = await apolloSel.evaluate((el) => el.selectedOptions[0].textContent);
  ok('  and the download dropdown says how many Strong Signal leads that leaves out', /Leave out 2 already in Apollo \(2 Strong Signal\)/.test(picked), picked);
  await page.locator('.scan-fold > summary').click(); await sleep(300);
  ok('  and the scan details spell it out', /Downloads hold 1 of 3 Strong Signal leads\.\s*2 are left out because they are already in Apollo/.test(await main()), (await main()).slice(0, 900));
  await page.locator('.scan-fold > summary').click(); await sleep(200);
  ok('  Zed carries an In Apollo badge (email match)', /Zed Quinn[^|]*In Apollo(?!\?)/.test(r), r);
  ok('  Lou carries an In Apollo? badge (name only)', /Lou Park[^|]*In Apollo\?/.test(r), r);
  ok('  Nia carries none', !/Nia Rowe[^|]*In Apollo/.test(r), r);
  ok('  the Strong Signal tab counts every row on screen', /Strong Signal \(3\)/.test(await main()), (await main()).slice(0, 400));
  await apolloSel.selectOption('in'); await sleep(600);
  r = await rows();
  ok('choosing Include leaves the table unchanged', /Nia Rowe/.test(r) && /Zed Quinn/.test(r) && /Lou Park/.test(r), r);
  ok('  and the downloads count all three again', /M365 \/ Azure\s*3\b/.test(await dl()), await dl());

  console.log('\n== the roster survives a reload ==');
  await page.reload(); await sleep(1500);
  await upload('Main Scanner', BATCH);
  ok('still 2 already in Apollo after a reload', /2 already in Apollo/.test(await main()));

  console.log('\n== the CSP scanner checks too ==');
  await upload('CSP Scanner', CSP);
  t = await main();
  ok('CSP: one row already in Apollo, by email', /1 of these rows is already in Apollo/.test(t) && /1 by email/.test(t), t.slice(0, 600));
  r = await rows();
  ok('  still shown in the CSP table', /Kim Lane/.test(r) && /Zed Quinn/.test(r), r);

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\napollo-roster-live ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
