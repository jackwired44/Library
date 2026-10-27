// Raw notes are locked behind their own password ("2828") and only the
// summarized note shows in All leads.
// Per Jack: "raw note needs to be locked with password and not displayed".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const SECRET = 'Spoke with Rae, budget approved, moving off Google Workspace to Microsoft 365 for 240 users with a partner. ZEBRA-7731';
const FILE = path.join(os.tmpdir(), 'raw-lock.csv');
fs.writeFileSync(FILE, ['Company,Full Name,Title,Email,Phone,Comments', ['RAW CO', 'Rae Dunn', 'CIO', 'rae@rawco.com', '312-555-0101', SECRET].map(q).join(',')].join('\n'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(60000);
  const nav = async (name, sub) => {
    await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(500);
    if (sub) { await page.locator('.seg-btn', { hasText: sub }).first().click(); await sleep(500); }
  };
  const body = async () => page.locator('body').innerText();
  const signIn = async () => {
    await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
    await page.fill('input[type=password]', 'changeme');
    await page.click('button:has-text("Unlock")'); await sleep(1200);
  };
  await page.goto(BASE); await sleep(700); await signIn();
  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'));
  await sleep(600);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  await nav('All leads', 'Leads');
  // Per Jack: "only have sumarrized note visibile" — no raw column at all.
  ok('All leads has no raw note column', await page.locator('[data-col="raw"]').count() === 0);
  ok('  and the raw text appears nowhere in the table', !(await body()).includes('ZEBRA-7731'));
  ok('  the summarized note does', /RAW CO/.test(await body()));

  await page.locator('.data-table tbody tr', { hasText: 'RAW CO' }).first().locator('td').nth(1).click(); await sleep(800);
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; })); await sleep(300);
  let t = await body();
  ok('lead record: raw note and CSV rows locked', !t.includes('ZEBRA-7731') && /Raw notes are locked/.test(t));
  // Per Jack: "for all raw notes should be snell", later "all passwords for raw are 2828" — its own password.
  await page.fill('input[aria-label="Raw note password"]', 'changeme');
  await page.locator('button', { hasText: 'Unlock' }).last().click(); await sleep(600);
  { const bt = await body(); ok('lead record: the sign-in password does not unlock it', /Wrong password/i.test(bt) && !bt.includes('ZEBRA-7731')); }
  await page.fill('input[aria-label="Raw note password"]', '2828');
  await page.locator('button', { hasText: 'Unlock' }).last().click(); await sleep(800);
  ok('lead record: unlocks with 2828', (await body()).includes('ZEBRA-7731'));
  await page.locator('button[aria-label="Lock raw notes"]').first().click(); await sleep(400);
  ok('Lock hides it again', !(await body()).includes('ZEBRA-7731'));

  await page.reload(); await sleep(1500);
  if (await page.locator('input[aria-label="Email"]').count()) await signIn();
  await nav('All leads', 'Leads');
  await page.locator('.data-table tbody tr', { hasText: 'RAW CO' }).first().locator('td').nth(1).click(); await sleep(800);
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; })); await sleep(300);
  ok('a reload locks it again', !(await body()).includes('ZEBRA-7731') && /Raw notes are locked/.test(await body()));
  ok('the scanned note still shows', /RAW CO/.test(await body()));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
