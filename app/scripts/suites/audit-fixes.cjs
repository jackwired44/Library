// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('/home/user/Library/app/node_modules/playwright');
const fs = require('fs'); const SP = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const ck = (n,c) => { out.push(!!c); console.log((c?'PASS':'FAIL')+'  '+n); };
(async () => {
  const br = await chromium.launch({ executablePath: EXE });
  const page = await (await br.newContext({ viewport:{width:1500,height:1000}, timezoneId:'America/Chicago' })).newPage();
  const errs=[]; page.on('pageerror', e=>errs.push(e.message)); page.on('dialog', d=>d.accept());
  const body = () => page.locator('body').innerText();
 const __unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
  const nav = async l => { await page.locator(`aside button`).filter({hasText:l}).first().click(); await sleep(450); await __unlockScanner(); };
  const TAB_LABEL={sequences:'Sequences',tasks:'Tasks',calls:'Calls',emails:'Emails',companies:'Companies',contacts:'Contacts',lists:'Lists'};
  const engage = async t => { await nav(TAB_LABEL[t]); await sleep(550); };
  const csv = ['Company Name,First Name,Last Name,Email,Work Phone,Title,Comments',
    'Acme Dynamics Co,Jane,Doe,jane@acmedynamics.com,(212) 555-0100,IT Director,"Dynamics 365 Business Central for 40 users"',
    'Northwind Logistics,Sam,Reed,sam@northwindlog.com,+1 415 555 0100,COO,"Google Workspace to Microsoft 365 migration, bringing in a partner"'].join('\n');
  fs.writeFileSync(`${SP}/vfix.csv`, csv);
  await page.goto(BASE); await sleep(400);
  await page.locator('input[aria-label="Email"]').fill('jack@wiredcio.com');
  await page.locator('input[type="password"]').fill('changeme');
  await page.locator('button').filter({hasText:/Unlock/}).click(); await sleep(600);
  await page.keyboard.press('Shift+J'); await page.waitForTimeout(450); await __unlockScanner();
  await page.locator('input[type="file"][accept=".csv"]').setInputFiles(`${SP}/vfix.csv`);
  await page.locator('.kpi').first().waitFor({timeout:15000}); await sleep(700);
  const row = n => page.locator('.data-table tbody tr', { hasText: n }).first();

  // set Meeting booked + star it
  await row('Acme Dynamics Co').locator('select').nth(1).selectOption('meeting-booked'); await sleep(600);
  await row('Acme Dynamics Co').locator('button:has-text("⭐")').first().click(); await sleep(500);
  ck('setup: Acme is Meeting booked and starred', /BOOKED/.test(await row('Acme Dynamics Co').innerText()));
  await engage('contacts');
  ck('setup: Contacts shows Meeting booked', /Meeting booked/.test(await body()));

  // ---- FIX 2: High Priority Unmark must not revert the live disposition ----
  await page.keyboard.press('Shift+J'); await page.waitForTimeout(450); await __unlockScanner();
  await page.locator('button:has-text("Start over")').first().click(); await sleep(800);
  const hp = /High Priority/i.test(await body());
  ck('High Priority panel is present on the landing screen', hp);
  if (hp) {
    const un = page.locator('main button').filter({ hasText: /^Unmark$/ }).first();
    if (await un.count()) { await un.click(); await sleep(800); }
  }
  await engage('contacts');
  ck('FIX 2: disposition survives High Priority Unmark', /Meeting booked/.test(await body()));

  // ---- FIX 1: Library folder upload must not wipe sticky state ----
  await nav('Lead library');
  const folder = page.locator('main button').filter({ hasText: /20\d\d/ }).first();
  await folder.click(); await sleep(700);
  const up = page.locator('main input[type="file"]').first();
  if (await up.count()) { await up.setInputFiles(`${SP}/vfix.csv`); await sleep(2000); }
  await engage('contacts');
  ck('FIX 1: disposition survives a Lead Library folder upload', /Meeting booked/.test(await body()));

  // ---- FIX 5: Save to Lead Library from a History-reopened batch ----
  await nav('History');
  const v = page.locator('main button').filter({ hasText: /^View \/ edit$/ }).first();
  // "View / edit" lands on the Scanner, which is always locked now, so the
  // gate has to be cleared before the batch is on screen. This is not the
  // nav helper's path, which is why it needs its own unlock here.
  if (await v.count()) { await v.click(); await sleep(1200); }
  await __unlockScanner();
  const saveBtn = page.locator('main button').filter({ hasText: /Save to Lead Library|✓ Filed/ }).first();
  const present = await saveBtn.count();
  const enabled = present ? await saveBtn.isEnabled() : false;
  ck('FIX 5: Save button is enabled on a History-reopened batch', enabled);
  if (enabled) { await saveBtn.click(); await sleep(1200); }
  ck('FIX 5: filing actually reports success', /Filed/.test(await body()));

  ck('no page errors', errs.length === 0); if (errs.length) console.log(errs.slice(0,4));
  console.log(`\n${out.filter(Boolean).length}/${out.length}`);
  await br.close();
  // This suite used to end without an exit code, so it reported success
  // no matter how many checks failed — the runner only reads the exit
  // status. A test that cannot fail is not a test.
  process.exit(out.filter(Boolean).length === out.length ? 0 : 1);
})();
