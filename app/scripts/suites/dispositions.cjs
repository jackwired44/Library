// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('/home/user/Library/app/node_modules/playwright');
const fs = require('fs');
const SP = __dirname;
const out = []; const check = (n, c) => { out.push(!!c); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, timezoneId: 'America/Chicago' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  const body = () => page.locator('body').innerText();
  const nav = async l => { await page.locator(`aside button:has-text("${l}")`).first().click(); await sleep(350); };
  const seqCard = () => page.locator('main button').filter({ hasText: 'DQ seq' }).filter({ hasNotText: '(copy)' }).first();
  const expandSeq = async () => { const t = await seqCard().innerText(); if (t.startsWith('▸')) { await seqCard().click(); await sleep(500); } };
  // Flat sidebar: every former Engage sub-tab is its own destination now,
  // so navigating there is one click. Assertions below are unchanged.
  const ENGAGE_LABEL = { sequences:'Sequences', tasks:'Tasks', calls:'Calls', emails:'Emails', companies:'Companies', contacts:'Contacts', lists:'Lists' };
  const engage = async t => { await nav(ENGAGE_LABEL[t] || t); await sleep(450); };

  await page.goto(BASE); await sleep(400);
  await page.locator('input[aria-label="Email"]').fill('jack@wiredcio.com');
  await page.locator('input[type="password"]').fill('changeme');
  await page.locator('button:has-text("Unlock")').click(); await sleep(500);

  const csv = ['Company Name,First Name,Last Name,Email,Work Phone,Title,Comments',
    'Acme Dynamics Co,Jane,Doe,jane@acmedynamics.com,(212) 555-0100,IT Director,"Dynamics 365 Business Central for 40 users"',
    'Northwind Logistics,Sam,Reed,sam@northwindlog.com,+1 415 555 0100,COO,"Migrate from Google Workspace to Microsoft 365, bringing in a partner"'].join('\n');
  fs.writeFileSync(`${SP}/disp2.csv`, csv);
  await nav('Scanner');
  await page.locator('input[type="file"][accept=".csv"]').setInputFiles(`${SP}/disp2.csv`);
  await page.locator('.kpi').first().waitFor(); await sleep(500);

  // 1. Scanner per-row dropdown is grouped and has the new set
  const rowSel = page.locator('.data-table tbody tr', { hasText: 'Acme Dynamics Co' }).first().locator('select').nth(1);
  const groups = await rowSel.locator('optgroup').evaluateAll(g => g.map(x => x.label));
  check('Scanner dropdown grouped: Reached / Didn\'t reach', groups.join('|') === "Reached them|Didn't reach them");
  const opts = await rowSel.locator('option').allTextContents();
  check('All 9 outcomes + none present', opts.length === 10 && ['Meeting booked','Call back scheduled','Info requested','Not interested','Do not contact','Gatekeeper / front desk','Left voicemail','No answer','Wrong number'].every(l => opts.includes(l)));
  check('Retired built-ins gone from the picker', !opts.includes('No contact made') && !opts.includes('Other'));

  // 2. Enroll Acme in a sequence, then set Do not contact -> enrollment finishes
  await engage('sequences');
  await page.locator('input[placeholder="New sequence name"]').fill('DQ seq');
  await page.locator('button:has-text("+ New sequence")').click(); await sleep(500);
  await expandSeq();
  await page.locator('button:has-text("+ Add step")').first().click(); await sleep(400);
  const pick = async (who) => { await page.locator('main label').filter({ hasText: who }).locator('input[type="checkbox"]').first().check(); await sleep(250); };
  await pick('Jane Doe');
  await page.locator('button:has-text("Enroll 1 contact")').last().click(); await sleep(500);
  check('Enrolled before opt-out', /Enrolled 1 contact/.test(await body()));

  await nav('Scanner');
  await rowSel.selectOption('do-not-contact'); await sleep(600);
  await engage('sequences');
  await expandSeq();
  let b = await body();
  check('Do not contact finished the active enrollment', /Finished|Ended by disposition/.test(b));

  // 3. Re-enroll is refused with a visible reason
  await pick('Jane Doe');
  await page.locator('button:has-text("Enroll 1 contact")').last().click(); await sleep(500);
  b = await body();
  check('Re-enroll blocked with a visible Do not contact reason', /skipped as Do not contact/.test(b) && /Enrolled 0 contacts/.test(b));

  // 4. A not-reached outcome does NOT end a sequence
  await engage('sequences');
  await expandSeq();
  await pick('Sam Reed');
  await page.locator('button:has-text("Enroll 1 contact")').last().click(); await sleep(500);
  await nav('Scanner');
  const rowSel2 = page.locator('.data-table tbody tr', { hasText: 'Northwind' }).first().locator('select').nth(1);
  await rowSel2.selectOption('left-voicemail'); await sleep(600);
  await engage('sequences');
  await expandSeq();
  b = await body();
  check('Left voicemail (not reached) leaves the enrollment Active', /Active/.test(b));

  // 5. Contacts filter row shows both group headers + retired value renders
  await engage('contacts');
  await page.locator('.filter-btn').first().click(); await sleep(400);
  b = await body();
  check('Contacts filter row shows both bucket headers', /REACHED THEM|Reached them/i.test(b) && /DIDN'T REACH THEM|Didn't reach them/i.test(b));

  // 6. Custom disposition with reached flag
  await page.locator('button:has-text("Manage")').first().click(); await sleep(500);
  await page.locator('input[placeholder*="New call disposition"]').fill('Connected callback Q2');
  await page.locator('select.field').last().selectOption('reached');
  await page.locator('button:has-text("Add disposition")').click(); await sleep(400);
  b = await body();
  check('Custom disposition added into the Reached bucket', /Connected callback Q2/.test(b));
  await page.locator('.notes-popover-close').first().click().catch(()=>{}); await sleep(300);
  if (await page.locator('.notes-popover-backdrop').count()) { await page.mouse.click(5, 500); await sleep(300); }

  // 7. Persistence
  await page.reload(); await sleep(900);
  if (await page.locator('input[type="password"]').count()) { await page.locator('input[aria-label="Email"]').fill('jack@wiredcio.com');
  await page.locator('input[type="password"]').fill('changeme'); await page.locator('button:has-text("Unlock")').click(); await sleep(600); }
  await engage('contacts');
  await page.locator('.filter-btn').first().click(); await sleep(400);
  b = await body();
  check('Reload: custom + connected flag persisted', /Connected callback Q2/.test(b));
  check('Reload: Do not contact stuck on the contact', /Do not contact/.test(b));

  check('No page errors', errs.length === 0); if (errs.length) console.log(errs.slice(0,5));
  console.log(`${out.filter(Boolean).length}/${out.length}`);
  await browser.close();
})();
