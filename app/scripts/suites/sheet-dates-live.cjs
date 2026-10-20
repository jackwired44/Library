// Numbered sheets carry no date. Per Jack: "anything from sheet 45 - sheet
// 82 its all pre may 2026", "from july 2025 - april 2026 for those sheets",
// "so lets try and guess its month" and "reogranize it in all leads for
// filtering purposes". Each sheet files under an estimated month, marked
// "(est.)", never under the month it happened to be uploaded.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = rows => ['Company,Full Name,Title,Email,Comments'].concat(rows.map(r => r.map(q).join(','))).join('\n');
const SIG = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-'));
const F75 = path.join(dir, 'BookSheet75.csv'); fs.writeFileSync(F75, csv([['OLD CO', 'Ola Dee', 'CIO', 'ola@oldco.com', SIG]]));
const F83 = path.join(dir, 'BookSheet83.csv'); fs.writeFileSync(F83, csv([['NEWER CO', 'Ned Ray', 'CIO', 'ned@newerco.com', SIG]]));
const F82 = path.join(dir, 'BookSheet82.csv'); fs.writeFileSync(F82, csv([['EDGE CO', 'Eda Moe', 'CIO', 'eda@edgeco.com', SIG]]));
const F1 = path.join(dir, 'Sheet1.csv'); fs.writeFileSync(F1, csv([['EXCEL CO', 'Eve Xu', 'CIO', 'eve@excelco.com', SIG]]));

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
  for (const f of [F75, F83, F82, F1]) {
    await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
    const start = page.locator('button', { hasText: 'Start over' });
    if (await start.count()) { await start.first().click(); await sleep(500); }
    await page.setInputFiles('input[type=file]', f);
    await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
    await sleep(600);
    await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  }
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(800);
  const groups = await page.$$eval('select[aria-label="Uploaded file"] optgroup', gs => gs.map(g => ({ label: g.label, files: [...g.querySelectorAll('option')].map(o => o.textContent) })));
  const groupOf = name => (groups.find(g => g.files.some(f => f.startsWith(name))) || {}).label;
  ok('Sheet 75 files under an estimated month (Feb 2026, est.)', groupOf('BookSheet75') === '~February 2026 (est.)', JSON.stringify(groups));
  ok('Sheet 82 is pre-May too, estimated April 2026', groupOf('BookSheet82') === '~April 2026 (est.)', groupOf('BookSheet82'));
  ok('Sheet 83 is not pre-May', groupOf('BookSheet83') && !/est\.|Before May/.test(groupOf('BookSheet83')), groupOf('BookSheet83'));
  ok('Excel\'s default Sheet1 is not treated as a numbered sheet', !/est\.|Before May/.test(groupOf('Sheet1') || ''), groupOf('Sheet1'));
  ok('an estimated day is marked with ~', groups.flatMap(g => g.files).filter(f => /^BookSheet7|^BookSheet82/.test(f)).every(f => /· ~\d\d\/\d\d/.test(f)), JSON.stringify(groups));
  await page.locator('button[aria-label="More filters"]').first().click(); await sleep(400);
  const months = await page.$$eval('select[aria-label="CSV month"] option', os => os.map(o => o.textContent));
  ok('CSV month offers the estimated months', months.some(m => /^~February 2026 \(est\.\) \(1\)$/.test(m)) && months.some(m => /^~April 2026 \(est\.\) \(1\)$/.test(m)), JSON.stringify(months));
  const idx = months.findIndex(m => /^~February 2026/.test(m));
  await page.selectOption('select[aria-label="CSV month"]', { label: months[idx] }); await sleep(400);
  const rows = (await page.locator('.data-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('filtering to it shows only the Sheet 75 lead', /OLD CO/.test(rows) && !/NEWER CO|EXCEL CO|EDGE CO/.test(rows), rows.slice(0, 200));
  await page.locator('.data-table tbody tr', { hasText: 'OLD CO' }).first().locator('td').nth(1).click(); await sleep(800);
  const detail = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok('the lead record says it is an estimate from a Sheet file', /~February 2026 \(est\.\)/.test(detail) && /before May 2026/i.test(detail), detail.slice(0, 300));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
