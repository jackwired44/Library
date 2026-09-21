// "Wants a partner" — Jack's top-quality flag, driven in a real browser.
//
// Per Jack: "if it states wants a partner that needs to be flagged for top
// quality." The flag is only worth having if it is TRUE, and on his real
// 9,265-row export the original pattern fired 961 times with 857 of those
// (89%) on rows that NAME a partner in the partner column. The rule logic
// is unit-tested in the `csp` suite; this one checks the three things only
// a browser can: the chip renders, the filter narrows, and a lead the
// SCORE would never promote reaches High priority on the flag alone.
//
// Its own fixture on purpose: csp-live's six rows carry a "all six rows"
// narrative through 130 checks, and growing that fixture to test this
// would have rewritten two dozen unrelated count assertions.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getDate()}/${MON[d.getMonth()]}`; };

const HEAD = ['customeridname','estimatedvalue','msp_forecastcomments','msp_licensingprogramname',
  'msp_partneraccountidname','msp_rollupestrevenue','fullname','telephone1','mobilephone',
  'emailaddress1','address1_country','campaignidname'];
const row = o => HEAD.map(h => q(o[h] ?? '')).join(',');
const base = { estimatedvalue:'', msp_rollupestrevenue:'', mobilephone:'NULL',
  address1_country:'United States', campaignidname:'NULL' };

