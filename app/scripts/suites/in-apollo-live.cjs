// The In Apollo view: is a lead active in Apollo from here, and in which
// sequence. Read-only — nothing is queued or pushed to Apollo.
//
// Per Jack: "the apollo queue isnt what i want … i want to be able to see
// if a lead is active in apollo from here and if so which sequence", and
// "i dont want to push the leads over".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'inapollo-leads.csv');
fs.writeFileSync(LEADS, csv(HEAD, [
  ['ACTIVE CO','Ada Brant','IT Director','ada@active.com','312-555-0101', SIGNAL],
  ['ENDED CO','Ben Cole','CFO','ben@ended.com','312-555-0102', SIGNAL],
  ['NEW CO','Nia Rowe','CIO','nia@new.com','312-555-0103', SIGNAL],
]));
const SYNC = path.join(os.tmpdir(), 'inapollo-sync.csv');
fs.writeFileSync(SYNC, ['Name,Email,Company,Sequences',
  'Ada Brant,ada@active.com,ACTIVE CO,Jack Main Sequence:active:2; Old Sequence:finished:5',
  'Ben Cole,ben@ended.com,ENDED CO,Carly Main Sequence:finished:6'].join('\n'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const nav = async name => { await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); };
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const rows = async () => (await page.locator('.data-table tbody tr').allInnerTexts()).join(' | ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1000);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await nav('All leads');
  await page.setInputFiles('main label:has-text("Import sync") input[type=file]', SYNC); await sleep(1200);

  console.log('\n== the nav item is In Apollo, not a queue ==');
  ok('sidebar says In Apollo', await page.locator('.side-nav-btn', { hasText: 'In Apollo' }).count() === 1);
  ok('no Apollo queue in the sidebar', await page.locator('.side-nav-btn', { hasText: 'Apollo queue' }).count() === 0);

  console.log('\n== it shows who is active, and in which sequence ==');
  await nav('In Apollo');
  let t = await main();
  // An imported sync with no checks yet: Ben's sequence ended with no
  // conversation recorded, so he reads "never reached"; Nia was never
  // looked up, so she is "Not checked yet" rather than "Not in Apollo".
  ok('tiles count active / ended / not checked', /1 Active in a sequence/.test(t) && /1 Sequence ended, never reached/.test(t) && /1 Not checked yet/.test(t), t.slice(0, 700));
  ok('active-by-sequence lists the live sequence', /Active by sequence: Jack Main Sequence 1/.test(t), t.slice(0, 500));
  await page.locator('.vault-tile', { hasText: 'Active in a sequence' }).click(); await sleep(400);
  let r = await rows();
  ok('default view lists the active lead with its sequence', /Ada Brant[^|]*Active[^|]*Jack Main Sequence · active/.test(r) && !/Ben Cole/.test(r), r);
  ok('  and its ended sequence too, marked ended', /Ada Brant[^|]*Old Sequence · finished/.test(r), r);
  await page.locator('.vault-tile', { hasText: 'Sequence ended, never reached' }).click(); await sleep(400);
  r = await rows();
  ok('ended view shows Ben in Carly Main Sequence', /Ben Cole[^|]*Ended[^|]*Carly Main Sequence/.test(r), r);
  await page.locator('.vault-tile', { hasText: 'Not checked yet' }).click(); await sleep(400);
  r = await rows();
  ok('not-in-Apollo view shows Nia only', /Nia Rowe/.test(r) && !/Ada Brant/.test(r), r);

  console.log('\n== nothing here pushes or queues ==');
  t = await main();
  ok('no queue or export controls', !/Queue into|Export .* for Apollo|Remove from queue/i.test(t), t.slice(0, 400));
  await nav('All leads');
  ok('All leads has no "Queue into sequence" control', await page.locator('input[aria-label="Queue into sequence"]').count() === 0);

  console.log('\n== Home reports it too ==');
  await nav('Home');
  t = await main();
  ok('Home shows Active in Apollo', /Active in Apollo 1/.test(t), t.slice(0, 800));
  ok('Home no longer shows a queue', !/Queued for Apollo|Apollo queue/.test(t));

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\nin-apollo-live ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
