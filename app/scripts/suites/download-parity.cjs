// Per Jack: the Custom Scanner's post-scan download must line up with the
// Main Scanner's, column for column. Nothing here touches the Main Scanner
// — it is the reference, downloaded live and compared against.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const samples = require('../fixtures/smc-samples.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
const esc = v => `"${String(v).replace(/"/g, '""')}"`;
const header = t => t.split('\n')[0].replace(/\r$/, '').match(/("([^"]|"")*"|[^,]*)/g).filter(x => x !== '').map(c => c.replace(/^"|"$/g, '').replace(/\r$/, ''));

const mainCsv = ['Company,Full Name,Title,Email,Phone,Comments'].concat([
  ['Alpine Freight', 'Dana Reyes', 'Ops Director', 'dana@alpinefreight.com', '312-555-0101', 'Looking at Dynamics 365 Business Central for 40 users this year.'],
  ['Borden Labs', 'Reed Okafor', 'IT Manager', 'reed@bordenlabs.com', '312-555-0201', 'Need to migrate from Google Workspace to Microsoft 365, bringing in a partner.'],
].map(r => r.map(esc).join(','))).join('\n');

const HEAD = ['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename','statuscodename','revenue','numberofemployees','campaignidname','companyname','description','estimatedclosedate'];
const CAMPS = ['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~US~FY26~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~US~FY26~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const smcCsv = [HEAD.join(',')].concat(samples.map((d, i) => [
  'US', d, 'real' + i + '@corp.com', 'Pat Vance ' + i, 'IT Director', '312-555-90' + i, '312-555-10' + i,
  'ACCT-' + i + ' (CRM record)', 'corp.com', 'Chicago', 'IL', 'Seg', 'Tech', 'Open', '100', '250',
  CAMPS[i] || 'NULL', 'Real Company ' + i, 'second desc', '2026-12-01',
].map(esc).join(','))).join('\n');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1300);

  console.log('\n== Main Scanner download (the reference) ==');
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'main.csv', mimeType: 'text/csv', buffer: Buffer.from(mainCsv) });
  await sleep(2600);
  const [d1] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('.dl-strip button.btn-primary').first().click(),
  ]);
  const f1 = path.join(os.tmpdir(), 'parity-main.csv'); await d1.saveAs(f1);
  const mainCols = header(fs.readFileSync(f1, 'utf8'));
  ok('Main Scanner still exports its own columns, untouched',
     JSON.stringify(mainCols) === JSON.stringify(['First Name','Last Name','Title','Company Name','Email','Work Direct Phone','Mobile Phone','Number of Employees','Product Area','Notes']),
     JSON.stringify(mainCols));

  console.log('\n== Custom Scanner download ==');
  await page.locator('.side-nav-btn', { hasText: 'Custom Scanner' }).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]', { name: 'smc.csv', mimeType: 'text/csv', buffer: Buffer.from(smcCsv) });
  await sleep(3000);
  const [d2] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('button[aria-label="Download All High priority leads"]').click(),
  ]);
  const f2 = path.join(os.tmpdir(), 'parity-custom.csv'); await d2.saveAs(f2);
  const custText = fs.readFileSync(f2, 'utf8');
  const custCols = header(custText);

  // Jack's call, revised: IDENTICAL to the Main Scanner, Last Name included,
  // so the column letters line up on every scanner — he works to "column I
  // and J", which only holds at ten columns. A full-name source is split
  // instead of dropping the column.
  ok('Custom Scanner columns are exactly the Main Scanner\'s, same order',
     JSON.stringify(custCols) === JSON.stringify(mainCols), `${JSON.stringify(custCols)} vs ${JSON.stringify(mainCols)}`);
  ok('ten columns exactly', custCols.length === 10, String(custCols.length));
  ok('Product Area is column I and Notes is column J',
     custCols[8] === 'Product Area' && custCols[9] === 'Notes', custCols.slice(8).join(','));

  console.log('\n== the data under those headings is real ==');
  const rows = custText.split('\n').slice(1).filter(Boolean);
  ok('at least one Strong Signal row downloaded', rows.length > 0, String(rows.length));
  const cells = rows[0].match(/("([^"]|"")*"|[^,]*)/g).filter(x => x !== '').map(c => c.replace(/^"|"$/g, ''));
  const at = n => cells[custCols.indexOf(n)] || '';
  ok('Name is a person, not a CRM record id', /^[A-Za-z]/.test(at('First Name')) && !/ACCT-/.test(at('First Name')), at('First Name'));
  ok('Company Name is the company, not the account column', !/ACCT-|CRM record/.test(at('Company Name')) && at('Company Name').length > 0, at('Company Name'));
  ok('Email present', /@/.test(at('Email')), at('Email'));
  ok('Work and Mobile phone are different columns, not the same number',
     at('Work Direct Phone') !== '' && at('Mobile Phone') !== '' && at('Work Direct Phone') !== at('Mobile Phone'),
     `${at('Work Direct Phone')} vs ${at('Mobile Phone')}`);
  ok('Number of Employees filled', /^\d+$/.test(at('Number of Employees')), at('Number of Employees'));
  ok('Product Area is a real product line', ['Dynamics 365', 'M365 / Azure'].includes(at('Product Area')), at('Product Area'));
  ok('Notes carries the reason', at('Notes').length > 10, at('Notes').slice(0, 60));
  ok('no COE / EA renewal campaign text in Notes', !/COE|True Up|EA Renewal/i.test(at('Notes')), at('Notes').slice(0, 80));

  console.log('\n== same style as the other two scanners ==');
  // Per Jack: "make sure the csv download is the same style as the two
  // other scanners." The column shape was already right; what was not was
  // the ORDER (file order, so the score was invisible the moment you left
  // the app), the filename, and the set of files on offer.
  const noteScore = t => { const m = /Score (\d+)/.exec(t); return m ? Number(m[1]) : -1; };
  const parsed = rows.map(r => r.match(/("([^"]|"")*"|[^,]*)/g).filter(x => x !== '').map(c => c.replace(/^"|"$/g, '')));
  const scores = parsed.map(c => noteScore(c[custCols.indexOf('Notes')] || ''));
  ok('every row states its score in Notes', scores.every(n => n >= 0), JSON.stringify(scores));
  // Flagged rows (a stated need, or all four at once) are pinned above the
  // score, exactly as the CSP file pins "wants a partner" — so the check is
  // that the UNflagged tail descends, not that the whole column does.
  const tail = parsed
    .filter(c => !/[\u2605\u2691]/.test(c[custCols.indexOf('Notes')] || ''))
    .map(c => noteScore(c[custCols.indexOf('Notes')] || ''));
  ok('unpinned rows come out best-score-first', tail.every((n, i) => i === 0 || tail[i - 1] >= n), JSON.stringify(tail));
  ok('pinned and flagged rows lead the file',
     parsed.findIndex(c => !/[\u2605\u2691]/.test(c[custCols.indexOf('Notes')] || '')) !== 0
     || !parsed.some(c => /[\u2605\u2691]/.test(c[custCols.indexOf('Notes')] || '')));
  ok('the file is named for its scanner, like csp-*', /^custom-/.test(d2.suggestedFilename()), d2.suggestedFilename());

  // The same five buttons the CSP tab offers three of: two call lists, a
  // combined High, the Medium emailing list, and High+Medium together.
  const dlLabels = await page.locator('.dl-strip button[aria-label^="Download "]').evaluateAll(
    ns => ns.map(n => n.getAttribute('aria-label')));
  for (const want of ['Dynamics', 'M365 / Azure', 'All High priority', 'Medium priority', 'High + Medium']) {
    ok(`offers a "${want}" download`, dlLabels.some(l => l === `Download ${want} leads`), JSON.stringify(dlLabels));
  }
  const [d3] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('button[aria-label="Download High + Medium leads"]').click(),
  ]);
  const f3 = path.join(os.tmpdir(), 'parity-custom-hm.csv'); await d3.saveAs(f3);
  const hmText = fs.readFileSync(f3, 'utf8');
  ok('High + Medium is named for its scanner too', /^custom-/.test(d3.suggestedFilename()), d3.suggestedFilename());
  ok('High + Medium carries the same ten columns',
     JSON.stringify(header(hmText)) === JSON.stringify(mainCols), JSON.stringify(header(hmText)));
  ok('High + Medium is a superset of High alone',
     hmText.split('\n').filter(Boolean).length >= custText.split('\n').filter(Boolean).length,
     `${hmText.split('\n').filter(Boolean).length} vs ${custText.split('\n').filter(Boolean).length}`);
  ok('no Low priority lead is in it', !/Score \d+ \u2014 Low priority/.test(hmText));

  console.log('\n== downloads follow the filters ==');
  // Per Jack: "i want to be able to download the high and medium together
  // when its whats filtered that goes for everything also if im filtering
  // through custom scanner." Before this the Custom tab's downloads read
  // the whole batch regardless of the view, so filtering down to a slice
  // and hitting download still gave you everything.
  const dlCount = async label => {
    const b = page.locator(`button[aria-label="Download ${label} leads"]`);
    return await b.count() ? Number((await b.innerText()).match(/(\d+)\s*$/)?.[1] ?? -1) : -1;
  };
  const snapshot = async () => ({
    high: await dlCount('All High priority'),
    med: await dlCount('Medium priority'),
    both: await dlCount('High + Medium'),
  });
  const wide = await snapshot();
  ok('High + Medium is exactly High plus Medium', wide.both === wide.high + wide.med, JSON.stringify(wide));

  await page.fill('input[placeholder*="Search company"]', 'Real Company 3'); await sleep(900);
  const narrow = await snapshot();
  ok('a search narrows every download', narrow.both < wide.both, `${wide.both} -> ${narrow.both}`);
  ok('and they still add up', narrow.both === narrow.high + narrow.med, JSON.stringify(narrow));

  const [d4] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('button[aria-label="Download High + Medium leads"]').click(),
  ]);
  const f4 = path.join(os.tmpdir(), 'parity-filtered.csv'); await d4.saveAs(f4);
  const filteredRows = fs.readFileSync(f4, 'utf8').split('\n').filter(Boolean).length - 1;
  ok('the FILE matches the filtered count, not the whole batch',
     filteredRows === narrow.both, `${filteredRows} rows in the file vs ${narrow.both} on the button`);

  // The band tab and the line chips must stay excluded: the button picks
  // those, so narrowing to Medium must not empty the High download.
  await page.fill('input[placeholder*="Search company"]', ''); await sleep(700);
  await page.locator('button:has-text("Medium priority (")').first().click(); await sleep(900);
  const onMedium = await snapshot();
  ok('sitting on the Medium tab does not empty the High download',
     onMedium.high === wide.high, JSON.stringify(onMedium));

  console.log('\n== errors ==');
  ok('no page or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
