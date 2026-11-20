// Archive -> Apollo rules: dispositions, the six sequences, stages.
const BASE = process.env.BASE || 'http://localhost:4173';
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await page.waitForTimeout(900);
  await page.locator('aside button:has-text("Apollo rules")').first().click(); await page.waitForTimeout(300);
  const d = await page.locator('table[aria-label="Dispositions"]').innerText();
  ok('every Apollo disposition listed', ['Meeting Booked', 'Qualified, Pending Review', 'Info Requested', 'Call Back Scheduled', 'Not interested', 'Do Not Contact', 'Gatekeeper', 'Left Voicemail', 'No Answer', 'Wrong Number', 'No Disposition'].every((x) => d.includes(x)));
  const row = async (n) => page.locator('table[aria-label="Dispositions"] tbody tr', { hasText: n }).first().innerText();
  ok('info requested ends the sequence', (await row('Info Requested')).includes('Ends the sequence'));
  ok('no answer does not', !(await row('No Answer')).includes('Ends the sequence'));
  ok('the six sequences shown', await page.locator('[data-seq-rule]').count() === 6);
  ok('contact stages shown', (await page.locator('table[aria-label="Contact stages"]').innerText()).includes('Meeting Logged'));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
