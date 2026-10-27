// Numbered sheets carry no date. Per Jack: "anything from sheet 45 - sheet
// 82 its all pre may 2026", "from july 2025 - april 2026 for those sheets" (later "october of 2025 is
// the ltest back to go"),
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
const FJUL = path.join(dir, 'Book7-15-25.csv'); fs.writeFileSync(FJUL, csv([['JULY CO', 'Jul Ash', 'CIO', 'jul@julyco.com', SIG]]));
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
  for (const f of [F75, F83, F82, F1, FJUL]) {
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
  ok('Sheet 75 files under its estimated month (Mar 2026)', groupOf('BookSheet75') === 'Mar 2026', JSON.stringify(groups));
  ok('Sheet 82 is pre-May too, estimated April 2026', groupOf('BookSheet82') === 'Apr 2026', groupOf('BookSheet82'));
  ok('Sheet 83 is not pre-May', groupOf('BookSheet83') && !/est\.|Before May/.test(groupOf('BookSheet83')), groupOf('BookSheet83'));
  ok('Excel\'s default Sheet1 is not treated as a numbered sheet', !/est\.|Before May/.test(groupOf('Sheet1') || ''), groupOf('Sheet1'));
  ok('an estimated day is marked with ~', groups.flatMap(g => g.files).filter(f => /^BookSheet7|^BookSheet82/.test(f)).every(f => /· ~\d\d\/\d\d/.test(f)), JSON.stringify(groups));
  // The months now lead All leads as a period strip (View by Month).
  const months = await page.$$eval('[role=group][aria-label="Periods"] button[aria-label^="Period "]', bs => bs.map(b => b.getAttribute('aria-label').slice(7) + ' (' + b.querySelector('b').textContent + ')'));
  ok('the month strip offers the estimated months', months.some(m => /^Mar 2026 \(1\)$/.test(m)) && months.some(m => /^Apr 2026 \(1\)$/.test(m)) && !months.some(m => /est\.|2025-0[1-9]|Jul 2025|Aug 2025|Sep 2025/.test(m)), JSON.stringify(months));
  ok('a CSV dated before October 2025 counts in Oct 2025 (the earliest month)', months.some(m => /^Oct 2025 \(1\)$/.test(m)), JSON.stringify(months));
  await page.locator('[role=group][aria-label="Periods"] button[aria-label="Period Mar 2026"]').click(); await sleep(400);
  const rows = (await page.locator('.data-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('filtering to it shows only the Sheet 75 lead', /OLD CO/.test(rows) && !/NEWER CO|EXCEL CO|EDGE CO/.test(rows), rows.slice(0, 200));
  // Per Jack: "select all the files from last october to this may".
  await page.selectOption('select[aria-label="Range from"]', { label: 'Oct 2025' }); await sleep(200);
  await page.selectOption('select[aria-label="Range to"]', { label: 'Apr 2026' }); await sleep(400);
  const ranged = (await page.locator('.data-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('a From/To range selects every month between them', /OLD CO/.test(ranged) && /EDGE CO/.test(ranged) && /JULY CO/.test(ranged) && !/NEWER CO|EXCEL CO/.test(ranged), ranged.slice(0, 300));
  const chipText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok('the range reads as one chip', /Received Oct 2025 – Apr 2026 \(\d+ months\)/.test(chipText), (chipText.match(/Received[^|]{0,60}/) || [''])[0]);
  await page.locator('.data-table tbody tr', { hasText: 'OLD CO' }).first().locator('td').nth(1).click(); await sleep(800);
  const detail = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok('the lead record says it is an estimate from a Sheet file', /~March 2026 \(est\.\)/.test(detail) && /before May 2026/i.test(detail), detail.slice(0, 300));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
