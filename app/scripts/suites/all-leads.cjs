// Every scanned lead is stored, from all three scanners, and survives a
// reload — driven in a real browser against real IndexedDB.
//
// Per Jack: "i will just upload the files again then store them going
// forward fresh library state as theyre uploaded", and "we need to make
// this the source of truth for leads … from raw lead to finished lead in
// this library".
//
// This is the first thing in the app that persists a Custom or CSP lead at
// all: buildRun records counts and filenames, never rows, so before this a
// 9,265-row CSP scan was gone on Start over unless the CSV was downloaded.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getDate()}/${MON[d.getMonth()]}`; };

// --- Main Scanner file: one Strong Signal, one Needs Review, one Bad Lead.
const MAIN_HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const mainCsv = [MAIN_HEAD.join(',')].concat([
  ['MAIN ALPHA CO','Ada Brant','IT Director','ada@mainalpha.com','312-555-0101',
   'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.'],
  ['MAIN BETA CO','Bo Hale','CFO','bo@mainbeta.com','312-555-0102',
   'Mentioned Dynamics 365 in passing on the last call.'],
  ['MAIN GAMMA CO','Cy Webb','Owner','cy@maingamma.com','312-555-0103',
   'Single freelancer, not interested, please unsubscribe.'],
].map(r => r.map(q).join(','))).join('\n');

// --- CSP file (13-column shape, as the real export comes).
const CSP_HEAD = ['customeridname','estimatedvalue','msp_forecastcomments','msp_licensingprogramname',
  'msp_partneraccountidname','msp_rollupestrevenue','fullname','telephone1','mobilephone',
  'emailaddress1','address1_country','campaignidname'];
const cspBase = { estimatedvalue:'', msp_rollupestrevenue:'', mobilephone:'NULL',
  address1_country:'United States', campaignidname:'NULL' };
const cspRow = o => CSP_HEAD.map(h => q(o[h] ?? '')).join(',');
const cspCsv = [CSP_HEAD.join(',')].concat([
  cspRow({ ...cspBase, customeridname:'CSP ALPHA CO', estimatedvalue:'120000', msp_rollupestrevenue:'120000',
    msp_licensingprogramname:'CSP | Annual New Upfront Billing', msp_partneraccountidname:'NULL',
    fullname:'Dana Reyes', telephone1:'312-555-0201', emailaddress1:'dana@cspalpha.com',
    msp_forecastcomments:`JS - ${ago(5)} - Customer is looking for a partner to take over licensing. Next Steps: intro call.` }),
  cspRow({ ...cspBase, customeridname:'CSP BETA CO', msp_licensingprogramname:'CSP | Monthly New',
    msp_partneraccountidname:'Some Reseller LLC', fullname:'Eve Stone', telephone1:'312-555-0202',
    emailaddress1:'eve@cspbeta.com',
    msp_forecastcomments:`JS - ${ago(40)} - Quote sent, awaiting review.` }),
]).join('\n');

