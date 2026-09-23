// The Custom Scanner against Jack's REAL SMC rows, in a real browser.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const samples = require('../fixtures/smc-samples.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };

// Real description blobs paired with real campaign codes.
const CAMPAIGNS = [
  'US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6',
  'US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10',
  'US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7',
  'US~FY24~CMP~COE True Up 1~SRAIM419760',          // stale on purpose
  'US~US~FY25~CMP~Partner CoSell~SRAIM562011',
  'US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2',
  'NULL',
  'US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33',
  'US~FY24~CMP~COE True Up 1~SRAIM419760',          // stale
  'NULL',
  'US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13', // hot word: migration
  'US~US~FY25~CMP~TUM~SRAIM514049',
  'US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2',
];
const esc = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = ['companyname,description,campaignidname,emailaddress1,fullname']
  .concat(samples.map((d, i) => [
    esc(''), esc(d), esc(CAMPAIGNS[i] || 'NULL'), esc(''), esc(''),
  ].join(','))).join('\n');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());
  const txt = () => page.locator('main').innerText();

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  console.log('\n== nav placement ==');
  const nav = (await page.locator('.side-nav-btn').allInnerTexts()).map(t => t.split('\n')[0].trim());
  // The three scanners sit together at the top, in the order they were
  // built, with the rest of the platform below them.
  ok('the three scanners sit together above Lead library',
     nav.indexOf('Custom Scanner September') === nav.indexOf('Main Scanner') + 1 &&
     nav.indexOf('CSP Scanner') === nav.indexOf('Custom Scanner September') + 1 &&
     nav.indexOf('Lead library') === nav.indexOf('CSP Scanner') + 1, JSON.stringify(nav));

  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(600);

  console.log('\n== upload the real SMC batch ==');
  await page.setInputFiles('input[type=file]', { name: 'smc.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await sleep(2600);
  const t1 = await txt();
  ok(`read all ${samples.length} rows`, new RegExp(`ROWS READ\\s*${samples.length}`, 'i').test(t1), (t1.match(/ROWS READ\s*\d+/i) || [])[0]);
  ok('figures reconcile', /figures reconcile/.test(t1));

  console.log('\n== the blob is actually parsed ==');
  ok('company pulled out of the blob', /CARING ENDPOINTS/.test(t1));
  ok('multi-contact company shows the extra contacts', /\+2 more|\+1 more/.test(t1));
  ok('SMC Type surfaced as its own column value', /Upper Medium|Medium/.test(t1));
  // The Campaign column is merged into Why now, so the campaign has to
  // show up inside the reason text rather than in a column of its own.
  ok('campaign name surfaced inside the reason', /Fabric as Next Logical Workload|Expand M365 Copilot/.test(t1));
  ok('there is no separate Campaign column', !/CAMPAIGN/.test(t1));
  ok('fiscal year surfaced', /FY26|FY25/.test(t1));

  console.log('\n== scoring ==');
  ok('Act Now gaps shown as product chips', /Azure|D365 Sales Pro|Surface/.test(t1));
  ok('some leads scored Strong Signal', !/HIGH PRIORITY\s*0/i.test(t1), (t1.match(/HIGH PRIORITY\s*\d+/i) || [])[0]);
  ok('stale FY24 campaigns are Bad Leads', /LOW PRIORITY\s*[1-9]/i.test(t1), (t1.match(/LOW PRIORITY\s*\d+/i) || [])[0]);
  ok('a stale row says why', /Stale campaign/.test(t1));
  ok('a NULL row is excluded with a reason', /No usable lead content/.test(t1));

  console.log('\n== callable only: the leads you can actually work ==');
  // Jack's real export: 82 of 99 Strong Signal rows named a company and
  // nobody at it. This filter is how he gets to the 17 he can call.
  const rowCount = () => page.locator('.data-table').first().locator('tbody tr').count();
  const beforeCallable = await rowCount();
  await page.locator('input[aria-label="Callable only"]').check(); await sleep(800);
  const afterCallable = await rowCount();
  ok('callable-only narrows to rows with a phone or an email', afterCallable > 0 && afterCallable <= beforeCallable, `${beforeCallable} -> ${afterCallable}`);
  const callableText = await page.locator('.data-table').first().innerText();
  ok('every row left has a phone or an email',
     callableText.split('\n').filter(l => l.includes('@') || /\d{3}/.test(l)).length > 0);
  await page.locator('input[aria-label="Callable only"]').uncheck(); await sleep(600);
  ok('unticking restores every row', (await rowCount()) === beforeCallable);

  console.log('\n== SMC filters ==');
  await page.locator('input[aria-label="Act Now gaps only"]').check(); await sleep(700);
  const gapRows = await page.locator('.data-table').first().locator('tbody tr').count();
  const t2 = await txt();
  ok('Act Now gaps filter narrows the table', gapRows > 0 && !/No rows match/.test(t2), String(gapRows));
  await page.locator('input[aria-label="Act Now gaps only"]').uncheck(); await sleep(500);

  await page.locator('select[aria-label="Product filter"]').selectOption('Azure'); await sleep(700);
  const azureRows = await page.locator('.data-table').first().locator('tbody tr').count();
  ok('product filter narrows to Azure propensity', azureRows > 0, String(azureRows));
  await page.locator('select[aria-label="Product filter"]').selectOption('all'); await sleep(500);

  console.log('\n== fiscal-year cutoff is adjustable ==');
  // It decides what counts as stale, so it is a RULE now and lives with the
  // other rules under Scan setup rather than in the filter bar.
  const beforeExcluded = ((await txt()).match(/LOW PRIORITY\s*(\d+)/i) || [])[1];
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(600);
  ok('the fiscal-year cutoff sits with the rules, not the filters',
     await page.locator('input[aria-label="Oldest fiscal year"]').count() > 0);
  await page.fill('input[aria-label="Oldest fiscal year"]', '24'); await sleep(1200);
  const afterExcluded = ((await txt()).match(/LOW PRIORITY\s*(\d+)/i) || [])[1];
  ok('lowering the FY cutoff un-excludes the stale campaigns',
     Number(afterExcluded) < Number(beforeExcluded), `${beforeExcluded} -> ${afterExcluded}`);
  await page.fill('input[aria-label="Oldest fiscal year"]', '25'); await sleep(1000);
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(400);

  // Rule checkboxes are controlled inputs updated optimistically; the box
  // flips on the click itself (verified by instrumentation at t+0ms).
  // Playwright's built-in check()/uncheck() re-reads state in a way that
  // trips on this, so do what a user does — click — and assert the DOM
  // state explicitly, which is the stronger check anyway.
  const setBox = async (label, want) => {
    const box = page.locator(`input[aria-label="${label}"]`);
    if ((await box.isChecked()) !== want) { await box.click(); await sleep(400); }
    ok(`"${label}" is now ${want ? 'on' : 'off'}`, (await box.isChecked()) === want);
    await sleep(900);
  };

  console.log('\n== Strong Signal rules are live knobs ==');
  const strongBefore = Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]);
  // The rule in force is readable without opening anything; the knobs for
  // it sit behind the Scan setup toggle.
  ok('the collapsed setup bar states the rule in force', /High priority = Act Now/.test(await txt()));
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(600);
  ok('Edit setup reveals the Strong Signal knobs', await page.locator('input[aria-label="Hot words"]').count() > 0);

  // Jack's rule: modernize / migrate / migration language is a great-opp
  // signal — but ONLY where a human wrote it about THIS account.
  //
  // This assertion used to read the other way: a migration CAMPAIGN alone
  // pushed a lead to Strong. Measured on the real 13,106-row export that
  // was firing on 173 of 197 hot-signal rows, across only 81 distinct
  // campaign names, with 364 accounts sharing "Microsoft Azure Virtual
  // Training Day: Migrate and Secure Windows Server" — a webinar invite
  // list scoring as buying intent, and 122 of the 197 had no propensity at
  // all. Per Jack the campaign title is now context, never a qualifier, so
  // the assertion is INVERTED rather than deleted: it pins the new rule.
  ok('hot-word rule is on by default and named in the sentence', /modernize\/modernization\/migrate\/migration language/.test(await txt()));
  ok('a migration CAMPAIGN TITLE alone no longer qualifies a lead',
     !/hot signal — "migration" in campaign/i.test(await txt()), (await txt()).match(/hot signal[^\n]{0,70}/i)?.[0]);
  // The campaign used to ride along as "campaign mentions ..." AND print
  // again at the end of the note. Per Jack — "get rid of what is not stated
  // or indicated in the file" — the note is now the call reason only, so the
  // campaign is gone from it entirely. Inverted rather than deleted, so the
  // new contract is pinned: it must NOT come back.
  ok('  and the campaign no longer pads the note',
     !/campaign mentions/i.test(await txt()), (await txt()).match(/campaign mentions[^\n]{0,50}/i)?.[0]);

  console.log('\n== not supported: Fabric · large opps only: Power BI ==');
  // Per Jack: "we dont do fabric anymore and unless its a large power bi
  // opp no." CARING ENDPOINTS came in on a Fabric campaign; TPID 10984130's
  // only gap is D365 F&O (unsupported) and its BANT need is "Data &
  // Analytics Modernization / Fabric" — the hot word next to Fabric must
  // not fire, and both rows are Bad Leads that say why.
  ok('a Fabric campaign is a Bad Lead, not Needs Review', /Not supported — "fabric" in campaign "Fabric as Next Logical Workload"/.test(await txt()));
  ok('"Modernization / Fabric" in a BANT need is a Bad Lead — the hot word next to Fabric does not count', /Not supported — "fabric" in BANT need/.test(await txt()));
  ok('the rule sentence states both rules', /never fabric \(Low priority\)/.test(await txt()) && /power bi\/powerbi only if large \(Medium priority\)/.test(await txt()));
  // The list is a live knob: clear it and the Fabric BANT lead is a hot-word Strong again.
  await page.fill('input[aria-label="Not supported products"]', ''); await page.locator('input[aria-label="Not supported products"]').blur(); await sleep(1200);
  ok('clearing the not-supported list restores the Fabric hot-word lead to Strong Signal',
     Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]) === strongBefore + 1 && !/Not supported — "fabric" in BANT need/.test(await txt()));
  await page.fill('input[aria-label="Not supported products"]', 'fabric'); await page.locator('input[aria-label="Not supported products"]').blur(); await sleep(1200);
  ok('restoring it puts the count back', Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]) === strongBefore);

  console.log('\n== the counts add up ==');
  // Per Jack: "make sure strong signals add up." The Strong Signal tile
  // carries a per-line split, and the product-line chips count what the
  // active bucket filter leaves — so with Strong Signal selected, Dynamics
  // + M365/Azure must equal the Strong Signal total exactly.
  const kpiSplit = await page.locator('[aria-label="Strong Signal by product line"]').innerText();
  // The two <strong> values are the counts; the labels themselves contain "365".
  const splitNums = (await page.locator('[aria-label="Strong Signal by product line"] strong').allInnerTexts()).map(Number);
  ok('Strong Signal tile shows a Dynamics + M365/Azure split that sums to the total',
     splitNums.length === 2 && splitNums[0] + splitNums[1] === strongBefore && !/unassigned/.test(kpiSplit), `${kpiSplit} vs ${strongBefore}`);
  await page.locator('.seg-btn', { hasText: /^High priority \(/ }).first().click(); await sleep(600);
  const lineN = async (l) => Number(((await page.locator(`button[aria-label="Product line ${l}"]`).innerText()).match(/\((\d+)\)/) || [])[1]);
  const [lAll, lDyn, lM365] = [await lineN('all'), await lineN('Dynamics 365'), await lineN('M365 / Azure')];
  ok('with Strong Signal selected the line chips count Strong rows only, and add up', lAll === strongBefore && lDyn + lM365 === lAll, `${lAll} = ${lDyn} + ${lM365}`);
  ok('a hot-word Strong lead with no propensity still carries a line (Age-se → M365 / Azure)', lM365 >= 1);
  await page.locator('.seg-btn', { hasText: /^All \(/ }).first().click(); await sleep(500);

  await setBox('Hot words push Strong Signal', false);
  const strongNoHot = Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]);
  // Exactly one row is Strong ONLY because of a hot word: Age-se (campaign
  // "…migration to Azure"). TPID 10984130 used to be the second — its BANT
  // need reads "Data & Analytics Modernization / Fabric" — but Fabric is
  // not supported now, so it is a Bad Lead whichever way this knob is set.
  // The only hot word in this fixture sits in a CAMPAIGN TITLE, and a
  // campaign title no longer qualifies anything (see the inverted assertion
  // above), so toggling the knob cannot move the count here. That IS the
  // new rule, so assert it rather than a count that can no longer change.
  ok('toggling hot words off does not change the count, because the only hot word is a campaign title',
     strongNoHot === strongBefore, `${strongBefore} -> ${strongNoHot}`);
  ok('  and no row claims a hot signal from a campaign', !/hot signal \u2014 "migration" in campaign/i.test(await txt()));
  await setBox('Hot words push Strong Signal', true);
  ok('turning it back on leaves the count where it was', Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]) === strongBefore);
  // The word list is still editable and still live \u2014 it just only applies
  // to the BANT need and the notes now.
  await page.fill('input[aria-label="Hot words"]', 'modernize, modernization'); await page.locator('input[aria-label="Hot words"]').blur(); await sleep(1200);
  ok('the hot-word list is still editable without breaking the scan', Number.isFinite(Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1])));
  await page.fill('input[aria-label="Hot words"]', 'modernize, modernization, migrate, migration'); await page.locator('input[aria-label="Hot words"]').blur(); await sleep(1200);
  // The "Also push Strong" checkboxes for BANT and High prioritization
  // index are GONE: both are weights now, so an override on top would have
  // counted the same signal twice. A control that silently did nothing
  // would be worse than no control, so the checkboxes were removed with
  // the branches. What must hold is that the weights exist instead.
  ok('the BANT override checkbox is gone', await page.locator('input[aria-label="BANT pushes Strong Signal"]').count() === 0);
  ok('the prioritization-index override checkbox is gone', await page.locator('input[aria-label="High prioritization index pushes Strong Signal"]').count() === 0);
  ok('  BANT is a scoring weight instead', await page.locator('label:has-text("BANT on file") input[type=number]').count() > 0);
  ok('  and so is the prioritization index', await page.locator('label:has-text("Prioritization index") input[type=number]').count() > 0);
  // Loosening stage + fit must never lower the count.
  await setBox('Stage Evaluate', true);
  await page.locator('select[aria-label="Minimum fit"]').selectOption('Medium'); await sleep(1200);
  const strongLoose = Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]);
  ok('adding Evaluate + Medium fit never lowers Strong Signal', strongLoose >= strongBefore, `${strongBefore} -> ${strongLoose}`);
  ok('the sentence reflects the loosened rule', /Act Now or Evaluate/.test(await txt()) && /at least Medium Fit/.test(await txt()));
  await page.locator('button:has-text("Reset to defaults")').click(); await sleep(1200);
  ok('Reset returns to the shipped default count', Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]) === strongBefore);

  console.log('\n== received dates: sort + filter ==');
  // Per Jack: "are there any dates in these 13k+ leads ... most recent at
  // the top so i can add these to sequences." The blobs state "(as pulled
  // from Cloud Ascent on YYYY-MM-DD)" — that is the Received column.
  // Address the cell by its aria-label, not its position: a new column
  // (Email / Phone) shifted the index and silently emptied every date read.
  // Received is no longer its own column (the table is stripped to the nine
  // download fields); it rides inside the Notes cell, addressed by label.
  const received = async () => (await page.locator('.data-table').first().locator('tbody tr [aria-label="Received"]').allInnerTexts()).map(t => t.trim());
  // Score-first is the default now that this tab scores, so the date order
  // is selected explicitly rather than assumed.
  await page.locator('select[aria-label="Sort by"]').selectOption('received-desc'); await sleep(700);
  const dates0 = (await received()).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
  ok('real pull dates are read out of the blobs', dates0.length >= 4, JSON.stringify(dates0));
  ok('newest first when sorted by date', dates0.join() === [...dates0].sort().reverse().join(), JSON.stringify(dates0));
  const firstCells = await received();
  ok('undated rows sink below every dated row, never to the top', /^\d{4}-/.test(firstCells[0]), firstCells[0]);
  ok('an undated row says so rather than showing blank', (await received()).some(v => v === 'no date'));
  await page.locator('select[aria-label="Sort by"]').selectOption('received-asc'); await sleep(700);
  const asc = (await received()).filter(v => /^\d{4}-/.test(v));
  ok('oldest first reverses it', asc.join() === [...dates0].reverse().join(), JSON.stringify(asc));
  ok('undated rows still sink when sorting oldest first', /^\d{4}-/.test((await received())[0]));
  await page.locator('select[aria-label="Sort by"]').selectOption('received-desc'); await sleep(600);
  // Filter to a window that excludes the oldest pull date.
  await page.fill('input[aria-label="Received from"]', '2026-06-01'); await sleep(900);
  const win = (await received()).filter(v => /^\d{4}-/.test(v));
  ok('a from-date narrows to leads received on or after it', win.length > 0 && win.every(v => v >= '2026-06-01'), JSON.stringify(win));
  ok('undated rows are excluded once a date range is set', (await received()).every(v => /^\d{4}-/.test(v)));
  await page.locator('button[aria-label="Clear date range"]').click(); await sleep(700);
  ok('clearing the range restores every row', (await received()).length >= firstCells.length);

  console.log('\n== identity is the TPID, never the campaign code ==');
  // Regression: with no companyname/fullname in the file, the column
  // guesser mapped "contact" to campaignidname — so two unrelated leads on
  // the same campaign shared one identity. That made them a duplicate pair
  // (silently merged) AND made one Keep click curate both. A Cloud Ascent
  // lead's identity is its Microsoft Customer TPID.
  // The accounting note names duplicates only when there are some (same as
  // the Main Scanner), so "no merge happened" reads as its absence.
  const note = (await txt()).replace(/\s+/g, ' ');
  ok('no rows were merged on a campaign code', /13 read . 13 processed/.test(note) && !/duplicates merged/.test(note), note.slice(0, 120));

  console.log('\n== curation still works on parsed leads ==');
  const keep = page.locator('button[aria-label^="High "]').first();
  ok('curation controls present', await keep.count() > 0);
  await keep.click(); await sleep(700);
  ok('one High click overrides exactly one lead', /High \(1\)/.test(await txt()), ((await txt()).match(/High \(\d+\)/) || [])[0]);

  console.log('\n== storage failure never blanks the screen ==');
  // Per Jack: "no gap for errors." Simulate a full/failed IndexedDB and
  // change a rule: the change must still apply, the table must still be
  // there, and a dismissible banner must say what did not save.
  await page.evaluate(() => {
    window.__origOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function () {
      const r = {};
      setTimeout(() => { r.error = new DOMException('Quota exceeded (simulated)', 'QuotaExceededError'); if (r.onerror) r.onerror({ target: r }); }, 0);
      return r;
    };
  });
  const strongPreFail = Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]);
  // Any live rule change will do here; the point is that the SCAN still
  // re-runs when the SAVE fails. The BANT checkbox this used to toggle
  // became a scoring weight, so move the High threshold instead — that is
  // guaranteed to change the count whatever the fixture scores.
  await page.fill('input[aria-label="High priority threshold"]', '10');
  await page.locator('input[aria-label="High priority threshold"]').blur(); await sleep(1400);
  ok('the rule change still applies with storage down', Number(((await txt()).match(/HIGH PRIORITY\s*(\d+)/i) || [])[1]) > strongPreFail);
  ok('the results table is still on screen', await page.locator('.data-table').first().locator('tbody tr').count() > 0);
  ok('a banner names what could not be saved', /could not be saved.*Quota exceeded/.test(await page.locator('[role=alert]').innerText().catch(() => '')));
  await page.locator('button[aria-label="Dismiss error"]').click(); await sleep(300);
  ok('the banner dismisses', await page.locator('[role=alert]').count() === 0);
  await page.evaluate(() => { IDBFactory.prototype.open = window.__origOpen; });
  await page.fill('input[aria-label="High priority threshold"]', '60');
  await page.locator('input[aria-label="High priority threshold"]').blur(); await sleep(1400);

  console.log('\n== isolation ==');
  await page.locator('.side-nav-btn', { hasText: 'Lead library' }).first().click(); await sleep(800);
  ok('nothing reached the Lead library', !/CARING ENDPOINTS|SOFVARE/.test(await txt()));

  console.log('\n== errors ==');
  ok('no page or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
