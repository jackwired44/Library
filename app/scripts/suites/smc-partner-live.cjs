// The Custom Scanner's partner lane, driven in a real browser.
//
// Per Jack: "For custom scanner is there any indications of partner
// involvement for the leads being qualified there." The blob's "Partner:"
// field was parsed and then thrown away. The rule logic is unit-tested in
// the `smc-partner` suite; this one checks the three things only a browser
// can show: the lane renders on the row, the filter narrows to it, and the
// adjustment in Scan setup actually moves the score.
//
// Its own fixture on purpose — smc-live's 66 checks carry a fixed
// thirteen-row narrative, and adding partner values to it would have
// rewritten a couple of dozen unrelated counts.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const samples = require('../fixtures/smc-samples.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };

// A real Act Now / High index blob, with its own Partner: field stripped so
// the three rows differ ONLY in the lane under test.
const BLOB = samples[3].replace(/\sPartner:\s[^]*?(?=\s(?:Lead I[dD]|MSX Account|Customer TPID|Budget|Authority|Need|Timeline)\s*:|$)/i, ' ');
const rows = [
  { co: 'Alpine Freight', partner: 'Partner: Rackspace Technology ' },   // held
  { co: 'Borden Labs', partner: 'Partner: Microsoft Corporation ' },     // open
  { co: 'Carlow Metals', partner: '' },                                  // not stated
];
const HEAD = ['address1_country', 'description', 'emailaddress1', 'fullname', 'jobtitle', 'mobilephone',
  'telephone1', 'accountidname', 'websiteurl', 'address1_city', 'address1_stateorprovince', 'msdyn_segmentidname',
  'industrycodename', 'statuscodename', 'revenue', 'numberofemployees', 'campaignidname', 'companyname', 'estimatedclosedate'];
const csv = [HEAD.join(',')].concat(rows.map((r, i) => [
  'US', BLOB + r.partner, `p${i}@corp.com`, `Pat Vance ${i}`, 'IT Director', `312-555-90${i}`, `312-555-10${i}`,
  `ACCT-${i}`, 'corp.com', 'Chicago', 'IL', 'Seg', 'Tech', 'Open', '100', '250',
  'US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2', r.co, '2026-12-01',
].map(q).join(','))).join('\n');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1300);
  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'smc.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await sleep(3000);

  const tableRows = () => page.locator('table.data-table tbody tr').evaluateAll(ns => ns.map(n => n.innerText.replace(/\n/g, ' | ')));
  const rowFor = async co => (await tableRows()).find(t => t.includes(co)) || '';

  console.log('\n== the fixture actually scores, or nothing below means anything ==');
  const all = await tableRows();
  ok('all three rows scored', all.length === 3 && all.every(t => /Score \d+/.test(t)), JSON.stringify(all.map(t => (t.match(/Score \d+/) || [''])[0])));

  console.log('\n== the lane shows on the row ==');
  ok('a held account names its partner', /Rackspace Technology/.test(await rowFor('Alpine Freight')), (await rowFor('Alpine Freight')).slice(0, 200));
  ok('an open lane is flagged', /no partner on it/.test(await rowFor('Borden Labs')), (await rowFor('Borden Labs')).slice(0, 200));
  ok('a row that states nothing shows neither', !/no partner on it|Rackspace/.test(await rowFor('Carlow Metals')), (await rowFor('Carlow Metals')).slice(0, 200));

  console.log('\n== the score moved, and only where it should ==');
  const scoreOf = async co => Number(((await rowFor(co)).match(/Score (\d+)/) || [])[1]);
  const held0 = await scoreOf('Alpine Freight'), open0 = await scoreOf('Borden Labs'), quiet0 = await scoreOf('Carlow Metals');
  ok('the open lane outscores the silent row by the adjustment', open0 - quiet0 === 8, `${quiet0} -> ${open0}`);
  ok('the held account undercuts it by the same', quiet0 - held0 === 8, `${quiet0} -> ${held0}`);

  console.log('\n== the filter narrows to a lane ==');
  const sel = page.locator('select[aria-label="Partner lane"]');
  ok('the filter exists', await sel.count() === 1);
  const opts = await sel.locator('option').evaluateAll(ns => ns.map(n => n.textContent.trim()));
  ok('faceted counts, one row in each lane',
     /Open lane \(1\)/.test(opts.join('|')) && /Partner held \(1\)/.test(opts.join('|')) && /Not stated \(1\)/.test(opts.join('|')),
     JSON.stringify(opts));
  await sel.selectOption('held'); await sleep(600);
  let shown = await tableRows();
  ok('held shows only the reseller row', shown.length === 1 && shown[0].includes('Alpine Freight'), JSON.stringify(shown.map(t => t.slice(0, 40))));
  await sel.selectOption('open'); await sleep(600);
  shown = await tableRows();
  ok('open shows only the direct row', shown.length === 1 && shown[0].includes('Borden Labs'), JSON.stringify(shown.map(t => t.slice(0, 40))));
  await sel.selectOption('unknown'); await sleep(600);
  shown = await tableRows();
  ok('not stated shows only the silent row', shown.length === 1 && shown[0].includes('Carlow Metals'), JSON.stringify(shown.map(t => t.slice(0, 40))));
  await sel.selectOption('all'); await sleep(600);

  console.log('\n== the adjustment is editable, and 0 turns it off ==');
  await page.locator('button:has-text("Scan setup"), button:has-text("Edit setup")').first().click().catch(() => {}); await sleep(900);
  const adj = page.locator('input[aria-label="Partner lane adjustment"]');
  ok('the control exists', await adj.count() === 1);
  ok('defaults to 8', (await adj.inputValue()) === '8', await adj.inputValue());
  await adj.fill('0'); await sleep(2600);
  const held1 = await scoreOf('Alpine Freight'), open1 = await scoreOf('Borden Labs'), quiet1 = await scoreOf('Carlow Metals');
  ok('at 0 every lane scores the same', held1 === quiet1 && open1 === quiet1, `${held1} / ${open1} / ${quiet1}`);
  ok('the silent row never moved at all', quiet1 === quiet0, `${quiet0} -> ${quiet1}`);

  console.log('\n== errors ==');
  ok('no page or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