const csv = [HEAD.join(',')].concat([
  // 1. STATES IT, and is weak on every other factor: held by a named
  //    partner, monthly billing, no stated value. Only the flag can put
  //    this in High — which is exactly what Jack asked for.
  row({ ...base, customeridname:'STATES IT CO', msp_licensingprogramname:'CSP | Monthly New',
    msp_partneraccountidname:'Some Reseller LLC', fullname:'Ada Brant', telephone1:'312-555-0199',
    emailaddress1:'ada@statesit.com',
    msp_forecastcomments:`JS - ${ago(6)} - The customer is looking for a partner to take over licensing and support. Next Steps: intro call.` }),
  // 2. Microsoft's CRM template ONLY. Same weak factors. Must NOT be
  //    flagged and must NOT reach High. This is the 846-row false fire.
  row({ ...base, customeridname:'TEMPLATE ONLY CO', msp_licensingprogramname:'CSP | Monthly New',
    msp_partneraccountidname:'Another Reseller LLC', fullname:'Cy Webb', telephone1:'312-555-0198',
    emailaddress1:'cy@templateonly.com',
    msp_forecastcomments:`JS - ${ago(6)} - Partner: Not discovered - recommend initiating partner discovery/Partner Recommendation Partner POC: Not discovered. Partner Contact: N/A PCM program: Open to partner introduction` }),
  // 3. A NEGATION. The opposite signal; must never be top quality.
  row({ ...base, customeridname:'DECLINED CO', msp_licensingprogramname:'CSP | Monthly New',
    msp_partneraccountidname:'Third Reseller LLC', fullname:'Rex Hale', telephone1:'312-555-0197',
    emailaddress1:'rex@declined.com',
    msp_forecastcomments:`JS - ${ago(6)} - Customer does not want a reseller to be the middle man and would prefer a direct relationship.` }),
  // 4. A high scorer that never says it — should be High on merit, and
  //    must NOT appear under the flag's filter.
  row({ ...base, customeridname:'QUIET WHALE CO', estimatedvalue:'300000', msp_rollupestrevenue:'300000',
    msp_licensingprogramname:'CSP | Annual New Upfront Billing', msp_partneraccountidname:'NULL',
    fullname:'Sam Vale', telephone1:'312-555-0196', emailaddress1:'sam@quietwhale.com',
    msp_forecastcomments:`TH - ${ago(4)} - Quote sent. Meeting set for Thursday. Next Steps: contract review.` }),
  // 5. The full pinned lead: states it, none assigned, annual upfront.
  //    Gets the star, not the chip — the star means all three.
  row({ ...base, customeridname:'PINNED CO', estimatedvalue:'45000', msp_rollupestrevenue:'45000',
    msp_licensingprogramname:'CSP | Annual New Upfront Billing', msp_partneraccountidname:'NULL',
    fullname:'Dana Reyes', telephone1:'312-555-0195', emailaddress1:'dana@pinned.com',
    msp_forecastcomments:`MA - ${ago(5)} - Customer is looking for a partner to take over licensing. Next Steps: intro call Monday.` }),
]).join('\n');
const FILE = path.join(os.tmpdir(), 'wants-partner.csv');
fs.writeFileSync(FILE, csv);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await page.locator('.side-nav-btn', { hasText: 'CSP Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(900);

  const tbody = async () => (await page.locator('.data-table tbody').innerText()).replace(/\s+/g, ' ');
  const band = async name => { await page.locator('[aria-label="CSP filters"] .seg-btn', { hasText: name }).click(); await sleep(450); };
  const all = async () => { await page.locator('[aria-label="CSP filters"] .seg-btn', { hasText: /^All/ }).click(); await sleep(450); };

  console.log('\n== the flag itself ==');
  const wpLabel = page.locator('label:has-text("Wants a partner")');
  ok('the CSP tab has a Wants-a-partner filter', await wpLabel.count() === 1);
  const labelText = (await wpLabel.innerText()).replace(/ /g, ' ');
  // STATES IT CO and PINNED CO. Not the template row, not the negation,
  // not the quiet whale.
  ok('  and its count is exactly the two leads that state it', /\(\s*2\s*\)/.test(labelText), labelText);

  console.log('\n== it forces High priority, per Jack ==');
  await band('High priority');
  const high = await tbody();
  ok('a stated want reaches High with a named partner, monthly billing and no value',
     /STATES IT CO/.test(high), high.slice(0, 200));
  ok('  the template-only row does NOT reach High', !/TEMPLATE ONLY CO/.test(high), high.slice(0, 200));
  ok('  the negation does NOT reach High', !/DECLINED CO/.test(high), high.slice(0, 200));
  ok('  a genuine high scorer is still there on merit', /QUIET WHALE CO/.test(high), high.slice(0, 200));

  console.log('\n== chip vs star ==');
  ok('the flagged-but-not-pinned lead carries the chip', /⚑\s*wants a partner/i.test(high), high.slice(0, 300));
  const pinnedRow = await page.locator('.data-table tbody tr', { hasText: 'PINNED CO' }).innerText();
  ok('  the pinned lead shows the star, not the chip',
     /★/.test(pinnedRow) && !/⚑/.test(pinnedRow), pinnedRow.replace(/\s+/g, ' ').slice(0, 160));
  const statesRow = await page.locator('.data-table tbody tr', { hasText: 'STATES IT CO' }).innerText();
  ok('  the chip row carries the chip and not the star', /⚑/.test(statesRow) && !/★/.test(statesRow), statesRow.replace(/\s+/g, ' ').slice(0, 160));

  console.log('\n== ranking ==');
  await all();
  const order = await page.locator('.data-table tbody tr td:nth-child(3)').allInnerTexts();
  const iPin = order.findIndex(t => /PINNED CO/.test(t));
  const iStates = order.findIndex(t => /STATES IT CO/.test(t));
  const iWhale = order.findIndex(t => /QUIET WHALE CO/.test(t));
  ok('the pinned lead sorts first', iPin === 0, order.join(' | ').slice(0, 160));
  ok('  the flagged lead outranks a higher-scoring lead that never says it',
     iStates >= 0 && iWhale >= 0 && iStates < iWhale, `states@${iStates} whale@${iWhale}`);

  console.log('\n== the filter ==');
  const box = wpLabel.locator('input[type=checkbox]');
  await box.check(); await sleep(500);
  const only = await tbody();
  ok('checking it narrows to exactly the flagged leads',
     /STATES IT CO/.test(only) && /PINNED CO/.test(only), only.slice(0, 200));
  ok('  template-only excluded', !/TEMPLATE ONLY CO/.test(only), only.slice(0, 200));
  ok('  negation excluded', !/DECLINED CO/.test(only), only.slice(0, 200));
  ok('  unflagged high scorer excluded', !/QUIET WHALE CO/.test(only), only.slice(0, 200));
  ok('  the active-filter summary names it',
     /wants a partner/i.test(await page.locator('[aria-label="CSP filters"]').innerText()));
  await box.uncheck(); await sleep(450);
  ok('unchecking restores every row', /TEMPLATE ONLY CO/.test(await tbody()) && /DECLINED CO/.test(await tbody()));

  console.log('\n== it reaches the CSV ==');
  ok('the reason text says TOP QUALITY on the flagged lead',
     /TOP QUALITY/i.test(await page.locator('.data-table tbody tr', { hasText: 'STATES IT CO' }).innerText()),
     (await page.locator('.data-table tbody tr', { hasText: 'STATES IT CO' }).innerText()).replace(/\s+/g, ' ').slice(0, 200));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
