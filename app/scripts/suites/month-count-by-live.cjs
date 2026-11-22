// All leads "Count by": first seen vs any file it came in on (2026-11-22).
// Per Jack: "i got 323 when scanning … 178 in all leads when searching nov
// 2026 … so theres a big difference". A lead first stored from an October
// file stays October by default; "any file" also counts it in November.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = (require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = rows => ['Company,Full Name,Title,Email,Comments'].concat(rows.map(r => r.map(q).join(','))).join('\n');
const DYN = 'Evaluating Dynamics 365 Business Central to replace QuickBooks for 25 users this quarter, want a partner to implement.';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-'));
const A = path.join(dir, 'Book10-19-26.csv');
fs.writeFileSync(A, csv([['Repeat Co', 'Ray Peat', 'CFO', 'ray@repeatco.com', DYN]]));
const B = path.join(dir, 'Book11-05-26.csv');
fs.writeFileSync(B, csv([['Repeat Co', 'Ray Peat', 'CFO', 'ray@repeatco.com', DYN], ['Fresh Co', 'Fay Resh', 'CFO', 'fay@freshco.com', DYN]]));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('skipFileNameBox', '1'); localStorage.setItem('apolloAutoSync', 'off'); } catch {} });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(15000);
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
    await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(1200);
  };
  await scan(A); await scan(B);
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(1200);
  const seg = page.locator('[aria-label="View by"] button', { hasText: /^Month$/ });
  if (await seg.count()) { await seg.first().click(); await sleep(400); }
  const nov = () => page.locator('[aria-label="Periods"] button', { hasText: /Nov 2026/ }).first();
  const countOf = async () => Number(((await nov().innerText()).match(/(\d+)\s*$/) || [])[1]);
  // 11/22 (later): per Jack, "any file" is now the default.
  ok('default is any file', (await page.locator('select[aria-label="Count by"]').inputValue()) === 'any');
  ok('any file: Nov 2026 counts both leads in the November file', await countOf() === 2, String(await countOf()));
  await nov().click(); await sleep(500);
  const split = async () => (await page.locator('[aria-label="Month split"]').innerText().catch(() => ''));
  ok('  the split line says 1 was first seen earlier and is included', /2 came in on this period's files; 1 of them were first seen in an earlier month and are included/.test(await split()), await split());
  await page.selectOption('select[aria-label="Count by"]', 'first'); await sleep(500);
  ok('first seen: Nov 2026 counts only the new lead', await countOf() === 1, String(await countOf()));
  ok('  the split line offers to include the earlier one', /not counted here/.test(await split()), await split());
  await page.locator('[aria-label="Month split"] button', { hasText: 'Include them' }).click(); await sleep(500);
  ok('  Include them switches back to any file', (await page.locator('select[aria-label="Count by"]').inputValue()) === 'any' && await countOf() === 2);
  const t = (await page.locator('main').innerText());
  ok('  and picking Nov 2026 shows the repeat lead too', /Ray Peat/.test(t) && /Fay Resh/.test(t));
  const oct = page.locator('[aria-label="Periods"] button', { hasText: /Oct 2026/ }).first();
  ok('  Oct 2026 still counts the repeat lead', Number(((await oct.innerText()).match(/(\d+)\s*$/) || [])[1]) === 1);
  await page.reload(); await sleep(1500);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com').catch(() => {});
  await page.fill('input[type=password]', 'changeme').catch(() => {});
  await page.click('button:has-text("Unlock")').catch(() => {}); await sleep(1200);
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(1200);
  ok('the choice is remembered', (await page.locator('select[aria-label="Count by"]').inputValue()) === 'any');
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
