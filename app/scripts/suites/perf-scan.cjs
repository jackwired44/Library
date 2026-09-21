// Two measured regressions that a functional suite cannot see, because the
// app is CORRECT in both cases — just unusably slow, and leaking.
//
//  1. Search rebuilt a per-row haystack inside tests.search, and tests
//     feeds eleven faceted counts, so ONE keystroke stringified every
//     column of every row ten times over. Measured on Jack's real
//     9,265-row file: 1,033 ms per keystroke, 8.3 s to type 8 characters.
//     Now the text is joined once per scan and the query resolves to a Set
//     of ids once per keystroke: 112 ms.
//
//  2. "Start over" cleared every piece of state but freed no memory —
//     React keeps the last render's memoised rows on the fiber. A scan
//     retained ~146 MB across Start over and four scan cycles reached
//     420 MB with forced GC between each. Start over now remounts the
//     scanner, which does release it: 6 MB after every cycle.
//
// Thresholds are deliberately loose — several times better than the bug,
// several times worse than the fix — so this fails on a real regression
// and not on a slow CI box.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = v => `"${String(v).replace(/"/g, '""')}"`;

// Long seller notes are what make the haystack expensive, so the fixture
// carries a realistic blob rather than a short comment.
// Sized against the real file, because the first version of this suite was
// 430 chars of notes over 4,000 rows and PASSED on the unfixed code — ~20x
// too little text to reproduce the bug. Jack's export averages 4,159 chars
// of seller notes per row over 9,265 rows, so the fixture matches that
// shape: a multi-entry dated log with Microsoft's own labelled fields.
const N = Number(process.env.N || 8000);
const ENTRY = (i, k) => [
  `${['MA', 'TH', 'KBM', 'RZ', 'GD'][k % 5]} - ${1 + ((i + k) % 28)}/Aug -`,
  `Customer is looking for a partner to take over licensing.`,
  `Need: renew ${20 + ((i + k) % 300)} users and expand into Copilot.`,
  `Budget: approved this year. Authority: IT Director. Timeline: this quarter.`,
  `Risk: incumbent reseller holds the tenant. Estimated Close Date: 30/Sep.`,
  `Current Environment or Challenge: mixed M365 E3 and Business Premium estate,`,
  `Defender for Business in pilot, Purview not deployed, Entra ID P1 only.`,
  `Microsoft Solution Solution Area: Modern Work. Next Steps: intro call, quote.`,
  `Orchestration Note: Associated Consumption Opportunity created to track usage`,
  `and adoption. Partner Summary Partner: not discovered, recommend discovery.`,
].join(' ');
// Six dated entries per row, newest first — the same shape the recency and
// dead-language rules read, and about 4,100 characters.
const BLOB = (i) => [0, 1, 2, 3, 4, 5].map((k) => ENTRY(i, k)).join(' | ');
const HEAD = ['customeridname', 'estimatedvalue', 'msp_forecastcomments', 'msp_licensingprogramname',
  'msp_partneraccountidname', 'msp_rollupestrevenue', 'fullname', 'telephone1', 'mobilephone',
  'emailaddress1', 'address1_country', 'campaignidname', 'createdon'];
const PROG = ['CSP | Annual New Upfront Billing', 'CSP | Monthly New', 'CSP | Annual Renewal Upfront Billing'];
const lines = [HEAD.join(',')];
for (let i = 0; i < N; i++) {
  lines.push([
    `PERF COMPANY ${i}`, String(1000 + i * 37), BLOB(i), PROG[i % PROG.length],
    i % 3 === 0 ? 'NULL' : `Reseller ${i % 17}`, String(1000 + i * 37),
    `First${i} Last${i}`, `312-555-${String(1000 + (i % 8999)).slice(0, 4)}`, 'NULL',
    `p${i}@perfco${i}.com`, 'United States', 'NULL', '2026-08-01',
  ].map(esc).join(','));
}
const FILE = path.join(os.tmpdir(), 'perf-scan.csv');
fs.writeFileSync(FILE, lines.join('\n'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--js-flags=--expose-gc'] });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(180000);

  const gcHeap = async () => {
    await page.evaluate(() => { for (let i = 0; i < 5; i++) if (window.gc) window.gc(); });
    await sleep(600);
    return Math.round((await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0))) / 1048576);
  };
  const scan = async () => {
    await page.setInputFiles('input[type=file]', FILE);
    await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 180000 });
    await sleep(900);
  };
  const shown = async () => {
    const m = (await page.locator('main').innerText()).match(/([\d,]+) of ([\d,]+) shown/);
    return m ? Number(m[1].replace(/,/g, '')) : -1;
  };

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await page.locator('.side-nav-btn', { hasText: 'CSP Scanner' }).first().click(); await sleep(600);

  console.log(`\n== search latency (${N} rows) ==`);
  const base = await gcHeap();
  await scan();
  const sel = 'input[placeholder*="Search company"]';
  const word = 'company 1234';
  let total = 0;
  for (let i = 1; i <= word.length; i++) {
    const t = Date.now();
    await page.fill(sel, word.slice(0, i));
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    total += Date.now() - t;
  }
  const per = Math.round(total / word.length);
  console.log(`  ${word.length} keystrokes: ${total} ms total, ${per} ms each`);
  // The bug measured 1,033 ms/keystroke on 9,265 rows; the fix measured
  // 112 ms. 400 ms leaves room for a slow box without letting the bug back.
  ok(`a keystroke costs under 400 ms (was ~1,000 ms)`, per < 400, `${per} ms`);

  // ...and still returns the RIGHT rows. A fast filter that matches nothing
  // would sail past a timing check.
  await page.fill(sel, 'PERF COMPANY 1234'); await sleep(500);
  ok('an exact company matches exactly one row', await shown() === 1, String(await shown()));
  await page.fill(sel, 'zzz-no-such-company'); await sleep(400);
  ok('a query matching nothing empties the table', await shown() === 0, String(await shown()));
  await page.fill(sel, ''); await sleep(400);
  const all = await shown();
  ok('clearing the box restores every row', all > N * 0.5, String(all));

  console.log('\n== Start over releases the scan ==');
  const scanned = await gcHeap();
  await page.locator('button:has-text("Start over")').first().click(); await sleep(1000);
  const cleared = await gcHeap();
  console.log(`  baseline ${base} MB · after scan ${scanned} MB · after Start over ${cleared} MB`);
  ok('Start over frees most of the scan (it used to free none)',
     cleared < base + (scanned - base) * 0.4, `${cleared} MB vs ${scanned} MB scanned`);
  ok('  and the upload screen is back', await page.locator('input[type=file]').count() > 0);

  // Repeated cycles must not climb: this is the actual leak, and one cycle
  // cannot show it.
  await scan();
  await page.locator('button:has-text("Start over")').first().click(); await sleep(1000);
  await scan();
  const third = await gcHeap();
  console.log(`  after three scan cycles: ${third} MB (first scan was ${scanned} MB)`);
  ok('three scan cycles do not stack up (was +91 MB each)', third < scanned * 1.6, `${third} MB vs ${scanned} MB`);

  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
