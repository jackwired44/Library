// The CSP Scanner's renewal handling, driven in a real browser: the
// coverage strip, the Renewal filter, and the ◆ pin Jack asked for —
// "a company with a known upcoming renewal date no partner is the highest
// priority lead here."
//
// Its own suite rather than more rows in csp-live, whose fixture row count
// is asserted on in a dozen places; a renewal fixture needs several rows
// that differ only in lane and date, which is a different fixture.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getDate()}/${MON[d.getMonth()]}`; };
// A real calendar date n days out, written the way a seller writes one.
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };

const HEAD = ['customeridname','estimatedvalue','msp_forecastcomments','msp_licensingprogramname','msp_partneraccountidname','msp_rollupestrevenue','fullname','address1_telephone1','telephone1','mobilephone','emailaddress1','address1_country','campaignidname'];
const q = v => `"${String(v).replace(/"/g,'""')}"`;
const base = { address1_telephone1:'', mobilephone:'NULL', address1_country:'United States', campaignidname:'NULL', msp_licensingprogramname:'CSP | Annual Renewal Upfront Billing' };
const row = o => HEAD.map(h => q({ ...base, ...o }[h] ?? '')).join(',');

// Six rows. Three pin, three must not — and each non-pinning row fails for
// a DIFFERENT reason, so a rule that over-fires cannot pass this file.
const csv = [HEAD.join(',')].concat([
  // pins: open lane, contract renewal 20 days out. Soonest, so it leads.
  row({ customeridname:'OPEN SOON LLC', estimatedvalue:'90000', msp_partneraccountidname:'NULL', msp_rollupestrevenue:'90000', fullname:'Dana Reyes', telephone1:'312-555-0147', emailaddress1:'dana@opensoon.com',
        msp_forecastcomments:`MA - ${ago(4)} - Renewal date: ${inDays(20)}. Next Steps: confirm licence count on M365 E5.` }),
  // pins: same shape, further out — must sort BELOW the 20-day one.
  row({ customeridname:'OPEN LATER INC', estimatedvalue:'400000', msp_partneraccountidname:'NULL', msp_rollupestrevenue:'400000', fullname:'Nia Bell', telephone1:'312-555-0151', emailaddress1:'nia@openlater.com',
        msp_forecastcomments:`RZ - ${ago(6)} - Renewal date: ${inDays(70)}. Next Steps: pricing review.` }),
  // pins: Microsoft direct is still nobody on the record.
  row({ customeridname:'DIRECT CORP', estimatedvalue:'20000', msp_partneraccountidname:'Microsoft Corporation', msp_rollupestrevenue:'20000', fullname:'Ray Diaz', telephone1:'786-555-0122', emailaddress1:'ray@direct.com',
        msp_forecastcomments:`GD - ${ago(3)} - Term end ${inDays(45)}. Next Steps: quote.` }),
  // no pin: a named partner holds it. Same date, same money.
  row({ customeridname:'HELD CO', estimatedvalue:'90000', msp_partneraccountidname:'CDW Logistics LLC', msp_rollupestrevenue:'90000', fullname:'Sam Vale', telephone1:'312-555-0148', emailaddress1:'sam@held.com',
        msp_forecastcomments:`TH - ${ago(5)} - Renewal date: ${inDays(20)}. Next Steps: confirm licence count.` }),
  // no pin: a seller FORECAST close, not the customer's contract.
  row({ customeridname:'FORECAST LTD', estimatedvalue:'75000', msp_partneraccountidname:'NULL', msp_rollupestrevenue:'75000', fullname:'Lee Park', telephone1:'312-555-0152', emailaddress1:'lee@forecast.com',
        msp_forecastcomments:`KBM - ${ago(7)} - Estimated Close Date: ${inDays(30)}. Next Steps: follow up.` }),
  // no pin: the renewal already went by. They just re-signed.
  row({ customeridname:'RESIGNED GROUP', estimatedvalue:'60000', msp_partneraccountidname:'NULL', msp_rollupestrevenue:'60000', fullname:'Jo Marsh', telephone1:'312-555-0153', emailaddress1:'jo@resigned.com',
        msp_forecastcomments:`MA - ${ago(8)} - Renewal date: ${inDays(-35)}. Next Steps: revisit next cycle.` }),
]).join('\n');
const CSP = path.join(os.tmpdir(), 'csp-renewal-live.csv');
fs.writeFileSync(CSP, csv);

