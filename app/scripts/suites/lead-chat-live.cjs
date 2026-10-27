// All leads, time-first, with "Ask for leads" and smart lists.
//
// Per Jack: "all leads … should be much more straight forward … have
// different views as in by month or by quarter", "a chatbot in here under
// all leads … pull up and create a list of all uncontacted leads around
// dynamics for the last 30 days", and smart lists as "saved rules that
// refresh". Outside the published page there is no Claude, so this drives
// the built-in reader — the same rule shape Claude's answer is checked into.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const ym = s => s.slice(0, 7);
// The period strip uses short month names ("Mar 2026").
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthName = s => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;

const L = (o) => ({
  source: 'main', title: 'CFO', phone: '312-555-0100', mobilePhone: '', tier: 'Strong Signal', score: 70, timesSeen: 1,
  notes: '(70) ▲ Wants Dynamics 365 Business Central (25 users).', productArea: 'Dynamics 365',
  firstSeenAt: `${o.receivedOn}T12:00:00Z`, lastSeenAt: `${o.receivedOn}T12:00:00Z`, sourceFiles: [`Book-${o.receivedOn}.csv`],
  ...o, key: `e:${o.email}`,
});
const LEADS = [
  L({ company: 'FRESH DYN CO', contact: 'Ada Fresh', email: 'ada@freshdyn.com', receivedOn: day(5) }),
  L({ company: 'CALLED DYN CO', contact: 'Bo Called', email: 'bo@calleddyn.com', receivedOn: day(6),
      apollo: { syncedAt: day(1), sequences: [], callCount: 2, emailCount: 0, outcomes: { 'No Answer': 2 }, lastOutcome: 'No Answer', lastCallAt: day(3) } }),
  L({ company: 'OLD DYN CO', contact: 'Cy Old', email: 'cy@olddyn.com', receivedOn: day(70) }),
  L({ company: 'FRESH M365 CO', contact: 'Di Cloud', email: 'di@freshm365.com', receivedOn: day(4), productArea: 'M365 / Azure', notes: '(66) ▲ Moving off Google Workspace to Microsoft 365.' }),
  L({ company: 'STALE STRONG CO', contact: 'Ed Stale', email: 'ed@stalestrong.com', receivedOn: day(90), productArea: 'M365 / Azure',
      apollo: { syncedAt: day(1), sequences: [{ name: 'Jack Main Sequence', status: 'finished', step: 5, addedAt: day(80), finishedAt: day(60) }], callCount: 4, emailCount: 2, outcomes: { 'No Answer': 4 }, lastOutcome: 'No Answer', lastCallAt: day(60) } }),
  L({ company: 'REVIEW CO', contact: 'Fay Review', email: 'fay@review.com', receivedOn: day(8), tier: 'Needs Review', score: 30, notes: '(30) ▸ Mentions Dynamics.' }),
];

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('skipFileNameBox', '1'); } catch {} });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(60000);
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await page.evaluate(async (leads) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const t = db.transaction('leads', 'readwrite'); for (const l of leads) t.objectStore('leads').put(l); t.oncomplete = () => res(); });
    db.close();
  }, LEADS);
  await page.reload(); await sleep(1200);
  const nav = async n => { await page.locator('.side-nav-btn', { hasText: n }).first().click(); await sleep(700); };
  const tableText = async () => (await page.locator('.all-leads-table tbody').innerText()).replace(/\s+/g, ' ');

  console.log('\n== time first ==');
  await nav('All leads');
  ok('a View by switch leads the page', await page.locator('[aria-label="View by"] button').count() === 3);
  const strip = page.locator('[role=group][aria-label="Periods"]');
  const chipsText = (await strip.innerText()).replace(/\s+/g, ' ');
  ok('each month a CSV is dated is a period, newest first', chipsText.indexOf(monthName(day(5))) > -1 && chipsText.indexOf(monthName(day(5))) < chipsText.indexOf(monthName(day(90))), chipsText);
  await strip.locator(`button[aria-label="Period ${monthName(day(90))}"]`).click(); await sleep(400);
  let rows = await tableText();
  ok('clicking a month shows only that month', /STALE STRONG CO/.test(rows) && !/FRESH DYN CO/.test(rows), rows.slice(0, 200));
  ok('  and says so as a filter chip', /Received /.test(await page.locator('main').innerText()));
  // Per Jack: "view multipls months at a time … group them together".
  await strip.locator(`button[aria-label="Period ${monthName(day(5))}"]`).click(); await sleep(400);
  rows = await tableText();
  ok('clicking a second month adds it: both months show', /STALE STRONG CO/.test(rows) && /FRESH DYN CO/.test(rows), rows.slice(0, 200));
  ok('  and the chip names both', new RegExp(`Received .*\\+`).test(await page.locator('main').innerText()));
  await strip.locator(`button[aria-label="Period ${monthName(day(5))}"]`).click(); await sleep(400);
  rows = await tableText();
  ok('  clicking it again takes it back out', /STALE STRONG CO/.test(rows) && !/FRESH DYN CO/.test(rows), rows.slice(0, 200));
  await page.locator('[aria-label="View by"] button', { hasText: 'Quarter' }).click(); await sleep(400);
  const qText = (await strip.innerText()).replace(/\s+/g, ' ');
  ok('Quarter view groups months into quarters', /Q[1-4] 20\d\d/.test(qText) && !new RegExp(MONTHS.join('|')).test(qText), qText);
  ok('  switching views clears the period', (await tableText()).includes('FRESH DYN CO'));
  await page.locator('[aria-label="View by"] button', { hasText: 'All time' }).click(); await sleep(300);
  ok('All time hides the period strip', await strip.count() === 0);
  await page.locator('[aria-label="View by"] button', { hasText: 'Month' }).click(); await sleep(300);

  console.log('\n== the four questions asked most, always in view ==');
  for (const sel of ['[aria-label="Main filters"] [aria-label="Verdict"]', '[aria-label="Main filters"] select[aria-label="Product line"]', '[aria-label="Main filters"] select[aria-label="Outreach"]', '[aria-label="Main filters"] select[aria-label="Scanner"]'])
    ok(`  ${sel.split('aria-label="').pop().replace('"]', '')}`, await page.locator(sel).count() === 1);
  ok('no filter appears twice', await page.locator('select[aria-label="Product line"]').count() === 1 && await page.locator('[aria-label="Verdict"]').count() === 1 && await page.locator('select[aria-label="Stored as"]').count() === 0);
  await page.locator('[aria-label="Main filters"] [aria-label="Verdict"] button', { hasText: 'Needs Review' }).click(); await sleep(300);
  rows = await tableText();
  ok('Grade switch narrows the table', /REVIEW CO/.test(rows) && !/FRESH DYN CO/.test(rows), rows.slice(0, 160));
  await page.locator('[aria-label="Main filters"] [aria-label="Verdict"] button', { hasText: 'All' }).click(); await sleep(300);

  console.log('\n== Ask for leads ==');
  const chat = page.locator('.panel[aria-label="Ask for leads"]');
  await chat.locator('input[aria-label="Ask for leads"]').fill('pull up and create a list of all uncontacted leads around dynamics for the last 30 days');
  await chat.locator('button', { hasText: 'Find leads' }).click(); await sleep(600);
  const read = (await chat.locator('[aria-label="What I understood"]').innerText()).replace(/\s+/g, ' ');
  ok('the request reads back as chips', /Dynamics 365/.test(read) && /Never contacted/.test(read) && /Received in the last 30 days/.test(read), read);
  ok('  outside the published page the built-in reader answers, and says "Read as"', /Read as:/.test(read));
  ok('  Strong + Needs Review fresh uncontacted Dynamics: 2 match', /\b2 leads match/.test(read), read);
  rows = await tableText();
  ok('the table shows exactly those', /FRESH DYN CO/.test(rows) && /REVIEW CO/.test(rows) && !/CALLED DYN CO|OLD DYN CO|FRESH M365 CO|STALE STRONG CO/.test(rows), rows.slice(0, 240));
  await chat.locator('button[aria-label="Remove Received in the last 30 days"]').click(); await sleep(400);
  ok('removing a chip widens it (the 70-day-old lead joins)', /OLD DYN CO/.test(await tableText()));

  await chat.locator('input[aria-label="Days since last contact"]').fill('45');
  await chat.locator('button', { hasText: 'Strong Signal not contacted in' }).click(); await sleep(600);
  rows = await tableText();
  ok('"Strong Signal not contacted in 45 days": the three untouched + the 60-day-old', /FRESH DYN CO/.test(rows) && /FRESH M365 CO/.test(rows) && /STALE STRONG CO/.test(rows) && /OLD DYN CO/.test(rows), rows.slice(0, 240));
  ok('  not the lead called 3 days ago, not Needs Review', !/CALLED DYN CO|REVIEW CO/.test(rows));

  const [dl] = await Promise.all([page.waitForEvent('download'), chat.locator('button', { hasText: 'Download CSV' }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('Download CSV is the Main Scanner\'s ten columns', csv.split(/\r?\n/)[0].replace(/"/g, '') === 'First Name,Last Name,Title,Company Name,Email,Work Direct Phone,Mobile Phone,Number of Employees,Product Area,Notes', csv.split(/\r?\n/)[0]);
  ok('  with the matched leads', /STALE STRONG CO/.test(csv) && /FRESH DYN CO/.test(csv) && !/CALLED DYN CO/.test(csv));

  await chat.locator('input[aria-label="List name"]').fill('Stale strong 45');
  await chat.locator('button', { hasText: 'Save as smart list' }).click(); await sleep(500);
  ok('saving says so', /Saved smart list "Stale strong 45" with 4 leads/.test(await chat.innerText()));
  await chat.locator('input[aria-label="List name"]').fill('Snapshot Oct');
  await chat.locator('button', { hasText: 'Snapshot to list' }).click(); await sleep(500);
  ok('a snapshot adds the same leads to a plain list', /Added 4 leads to "Snapshot Oct"/.test(await chat.innerText()));

  console.log('\n== smart lists refresh ==');
  await nav('Lists'); await sleep(500);
  const card = page.locator('[aria-label="List Stale strong 45"]');
  ok('the smart list is marked as one, with its rule', /Smart list/.test(await card.innerText()) && /Not contacted in 45 days/.test(await page.locator('[aria-label="Rule for Stale strong 45"]').innerText()));
  ok('  holding 4 leads', /4 leads/.test(await card.innerText()));
  // A new Strong Signal lead arrives: the smart list picks it up, the snapshot does not.
  await page.evaluate(async (l) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const t = db.transaction('leads', 'readwrite'); t.objectStore('leads').put(l); t.oncomplete = () => res(); });
    db.close();
  }, L({ company: 'NEW ARRIVAL CO', contact: 'Gus New', email: 'gus@newarrival.com', receivedOn: day(1) }));
  await page.reload(); await sleep(1200);
  await nav('Lists'); await sleep(800);
  ok('after a new lead lands, the smart list has 5', /5 leads/.test(await page.locator('[aria-label="List Stale strong 45"]').innerText()), await page.locator('[aria-label="List Stale strong 45"]').innerText());
  ok('  and the snapshot still has 4', /4 leads/.test(await page.locator('[aria-label="List Snapshot Oct"]').innerText()));
  await page.selectOption('select[aria-label="Filter by kind"]', 'smart'); await sleep(300);
  ok('Lists can show smart lists only', await page.locator('[aria-label^="List "]').count() === 1);

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
