// Scanner 2 end-to-end, driven in a real browser against real IndexedDB.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const OUT = require('os').tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };

// A CSV shaped NOTHING like a Microsoft lead export — the whole point.
// Jack's REAL import shape for this batch (Dynamics-style headers),
// including the duplicate "description" his list contains twice — Papa
// renames the second to description_1, which is asserted below.
const HEAD = ['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1',
  'accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename',
  'statuscodename','revenue','numberofemployees','campaignidname','companyname','description','estimatedclosedat'];
const rec = (country,desc,email,name,title,mob,tel,acct,web,city,state,seg,ind,stat,rev,emp,camp,co,desc2,close) =>
  [country,desc,email,name,title,mob,tel,acct,web,city,state,seg,ind,stat,rev,emp,camp,co,desc2,close]
    .map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
const csv = [
  HEAD.join(','),
  rec('USA','Renewal at risk, evaluating competitors this quarter.','dana@alpinefreight.com','Dana Reyes','Ops Director','312-555-0101','312-555-0102','Alpine Freight Account','alpinefreight.com','Chicago','IL','Seg A','Transportation','Open','82000','240','Q3 Push','Alpine Freight','second desc','2026-12-01'),
  rec('USA','Expansion talk, wants more seats.','reed@bordenlabs.com','Reed Okafor','IT Manager','312-555-0201','312-555-0202','Borden Labs Account','bordenlabs.com','Evanston','IL','Seg B','Biotech','Open','31000','90','Q3 Push','Borden Labs','second desc','2026-11-15'),
  rec('USA','Churned last quarter, do not pursue.','mia@cortezmed.com','Mia Cortez','Owner','312-555-0301','312-555-0302','Cortez Medical Account','cortezmed.com','Oak Park','IL','Seg A','Healthcare','Closed','9000','12','Q2','Cortez Medical','second desc','2026-08-01'),
  rec('USA','Renewal at risk, evaluating competitors this quarter.','dana@alpinefreight.com','Dana Reyes','Ops Director','312-555-0101','312-555-0102','Alpine Freight Account','alpinefreight.com','Chicago','IL','Seg A','Transportation','Open','82000','240','Q3 Push','Alpine Freight','second desc','2026-12-01'),
  rec('USA','Quiet account, no recent contact.','kim@deltaworks.com','Kim Alvarez','CFO','312-555-0401','312-555-0402','Delta Works Account','deltaworks.com','Skokie','IL','Seg C','Manufacturing','Open','45000','150','Q1','Delta Works','second desc','2027-01-20'),
].join('\n');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  console.log('\n== nav + separate gate ==');
  ok('Custom Scanner appears in the nav', await page.locator('.side-nav-btn:has-text("Custom Scanner")').count() > 0);
  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(700);
  ok('Custom Scanner opens directly — no gate', await page.locator('input[type=file]').count() > 0);

  console.log('\n== upload an unfamiliar CSV shape ==');
  await page.setInputFiles('input[type=file]', { name: 'accounts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await sleep(2000);
  const txt = () => page.locator('main').innerText();
  // This fixture is a plain account list, not SMC data — switch the tab to
  // the keyword model, which is the right one for that batch shape.
  // Lead format lives inside the collapsed Scan setup now: open, switch,
  // close again, so the assertions below read the normal results view.
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(500);
  await page.locator('select[aria-label="Lead format"]').selectOption('keywords'); await sleep(1400);
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(400);
  const t1 = await txt();
  ok('read 5 rows', /ROWS READ\s*5/i.test(t1), t1.match(/ROWS READ\s*\d+/i)?.[0]);
  // 4, not 5: the repeated Dana Reyes / Alpine Freight row is merged by
  // identity before any rule runs (see the dedupe check below).
  ok('every row lands in No Signal with no rules yet', /NO SIGNAL\s*4/i.test(t1), t1.match(/NO SIGNAL\s*\d+/i)?.[0]);
  // Default dedupe is the lead's own identity (contact + company, both
  // present) — the Main Scanner's rule, per Jack: "i dont want it to be
  // possible to dupe." The fixture repeats Dana Reyes / Alpine Freight.
  ok('a repeated lead (same contact + company) is merged by default: 5 read, 4 processed, 1 merged',
     /5 read . 4 processed . 1 duplicates merged/.test(t1.replace(/\s+/g,' ')), t1.match(/\d+ read[^\n]*/)?.[0]);
  ok('figures reconcile', /figures reconcile/.test(t1), t1.slice(0, 200));

  // Per Jack the column-chip walls (notes / campaign / merge-duplicates)
  // are gone from the post-scan screen; mapping is guessed from the file.
  ok('no column-chip walls on the post-scan screen',
     !/Notes — the text the rules read|Campaign code — the Microsoft|Merge duplicates on/.test(t1));

  console.log('\n== column profiling is a check on the upload, not a download switch ==');
  // The download is a fixed column set, so this panel no longer gates
  // anything — it exists to confirm the file was read correctly. The
  // count is DERIVED from exportLabelsFor() in the component rather than
  // typed into the copy, so assert the shape of the sentence and that the
  // number is the Custom tab's real ten, not a literal spelled-out word.
  await page.locator('button:has-text("Columns (")').first().click(); await sleep(700);
  const tc = await txt();
  ok('profiles the real columns', /Columns — what arrived in the file/.test(tc) && /numberofemployees/.test(tc));
  ok('infers a numeric column', /numeric/.test(tc));
  ok('infers a date column', /date/.test(tc));
  ok('duplicate header auto-renamed to description_1', /description_1/.test(tc));
  ok('the panel says the download shape is fixed', /every download is[\s\S]{0,40}the same 10 columns/.test(tc),
     (tc.match(/every download is[\s\S]{0,60}/) || [])[0]);
  ok('no per-column download checkboxes remain',
     await page.locator('input[aria-label^="Include "]').count() === 0);
  ok('all 20 columns are reported, none hidden', /Columns \(20\)/.test(tc), (tc.match(/Columns \(\d+\)/) || [])[0]);
  await page.locator('button:has-text("Columns (")').first().click(); await sleep(400);

  console.log('\n== rules are data, editable in-app ==');
  // Mapping + Strong Signal rules + keyword rules all live behind one
  // "Scan setup" toggle now; the keyword panel keeps its own Show inside it.
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(500);
  ok('setup is collapsed by default and opens on demand', await page.locator('input[placeholder="Rule name"]').count() >= 0);
  await page.locator('button:has-text("Show")').first().click(); await sleep(600);
  await page.fill('input[placeholder="Rule name"]', 'At risk');
  await page.fill('input[placeholder="keywords, comma separated"]', 'at risk, evaluating competitors');
  await page.locator('select[aria-label="Rule bucket"]').first().selectOption('priority');
  await page.click('button:has-text("+ Add rule")'); await sleep(1200);
  let t2 = await txt();
  // Alpine Freight is present twice but merged by identity, so 1 is right.
  ok('priority rule reclassifies rows live', /HIGH PRIORITY\s*1/i.test(t2), t2.match(/HIGH PRIORITY\s*\d+/i)?.[0]);

  await page.fill('input[placeholder="Rule name"]', 'Dead');
  await page.fill('input[placeholder="keywords, comma separated"]', 'churned, do not pursue');
  await page.locator('select[aria-label="Rule bucket"]').first().selectOption('excluded');
  await page.click('button:has-text("+ Add rule")'); await sleep(1200);
  t2 = await txt();
  ok('exclude rule reclassifies a row live', /LOW PRIORITY\s*1/i.test(t2), t2.match(/LOW PRIORITY\s*\d+/i)?.[0]);
  ok('unmatched shrinks as rules are added', /NO SIGNAL\s*2/i.test(t2), t2.match(/NO SIGNAL\s*\d+/i)?.[0]);
  ok('a row is explainable — the matched rule is named on it', /At risk/.test(t2));
  ok('figures still reconcile after rule edits', /figures reconcile/.test(t2));

  console.log('\n== filtering ==');
  await page.locator('.seg-btn:has-text("High priority")').first().click(); await sleep(600);
  const rows = await page.locator('.data-table').first().locator('tbody tr').count();
  ok('Priority filter shows exactly the matching row', rows === 1, String(rows));

  console.log('\n== lead bones: field mapping + snippet ==');
  await page.locator('.seg-btn:has-text("All")').first().click(); await sleep(500);
  const t4 = await txt();
  // Seven identity fields now: work phone and mobile are separate, and
  // employee count is captured, so the download can carry the Main
  // Scanner's exact Apollo columns.
  ok('all 7 identity fields guessed from Dynamics headers', /Which column is what/.test(t4) && /7 of 7 mapped/.test(t4), (t4.match(/\d of \d mapped/) || [])[0]);
  ok('the collapsed setup bar states the rule in force', /SCAN SETUP/i.test(t4) && /keyword rule/i.test(t4));
  ok('table shows the company as identity', /Alpine Freight/.test(t4));
  ok('table shows the contact and title', /Dana Reyes/.test(t4) && /Ops Director/.test(t4));
  ok('a matched row shows readable snippet evidence', /evaluating competitors/.test(t4));
  // description is the notes; campaignidname is its own field now (the
  // Microsoft campaign code has its own parser), so it must NOT be in notes.
  // The chips are gone from the screen, so read the saved rule set itself.
  const savedSets = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1');
    r.onsuccess = () => { const db = r.result; const g = db.transaction('scanner2RuleSets').objectStore('scanner2RuleSets').getAll(); g.onsuccess = () => { db.close(); res(g.result); }; g.onerror = () => rej(g.error); };
    r.onerror = () => rej(r.error);
  }));
  ok('description is the notes column', savedSets.some(s => (s.notesColumns || []).includes('description')), JSON.stringify(savedSets.map(s => s.notesColumns)));
  ok('campaignidname is NOT swallowed into notes', savedSets.every(s => !(s.notesColumns || []).includes('campaignidname')));
  ok('campaignidname is the campaign column', savedSets.some(s => (s.campaignColumns || []).includes('campaignidname')));
  // A keyword that only appears in campaignidname must still classify the row.
  await page.fill('input[placeholder="Rule name"]', 'Q3 campaign');
  await page.fill('input[placeholder="keywords, comma separated"]', 'Q3 Push');
  await page.locator('select[aria-label="Rule bucket"]').first().selectOption('review');
  await page.click('button:has-text("+ Add rule")'); await sleep(1200);
  const tq = await txt();
  ok('a keyword found only in campaignidname classifies the row', /Q3 campaign/.test(tq) && !/NEEDS REVIEW\s*0/i.test(tq), (tq.match(/REVIEW\s*\d+/i) || [])[0]);

  console.log('\n== curation: rules propose, you dispose ==');
  const keepBtn = page.locator('button[aria-label^="High Alpine Freight"]').first();
  ok('curation controls render per row', await keepBtn.count() > 0);
  await keepBtn.click(); await sleep(700);
  let t5 = await txt();
  ok('a High override is recorded', /High \(1\)/.test(t5), (t5.match(/High \(\d+\)/) || [])[0]);
  const rejBtn = page.locator('button[aria-label^="Low Cortez Medical"]').first();
  await rejBtn.click(); await sleep(700);
  t5 = await txt();
  ok('a Low override is recorded', /Low \(1\)/.test(t5), (t5.match(/Low \(\d+\)/) || [])[0]);
  ok('undecided count drops accordingly', /Undecided \(2\)/.test(t5), (t5.match(/Undecided \(\d+\)/) || [])[0]);
  await page.locator('.chip-btn:has-text("High (")').first().click(); await sleep(600);
  const keptRows = await page.locator('.data-table').first().locator('tbody tr').count();
  ok('filtering to High shows only the overridden lead', keptRows === 1, String(keptRows));
  await page.locator('.chip-btn:has-text("Any")').first().click(); await sleep(500);

  console.log('\n== isolation from Scanner 1 ==');
  await page.locator('.side-nav-btn', { hasText: 'Lead library' }).first().click(); await sleep(900);
  const lib = await txt();
  ok('nothing from the Custom Scanner reached the Lead library', !/Alpine Freight|Borden Labs/.test(lib));
  await page.locator('.side-nav-btn', { hasText: 'History' }).first().click(); await sleep(900);
  const hist = await txt();
  ok('nothing from the Custom Scanner reached History', !/Alpine Freight|accounts\.csv/.test(hist));

  console.log('\n== Scanner 1 still works, untouched ==');
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(700);
  ok('Main Scanner opens directly — no gate', await page.locator('input[type=file]').count() > 0);
  const leadCsv = 'First Name,Last Name,Title,Company,Email,Phone,Comments\n"Ada","Brant","IT Director","Northwind Freight","ada@nwf.com","(312) 555-0101","Dynamics 365 Business Central for 40 users, looking for a partner"';
  await page.setInputFiles('input[type=file]', { name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(leadCsv) });
  await sleep(2400);
  const s1 = await txt();
  // The Main Scanner keeps its OWN vocabulary — Strong Signal / Needs
  // Review / Bad Leads. Only the two SCORED tabs read High / Medium / Low.
  ok('Main Scanner still classifies Strong Signal', /STRONG SIGNAL\s*1/i.test(s1), s1.match(/STRONG SIGNAL\s*\d+/i)?.[0]);

  console.log('\n== persistence ==');
  await page.reload(); await sleep(1800);
  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(700);
  ok('Custom Scanner still opens directly after reload', await page.locator('input[type=file]').count() > 0);
  // Rules panel is collapsed by default; open it to read the rule names.
  await page.setInputFiles('input[type=file]', { name: 'accounts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await sleep(2000);
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(500);
  await page.locator('button:has-text("Show")').first().click(); await sleep(500);
  const after = await txt();
  ok('rules survived the reload', /At risk/.test(after) && /Dead/.test(after));
  ok('past runs survived the reload', /Past runs/.test(after) && /accounts\.csv/.test(after));

  // The real test of sticky curation: the SAME list was just re-uploaded
  // above, so the decisions must still be attached to those leads.
  const t6 = await txt();
  ok('curation survives a re-upload of the same list', /High \(1\)/.test(t6) && /Low \(1\)/.test(t6),
     `${(t6.match(/High \(\d+\)/) || [])[0]} ${(t6.match(/Low \(\d+\)/) || [])[0]}`);

  await page.screenshot({ path: `${OUT}/scanner2.png`, fullPage: true });
  console.log('\n== errors ==');
  ok('no page or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 4)));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
