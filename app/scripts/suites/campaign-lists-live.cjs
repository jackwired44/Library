// Campaign lists: tags, created date, a 45/60-day cycle, overlap between
// live campaigns, and cycling into a new dated list. Per Jack: "have these
// added leads stored as lists with the created date and taggs so then i can
// move them but maintain who i am contacting", "every 45 or 60 days i want
// to cycle leads here to push to a new campign based on their company as
// well as summarizxed note".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'campaign-leads.csv');
fs.writeFileSync(LEADS, csv(HEAD, [
  ['ZULU CO','Ada Brant','IT Director','ada@zulu.com','312-555-0101', SIGNAL],
  ['ALPHA CO','Ben Cole','CFO','ben@alpha.com','312-555-0102', SIGNAL],
]));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(60000);
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr')); await sleep(800);
  const strip = page.locator('[role=group][aria-label="Add to list"]');
  for (const name of ['October push', 'Licensing follow-up']) {
    await strip.locator('select').selectOption('__new__');
    await strip.locator('input[aria-label="New list name"]').fill(name);
    await strip.locator('button').click(); await sleep(500);
  }

  await page.locator('.side-nav-btn', { hasText: 'Lists' }).first().click(); await sleep(700);
  const card = name => page.locator(`[aria-label="List ${name}"]`);
  ok('each list shows its created date', /created \d/.test(await card('October push').innerText()));

  // Tags, campaign and a 45-day cycle on the first list.
  await card('October push').locator('button', { hasText: 'Tags & cycle' }).click(); await sleep(200);
  await card('October push').locator('input[aria-label="Campaign"]').fill('Q4 M365');
  await card('October push').locator('input[aria-label="Tags"]').fill('m365, q4, M365');
  await card('October push').locator('select[aria-label="Cycle after"]').selectOption('45'); await sleep(300);
  await card('October push').locator('input[aria-label="Campaign"]').click(); await sleep(200);
  await page.locator('main h2').first().click(); await sleep(400);
  let t = await card('October push').innerText();
  ok('campaign, tags (deduped) and the cycle date show', /campaign Q4 M365/.test(t) && /cycles in 45d/.test(t) && (t.match(/\bm365\b/gi) || []).length >= 1 && !/M365\s*\n\s*M365/.test(t), t.slice(0, 300));

  // Second list becomes a campaign too, so both leads are on two live campaigns.
  await card('Licensing follow-up').locator('button', { hasText: 'Tags & cycle' }).click(); await sleep(200);
  await card('Licensing follow-up').locator('select[aria-label="Cycle after"]').selectOption('60'); await sleep(400);
  await card('October push').locator('button[title="Expand"]').click(); await sleep(400);
  t = await card('October push').innerText();
  ok('a lead on another live campaign is flagged "Also on"', /⚠ Licensing follow-up/.test(t), t.slice(0, 400));
  ok('  and the summarized note is shown', /Moving off Google Workspace|Google Workspace/.test(t), t.slice(0, 400));

  // Tag filter.
  await page.locator('select[aria-label="Filter by tag"]').selectOption('q4'); await sleep(300);
  ok('filtering by tag shows only tagged lists',
     await card('October push').count() === 1 && await card('Licensing follow-up').count() === 0);
  await page.locator('select[aria-label="Filter by tag"]').selectOption(''); await sleep(300);

  // Cycle now.
  await card('October push').locator('button', { hasText: 'Cycle now' }).click(); await sleep(800);
  t = await page.locator('main').innerText();
  ok('cycling makes a new dated list for the campaign', /Q4 M365 — \d{4}-\d{2}-\d{2}/.test(t), t.slice(0, 400));
  ok('  the old list is kept, marked cycled', /October push[\s\S]{0,200}cycled/.test(t));
  const newCard = page.locator('[aria-label^="List Q4 M365 — "]');
  await newCard.locator('button[title="Expand"]').click(); await sleep(400);
  const rows = await newCard.locator('tbody tr').allInnerTexts();
  ok('  with both leads, sorted by company', rows.length === 2 && /ALPHA CO/.test(rows[0]) && /ZULU CO/.test(rows[1]), JSON.stringify(rows.map(r => r.slice(0, 20))));
  ok('  carrying the tags over', /\bq4\b/.test(await newCard.innerText()));

  await page.reload(); await sleep(1500);
  await page.locator('.side-nav-btn', { hasText: 'Lists' }).first().click(); await sleep(700);
  t = await page.locator('main').innerText();
  ok('everything survives a reload', /Q4 M365 — /.test(t) && /cycled/.test(t) && /campaign Q4 M365/.test(t));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
