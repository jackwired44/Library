// All leads → Refresher, in a real browser.
//
// Per Jack: "create a refresher mechanism here under all leads that can auto
// generate lists that seem likely and action them into sequences once pushed
// to apollo", "this action checks the leads are fresh have not really gone
// anywhere or gone nowhere and are not in hubspot as a deal have not been
// info reuqested pending review or meeting booked", and "i will choose
// certain files to do this from and then you generate the list around strong
// signals but also company or eventually industry". Read-only toward Apollo:
// accepting hands over the import CSV and files a dated campaign list.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const verified = (extra = {}) => ({ syncedAt: day(1), sequences: [], callCount: 0, emailCount: 0, outcomes: {}, lastOutcome: '', lastCallAt: '', live: { emailStatus: 'Verified' }, ...extra });
const L = (o) => ({
  source: 'main', title: 'CFO', phone: '312-555-0100', mobilePhone: '', tier: 'Strong Signal', score: 70, timesSeen: 1,
  notes: '(70) ▲ Wants Dynamics 365 Business Central (25 users).', productArea: 'Dynamics 365',
  firstSeenAt: `${o.receivedOn || day(3)}T12:00:00Z`, lastSeenAt: `${o.receivedOn || day(3)}T12:00:00Z`, receivedOn: day(3),
  apollo: verified(), ...o, key: `e:${o.email}`,
});
const FILE_A = 'BookDyn10-18.csv', FILE_B = 'BookM365-10-02.csv';
const LEADS = [
  ...Array.from({ length: 6 }, (_, i) => L({ company: `DYN CO ${i}`, contact: `Dyn Person${i}`, email: `p${i}@dynco${i}.com`, sourceFiles: [FILE_A], score: 60 + i })),
  L({ company: 'UNCHECKED DYN', contact: 'Una Checked', email: 'una@uncheckeddyn.com', sourceFiles: [FILE_A], apollo: undefined }),
  L({ company: 'INFO REQ DYN', contact: 'Ivy Asked', email: 'ivy@inforeq.com', sourceFiles: [FILE_A],
      apollo: verified({ callCount: 1, outcomes: { 'Info Requested': 1 }, lastOutcome: 'Info Requested', lastCallAt: day(2) }) }),
  L({ company: 'PENDING DYN', contact: 'Pat Pending', email: 'pat@pendingdyn.com', sourceFiles: [FILE_A],
      apollo: verified({ sequences: [{ name: 'Jack Main Sequence', status: 'finished', step: 3, reason: 'Pending review' }] }) }),
  ...Array.from({ length: 3 }, (_, i) => L({ company: `CLOUD CO ${i}`, contact: `Cloud Person${i}`, email: `c${i}@cloudco${i}.com`, sourceFiles: [FILE_B], productArea: 'M365 / Azure', notes: '(66) ▲ Wants Microsoft 365 E3 for 40 users.', receivedOn: day(19) })),
  L({ company: 'ACME HOLD', contact: 'Ann Acme', email: 'ann@acmehold.com', sourceFiles: [FILE_B], productArea: 'M365 / Azure', notes: '(66) ▲ Wants Microsoft 365 E3 for 40 users.', receivedOn: day(19) }),
  L({ company: 'Acme Hold', contact: 'Ben Acme', email: 'ben@acmehold.com', sourceFiles: [FILE_B], productArea: 'M365 / Azure', notes: '(66) ▲ Wants Microsoft 365 E3 for 40 users.', receivedOn: day(19) }),
];
for (const l of LEADS) if (!l.apollo) delete l.apollo;

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
  const seed = async (leads) => page.evaluate(async (leads) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const t = db.transaction('leads', 'readwrite'); for (const l of leads) t.objectStore('leads').put(l); t.oncomplete = () => res(); });
    db.close();
  }, leads);
  await seed(LEADS);
  await page.reload(); await sleep(1200);
  const open = async () => {
    await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(600);
    await page.locator('[aria-label="All leads view"] button', { hasText: 'Refresher' }).click(); await sleep(700);
  };
  const card = (t) => page.locator(`[aria-label="Suggestion ${t}"]`);
  const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ');

  console.log('\n== suggestions, fresh or went nowhere only ==');
  await open();
  ok('Refresher is a tab inside All leads', await page.locator('h2', { hasText: 'Refresher' }).count() === 1);
  const dyn = card('Fresh Dynamics 365');
  ok('Fresh Dynamics 365 is suggested', await dyn.count() === 1);
  let t = await text(dyn);
  ok('  six green-lit leads ready', /\b6 ready\b/.test(t), t.slice(0, 160));
  ok('  the unchecked email waits for an Apollo check', /1 more need an email check/.test(t) && /Check 1 in Apollo/.test(t), t);
  await dyn.locator('button', { hasText: 'Preview' }).click(); await sleep(300);
  t = await text(dyn);
  ok('  info requested is left out', !/INFO REQ DYN/.test(t));
  ok('  pending review is left out', !/PENDING DYN/.test(t));
  ok('  preview lists the leads, best score first', /DYN CO 5/.test(t) && t.indexOf('DYN CO 5') < t.indexOf('DYN CO 0'), t.slice(0, 300));
  ok('Fresh M365 / Azure is suggested from the other file', await card('Fresh M365 / Azure').count() === 1);

  console.log('\n== pick files ==');
  await page.locator('summary', { hasText: 'Pick files to work from' }).click(); await sleep(200);
  await page.locator(`input[aria-label="File ${FILE_A}"]`).check(); await sleep(500);
  ok('scope says one file picked', /1 file picked/.test(await text(page.locator('[aria-label="Files in scope"]'))));
  ok('  the other file\'s list goes', await card('Fresh M365 / Azure').count() === 0);
  ok('  the picked file\'s list stays', await card('Fresh Dynamics 365').count() === 1);
  await page.reload(); await sleep(1200); await open();
  ok('  the pick is remembered', /1 file picked/.test(await text(page.locator('[aria-label="Files in scope"]'))));
  await page.locator('summary', { hasText: 'Pick files to work from' }).click(); await sleep(200);
  await page.locator('button', { hasText: 'Use every file' }).click(); await sleep(500);
  ok('  "Use every file" brings everything back', /Every file/.test(await text(page.locator('[aria-label="Files in scope"]'))) && await card('Fresh M365 / Azure').count() === 1);

  console.log('\n== by company, by industry ==');
  await page.locator('[aria-label="Build lists by"] button', { hasText: 'Company' }).click(); await sleep(500);
  const acme = card('ACME HOLD');
  ok('a company with two Strong Signal people gets its own list', await acme.count() === 1 && /\b2 ready\b/.test(await text(acme)));
  ok('  and only company lists show', await card('Fresh Dynamics 365').count() === 0);
  await page.locator('[aria-label="Build lists by"] button', { hasText: 'Industry' }).click(); await sleep(500);
  ok('industry with no enriched data: nothing made up, and it says to enrich', await page.locator('[aria-label^="Suggestion "]').count() === 0 && /no industry yet/.test(await text(page.locator('[aria-label="Refresher scope"]'))));
  await page.locator('[aria-label="Build lists by"] button', { hasText: 'Product line' }).click(); await sleep(500);

  console.log('\n== accept: CSV + dated list, nothing sent to Apollo ==');
  await page.locator('select[aria-label="Sequence for Fresh Dynamics 365"]').selectOption('Jack Main Sequence');
  await page.fill('input[aria-label="List name for Fresh Dynamics 365"]', 'Refresh Dyn Test');
  const [dl] = await Promise.all([page.waitForEvent('download'), card('Fresh Dynamics 365').locator('button', { hasText: 'Accept' }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('the import CSV is handed over', dl.suggestedFilename() === 'Refresh Dyn Test.csv', dl.suggestedFilename());
  ok('  with the six leads in the Main Scanner columns', csv.split('\n')[0].startsWith('First Name,Last Name,Title,Company Name,Email') && (csv.match(/dynco\d\.com/g) || []).length === 6, csv.slice(0, 200));
  ok('  and not the reached ones', !/inforeq|pendingdyn/.test(csv));
  await sleep(600);
  const row = page.locator('[aria-label="Handoff Refresh Dyn Test"]');
  t = await text(row);
  ok('the list shows as handed off to Jack Main Sequence (0 of 6)', /Jack Main Sequence/.test(t) && /Downloaded/.test(t) && /0 \/ 6/.test(t), t);
  ok('  its leads leave the suggestion (on a live campaign list now)', await card('Fresh Dynamics 365').count() === 0);

  console.log('\n== an Apollo check moves it along ==');
  const moved = { ...LEADS[0], apollo: verified({ sequences: [{ name: 'Jack Main Sequence', status: 'active', step: 1, addedAt: day(0) }] }) };
  await seed([moved]);
  await page.reload(); await sleep(1200); await open();
  t = await text(page.locator('[aria-label="Handoff Refresh Dyn Test"]'));
  ok('one lead seen in the sequence → Partly in sequence, 1 of 6', /Partly in sequence/.test(t) && /1 \/ 6/.test(t), t);
  ok('  the rest can be checked from the row', /Check 5/.test(t));
  await page.locator('.side-nav-btn', { hasText: 'Lists' }).first().click(); await sleep(700);
  ok('the list is in Lists too', /Refresh Dyn Test/.test(await page.locator('main').innerText()));

  console.log('\n== draft from keywords ==');
  await open();
  await page.fill('input[aria-label="Draft keywords"]', 'acme, cloud co 1');
  await page.locator('[aria-label="Draft from keywords"] button', { hasText: 'Draft list' }).click(); await sleep(500);
  const dcard = page.locator('[aria-label="Draft from keywords"] [aria-label^="Suggestion "]');
  t = await text(dcard);
  ok('typing keywords drafts a list (company words, any of them)', /\b3 ready\b/.test(t), t.slice(0, 200));
  await page.locator('select[aria-label="Match keywords in"]').selectOption('title'); await sleep(400);
  ok('  limited to Title, those words find nothing', /No lead .*matches/.test(await text(page.locator('[aria-label="Draft from keywords"]'))));
  await page.locator('select[aria-label="Match keywords in"]').selectOption('all'); await sleep(300);
  await page.fill('input[aria-label="Draft keywords"]', '"business central"');
  await page.press('input[aria-label="Draft keywords"]', 'Enter'); await sleep(500);
  t = await text(page.locator('[aria-label="Draft from keywords"]'));
  ok('  a phrase in the note: accepted and reached leads are gone, the unchecked one waits for a check', /\b0 ready\b/.test(t) && /1 more need an email check/.test(t), t.slice(0, 300));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