const notesOf = async page => (await page.locator('tbody tr').allInnerTexts());

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  // Scanner2 folds its fine print behind Details; open it so this suite
  // can read the reconciliation, renewal and phone lines it checks.
  await page.addInitScript(() => { try { localStorage.setItem('scanDetailsOpen', '1'); } catch {} });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await page.locator('.side-nav-btn', { hasText: 'CSP Scanner' }).first().click(); await sleep(800);
  await page.setInputFiles('input[type=file]', CSP); await sleep(2500);

  console.log('\n== renewal coverage ==');
  const body = await page.locator('main').innerText();
  ok('all six rows were read', /6 rows read|6 read/i.test(body), body.slice(0, 200));
  ok('the coverage strip says how many state a date', /of 6 rows state one|rows state one/.test(body), (body.match(/.{0,90}rows state one.{0,60}/) || [''])[0]);
  ok('  and separates a contract renewal from a seller forecast', /renewal/i.test(body) && /forecast|close/i.test(body));
  ok('  and counts the ones with no partner on the record', /\u25c6 with no partner/.test(body), (body.match(/.{0,40}with no partner.{0,20}/) || [''])[0]);
  ok('it says where the dates came from, since no column carries them', /read out of the seller notes, not a column/.test(body));

  console.log('\n== the note ==');
  let rows = await notesOf(page);
  const find = c => rows.find(t => t.includes(c)) || '';
  ok('an open-lane renewal carries the ◆ pin mark', /◆/.test(find('OPEN SOON')), find('OPEN SOON').slice(0, 160));
  ok('  with the clock, the days out and the lane', /⏰ Renews .*\(\d+d\)/.test(find('OPEN SOON')) && /no partner yet/.test(find('OPEN SOON')), find('OPEN SOON').slice(0, 160));
  ok('Microsoft direct pins too — nobody is on that record', /◆/.test(find('DIRECT CORP')), find('DIRECT CORP').slice(0, 160));
  ok('a renewal HELD by a named partner does NOT pin', !/◆/.test(find('HELD CO')), find('HELD CO').slice(0, 160));
  ok('  but still shows the date', /Renews /.test(find('HELD CO')), find('HELD CO').slice(0, 160));
  ok('a seller forecast close does NOT pin', !/◆/.test(find('FORECAST')), find('FORECAST').slice(0, 160));
  ok('  and is worded "forecast close", never "renews"', /Forecast close /.test(find('FORECAST')) && !/Renews/.test(find('FORECAST')), find('FORECAST').slice(0, 160));
  ok("the note answers Jack's four: when it renews, the size, what it is about, and the lane",
     /⏰ Renews .*\(\d+d\)/.test(find('OPEN SOON'))
     && /\$90k on /.test(find('OPEN SOON'))
     && /M365 E5/.test(find('OPEN SOON'))
     && /no partner yet/.test(find('OPEN SOON')), find('OPEN SOON').slice(0, 200));
  ok('  a held row names the partner it goes through', /via partner: CDW/.test(find('HELD CO')), find('HELD CO').slice(0, 160));
  ok('  a Microsoft-direct row says so in words', /direct with Microsoft/.test(find('DIRECT CORP')), find('DIRECT CORP').slice(0, 160));
  ok('  billing never contradicts itself', !/annual \w+, monthly/.test(body), (body.match(/annual \w+, monthly/) || [''])[0]);
  ok('a renewal already passed does NOT pin', !/◆/.test(find('RESIGNED')), find('RESIGNED').slice(0, 160));
  ok('  and reads "Renewed", not as urgency', /Renewed /.test(find('RESIGNED')), find('RESIGNED').slice(0, 160));
  ok('no literal \\u escapes leak onto the screen', !/\\u[0-9a-f]{4}/i.test(body), (body.match(/\\u[0-9a-f]{4}/i) || [''])[0]);

  console.log('\n== ranking ==');
  const pinIdx = rows.map((t, i) => (/◆/.test(t) ? i : -1)).filter(i => i >= 0);
  ok('the three pinned leads are the first three rows', pinIdx.join(',') === '0,1,2', pinIdx.join(','));
  ok('  soonest renewal first, even on a quarter of the deal value',
     rows[0].includes('OPEN SOON') && rows[1].includes('DIRECT CORP') && rows[2].includes('OPEN LATER'),
     rows.slice(0, 3).map(t => t.split('\n')[0]).join(' | '));

  console.log('\n== the filter ==');
  // The Filters panel is open by default on this tab, so the select is
  // already there; clicking the header would close it.
  const sel = page.locator('select[aria-label="Renewal"]');
  ok('the Renewal filter is on the CSP toolbar', await sel.count() === 1);
  const opts = await sel.locator('option').allInnerTexts();
  ok('  it offers the pin as one click', opts.some(t => /Renewal \+ no partner/.test(t)), opts.join(' | '));
  ok('  and the option carries its live count (3)', opts.some(t => /Renewal \+ no partner \(3\)/.test(t)), opts.join(' | '));
  ok('  windows are counted too', opts.some(t => /Renews . 30 days \(2\)/.test(t)), opts.join(' | '));
  await sel.selectOption('pin'); await sleep(600);
  rows = await notesOf(page);
  ok('selecting it narrows the table to exactly the pinned leads', rows.length === 3 && rows.every(t => /◆/.test(t)), `${rows.length} rows`);
  ok('  and the held / forecast / passed rows are gone',
     !rows.some(t => /HELD CO|FORECAST|RESIGNED/.test(t)), rows.map(t => t.split('\n')[0]).join(' | '));
  await page.locator('button:has-text("Filters")').first().click(); await sleep(400);
  const collapsed = await page.locator('[aria-label="Active filters"]').innerText();
  ok('the collapsed Filters summary names it, so the narrowing is never silent',
     /renewal \+ no partner/i.test(collapsed), collapsed);

  await page.locator('button:has-text("Filters")').first().click(); await sleep(400);
  await sel.selectOption('all'); await sleep(600);
  ok('clearing it restores every row', (await notesOf(page)).length === 6);

  console.log('\n== download ==');
  const dl = page.locator('button[aria-label="Download High priority leads"]');
  if (await dl.count()) {
    const [d] = await Promise.all([page.waitForEvent('download'), dl.first().click()]);
    const p = path.join(os.tmpdir(), 'csp-renewal-dl.csv');
    await d.saveAs(p);
    const text = fs.readFileSync(p, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    ok('the ◆ mark is written into the downloaded Notes column', /◆/.test(text), lines[1]?.slice(0, 120));
    const marked = lines.slice(1).map((l, i) => (/◆/.test(l) ? i : -1)).filter(i => i >= 0);
    ok('  and the pinned leads lead the file', marked.join(',') === '0,1,2', marked.join(','));
  } else {
    ok('the High priority download button is there', false, 'not found');
  }

  ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
