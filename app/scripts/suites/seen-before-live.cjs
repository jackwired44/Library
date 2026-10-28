// "Seen before": the same person came in on an earlier file. Per Jack: "has
// it been logged by that same contact name in the past ... marcus bush was in
// 10/19 and 10/25". Same email, or same full name at the same company.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = rows => ['Company,Full Name,Title,Email,Comments'].concat(rows.map(r => r.map(q).join(','))).join('\n');
const DYN = 'Evaluating Dynamics 365 Business Central to replace QuickBooks for 25 users this quarter, want a partner to implement.';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seen-'));
const A = path.join(dir, 'Book10-19-26.csv');
fs.writeFileSync(A, csv([['Bush Holdings', 'Marcus Bush', 'CFO', 'marcus@bushholdings.com', DYN], ['Other Co', 'Ada Lane', 'CFO', 'ada@otherco.com', DYN]]));
const B = path.join(dir, 'Book10-25-26.csv');
// Marcus again with a different email (name + company match), Ada with the
// same email, a new person, and a different Marcus Bush at another company.
fs.writeFileSync(B, csv([
  ['BUSH HOLDINGS INC', 'Marcus Bush', 'CFO', 'mbush@bushholdings.net', DYN],
  ['Other Co', 'Ada L.', 'CFO', 'ada@otherco.com', DYN],
  ['New Co', 'Nia West', 'CFO', 'nia@newco.com', DYN],
  ['Elsewhere LLC', 'Marcus Bush', 'CFO', 'marcus@elsewhere.com', DYN],
]));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(120000);
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  const scan = async (f) => {
    await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
    const start = page.locator('button', { hasText: 'Start over' });
    if (await start.count()) { await start.first().click(); await sleep(500); }
    await page.setInputFiles('input[type=file]', f);
    await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
    await sleep(600);
  };
  await scan(A);
  ok('a first upload has nothing seen before', await page.locator('[data-seen-before]').count() === 0 && await page.locator('select[aria-label="Seen before"]').count() === 0);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  await scan(B);
  const rowText = async (co) => (await page.locator('.data-table tbody tr', { hasText: co }).first().innerText()).replace(/\s+/g, ' ');
  ok('the same name at the same company is tagged with the earlier date', /↺ Seen 10\/19/.test(await rowText('BUSH HOLDINGS')), await rowText('BUSH HOLDINGS'));
  ok('the same email is tagged', /↺ Seen 10\/19/.test(await rowText('Other Co')));
  ok('a new person is not tagged', !/Seen/.test(await rowText('New Co')));
  ok('a different Marcus Bush at another company is not tagged', !/Seen/.test(await rowText('Elsewhere')));
  await page.selectOption('select[aria-label="Seen before"]', 'only'); await sleep(400);
  ok('"Only seen before" shows the two repeats', await page.locator('.data-table tbody tr').count() === 2);
  await page.selectOption('select[aria-label="Seen before"]', 'hide'); await sleep(400);
  const left = (await page.locator('.data-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('"Hide seen before" leaves the new people', await page.locator('.data-table tbody tr').count() === 2 && /New Co/.test(left) && /Elsewhere/.test(left), left.slice(0, 200));
  const dl = (await page.locator('.dl-strip').innerText()).replace(/\s+/g, ' ');
  ok('downloads still hold every Strong Signal lead', /\b4\b/.test(dl), dl);
  await page.selectOption('select[aria-label="Seen before"]', 'all'); await sleep(300);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(800);
  const seenCell = async (co) => (await page.locator('.all-leads-table tbody tr', { hasText: co }).first().locator('td[data-col="seen"]').innerText()).replace(/\s+/g, ' ');
  ok('All leads shows the dates the person came in', /10\/19, 10\/25/.test(await seenCell('Other Co')), await seenCell('Other Co'));
  ok('  across two records with different emails', /10\/19, 10\/25/.test(await seenCell('BUSH HOLDINGS')), await seenCell('BUSH HOLDINGS'));
  ok('  and a one-file lead reads —', /^—$/.test((await seenCell('New Co')).trim()));
  await page.selectOption('select[aria-label="Seen before"]', 'only'); await sleep(500);
  const only = (await page.locator('.all-leads-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('the All leads filter narrows to repeats', /Other Co/.test(only) && /Bush Holdings|BUSH HOLDINGS/i.test(only) && !/New Co|Elsewhere/.test(only), only.slice(0, 300));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
