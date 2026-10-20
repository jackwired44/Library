// The Agents tab. Per Jack: "make a tab at the bottom left so i can view
// them and there work approve stuff and pause".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  ok('an Agents button sits in the sidebar footer', await page.locator('.sidebar-foot button[aria-label="Agents"]').count() === 1);
  await page.locator('.sidebar-foot button[aria-label="Agents"]').click(); await sleep(500);
  const rows = page.locator('table[aria-label="Agents overview"] tbody tr');
  ok('all ten agents are listed', await rows.count() === 10, String(await rows.count()));
  const t = await page.locator('main').innerText();
  for (const n of ['main-scanner-rules', 'apollo-read-only-guard', 'apollo-connection', 'campaign-lists', 'tests-and-docs'])
    ok(`  ${n}`, t.includes(n));
  ok('it says how they run and that they decide nothing', /platform-review/.test(t) && /every\s+decision comes to you/.test(t.replace(/\s+/g, ' ')));
  ok('the copy button is off until there is a decision', await page.locator('button', { hasText: 'Copy decisions for Claude' }).isDisabled());

  await page.locator('button[aria-label="Pause apollo-connection"]').click(); await sleep(300);
  ok('pausing marks the agent Paused', /Paused/.test(await page.locator('tr[aria-label="Agent apollo-connection"]').innerText()));
  ok('  and writes it into the block for Claude', /Pause: apollo-connection/.test(await page.locator('textarea[aria-label="Decisions for Claude"]').inputValue()));
  ok('  the copy button turns on', !(await page.locator('button', { hasText: 'Copy decisions for Claude' }).isDisabled()));

  await page.locator('tr[aria-label="Agent notes-format"] button[aria-expanded]').click(); await sleep(300);
  const detail = await page.locator('[aria-label="notes-format detail"]').innerText();
  ok('opening an agent shows its rules, even with no report yet', /No report yet/.test(detail) && /What this agent checks/.test(detail));

  await page.reload(); await sleep(1200);
  await page.locator('.sidebar-foot button[aria-label="Agents"]').click(); await sleep(500);
  ok('a pause survives a reload', /Paused/.test(await page.locator('tr[aria-label="Agent apollo-connection"]').innerText()));
  await page.locator('button[aria-label="Resume apollo-connection"]').click(); await sleep(300);
  ok('resuming clears it from the block', !(await page.locator('textarea[aria-label="Decisions for Claude"]').count()));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
