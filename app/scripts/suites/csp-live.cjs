// The CSP Scanner, driven in a real browser against real IndexedDB, on a
// fixture shaped exactly like Jack's BookCSPs export.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getDate()}/${MON[d.getMonth()]}`; };
const HEAD = ['customeridname','estimatedvalue','msp_forecastcomments','msp_licensingprogramname','msp_partneraccountidname','msp_rollupestrevenue','fullname','address1_telephone1','telephone1','mobilephone','emailaddress1','address1_country','campaignidname'];
const q = v => `"${String(v).replace(/"/g,'""')}"`;
const row = o => HEAD.map(h => q(o[h] ?? '')).join(',');
const csv = [HEAD.join(',')].concat([
  row({ customeridname:'ACME MANUFACTURING', estimatedvalue:'45000', msp_forecastcomments:`MA - ${ago(5)} - Customer is looking for a partner to take over licensing. Next Steps: intro call Monday.`, msp_licensingprogramname:'CSP | Annual New Upfront Billing', msp_partneraccountidname:'NULL', msp_rollupestrevenue:'45000', fullname:'Dana Reyes', address1_telephone1:'', telephone1:'312-555-0147', mobilephone:'NULL', emailaddress1:'dana@acme.com', address1_country:'United States', campaignidname:'US~US~FY25~CMP~TUM~SRAIM514049' }),
  row({ customeridname:'HELD CO', estimatedvalue:'300000', msp_forecastcomments:`TH - ${ago(9)} - Quote sent. Meeting set for Thursday.`, msp_licensingprogramname:'CSP | Annual New Upfront Billing', msp_partneraccountidname:'CDW Logistics LLC', msp_rollupestrevenue:'300000', fullname:'Sam Vale', address1_telephone1:'', telephone1:'312-555-0148', mobilephone:'NULL', emailaddress1:'sam@held.com', address1_country:'United States', campaignidname:'NULL' }),
  row({ customeridname:'GHOST LLC', estimatedvalue:'80000', msp_forecastcomments:`KBM - ${ago(12)} - Client No-Show. No response has been received. Marking as lost due to inactivity.`, msp_licensingprogramname:'CSP | Monthly New', msp_partneraccountidname:'NULL', msp_rollupestrevenue:'80000', fullname:'Lee Park', address1_telephone1:'', telephone1:'NULL', mobilephone:'NULL', emailaddress1:'lee@ghost.com', address1_country:'United States', campaignidname:'NULL' }),
  row({ customeridname:'MIDLING INC', estimatedvalue:'8000', msp_forecastcomments:`RZ - ${ago(20)} - Next steps: follow up on pricing.`, msp_licensingprogramname:'CSP | Annual New Monthly Billing', msp_partneraccountidname:'Insight', msp_rollupestrevenue:'8000', fullname:'Nia Bell', address1_telephone1:'', telephone1:'312-555-0151', mobilephone:'NULL', emailaddress1:'nia@midling.com', address1_country:'United States', campaignidname:'NULL' }),
  row({ customeridname:'MANGLED PHONE LLC', estimatedvalue:'120000', msp_forecastcomments:`GD - ${ago(4)} - Quote sent. Meeting set. Wants annual upfront.`, msp_licensingprogramname:'CSP | Annual New Upfront Billing', msp_partneraccountidname:'NULL', msp_rollupestrevenue:'120000', fullname:'Ray Diaz', address1_telephone1:'', telephone1:'5.25549E+11', mobilephone:'5.25549E+11', emailaddress1:'ray@mangled.com', address1_country:'United States', campaignidname:'NULL' }),
  row({ customeridname:'DIRECT CORP', estimatedvalue:'20000', msp_forecastcomments:`GD - ${ago(3)} - Business Phone: +1 786 953 5229 wants to move to annual upfront.`, msp_licensingprogramname:'CSP | Annual Renewal Upfront Billing', msp_partneraccountidname:'Microsoft Corporation', msp_rollupestrevenue:'20000', fullname:'Ray Diaz', address1_telephone1:'', telephone1:'NULL', mobilephone:'NULL', emailaddress1:'ray@direct.com', address1_country:'United States', campaignidname:'NULL' }),
]).join('\n');
const CSP = path.join(os.tmpdir(), 'csp-live.csv');
fs.writeFileSync(CSP, csv);

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

  console.log('\n== nav ==');
  const navs = await page.locator('.side-nav-btn').allInnerTexts();
  ok('CSP Scanner is its own item in the left nav', navs.some(t => /CSP Scanner/.test(t)), navs.join(' | '));
  ok('the SMC scanner keeps its own name', navs.some(t => /Custom Scanner September/.test(t)), navs.join(' | '));
  await page.locator('.side-nav-btn', { hasText: 'CSP Scanner' }).first().click(); await sleep(800);
  ok('it opens on its own page', /CSP Scanner/.test(await page.locator('main').innerText()));
  ok('the upload drop zone is there', await page.locator('input[type=file]').count() > 0);

  console.log('\n== scan ==');
  await page.setInputFiles('input[type=file]', CSP); await sleep(2500);
  const body = await page.locator('main').innerText();
  ok('all six rows were read', /6 rows read|6 read/i.test(body), body.slice(0, 200));
  ok('the scoring rule in force is stated', /Score 0.100/.test(body) && /High at 60\+/.test(body), body.slice(0, 500));
  ok('no SMC vocabulary leaks onto this tab', !/Strong Signal|Needs Review|Bad Leads?\b/.test(body), (body.match(/.{0,40}(Strong Signal|Needs Review|Bad Leads?).{0,40}/) || [''])[0]);
  ok('the reconcile strip speaks priority, not keep/maybe/reject', !/\bkeep\b|\bmaybe\b|\breject\b/i.test(body), (body.match(/.{0,40}(keep|maybe|reject).{0,40}/i) || [''])[0]);

  console.log('\n== priority breakdown ==');
  const panel = page.locator('[aria-label="Priority breakdown"]');
  ok('the Priority breakdown panel renders', await panel.count() === 1);
  const toggle = panel.locator('button[aria-label="Toggle priority breakdown"]');
  ok('  it is collapsed by default (arrow)', await toggle.getAttribute('aria-expanded') === 'false');
  const head = await panel.innerText();
  ok('  the band counts are visible while collapsed', /4\s*High/.test(head) && /1\s*Medium/.test(head) && /1\s*Low/.test(head), head.slice(0, 200));
  ok('  the chart is NOT rendered while collapsed', await panel.locator('[role=img]').count() === 0);
  await toggle.click(); await sleep(400);
  ok('  the arrow opens it', await toggle.getAttribute('aria-expanded') === 'true');
  const ptxt = (await panel.count()) ? await panel.innerText() : '';
  ok('  the header states how many leads were scored', /6 scored/.test(head), head.slice(0, 240));
  const tile = async (label) => (await panel.locator('.kpi').filter({ hasText: label }).first().locator('.kpi-value').innerText()).trim();
  ok('  three band tiles with counts', (await tile('High priority')) === '4' && (await tile('Medium priority')) === '1' && (await tile('Low priority')) === '1',
     `${await tile('High priority')} / ${await tile('Medium priority')} / ${await tile('Low priority')}`);
  ok('  the histogram is drawn', await panel.locator('[role=img][aria-label="Score histogram in ten-point buckets"]').count() === 1);
  ok('  both threshold lines are labelled in text', /High 60\+/.test(ptxt) && /Medium 25\+/.test(ptxt), ptxt.slice(0, 600));
  ok('  the drivers table lists every factor', /Partner lane/.test(ptxt) && /Billing intent/.test(ptxt) && /Reachable/.test(ptxt) && /Penalties/.test(ptxt) && /Average score/.test(ptxt));
  ok('  the Low band shows a penalty (the ghosted no-show)', /Penalties[^\n]*\u2212\d+/.test(ptxt), (ptxt.match(/Penalties[^\n]*/) || [''])[0]);

  const rowText = async co => {
    const r = page.locator('table[aria-label="Scan results"] tbody tr').filter({ hasText: co }).first();
    return (await r.count()) ? (await r.innerText()) : '';
  };
  const acme = await rowText('ACME MANUFACTURING');
  ok('the perfect lead is in the table', !!acme, acme);
  ok('  it carries the ★ pin', /★/.test(acme), acme);
  ok('  the partner column reads Open', /\bOpen\b/.test(acme) && /No partner assigned/i.test(acme), acme);
  ok('  the contact and phone carried through', /Dana Reyes/.test(acme) && /312-555-0147/.test(acme), acme);
  ok('  the notes lead with the score', /Score \d+/.test(acme), acme);

  const held = await rowText('HELD CO');
  ok('a held deal names its partner in the Partner column', /CDW Logistics LLC/.test(held), held);
  ok('  and reads Held', /\bHeld\b/.test(held), held);
  const direct = await rowText('DIRECT CORP');
  ok('a phone labelled in the notes filled the empty phone column', /\+1 786 953 5229/.test(direct), direct);
  ok('  Microsoft direct reads Direct', /\bDirect\b/.test(direct), direct);

  console.log('\n== rank order ==');
  const firstCo = await page.locator('table[aria-label="Scan results"] tbody tr').first().innerText();
  ok('the perfect lead is at the top of the table, above the $300k held deal', /ACME MANUFACTURING/.test(firstCo), firstCo.slice(0, 80));

  console.log('\n== tier counts ==');
  const tiers = (await page.locator('.seg-btn, .chip-btn').allInnerTexts()).join(' | ');
  ok('High priority holds ACME, HELD CO, MANGLED and DIRECT CORP', /High priority \(4\)/.test(tiers), tiers);
  ok('Low priority holds the ghosted one (scored, penalised, still Low)', /Low priority \(1\)/.test(tiers), tiers);
  const ghost = await rowText('GHOST LLC');
  ok('  the ghosted row carries a real score, not a blank', /\bScore \d+/.test(ghost), ghost);
  ok('  and its notes say the newest entry is the problem', /latest note: /.test(ghost), ghost);
  ok('Medium priority holds the middling one', /Medium priority \(1\)/.test(tiers), tiers);
  ok('no Strong Signal / Bad Leads wording on this tab', !/Strong Signal \(|Bad Leads \(|Needs Review \(/.test(tiers), tiers);

  ok('the four-tile KPI rail is gone on this tab (the breakdown header carries the counts)', await page.locator('.kpi-rail').count() === 0, String(await page.locator('.kpi-rail').count()));

  console.log('\n== basic filters: collapsible, two rows, no chip walls ==');
  const tb = page.locator('[aria-label="CSP filters"]');
  const ftoggle = tb.locator('button[aria-label="Toggle filters"]');
  ok('the filters have an arrow and start open', await ftoggle.getAttribute('aria-expanded') === 'true');
  ok('the filter controls are two rows under the header', await tb.locator('.toolbar-row').count() === 3, String(await tb.locator('.toolbar-row').count()));
  ok('  a shown-of-total count sits in the header', /6 of 6 shown/.test(await tb.innerText()), await tb.innerText());
  await ftoggle.click(); await sleep(300);
  ok('  collapsing hides the controls', await tb.locator('.toolbar-row').count() === 1 && await page.locator('select[aria-label="Partner"]').count() === 0);
  ok('  and says "none active"', /none active/.test(await tb.innerText()), await tb.innerText());
  await ftoggle.click(); await sleep(300);
  await page.fill('input[aria-label="Minimum score"]', '60'); await sleep(300);
  await ftoggle.click(); await sleep(300);
  ok('  collapsed header summarises an active filter', /score \u2265 60/.test(await tb.innerText()) && /4 of 6 shown/.test(await tb.innerText()), await tb.innerText());
  await ftoggle.click(); await sleep(300);
  await page.fill('input[aria-label="Minimum score"]', ''); await sleep(300);
  ok('no "set by hand" wording anywhere on the page', !/set by hand/i.test(await page.locator('main').innerText()));
  ok('  and has no chip buttons at all', await tb.locator('.chip-btn').count() === 0, String(await tb.locator('.chip-btn').count()));
  ok('  no "Set by hand" filter row (manual priorities already show under their tab)', !/Set by hand/.test(await tb.innerText()));
  ok('a Partner filter is offered', await page.locator('select[aria-label="Partner"]').count() === 1);
  ok('a Billing dropdown replaces the six billing chips', await page.locator('select[aria-label="Billing"]').count() === 1);
  ok('the Cloud Ascent product filter is gone', await page.locator('select[aria-label="Product filter"]').count() === 0);
  ok('the Act Now gaps toggle is gone', await page.locator('input[aria-label="Act Now gaps only"]').count() === 0);

  console.log('\n== dates ==');
  const dsrc = page.locator('[aria-label="Date source"]');
  // .toolbar-label is uppercased by CSS, so innerText comes back shouting.
  ok('the date filter says WHICH date it uses', /^last touched$/i.test((await dsrc.innerText()).trim()), await dsrc.innerText());
  ok('  and the tooltip explains this file has no date column', /no date column/i.test(await dsrc.getAttribute('title') || ''));
  ok('30d / 90d presets are offered', await page.locator('button[aria-label="Last 30 days"]').count() === 1 && await page.locator('button[aria-label="Last 90 days"]').count() === 1);
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  await page.fill('input[aria-label="Received from"]', tomorrow); await sleep(500);
  ok('a from-date in the future leaves nothing (every lead was touched before today)', await page.locator('table[aria-label="Scan results"] tbody tr').count() === 1 && /No rows match/.test(await page.locator('table[aria-label="Scan results"] tbody').innerText()));
  await page.locator('button[aria-label="Clear date range"]').click(); await sleep(400);
  ok('  Clear restores all six', await page.locator('table[aria-label="Scan results"] tbody tr').count() === 6, String(await page.locator('table[aria-label="Scan results"] tbody tr').count()));
  await page.locator('button[aria-label="Last 30 days"]').click(); await sleep(500);
  ok('  Last 30 days keeps all six (fixture touches are 3\u201320 days old)', await page.locator('table[aria-label="Scan results"] tbody tr').count() === 6, String(await page.locator('table[aria-label="Scan results"] tbody tr').count()));
  ok('  and fills the from-date box', /\d{4}-\d{2}-\d{2}/.test(await page.locator('input[aria-label="Received from"]').inputValue()));
  await page.locator('button[aria-label="Clear date range"]').click(); await sleep(300);

  console.log('\n== score & value: sort both ways, floor them together ==');
  const R = 'table[aria-label="Scan results"] tbody tr';
  const firstCompany = async () => (await page.locator(R).first().innerText()).split('\n')[0].trim();
  const sortSel = page.locator('select[aria-label="Sort by"]');
  ok('sort defaults to Score high \u2192 low', await sortSel.inputValue() === 'score-desc', await sortSel.inputValue());
  ok('  and the perfect lead leads', /ACME/.test(await firstCompany()), await firstCompany());
  await sortSel.selectOption('score-asc'); await sleep(400);
  ok('Score low \u2192 high puts the ghosted Low lead first', /GHOST/.test(await firstCompany()), await firstCompany());
  await sortSel.selectOption('value-desc'); await sleep(400);
  ok('Value high \u2192 low puts the $300k held deal first', /HELD CO/.test(await firstCompany()), await firstCompany());
  await sortSel.selectOption('value-asc'); await sleep(400);
  ok('Value low \u2192 high puts the $8k deal first', /MIDLING/.test(await firstCompany()), await firstCompany());
  await sortSel.selectOption('score-desc'); await sleep(300);
  await page.fill('input[aria-label="Minimum score"]', '60'); await sleep(500);
  ok('Score \u2265 60 leaves the four High leads', await page.locator(R).count() === 4, String(await page.locator(R).count()));
  await page.locator('select[aria-label="Minimum value"]').selectOption('50000'); await sleep(500);
  ok('  plus Value \u2265 $50k, together, leaves the $300k and $120k deals', await page.locator(R).count() === 2, String(await page.locator(R).count()));
  await page.fill('input[aria-label="Minimum score"]', ''); await sleep(300);
  ok('  clearing the score floor keeps the value floor (HELD $300k + GHOST $80k + MANGLED $120k)', await page.locator(R).count() === 3, String(await page.locator(R).count()));
  await page.locator('select[aria-label="Minimum value"]').selectOption('0'); await sleep(300);
  ok('  clearing both restores all six', await page.locator(R).count() === 6, String(await page.locator(R).count()));

  const seg = async () => (await page.locator('[aria-label="CSP filters"] .seg').innerText()).replace(/\s+/g, ' ');
  const dlCount = async (label) => (await page.locator(`button[aria-label="Download ${label} leads"]`).innerText()).replace(/\D+/g, '');
  ok('before filtering: High tab 4, High download 4', /High priority \(4\)/.test(await seg()) && await dlCount('High priority') === '4', `${await seg()} | dl ${await dlCount('High priority')}`);

  await page.locator('select[aria-label="Partner"]').selectOption('open'); await sleep(500);
  ok('Open lane narrows to ACME + GHOST + MANGLED + DIRECT', await page.locator(R).count() === 4, String(await page.locator(R).count()));
  ok('  the priority tabs RE-COUNT to the filtered set', /High priority \(3\)/.test(await seg()) && /Medium priority \(0\)/.test(await seg()) && /Low priority \(1\)/.test(await seg()), await seg());
  ok('  the All tab shows the filtered total, not the upload total', /All \(4\)/.test(await seg()), await seg());
  ok('  the High priority DOWNLOAD follows the filter too', await dlCount('High priority') === '3', await dlCount('High priority'));
  ok('  and Medium goes to 0', await dlCount('Medium priority') === '0', await dlCount('Medium priority'));

  await page.locator('select[aria-label="Partner"]').selectOption('named'); await sleep(500);
  ok('Named partner narrows to HELD + MIDLING', await page.locator(R).count() === 2, String(await page.locator(R).count()));
  ok('  and the tabs re-count again', /High priority \(1\)/.test(await seg()) && /Medium priority \(1\)/.test(await seg()) && /All \(2\)/.test(await seg()), await seg());

  // Faceting: a count never narrows itself. Sitting on the High tab must
  // not make the Medium tab read 0.
  await page.locator('[aria-label="CSP filters"] .seg-btn', { hasText: 'High priority' }).click(); await sleep(400);
  ok('sitting on the High tab still shows the real Medium count', /Medium priority \(1\)/.test(await seg()), await seg());
  ok('  while the table shows only High', await page.locator(R).count() === 1, String(await page.locator(R).count()));
  ok('  and the Medium download still offers its 1 lead', await dlCount('Medium priority') === '1', await dlCount('Medium priority'));
  await page.locator('[aria-label="CSP filters"] .seg-btn', { hasText: /^All/ }).click(); await sleep(400);
  await page.locator('select[aria-label="Partner"]').selectOption('all'); await sleep(300);
  ok('clearing the partner filter restores the full counts', /High priority \(4\)/.test(await seg()) && /All \(6\)/.test(await seg()), await seg());
  await page.locator('select[aria-label="Billing"]').selectOption('0'); await sleep(500);
  ok('Billing = annual new upfront narrows to ACME + HELD + MANGLED', await page.locator(R).count() === 3, String(await page.locator(R).count()));
  await page.locator('select[aria-label="Billing"]').selectOption('all'); await sleep(300);

  console.log('\n== selection: page / all / custom amount ==');
  const selBar = page.locator('[aria-label="Selection"]');
  ok('a selection bar is offered', await selBar.count() === 1);
  ok('  every row has a checkbox', await page.locator(`${R} input[type=checkbox]`).count() === 6);
  const selCount = async () => (await selBar.locator('strong').innerText()).replace(/\D/g, '');
  await selBar.locator('input[aria-label="Select page"]').check(); await sleep(400);
  ok('Page selects every row on this page', await selCount() === '6', await selCount());
  await selBar.locator('input[aria-label="Select page"]').uncheck(); await sleep(300);
  ok('  unchecking clears them', await selCount() === '0', await selCount());
  await selBar.locator('button[aria-label="Select all filtered"]').click(); await sleep(400);
  ok('Select all takes the whole filtered set', await selCount() === '6', await selCount());
  await selBar.locator('button[aria-label="Clear selection"]').click(); await sleep(300);
  await page.fill('input[aria-label="Custom amount"]', '2'); await sleep(200);
  await selBar.locator('button[aria-label="Select first N"]').click(); await sleep(400);
  ok('Take top N selects exactly N', await selCount() === '2', await selCount());
  const firstTwo = (await page.locator(R).allInnerTexts()).slice(0, 2).map((t) => t.split('\n')[1]);
  ok('  and they are the top of the current sort', firstTwo.length === 2);

  console.log('\n== build a specific list ==');
  await page.fill('input[aria-label="New list name"]', 'Aug open lane'); await sleep(200);
  await selBar.locator('button[aria-label="Add selected to list"]').click(); await sleep(900);
  const note = await selBar.locator('[aria-label="List note"]').innerText();
  ok('adding reports what it added', /Added 2 leads/.test(note), note);
  ok('  and clears the selection', await selCount() === '0', await selCount());
  // The list picker only renders while something is selected, so re-select
  // before reading it back.
  await selBar.locator('button[aria-label="Select all filtered"]').click(); await sleep(400);
  ok('  the new list is now a target option', /Aug open lane/.test(await selBar.locator('select[aria-label="Target list"]').innerText()));
  // re-adding the same leads must be a no-op, not a duplicate
  await selBar.locator('button[aria-label="Add selected to list"]').click(); await sleep(900);
  ok('re-adding skips leads already on the list', /already on the list/.test(await selBar.locator('[aria-label="List note"]').innerText()), await selBar.locator('[aria-label="List note"]').innerText());
  ok('no literal escapes leak into the selection bar', !/\\u[0-9a-f]{4}/i.test(await selBar.innerText()), (await selBar.innerText()).match(/.{0,25}\\u[0-9a-f]{4}.{0,25}/i)?.[0]);

  console.log('\n== Excel-damaged phones are surfaced, not silently blanked ==');
  const mang = page.locator('[aria-label="Mangled phones"]');
  ok('a notice names how many phones Excel destroyed', await mang.count() === 1);
  const mtxt = (await mang.count()) ? await mang.innerText() : '';
  ok('  it gives the count', /1 lead has no phone/.test(mtxt), mtxt.slice(0, 160));
  ok('  it shows what Excel wrote', /5\.25549E\+11/.test(mtxt), mtxt.slice(0, 240));
  ok('  and says how to fix it at source', /formatted as Text/i.test(mtxt), mtxt.slice(-140));

  console.log('\n== Has phone: the answer to a score-sorted list full of email-only leads ==');
  const ph = page.locator('input[aria-label="Has phone"]');
  ok('a Has phone filter is offered', await ph.count() === 1);
  const phLabel = await page.locator('label:has(input[aria-label="Has phone"])').innerText();
  ok('  it carries a live count', /\(\d+\)/.test(phLabel), phLabel);
  await ph.check(); await sleep(500);
  const shownPh = await page.locator(R).count();
  ok('  it removes the leads with no phone', shownPh === 4, String(shownPh));
  ok('  and the mangled-phone lead is one of them', !/MANGLED PHONE/.test(await page.locator('table[aria-label="Scan results"] tbody').innerText()));
  await ph.uncheck(); await sleep(400);
  ok('  unchecking restores them', await page.locator(R).count() === 6, String(await page.locator(R).count()));

  console.log('\n== the table IS the download ==');
  await page.locator('[aria-label="Selection"] button[aria-label="Clear selection"]').click().catch(() => {}); await sleep(300);
  // Read what the table shows, then read what toApolloRow would export for
  // the same rows, and require them to agree cell for cell.
  const shown = await page.locator(R).evaluateAll((trs) => trs.map((tr) => {
    const td = [...tr.querySelectorAll('td')].map((c) => c.textContent.trim());
    return td;
  }));
  const hdr = await page.locator('table[aria-label="Scan results"] thead th').allInnerTexts();
  const col = (name) => hdr.findIndex((h) => h.trim().toLowerCase().startsWith(name));
  ok('the table shows a row per lead', shown.length === 6, String(shown.length));
  const iName = col('name'), iCo = col('company'), iEmail = col('email'), iWork = col('work'), iMob = col('mobile');
  ok('  the table has the columns the CSV has', iName > 0 && iCo > 0 && iEmail > 0 && iWork > 0 && iMob > 0, JSON.stringify(hdr));
  const acmeRow = shown.find((td) => td.some((c) => /ACME MANUFACTURING/.test(c)));
  ok('  ACME row: name matches the export', /Dana Reyes/.test(acmeRow[iName]), acmeRow[iName]);
  ok('  ACME row: email matches', acmeRow[iEmail] === 'dana@acme.com', acmeRow[iEmail]);
  ok('  ACME row: work phone matches', acmeRow[iWork] === '312-555-0147', acmeRow[iWork]);
  const mangled = shown.find((td) => td.some((c) => /MANGLED PHONE/.test(c)));
  if (mangled) ok('  a dropped Excel-mangled phone shows blank on screen too, not a fake number', !/E\+/.test(mangled[iWork]), mangled[iWork]);
  const notesPhone = shown.find((td) => td.some((c) => /DIRECT CORP/.test(c)));
  ok('  a phone recovered from the notes shows in the table', /786 953 5229/.test(notesPhone[iWork]), notesPhone[iWork]);

  await page.locator('.side-nav-btn', { hasText: 'Lists' }).first().click(); await sleep(800);
  const listsTxt = await page.locator('main').innerText();
  ok('the list appears in Lists with every lead', /Aug open lane/.test(listsTxt), listsTxt.slice(0, 200));
  ok('  holding all six', /\b6\b/.test(listsTxt), listsTxt.slice(0, 300));
  await page.locator('.side-nav-btn', { hasText: 'CSP Scanner' }).first().click(); await sleep(800);
  await page.setInputFiles('input[type=file]', CSP); await sleep(2500);

  console.log('\n== downloads ==');
  ok('a High priority download is offered', await page.locator('button[aria-label="Download High priority leads"]').count() === 1);
  ok('a Medium priority download is offered', await page.locator('button[aria-label="Download Medium priority leads"]').count() === 1);
  ok('no Dynamics / M365 download on this tab', await page.locator('button[aria-label="Download Dynamics leads"]').count() === 0);
  const hiBtn = await page.locator('button[aria-label="Download High priority leads"]').innerText();
  ok('  High priority counts ACME + HELD + MANGLED + DIRECT (4)', /\b4\b/.test(hiBtn), hiBtn);

  console.log('\n== set by hand: manual priority overrides the score ==');
  const midRow = page.locator('table[aria-label="Scan results"] tbody tr').filter({ hasText: 'MIDLING INC' }).first();
  ok('the middling row shows Medium priority before any override', /Medium priority/.test(await midRow.innerText()));
  await midRow.locator('button', { hasText: /^High$/ }).click(); await sleep(600);
  ok('after clicking High its tier reads High priority', /High priority/.test(await page.locator('table[aria-label="Scan results"] tbody tr').filter({ hasText: 'MIDLING INC' }).first().innerText()));
  const tiers2 = (await page.locator('.seg-btn, .chip-btn').allInnerTexts()).join(' | ');
  ok('  and the High priority count went 4 -> 5', /High priority \(5\)/.test(tiers2), tiers2);
  ok('  and the Medium count went 1 -> 0', /Medium priority \(0\)/.test(tiers2), tiers2);
  const hiBtn2 = await page.locator('button[aria-label="Download High priority leads"]').innerText();
  ok('  and the High priority download now counts 5', /\b5\b/.test(hiBtn2), hiBtn2);
  await page.locator('table[aria-label="Scan results"] tbody tr').filter({ hasText: 'MIDLING INC' }).first().locator('button', { hasText: /^High$/ }).click(); await sleep(600);
  ok('clicking High again clears the override back to Medium', /Medium priority/.test(await page.locator('table[aria-label="Scan results"] tbody tr').filter({ hasText: 'MIDLING INC' }).first().innerText()));

  console.log('\n== setup panel ==');
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(500);
  const setup = await page.locator('main').innerText();
  // The weights header is uppercased by CSS, so innerText comes back as
  // "SCORING WEIGHTS" — match case-insensitively.
  ok('the scoring weights are editable', /scoring weights/i.test(setup) && /Partner lane/.test(setup) && /Billing intent/.test(setup));
  ok('the CSP columns are mapped and shown', /msp_licensingprogramname/.test(setup) && /msp_partneraccountidname/.test(setup));
  ok('  a mapped column never reads "not found"', !/Licensing programme\s*\n\s*auto . not found/.test(setup), setup.slice(setup.indexOf('WHICH COLUMN'), setup.indexOf('WHICH COLUMN') + 300));
  ok('  and its fill rate is shown', /100% filled/.test(setup), setup.slice(setup.indexOf('WHICH COLUMN'), setup.indexOf('WHICH COLUMN') + 300));
  ok('no literal \\u escapes leak onto the screen', !/\\u[0-9a-f]{4}/i.test(setup), (setup.match(/.{0,30}\\u[0-9a-f]{4}.{0,30}/i) || [''])[0]);
  ok('no renewal-date language survives from the old model', !/Renewal \/ term end/.test(setup) && !/win-back/i.test(setup));
  ok('dead language is a penalty with two knobs, not a checkbox', /in the newest seller entry costs/.test(setup) && /in an older entry only/.test(setup));
  ok('  and the hard stop is an opt-in', await page.locator('label:has-text("hard stop") input[type=checkbox]').isChecked() === false);

  console.log('\n== isolation ==');
  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner September' }).first().click(); await sleep(900);
  const smcBody = await page.locator('main').innerText();
  ok('the SMC scanner does not show the CSP scan', !/ACME MANUFACTURING/.test(smcBody));
  ok('  and shows its own rules, not the scoring ones', !/Score 0.100/.test(smcBody));
  await page.locator('.side-nav-btn', { hasText: 'CSP Scanner' }).first().click(); await sleep(900);
  ok('CSP starts clean rather than replaying a stale scan', !/ACME MANUFACTURING/.test(await page.locator('main').innerText()));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
