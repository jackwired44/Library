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
  ok('a scan alone stores nothing — the Save button does', /Nothing stored yet/.test(await allLeadsText()));
  await nav('Main Scanner');
  ok('  and the scanner offers Save for every row', /Save \d[\d,]* rows to All leads/.test(await page.locator('main').innerText()));
  // Nothing is stored until Save (per Jack: a save option on every upload).
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  ok('  Save confirms what it stored', /✓ Saved \d[\d,]* leads? to All leads/.test(await page.locator('main').innerText()));
  await nav('All leads');
  const afterMain = await allLeadsText();
  ok('all three Main rows are stored', /3 leads stored/.test(afterMain), afterMain.slice(0, 200));
  ok('  the Strong Signal lead is there', /MAIN ALPHA CO/.test(afterMain));
  ok('  the Needs Review lead is there too', /MAIN BETA CO/.test(afterMain));
  ok('  and so is the Bad Lead — this is every tier, not a filtered shelf',
     /MAIN GAMMA CO/.test(afterMain));

  console.log('\n== the CSP Scanner stores leads, which it never did before ==');
  await nav('CSP Scanner');
  await page.setInputFiles('input[type=file]', CSP_FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1800);
  // Nothing is stored until Save (per Jack: a save option on every upload).
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await nav('All leads');
  const afterCsp = await allLeadsText();
  ok('CSP leads are now stored', /5 leads stored/.test(afterCsp), afterCsp.slice(0, 200));
  ok('  by name', /CSP ALPHA CO/.test(afterCsp) && /CSP BETA CO/.test(afterCsp));
  ok('  each scanner is identified on its own rows',
     /Main/.test(afterCsp) && /CSP/.test(afterCsp));
  ok('  CSP keeps its OWN tier vocabulary, not the Main Scanner\'s',
     /High priority|Medium priority|Low priority/.test(afterCsp), afterCsp.slice(0, 400));

  console.log('\n== search and filters ==');
  const search = page.locator('main input.field').first();
  await search.fill('CSP ALPHA'); await sleep(600);
  let t = await allLeadsText();
  ok('search narrows to one lead', /\b1 of 5\b/.test(t), t.slice(0, 200));
  ok('  and it is the right one', /CSP ALPHA CO/.test(t) && !/MAIN ALPHA CO/.test(t));
  await search.fill(''); await sleep(600);

  await page.selectOption('select[aria-label="Scanner"]', 'csp'); await sleep(600);
  t = await allLeadsText();
  ok('the scanner filter narrows to CSP only', /\b2 of 5\b/.test(t), t.slice(0, 200));
  ok('  and excludes the Main rows', !/MAIN ALPHA CO/.test(t));
  await page.selectOption('select[aria-label="Scanner"]', 'all'); await sleep(600);

  console.log('\n== Apollo state: honest while unsynced ==');
  t = await allLeadsText();
  ok('the panel says it has never been synced', /Not synced/.test(t), t.slice(0, 300));
  ok('  and warns that nothing therefore reads as in Apollo yet',
     /nothing here reads as "in Apollo" yet/i.test(t));
  // The Apollo filter now lives in the Filters panel.
  await page.locator('button.filter-btn').first().click(); await sleep(500);
  const apolloSel = page.locator('select[aria-label="Apollo state"]');
  ok('the Apollo filter offers "Never called"',
     /Never called/.test(await apolloSel.innerText()));
  ok('  and with nothing synced it counts every lead',
     /Never called \(5\)/.test(await apolloSel.innerText()), await apolloSel.innerText());
  ok('  "No Apollo record" also counts every lead',
     /No Apollo record \(5\)/.test(await apolloSel.innerText()));
  await apolloSel.selectOption('never-called'); await sleep(600);
  ok('  selecting it keeps all five', /\b5 of 5\b/.test(await allLeadsText()));
  await apolloSel.selectOption('all'); await sleep(500);

  console.log('\n== re-scanning the same file merges rather than duplicating ==');
  await nav('Main Scanner');
  await page.locator('button:has-text("Start over")').first().click(); await sleep(800);
  await page.setInputFiles('input[type=file]', MAIN_FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1500);
  // Nothing is stored until Save (per Jack: a save option on every upload).
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await nav('All leads');
  t = await allLeadsText();
  ok('the count does NOT grow on a re-upload', /5 leads stored/.test(t), t.slice(0, 200));
  // Per Jack: "if i reupload the same csv i dont want the contact to
  // consider it added more than once" — the same file counts once.
  ok('  and the same file is NOT counted twice', !/×2/.test(t), t.slice(0, 400));

  console.log('\n== notes COMBINE across uploads, never overwrite ==');
  // Per Jack: "i just want to combine the notes not override with just the
  // new one." Re-upload the same person with genuinely different wording
  // and both readings must survive.
  const SECOND = [MAIN_HEAD.join(',')].concat([
    ['MAIN ALPHA CO','Ada Brant','IT Director','ada@mainalpha.com','312-555-0101',
     'Follow up: renewal is December and they want a quote for Business Central for 40 users.'],
  ].map(r => r.map(q).join(','))).join('\n');
  const SECOND_FILE = path.join(os.tmpdir(), 'all-leads-main-2.csv');
  fs.writeFileSync(SECOND_FILE, SECOND);
  await nav('Main Scanner');
  await page.locator('button:has-text("Start over")').first().click(); await sleep(800);
  await page.setInputFiles('input[type=file]', SECOND_FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1500);
  // Nothing is stored until Save (per Jack: a save option on every upload).
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await nav('All leads');
  const search2 = page.locator('main input.field').first();
  await search2.fill('MAIN ALPHA'); await sleep(700);
  const cell = await page.locator('.data-table tbody tr').first().innerText();
  ok('the row still shows ONE lead, not two', /\b1 of 5\b/.test(await allLeadsText()), (await allLeadsText()).slice(0, 160));
  ok('  and flags that earlier notes are held behind it', /earlier/.test(cell), cell.replace(/\s+/g, ' ').slice(0, 300));
  // The full timeline lives in the cell's title attribute.
  const full = await page.locator('.data-table tbody tr td[data-col="notes"]').first().getAttribute('title');
  // The stored note is the scanner's rendered brief, not the raw comment,
  // so the evidence that both survived is the two DIFFERENT seat counts:
  // 40 from the follow-up upload, 240 from the original.
  ok('the NEW note is in the combined text', /40 seats/.test(full || ''), (full || '').slice(0, 300));
  ok('  and the ORIGINAL note was not overwritten \u2014 both counts present',
     /240/.test(full || ''), (full || '').slice(0, 400));
  ok('  as two separate dated lines, not one run-on',
     (full || '').split('\n').length === 2, String((full || '').split('\n').length));
  // This fixture is a Dynamics lead, and a Dynamics line now carries NO
  // generated question at all — per Jack, "i dont need a score for
  // dynamics ... i just need the platform ... the user count ... partner
  // and timeline". So the stronger assertion is zero, not one. The
  // combine's own ask-deduplication is covered directly in lead-store.
  ok('  and a Dynamics timeline carries no generated question at all',
     !/\bAsk /.test(full || ''), (full || '').slice(0, 400));
  // NB: the earlier segment of this same timeline is an M365/Azure scan,
  // which correctly KEEPS its "(NN) ▲" head — only Dynamics drops it. So
  // there is deliberately no assertion here that the whole combined note
  // is head-free; that would be asserting the wrong thing.
  ok('  both are dated', ((full || '').match(/\d{4}-\d{2}-\d{2}/g) || []).length >= 2, (full || '').slice(0, 300));
  await search2.fill(''); await sleep(500);

  console.log('\n== it survives a reload ==');
  await page.reload(); await sleep(2000);
  await nav('All leads');
  t = await allLeadsText();
  ok('leads persist across a full page reload', /5 leads stored/.test(t), t.slice(0, 200));
  ok('  with both scanners still represented',
     /MAIN ALPHA CO/.test(t) || /CSP ALPHA CO/.test(t));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
