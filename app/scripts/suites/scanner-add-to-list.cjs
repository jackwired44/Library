// Main Scanner: Add to list is always on screen above the table. Per Jack:
// "need to be able to add to list from the scanner". With nothing ticked it
// adds every lead the table shows; with rows ticked it adds just those.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'addtolist-leads.csv');
fs.writeFileSync(LEADS, csv(HEAD, [
  ['ALPHA CO','Ada Brant','IT Director','ada@alpha.com','312-555-0101', SIGNAL],
  ['BETA CO','Ben Cole','CFO','ben@beta.com','312-555-0102', SIGNAL],
  ['GAMMA CO','Nia Rowe','CIO','nia@gamma.com','312-555-0103', SIGNAL],
  ['DELTA CO','Rae Lin','CFO','rae@delta.com','312-555-0104', 'Mentioned Dynamics 365 in passing.'],
]));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL ' + name + (detail ? '  — ' + detail : '')); } };

(async () => {
  const browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 60000 });
  await sleep(800);

  const strip = page.locator('[role=group][aria-label="Add to list"]');
  ok('Add to list sits above the table with nothing ticked', await strip.count() === 1);
  const shown = await page.locator('.data-table tbody tr').count();
  const addBtn = strip.locator('button');
  ok('  the button offers every lead shown', new RegExp(`Add all ${shown} shown`).test(await addBtn.innerText()), await addBtn.innerText());
  ok('  and is off until a list is chosen', await addBtn.isDisabled());

  await strip.locator('select').selectOption('__new__');
  await strip.locator('input[aria-label="New list name"]').fill('Scanner picks');
  await addBtn.click(); await sleep(500);
  ok(`  adding all shown puts ${shown} on a new list`, new RegExp(`Added ${shown} leads? to the list`).test(await strip.innerText()), await strip.innerText());

  await page.locator('.data-table tbody tr input[type=checkbox]').first().check(); await sleep(200);
  ok('ticking a row switches it to the selection', /Add 1 selected/.test(await addBtn.innerText()), await addBtn.innerText());
  const opts = await strip.locator('select option').allInnerTexts();
  ok('  the new list is offered with its count', opts.some(o => new RegExp(`Scanner picks \\(${shown}\\)`).test(o)), opts.join(' | '));
  const listId = await strip.locator('select option', { hasText: 'Scanner picks' }).getAttribute('value');
  await strip.locator('select').selectOption(listId);
  await addBtn.click(); await sleep(500);
  ok('  re-adding a lead already on it adds nothing', /Added 0 leads to the list \(1 already there\)/.test(await strip.innerText()), await strip.innerText());

  await page.locator('.side-nav-btn', { hasText: 'Lists' }).first().click(); await sleep(600);
  ok('Lists shows the list with every lead', new RegExp(`Scanner picks[\\s\\S]{0,80}${shown}`).test(await page.locator('main').innerText()));
  ok('no page errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