const MAIN_FILE = path.join(os.tmpdir(), 'all-leads-main.csv');
const CSP_FILE = path.join(os.tmpdir(), 'all-leads-csp.csv');
fs.writeFileSync(MAIN_FILE, mainCsv);
fs.writeFileSync(CSP_FILE, cspCsv);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);

  const nav = async name => { await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); };
  const allLeadsText = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  console.log('\n== empty state ==');
  await nav('All leads');
  ok('All leads is in the nav and opens', /All leads/.test(await allLeadsText()));
  ok('  and says nothing is stored yet', /Nothing stored yet/.test(await allLeadsText()));

  console.log('\n== the Main Scanner stores every tier, not just Strong Signal ==');
  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', MAIN_FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1500);
  await nav('All leads');
  const afterMain = await allLeadsText();
  ok('all three Main rows are stored', /3 leads scanned/.test(afterMain), afterMain.slice(0, 200));
  ok('  the Strong Signal lead is there', /MAIN ALPHA CO/.test(afterMain));
  ok('  the Needs Review lead is there too', /MAIN BETA CO/.test(afterMain));
  ok('  and so is the Bad Lead — this is every tier, not a filtered shelf',
     /MAIN GAMMA CO/.test(afterMain));

  console.log('\n== the CSP Scanner stores leads, which it never did before ==');
  await nav('CSP Scanner');
  await page.setInputFiles('input[type=file]', CSP_FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1800);
  await nav('All leads');
  const afterCsp = await allLeadsText();
  ok('CSP leads are now stored', /5 leads scanned/.test(afterCsp), afterCsp.slice(0, 200));
  ok('  by name', /CSP ALPHA CO/.test(afterCsp) && /CSP BETA CO/.test(afterCsp));
  ok('  each scanner is identified on its own rows',
     /Main/.test(afterCsp) && /CSP/.test(afterCsp));
  ok('  CSP keeps its OWN tier vocabulary, not the Main Scanner\'s',
     /High priority|Medium priority|Low priority/.test(afterCsp), afterCsp.slice(0, 400));

  console.log('\n== search and filters ==');
  const search = page.locator('main input.field').first();
  await search.fill('CSP ALPHA'); await sleep(600);
  let t = await allLeadsText();
  ok('search narrows to one lead', /1 of 5 shown/.test(t), t.slice(0, 200));
  ok('  and it is the right one', /CSP ALPHA CO/.test(t) && !/MAIN ALPHA CO/.test(t));
  await search.fill(''); await sleep(600);

  await page.selectOption('select[aria-label="Scanner"]', 'csp'); await sleep(600);
  t = await allLeadsText();
  ok('the scanner filter narrows to CSP only', /2 of 5 shown/.test(t), t.slice(0, 200));
  ok('  and excludes the Main rows', !/MAIN ALPHA CO/.test(t));
  await page.selectOption('select[aria-label="Scanner"]', 'all'); await sleep(600);

  console.log('\n== Apollo state: honest while unsynced ==');
  t = await allLeadsText();
  ok('the panel says it has never been synced', /Not synced yet/.test(t), t.slice(0, 300));
  ok('  and warns that every lead therefore reads as never contacted',
     /every lead currently reads as never contacted/i.test(t));
  const apolloSel = page.locator('select[aria-label="Apollo state"]');
  ok('the Apollo filter offers "Never contacted"',
     /Never contacted/.test(await apolloSel.innerText()));
  ok('  and with nothing synced it counts every lead',
     /Never contacted \(5\)/.test(await apolloSel.innerText()), await apolloSel.innerText());
  ok('  "No Apollo record" also counts every lead',
     /No Apollo record \(5\)/.test(await apolloSel.innerText()));
  await apolloSel.selectOption('never-contacted'); await sleep(600);
  ok('  selecting it keeps all five', /5 of 5 shown/.test(await allLeadsText()));
  await apolloSel.selectOption('all'); await sleep(500);

  console.log('\n== re-scanning the same file merges rather than duplicating ==');
  await nav('Main Scanner');
  await page.locator('button:has-text("Start over")').first().click(); await sleep(800);
  await page.setInputFiles('input[type=file]', MAIN_FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1500);
  await nav('All leads');
  t = await allLeadsText();
  ok('the count does NOT grow on a re-upload', /5 leads scanned/.test(t), t.slice(0, 200));
  ok('  and the lead records it has been seen twice', /×2/.test(t), t.slice(0, 400));

  console.log('\n== it survives a reload ==');
  await page.reload(); await sleep(2000);
  await nav('All leads');
  t = await allLeadsText();
  ok('leads persist across a full page reload', /5 leads scanned/.test(t), t.slice(0, 200));
  ok('  with both scanners still represented',
     /MAIN ALPHA CO/.test(t) || /CSP ALPHA CO/.test(t));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
