// The upload -> qualify -> route -> export pipeline, in a real browser.
//
// Per Jack: "upload all new leads here and start pre storing them with the
// relevant seuqence to transition to into apollo to create as task to call
// and email", with the scanners in "a drop down section on the left hand
// side" and a Home page "overseeing it all".
//
// The guarantee that matters most is the last one: an exported lead is
// never re-queued by a re-upload, so nothing goes to Apollo twice.
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
   'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it. Target go-live March 2027.'],
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

const MAIN_FILE = path.join(os.tmpdir(), 'queue-live-main.csv');
const CSP_FILE = path.join(os.tmpdir(), 'queue-live-csp.csv');
fs.writeFileSync(MAIN_FILE, mainCsv);
fs.writeFileSync(CSP_FILE, cspCsv);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);

  const nav = async name => { await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); };
  const text = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const navNames = async () => (await page.locator('.side-nav-btn').allInnerTexts()).map(t => t.split('\n')[0].trim());
  const card = name => page.locator('.panel', { has: page.locator('.panel-head b', { hasText: name }) }).first();
  const login = async () => {
    await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
    await page.fill('input[type=password]', 'changeme');
    await page.click('button:has-text("Unlock")'); await sleep(1200);
  };
  const upload = async (scanner, file) => {
    await nav(scanner);
    await page.setInputFiles('input[type=file]', file);
    await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
    await sleep(1800);
  };

  await page.goto(BASE); await sleep(700);
  await login();

  console.log('\n== Home is the landing page ==');
  let t = await text();
  ok('lands on Home', /Good (morning|afternoon|evening), Jack/.test(t), t.slice(0, 160));
  ok('  with the first-run next step', /Upload your first leads/.test(t));

  console.log('\n== scanners are a collapsible sidebar section ==');
  let names = await navNames();
  ok('all three scanners listed under the section', ['Main Scanner', 'Custom Scanner September', 'CSP Scanner'].every(n => names.includes(n)), JSON.stringify(names));
  await page.locator('button.sidebar-group', { hasText: 'Scanners' }).click(); await sleep(300);
  names = await navNames();
  ok('collapsing hides them', !names.includes('Main Scanner'), JSON.stringify(names));
  ok('  and leaves the rest of the nav', names.includes('All leads') && names.includes('Apollo queue'));
  await page.locator('button.sidebar-group', { hasText: 'Scanners' }).click(); await sleep(300);
  ok('expanding brings them back', (await navNames()).includes('CSP Scanner'));

  console.log('\n== upload: qualified CSP leads route themselves ==');
  await upload('Main Scanner', MAIN_FILE);
  await upload('CSP Scanner', CSP_FILE);
  await nav('Apollo queue');
  t = await text();
  ok('the CSP Leads sequence appears in the queue', /CSP Leads/.test(t), t.slice(0, 400));
  const cspCard = card('CSP Leads');
  const cspHead = (await cspCard.locator('.panel-head').innerText()).replace(/\s+/g, ' ');
  ok('  with the qualified CSP lead queued', /[1-9]\d* queued/.test(cspHead), cspHead);
  ok('  and the top CSP lead is the one in it', /CSP ALPHA CO/.test((await cspCard.innerText())), (await cspCard.innerText()).slice(0, 300));
  ok('a Main lead with no rule is held, not routed', /Waiting on a rule\s*[1-9]/i.test(t) || /Qualified, waiting on a rule/.test(t), t.slice(0, 600));

  console.log('\n== a routing rule queues the waiting leads ==');
  const rule = page.locator('input[aria-label="Sequence for Main · M365 / Azure"]');
  if (!(await rule.count())) { await page.locator('.panel-head', { hasText: 'Routing rules' }).click(); await sleep(300); }
  await page.fill('input[aria-label="Sequence for Main · M365 / Azure"]', 'Jack Main Sequence');
  await page.click('button:has-text("Save rules & route")'); await sleep(900);
  t = await text();
  ok('saving the rule routes the waiting lead', /[1-9]\d* qualified leads? routed/.test(t), t.slice(0, 500));
  ok('  into the named sequence', /Jack Main Sequence/.test(t));
  ok('  and it is the Main lead', /MAIN ALPHA CO/.test(await card('Jack Main Sequence').innerText()));

  console.log('\n== export writes one Apollo file per sequence, then marks it sent ==');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    card('CSP Leads').locator('button', { hasText: /Export \d+ for Apollo/ }).click(),
  ]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('the file is named for the sequence', /^apollo-csp-leads-\d+-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok('  carries Apollo\'s own columns plus Sequence', /^First Name,Last Name,Title,Company,Email/.test(csv) && /,Sequence\s*$/m.test(csv.split('\n')[0]), csv.split('\n')[0]);
  ok('  and the lead with its target', /CSP ALPHA CO/.test(csv) && /CSP Leads/.test(csv.split('\n')[1] || ''), csv.slice(0, 300));
  await sleep(600);
  const after = (await card('CSP Leads').locator('.panel-head').innerText()).replace(/\s+/g, ' ');
  ok('after export nothing is left queued in that sequence', /\b0 queued/.test(after), after);
  ok('  and the leads count as exported', /[1-9]\d* already exported/.test(after), after);

  console.log('\n== a lead can be moved between sequences ==');
  const jm = card('Jack Main Sequence');
  await jm.locator('select[aria-label="Move to another sequence"]').first().selectOption('CSP Leads'); await sleep(700);
  ok('moving it re-queues it in the other sequence',
     /[1-9]\d* queued/.test((await card('CSP Leads').locator('.panel-head').innerText()).replace(/\s+/g, ' ')));

  console.log('\n== a re-upload never sends a lead twice ==');
  await page.locator('.side-nav-btn', { hasText: 'CSP Scanner' }).first().click(); await sleep(600);
  // Leaving the scanner already returns it to its upload screen; only
  // press Start over if results are still showing.
  const so = page.locator('button:has-text("Start over")');
  if (await so.count()) { await so.first().click(); await sleep(800); }
  await upload('CSP Scanner', CSP_FILE);
  await nav('Apollo queue');
  const cspAfter = card('CSP Leads');
  const head2 = (await cspAfter.locator('.panel-head').innerText()).replace(/\s+/g, ' ');
  ok('the exported CSP lead stays exported after a re-upload', /[1-9]\d* already exported/.test(head2), head2);
  const queuedTable = (await cspAfter.innerText());
  ok('  and is NOT back in the queued list', !/CSP ALPHA CO/.test(queuedTable.split('Exported (')[0].split('Queued (')[1] || ''), queuedTable.slice(0, 400));

  console.log('\n== Home reflects the pipeline ==');
  await nav('Home');
  t = await text();
  ok('Home counts leads stored', /Leads stored\s*5/i.test(t), t.slice(0, 400));
  ok('  shows queued and exported', /Queued\s*[1-9]/i.test(t) && /Exported\s*[1-9]/i.test(t), t.slice(0, 500));
  ok('  and lists the queue by sequence', /CSP Leads/.test(t));

  console.log('\n== All leads shows where each lead is headed ==');
  await nav('All leads');
  t = await text();
  ok('the Headed for column names the sequence', /CSP Leads/.test(t) && /exported \d{4}-\d{2}-\d{2}/.test(t), t.slice(0, 600));
  await page.locator('button.filter-btn').first().click(); await sleep(400);
  await page.selectOption('select[aria-label="Queue status"]', 'exported'); await sleep(500);
  t = await text();
  ok('filtering by "Exported to Apollo" narrows to the exported leads', /\b[1-9] of 5\b/.test(t) && /exported \d{4}/.test(t), t.slice(0, 300));
  await page.selectOption('select[aria-label="Queue status"]', 'none'); await sleep(500);
  ok('  and "Not queued" shows the rest', /\b[1-9] of 5\b/.test(await text()));

  console.log('\n== Apollo sync fills the Sequence and Calls columns ==');
  const SYNC_FILE = path.join(os.tmpdir(), 'queue-live-sync.csv');
  fs.writeFileSync(SYNC_FILE, [
    'Email,Name,Company,Sequences,Call Count,Outcomes,Last Outcome,Last Call,Call History',
    'dana@cspalpha.com,Dana Reyes,CSP ALPHA CO,CSP Leads:active:2,3,No Answer x2; Meeting Booked x1,Meeting Booked,2026-10-07,2026-10-01 No Answer @CSP Leads:1; 2026-10-03 No Answer @CSP Leads:1; 2026-10-07 Meeting Booked @CSP Leads:2',
    'ada@mainalpha.com,Ada Brant,MAIN ALPHA CO,Jack Main Sequence:finished:5,4,No Answer x4,No Answer,2026-10-01,',
  ].join('\n'));
  await nav('All leads');
  // Still on All leads from the step above, with its filter set — clear it.
  const clr = page.locator('main button', { hasText: 'Clear all' });
  if (await clr.count()) { await clr.first().click(); await sleep(400); }
  await page.setInputFiles('main label:has-text("Import sync") input[type=file]', SYNC_FILE); await sleep(900);
  t = await text();
  ok('the sync matches both leads', /\b2\b of 2 rows matched/.test(t), t.slice(0, 500));
  const rowOf = async (co) => (await page.locator('.data-table tbody tr', { hasText: co }).first().innerText()).replace(/\s+/g, ' ');
  let r = await rowOf('CSP ALPHA CO');
  ok('Sequence column names the Apollo sequence with status and step', /CSP Leads active · step 2/.test(r), r);
  ok('Calls column shows the count and the last outcome', /3 calls Meeting Booked · 2026-10-07/.test(r), r);
  ok('status reads Meeting booked', /Meeting booked/.test(r), r);
  r = await rowOf('MAIN ALPHA CO');
  ok('a finished sequence shows where it stopped', /Jack Main Sequence finished · step 5/.test(r), r);
  ok('dialled but never reached is NOT "contacted"', /Called, not reached/.test(r) && /4 calls/.test(r), r);

  console.log('\n== the status strip filters ==');
  await page.locator('button[aria-pressed]', { hasText: 'Meeting booked' }).click(); await sleep(500);
  t = await text();
  ok('clicking Meeting booked narrows to that lead', /\b1 of 5\b/.test(t) && /CSP ALPHA CO/.test(t), t.slice(0, 300));
  await page.locator('button[aria-pressed]', { hasText: 'Meeting booked' }).click(); await sleep(400);
  ok('clicking again clears it', /\b5 of 5\b/.test(await text()));

  console.log('\n== a hand-set status sticks ==');
  await page.locator('.data-table tbody tr', { hasText: 'MAIN BETA CO' }).first().click(); await sleep(500);
  ok('the lead opens in a side panel with its position', /\d+ of 5/.test(await page.locator('[role=dialog]').innerText()));
  await page.selectOption('[role=dialog] select[aria-label="Change status"]', 'not-interested'); await sleep(500);
  ok('the override shows as hand-set', /Not interested ✎/.test(await page.locator('[role=dialog]').innerText()));
  const before = (await page.locator('[role=dialog]').innerText()).match(/(\d+) of 5/)[1];
  await page.locator('[role=dialog] button', { hasText: 'Next' }).click(); await sleep(400);
  const afterPos = (await page.locator('[role=dialog]').innerText()).match(/(\d+) of 5/)[1];
  ok('Next steps to the following lead', Number(afterPos) === Number(before) + 1, `${before} -> ${afterPos}`);
  await page.keyboard.press('Escape'); await sleep(300);
  ok('Escape closes the panel', (await page.locator('[role=dialog]').count()) === 0);
  await upload('Main Scanner', MAIN_FILE);
  await nav('All leads');
  r = await rowOf('MAIN BETA CO');
  ok('the hand-set status survives a re-upload', /Not interested ✎/.test(r), r);

  console.log('\n== the lead record: before and after ==');
  const dialog = () => page.locator('[role=dialog]');
  await page.locator('.data-table tbody tr', { hasText: 'CSP ALPHA CO' }).first().click(); await sleep(800);
  let dt = (await dialog().innerText()).replace(/\s+/g, ' ');
  ok('Before shows the RAW note exactly as the CSV had it', /Before.*Customer is looking for a partner to take over licensing/.test(dt), dt.slice(0, 600));
  ok('  with the file it came in and its upload date', /queue-live-csp\.csv · uploaded \d{4}-\d{2}-\d{2}/.test(dt));
  ok('  and the month it was received', /Received [A-Z][a-z]+ \d{4}/.test(dt));
  ok('After shows the scanned note and where it is headed', /After.*Scanned note.*Headed for/.test(dt) || (/After/.test(dt) && /Headed for/.test(dt) && /Scanned note/.test(dt)));
  ok('the outcome leads the record', /Meeting booked/.test(dt.slice(0, 400)), dt.slice(0, 400));
  ok('the sequence is drawn step by step with where they are', /CSP Leads ● active · on step 2/.test(dt), dt.match(/Sequences.{0,200}/)?.[0]);
  ok('the disposition history is dated, newest first', /2026-10-07 Meeting Booked · CSP Leads step 2 2026-10-03 No Answer/.test(dt), dt.match(/Disposition history.{0,200}/)?.[0]);
  await page.keyboard.press('Escape'); await sleep(300);

  await page.locator('.data-table tbody tr', { hasText: 'MAIN ALPHA CO' }).first().click(); await sleep(800);
  dt = (await dialog().innerText()).replace(/\s+/g, ' ');
  ok('dialled four times and never reached is flagged as such', /Never reached Called 4 times/.test(dt), dt.slice(0, 500));
  ok('a date the notes mention is pulled out', /Dates in the notes.*2027-03-31/i.test(dt), dt.match(/Dates in the notes.{0,200}/i)?.[0]);
  ok('  and marked in the raw note', (await dialog().locator('mark', { hasText: 'March 2027' }).count()) > 0);
  await page.keyboard.press('Escape'); await sleep(300);
  const mainRow = await rowOf('MAIN ALPHA CO');
  ok('the Leads row shows the next date in the notes', /📅 2027-03-31/.test(mainRow), mainRow);

  console.log('\n== filter by dates in notes, received month, never reached ==');
  await page.locator('button.filter-btn').first().click(); await sleep(400);
  await page.selectOption('select[aria-label="Dates in notes"]', 'upcoming'); await sleep(500);
  t = await text();
  ok('"Mentions an upcoming date" narrows to that lead', /\b1 of 5\b/.test(t) && /MAIN ALPHA CO/.test(t), t.slice(0, 300));
  await page.selectOption('select[aria-label="Dates in notes"]', 'all'); await sleep(300);
  const months = await page.locator('select[aria-label="Received month"] option').allInnerTexts();
  ok('the received-month filter lists the month the leads came in', months.some((m) => /[A-Z][a-z]+ \d{4} \(\d+\)/.test(m)), JSON.stringify(months));
  await page.selectOption('select[aria-label="Apollo state"]', 'never-reached'); await sleep(500);
  t = await text();
  ok('"Called, never reached" finds the lead dialled with no answer', /\b1 of 5\b/.test(t) && /MAIN ALPHA CO/.test(t), t.slice(0, 300));
  await page.locator('main button', { hasText: 'Clear all' }).first().click(); await sleep(400);

  console.log('\n== position filter ==');
  const posOpts = (await page.locator('select[aria-label="Position"] option').allInnerTexts()).join(' | ');
  ok('Position counts the fixture titles', /Director \/ Head of \(1\)/.test(posOpts) && /Owner \/ C-suite \(2\)/.test(posOpts) && /No title \(2\)/.test(posOpts), posOpts);
  await page.selectOption('select[aria-label="Position"]', 'director'); await sleep(500);
  t = await text();
  ok('Position: Director narrows to the IT Director', /\b1 of 5\b/.test(t) && /MAIN ALPHA CO/.test(t), t.slice(0, 300));
  await page.selectOption('select[aria-label="Position"]', 'all'); await sleep(300);

  console.log('\n== Home shows the status lifecycle ==');
  await nav('Home');
  t = await text();
  ok('Home lists statuses by stage', /Lead status/.test(t) && /Meeting booked/.test(t) && /Called, not reached/.test(t), t.slice(0, 600));
  await page.locator('main button', { hasText: 'Meeting booked' }).first().click(); await sleep(700);
  ok('a Home status opens Leads filtered to it', /Status: Meeting booked/.test(await text()) && /\b1 of 5\b/.test(await text()));

  console.log('\n== everything persists ==');
  await page.reload(); await sleep(1200);
  if (await page.locator('input[aria-label="Email"]').count()) await login();
  await nav('Apollo queue');
  t = await text();
  ok('the queue survives a reload', /CSP Leads/.test(t) && /Jack Main Sequence/.test(t));
  const ruleAfter = page.locator('input[aria-label="Sequence for Main · M365 / Azure"]');
  if (!(await ruleAfter.count())) { await page.locator('.panel-head', { hasText: 'Routing rules' }).click(); await sleep(300); }
  ok('  and so does the routing rule', (await page.inputValue('input[aria-label="Sequence for Main · M365 / Azure"]')) === 'Jack Main Sequence');

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`queue-live ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
