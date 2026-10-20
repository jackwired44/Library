// The four working sequences as lists in Lists, filled from what Apollo
// told us (a sync file here; the live pull fills the same roster).
//
// Per Jack: "for the apollo four seqeuences we are mainly working from jack
// main sequence, carly main sequnece and their backups or recycled sequence
// create lists in here so we can view them all quickly and we can update it".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';

const SEED = path.join(os.tmpdir(), 'seqlists-seed.csv');
fs.writeFileSync(SEED, csv(HEAD, [['SEED CO','Ada Brant','IT Director','ada@seed.com','312-555-0101', SIGNAL]]));
// Carly Main Sequence and Carly Main Sequence Recycled must stay apart.
const SYNC = path.join(os.tmpdir(), 'seqlists-sync.csv');
fs.writeFileSync(SYNC, ['Name,Email,Company,Sequences',
  'Ada Brant,ada@seed.com,SEED CO,Jack Main Sequence:active:2',
  'Zed Quinn,zed@newco.com,NEW CO,Jack Main Sequence:finished:5',
  'Lou Park,lou@park.com,PARK INC,Jack Main Backup Sequence:active:1',
  'Kim Lane,kim@lane.com,LANE CO,Carly Main Sequence:active:3',
  'Bo Reyes,bo@reyes.com,REYES CO,Carly Main Sequence Recycled:finished:4',
  'Ivy Holt,ivy@holt.com,HOLT CO,Some Other Sequence:active:1'].join('\n'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('skipFileNameBox', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(60000);
  const nav = async name => { await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); await page.evaluate(() => document.querySelectorAll('details.fold').forEach((d) => { d.open = true; })); };
  const panel = () => page.locator('[aria-label="Working sequences"]');
  const text = async () => (await panel().innerText()).replace(/\s+/g, ' ');
  const rows = async () => (await panel().locator('tbody tr').allInnerTexts()).join(' | ');
  const tab = name => panel().locator('[role=tab]').filter({ has: page.locator('.vault-label', { hasText: new RegExp(`^${name}$`) }) });

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  console.log('\n== empty before anything is read ==');
  await nav('Lists');
  ok('the working sequences panel is on Lists', await panel().count() === 1);
  ok('  all four sequences have a tab', await panel().locator('[role=tab]').count() === 4);
  ok('  and it says nothing is known yet', /Nobody known to be in Jack Main Sequence yet/.test(await text()), await text());
  ok('  with an Update from Apollo button', await panel().locator('button:has-text("Update from Apollo")').count() === 1);

  console.log('\n== store a lead, import a sync ==');
  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', SEED);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'));
  await sleep(1000);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await nav('All leads');
  await page.setInputFiles('main label:has-text("Import sync") input[type=file]', SYNC); await sleep(1200);

  console.log('\n== each list holds exactly its own people ==');
  await nav('Lists');
  let t = await text();
  ok('Jack Main Sequence: 2 (1 active, 1 ended)', /2 Jack Main Sequence 1 active · 1 ended/.test(t), t.slice(0, 500));
  ok('Jack Main Backup Sequence: 1', /1 Jack Main Backup Sequence 1 active · 0 ended/.test(t));
  ok('Carly Main Sequence: 1, not swallowing Recycled', /1 Carly Main Sequence 1 active · 0 ended/.test(t));
  ok('Carly Main Sequence Recycled: 1', /1 Carly Main Sequence Recycled 0 active · 1 ended/.test(t));
  let r = await rows();
  ok('Jack Main lists Ada and Zed', /Ada Brant/.test(r) && /Zed Quinn/.test(r), r);
  ok('  active first', r.indexOf('Ada Brant') < r.indexOf('Zed Quinn'), r);
  ok('  Ada is matched to her stored lead', /Ada Brant[^|]*High priority/.test(r), r);
  ok('  Zed reads "Not stored here"', /Zed Quinn[^|]*Not stored here/.test(r), r);
  ok('  a sequence outside the four is not listed anywhere', !/Ivy Holt/.test(t));

  await tab('Carly Main Sequence').click(); await sleep(300);
  r = await rows();
  ok('Carly Main tab shows Kim only', /Kim Lane/.test(r) && !/Bo Reyes/.test(r), r);
  await tab('Carly Main Sequence Recycled').click(); await sleep(300);
  r = await rows();
  ok('Recycled tab shows Bo only', /Bo Reyes/.test(r) && !/Kim Lane/.test(r), r);

  console.log('\n== filters ==');
  await tab('Jack Main Sequence').click(); await sleep(300);
  await panel().locator('select[aria-label="Sequence status"]').selectOption('ended'); await sleep(200);
  r = await rows();
  ok('Ended only shows Zed', /Zed Quinn/.test(r) && !/Ada Brant/.test(r), r);
  await panel().locator('select[aria-label="Sequence status"]').selectOption('all');
  await panel().locator('label:has-text("Stored leads only") input').check(); await sleep(200);
  r = await rows();
  ok('Stored leads only shows Ada', /Ada Brant/.test(r) && !/Zed Quinn/.test(r), r);
  await panel().locator('label:has-text("Stored leads only") input').uncheck();
  await panel().locator('input[aria-label="Search sequence"]').fill('newco'); await sleep(200);
  r = await rows();
  ok('search by email finds Zed', /Zed Quinn/.test(r) && !/Ada Brant/.test(r), r);
  await panel().locator('input[aria-label="Search sequence"]').fill('');

  console.log('\n== download ==');
  const [d] = await Promise.all([page.waitForEvent('download'), panel().locator('button:has-text("Download")').click()]);
  const body = fs.readFileSync(await d.path(), 'utf8');
  ok('the CSV names the sequence and both people', /Jack Main Sequence/.test(body) && /Ada/.test(body) && /Zed/.test(body), body.slice(0, 300));
  ok('  with a status column', /Active/.test(body) && /Ended/.test(body));

  console.log('\n== the chosen tab is remembered ==');
  await tab('Jack Main Backup Sequence').click(); await sleep(200);
  await page.reload(); await sleep(1500);
  await nav('Lists');
  ok('Backup tab still selected after reload', /Lou Park/.test(await rows()), await rows());

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\nsequence-lists-live ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
