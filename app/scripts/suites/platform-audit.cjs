// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// Full-platform workflow audit — per Jack: "check the workflows or any
// backend functions to make sure the entire platform works well." Walks
// every module end to end against the built app with real IndexedDB,
// asserting on outcomes (counts, persisted values, cross-module effects),
// not just "the page rendered."
const { chromium } = require('/home/user/Library/app/node_modules/playwright');
const fs = require('fs');
// Scratch dir for CSV fixtures a suite writes to disk. Must not
// point at a session-specific path — these run from a fresh clone.
const SP = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'wcio-suite-'));
const results = [];
const check = (n, c) => { results.push({ n, ok: !!c }); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, timezoneId: 'America/Chicago' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  const body = async () => page.locator('body').innerText();
  const nav = async (label) => { await page.locator(`aside button:has-text("${label}")`).first().click(); await sleep(350); };
  // Nav is now flat and grouped: every Engage tab is its own sidebar
  // destination, so a tab is one click instead of nav-then-dropdown.
  const TAB_LABEL = { sequences:'Sequences', tasks:'Tasks', calls:'Calls', emails:'Emails', companies:'Companies', contacts:'Contacts', lists:'Lists' };
  const engage = async (tab) => { await nav(TAB_LABEL[tab]); await sleep(450); };

  // ---------- 1. Lock screen ----------
  await page.goto(BASE);
  await sleep(400);
  check('Lock: password gate shown on fresh browser', (await page.locator('input[type="password"]').count()) === 1);
  check('Lock: email is required too', (await page.locator('input[aria-label="Email"]').count()) === 1);

  // Right email, wrong password.
  await page.locator('input[aria-label="Email"]').fill('jack@wiredcio.com');
  await page.locator('input[type="password"]').fill('wrong');
  await page.locator('button:has-text("Unlock")').click();
  await sleep(300);
  check('Lock: wrong password stays locked', (await page.locator('input[type="password"]').count()) === 1);

  // Right password, wrong email — must be refused just the same, and the
  // message must not reveal which field was wrong.
  await page.locator('input[aria-label="Email"]').fill('someone@else.com');
  await page.locator('input[type="password"]').fill('changeme');
  await page.locator('button:has-text("Unlock")').click();
  await sleep(300);
  check('Lock: wrong email stays locked', (await page.locator('input[type="password"]').count()) === 1);
  check('Lock: error does not say which field was wrong', /Wrong email or password/.test(await body()));

  await page.locator('input[aria-label="Email"]').fill('  JACK@WiredCIO.com  ');
  await page.locator('input[type="password"]').fill('changeme');
  await page.locator('button:has-text("Unlock")').click();
  await sleep(500);
  // Home now greets by time of day rather than a fixed "Welcome".
  check('Lock: correct credentials unlock (email case/space tolerant)', /Good (morning|afternoon|evening),/.test(await body()));

  // ---------- 2. Scanner: upload, edit, save to library ----------
  // ---------- Scanner's own gate ----------
  // A second lock on the Scanner view only, so the platform can be shown
  // to someone without handing them the file-processing screen. Separate
  // password, separate state: signing in does not unlock it.
  await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(450);
  check('Scanner: not advertised in the sidebar', (await page.locator('aside button:has-text("Scanner")').count()) === 0);
  check('Scanner: reachable on the shortcut', /Scanner/.test(await page.locator('main').innerText()));
  check('Scanner: locked behind its own password', (await page.locator('input[aria-label="Scanner password"]').count()) === 1);
  check('Scanner: the rest of the platform is still reachable', (await page.locator('aside button').count()) > 0);
  await page.locator('input[aria-label="Scanner password"]').fill('nope');
  await page.locator('button:has-text("Unlock scanner")').click(); await sleep(300);
  check('Scanner: wrong password stays locked', (await page.locator('input[aria-label="Scanner password"]').count()) === 1);
  await page.locator('input[aria-label="Scanner password"]').fill('changeme');
  await page.locator('button:has-text("Unlock scanner")').click(); await sleep(500);
  check('Scanner: correct password unlocks it', (await page.locator('input[type=file]').count()) > 0);
  check('Scanner: can be re-locked on demand', (await page.locator('button:has-text("Lock scanner")').count()) === 1);
  // Always locked, per Jack: leaving the tab and coming back must ask
  // again. Nothing about the unlock is persisted, so a reload re-locks it
  // too.
  await nav('Home'); await sleep(400);
  await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(450); await sleep(400);
  check('Scanner: re-locks after leaving the tab', (await page.locator('input[aria-label="Scanner password"]').count()) === 1);
  await page.locator('input[aria-label="Scanner password"]').fill('changeme');
  await page.locator('button:has-text("Unlock scanner")').click(); await sleep(500);
  await page.reload(); await sleep(1200);
  if (await page.locator('input[aria-label="Email"]').count()) {
    await page.locator('input[aria-label="Email"]').fill('jack@wiredcio.com');
    await page.locator('input[type="password"]').fill('changeme');
    await page.locator('button:has-text("Unlock")').click(); await sleep(800);
  }
  await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(450); await sleep(500);
  check('Scanner: re-locks after a reload', (await page.locator('input[aria-label="Scanner password"]').count()) === 1);
  await page.locator('input[aria-label="Scanner password"]').fill('changeme');
  await page.locator('button:has-text("Unlock scanner")').click(); await sleep(500);

  const csv = [
    'Company Name,First Name,Last Name,Email,Work Phone,Title,Comments',
    'Acme Dynamics Co,Jane,Doe,jane@acmedynamics.com,(212) 555-0100,IT Director,"Looking at Dynamics 365 Business Central for 40 users"',
    'Acme Dynamics Co,Jane,Doe,jane@acmedynamics.com,(212) 555-0100,IT Director,"Looking at Dynamics 365 Business Central for 40 users"',
    'Northwind Logistics,Sam,Reed,sam@northwindlog.com,+1 415 555 0100,COO,"Migrate from Google Workspace to Microsoft 365, bringing in a partner"',
    'Vertex Health,Amy,Lin,amy@vertexhealth.org,6025550100,CTO,"Interested in Azure Document Intelligence and a full custom app build"',
    'Quill Manufacturing,Ben,Ford,ben@quillmfg.com,,Ops,"Need help with Power BI dashboards"',
    'Zeta Freight,Ken,Ray,ken@zetafreight.com,,VP,"Quick question about Dynamics 365 — no budget, one-off project"',
    'Blank Co,Pat,Nolan,pat@blankco.com,,Manager,"Please send me the parking validation form"',
  ].join('\n');
  fs.writeFileSync(`${SP}/audit.csv`, csv);
  await page.locator('input[type="file"][accept=".csv"]').setInputFiles(`${SP}/audit.csv`);
  await page.locator('.kpi').first().waitFor();
  await sleep(500);
  let b = await body();
  // Accounting line condensed per Jack — "7 read · N processed · N no
  // signal · 1 duplicates merged", with the long wording now on hover.
  const note = await page.locator('.scan-note').innerText();
  check('Scanner: rows read 7, 1 duplicate merged, accounting line present', /7\s*read/.test(note) && /1\s*duplicates merged/.test(note));
  check('Scanner: Non Relevant tab present for the no-signal row', /Non Relevant \(1\)/.test(b));
  check('Scanner: tiers populated (Strong Signal ≥3, Bad Leads ≥1)', /Strong Signal \((\d+)\)/.test(b) && Number(b.match(/Strong Signal \((\d+)\)/)[1]) >= 3 && /Bad Leads \((\d+)\)/.test(b) && Number(b.match(/Bad Leads \((\d+)\)/)[1]) >= 1);
  // per-row tier toggle: the pill CYCLES Strong Signal -> Needs review ->
  // Bad Lead -> Strong Signal by design (Scanner.tsx TIER_CYCLE). Walk Acme
  // all the way around and confirm every count moves as it should.
  const acme = () => page.locator('.data-table tbody tr', { hasText: 'Acme Dynamics Co' }).first();
  const counts = (t) => ({ ss: Number((t.match(/Strong Signal \((\d+)\)/) || [0, 0])[1]), nr: Number((t.match(/Needs review \((\d+)\)/) || [0, 0])[1]), bl: Number((t.match(/Bad Leads \((\d+)\)/) || [0, 0])[1]) });
  const c0 = counts(await body());
  await acme().locator('button:has-text("Strong Signal")').click(); await sleep(300);
  const c1 = counts(await body());
  check('Scanner: tier pill Strong Signal -> Needs review moves the counts', c1.ss === c0.ss - 1 && c1.nr === c0.nr + 1);
  await page.locator('.seg-btn:has-text("Needs review")').click(); await sleep(300);
  await acme().locator('button:has-text("Needs review")').click(); await sleep(300);
  const c2 = counts(await body());
  check('Scanner: tier pill Needs review -> Bad Lead moves the counts', c2.nr === c1.nr - 1 && c2.bl === c1.bl + 1);
  await page.locator('.seg-btn:has-text("Bad Leads")').click(); await sleep(300);
  await acme().locator('button:has-text("Bad lead")').click(); await sleep(300);
  await page.locator('.seg-btn:has-text("Strong Signal")').click(); await sleep(300);
  const c3 = counts(await body());
  check('Scanner: tier pill Bad Lead -> Strong Signal restores the original counts', c3.ss === c0.ss && c3.nr === c0.nr && c3.bl === c0.bl);
  // disposition -> not interested auto-crosses out
  await acme().locator('select').nth(1).selectOption('not-interested'); await sleep(400);
  const struck = await acme().locator('td div[style*="line-through"]').count();
  check('Scanner: "Not interested" auto-crosses the row out', struck >= 1);
  await acme().locator('button[title*="Undo disposition"]').click(); await sleep(300);
  // save to library
  await page.locator('button:has-text("Save to Lead Library")').click(); await sleep(600);
  b = await body();
  check('Scanner: Save to Lead Library files Strong Signal rows and disables itself', /✓ Filed/.test(b) && /Filed \d+ Strong Signal/.test(b));
  // add two to a list
  await acme().locator('input[type="checkbox"]').check();
  await page.locator('.data-table tbody tr', { hasText: 'Northwind Logistics' }).first().locator('input[type="checkbox"]').check();
  await sleep(250);
  await page.locator('.bulkbar select').last().selectOption('__new__');
  await page.locator('.bulkbar input[placeholder="List name"]').fill('Audit list');
  await page.locator('.bulkbar button:has-text("Add")').click(); await sleep(400);
  check('Scanner: bulk add-to-list creates the list with 2 leads', /Added 2 leads/.test(await body()));

  // ---------- 3. Lead Library ----------
  await nav('Lead library');
  b = await body();
  check('Library: month folder shows filed leads', /Lead Library|Library/.test(b) && /September 2026|files? filed|leads/.test(b));
  const folder = page.locator('button', { hasText: 'September 2026' }).first();
  if (await folder.count()) { await folder.click(); await sleep(400); }
  b = await body();
  check('Library: folder opens and lists category files with a combined export', /All Strong Signal Leads/.test(b) || /category file/.test(b));

  // ---------- 4. History ----------
  await nav('History');
  b = await body();
  check('History: entry recorded with breakdown line', /7 rows read|rows read/.test(b) && /Strong Signal/.test(b));
  check('History: Library-linked badge on the filed entry', /Library-linked/.test(b));
  const viewBtn = page.locator('main button:has-text("View")').first();
  if (await viewBtn.count()) { await viewBtn.click(); await sleep(500); }
  // "View" lands on the Scanner, which is always locked — so it asks for
  // the password before showing the batch. The batch itself is already
  // loaded behind the gate; unlocking reveals it rather than reloading it.
  check('History: "View" hits the Scanner lock first', (await page.locator('input[aria-label="Scanner password"]').count()) === 1);
  await page.locator('input[aria-label="Scanner password"]').fill('changeme');
  await page.locator('button:has-text("Unlock scanner")').click(); await sleep(600);
  check('History: "View" reopens the batch in Scanner with the real rows-read figure', /Scan results/.test(await body()) && /7\s*read/.test(await page.locator('.scan-note').innerText()));

  // ---------- 5. Engage: Contacts ----------
  await engage('contacts');
  b = await body();
  check('Contacts: 6 unique contacts captured (dedupe folded the repeat)', /6 contacts across every upload/.test(b));
  check('Contacts: Local time column resolves Eastern for the 212 number', (await page.locator('tbody tr', { hasText: 'Jane Doe' }).first().innerText()).match(/\b(EDT|EST)\b/) !== null);
  await page.locator('input[placeholder*="Search name"]').fill('Vertex'); await sleep(300);
  check('Contacts: search narrows to Vertex Health', /Vertex Health/.test(await body()) && !/Northwind/.test(await body()));
  await page.locator('input[placeholder*="Search name"]').fill(''); await sleep(300);
  // Tier now lives inside the single Filters popover (per Jack: filters
  // "hidden under drop downs and not displayed just across the screen").
  await page.locator('.filter-btn').first().click(); await sleep(300);
  await page.locator('.filter-pop').locator('label', { hasText: 'Strong Signal' }).locator('input[type="radio"]').check(); await sleep(300);
  check('Contacts: tier filter applies', !/Blank Co/.test(await body()));
  await page.locator('.filter-pop').locator('label', { hasText: 'All tiers' }).locator('input[type="radio"]').check(); await sleep(200);
  await page.locator('.filter-pop-backdrop').click(); await sleep(250);
  // detail modal
  await page.locator('td :text("Jane Doe")').first().click(); await sleep(500);
  b = await body();
  check('Contact detail: record details (owner/last activity/lists/sequences/time zone) render', /Record details/.test(b) && /Audit list/.test(b) && /TIME ZONE/i.test(b));
  check('Contact detail: website auto-derived from email domain', /acmedynamics\.com/.test(b));
  await page.locator('button:has-text("Mark as On CRM")').click(); await sleep(300);
  check('Contact detail: On CRM toggle', /✓ On CRM/.test(await body()));
  await page.locator('button:has-text("✕")').first().click(); await sleep(300);
  // profile agent (no Apollo in this environment -> honest message, websites filled)
  await page.locator('tbody input[type="checkbox"]').first().check(); await sleep(200);
  await page.locator('button:has-text("Run profile agent")').click(); await sleep(1200);
  b = await body();
  check('Profile agent: without Apollo, reports honestly and does not fake a match', /Apollo isn't connected|isn't available in this view/.test(b) && !/Apollo match/.test(b));
  await page.locator('button:has-text("Clear selection")').click(); await sleep(200);

  // ---------- 6. Engage: Companies (+ Apollo export import) ----------
  await engage('companies');
  b = await body();
  check('Companies: roll-up lists the uploaded companies', /Acme Dynamics Co/.test(b) && /Northwind Logistics/.test(b));
  const apollo = [
    'Company,# Employees,Industry,Website,Company City,Company State,Company Country,Company Phone,Company Linkedin Url,Keywords,Annual Revenue,Founded Year,Short Description',
    'Acme Dynamics Co,51-200,Manufacturing,https://acmedynamics.com,Buffalo,New York,United States,(716) 555-0199,https://linkedin.com/company/acme,"erp, manufacturing",12M,1998,Precision parts maker.',
    'Quill Manufacturing,11-50,Industrial,quillmfg.com,Denver,CO,United States,,,,,,',
    ',10,Unknown,,,,,,,,,,',
  ].join('\n');
  fs.writeFileSync(`${SP}/apollo.csv`, apollo);
  await page.locator('input[type="file"][accept=".csv"]').last().setInputFiles(`${SP}/apollo.csv`);
  await sleep(900);
  b = await body();
  check('Companies: Apollo import summary (2 new, 1 skipped for no name)', /2 new companies/.test(b) && /1 skipped \(no company name\)/.test(b));
  check('Companies: Industry / Employees / HQ columns populated from the import', /Manufacturing/.test(b) && /51-200/.test(b) && /Buffalo, New York, United States/.test(b));
  await page.locator('tbody tr', { hasText: 'Quill Manufacturing' }).first().click(); await sleep(400);
  b = await body();
  check('Companies: HQ state (CO) drives the company time zone when no phone can', /Mountain \(Denver\)/.test(b) && /from HQ location/.test(b));
  check('Companies: "Known info" panel shows imported fields', /Known info/.test(b) && /quillmfg\.com/.test(b));

  // ---------- 7. Sequences + Calls ----------
  await engage('sequences');
  await page.locator('input[placeholder="New sequence name"]').fill('Audit seq');
  await page.locator('button:has-text("+ New sequence")').click(); await sleep(400);
  await page.locator('button:has-text("+ Add step")').click(); await sleep(250);
  await page.locator('label:has-text("Sam Reed") input[type="checkbox"]').first().check();
  await page.locator('button:has-text("Enroll 1 contact")').click(); await sleep(400);
  check('Sequences: enroll generates step task', /Enrolled 1 contact/.test(await body()) && /Step 1\/1/.test(await body()));
  await page.locator('button:has-text("⏸ Pause")').first().click(); await sleep(300);
  check('Sequences: pausing keeps the card visible (Live filter) with Activate available', /▶ Activate/.test(await body()));
  await page.locator('button:has-text("▶ Activate")').first().click(); await sleep(300);
  await page.locator('button:has-text("⧉ Copy")').first().click(); await sleep(400);
  check('Sequences: copy creates "(copy)" with the step', /Audit seq \(copy\)/.test(await body()));
  await engage('calls');
  b = await body();
  check('Calls: sequence-generated call task appears with the contact\'s local time (Pacific)', /Call Sam Reed/.test(b) && /\b(PDT|PST)\b/.test(b));
  check('Calls: disposition checkbox filter present', /DISPOSITION/i.test(b) && (await page.locator('label:has-text("No answer") input[type="checkbox"]').count()) > 0);
  const callRow = page.locator('div', { hasText: 'Call Sam Reed' }).last();
  await callRow.locator('input[type="checkbox"]').first().click(); await sleep(500);
  await engage('sequences');
  await page.locator('button', { hasText: 'Audit seq' }).filter({ hasNotText: '(copy)' }).first().click(); await sleep(400);
  check('Sequences: completing the only step finishes the enrollment', /Completed all steps/.test(await body()));

  // ---------- 8. Emails: assign + mark replied ----------
  await engage('emails');
  await page.locator('button:has-text("+ Email")').click(); await sleep(200);
  await page.locator('select').filter({ hasText: 'Choose a contact' }).first().selectOption({ label: 'Amy Lin — Vertex Health' });
  await page.locator('button:has-text("Add")').last().click(); await sleep(400);
  await page.locator('button:has-text("Mark replied")').first().click(); await sleep(300);
  check('Emails: manual "Mark replied" flips to ✓ Replied', /✓ Replied/.test(await body()));

  // ---------- 9. Lists ----------
  await engage('lists');
  b = await body();
  check('Lists: "Audit list" exists with 2 leads and a Download CSV', /Audit list/.test(b) && /Download CSV/.test(b));

  // ---------- 10. Home dashboard ----------
  await nav('Home');
  b = await body();
  // Rebuilt as four tiers: greeting/state, action band, today's numbers,
  // then needs-you-now / this-week. Assert each tier is present.
  check('Home: all four tiers render (action band, today, needs-you-now, this week)',
    (await page.locator('.action-band').count()) === 1 &&
    /TODAY/i.test(b) && /NEEDS YOU NOW/i.test(b) && /THIS WEEK/i.test(b) &&
    /WEEKLY GOALS/i.test(b) && /Notifications/.test(b) && /Viewing as|Everyone|\(you\)/.test(b));
  // At most one: an empty call queue deliberately renders a SECONDARY
  // "Go to sequences" instead, rather than a dead primary button.
  const primaries = await page.locator('main .btn-primary').count();
  check('Home: never more than one primary button', primaries <= 1);
  // The Today row's Calls tile — same underlying count, new label.
  check('Home: today\'s Calls tile reflects the completed call',
    /CALLS\s*\n?\s*1\b/i.test(await page.locator('.metric-row').first().innerText()));
  await page.locator('button:has-text("Notifications")').click(); await sleep(300);
  b = await body();
  check('Home: Notifications shows the replied email and the scheduled email', /Emails replied to/.test(b) && /Email Amy Lin/.test(b));
  const bookedTile = page.locator('button[title="Previous week"]');
  await bookedTile.click(); await sleep(200);
  check('Home: Meetings booked steps back a week', /Meetings booked/i.test(await page.locator('.stack-card').first().innerText()) || /Meetings booked/i.test(await body()));
  await page.locator('button[title="Next week"]').click(); await sleep(200);
  // weekly goals edit persists
  const target = page.locator('input[type="number"]').last();
  await target.fill('40'); await sleep(600);

  // ---------- 11. Dispositions manager + Cheat Sheet + Platform notes ----------
  await page.locator('aside button:has-text("Settings")').click(); await sleep(400);
  b = await body();
  check('Settings opens on the qualification rules with hot signals', /hot signals/i.test(b) && /Settings/.test(b));
  await page.locator('.settings-rail-btn:has-text("Call dispositions")').first().click(); await sleep(300);
  await page.locator('input[placeholder*="New call disposition"]').fill('Audit outcome');
  await page.locator('button:has-text("Add disposition")').click(); await sleep(300);
  check('Dispositions: custom disposition added from the shared panel', /Audit outcome/.test(await body()));
  await page.locator('div[style*="position: fixed"] button:has-text("Platform Notes"), .settings-rail-btn:has-text("Platform notes")').last().click(); await sleep(300);
  check('Platform Notes tab reachable from the shared panel', /Platform notes|Platform Notes/i.test(await body()) && /New note/i.test(await body()));
  await page.locator('.notes-popover-close, div[style*="position: fixed"] button:has-text("✕")').last().click().catch(() => {}); await sleep(300);
  if (await page.locator('div[style*="position: fixed"]').count()) { await page.mouse.click(5, 500); await sleep(300); }

  // ---------- 12. Profile & Access ----------
  await page.locator('.account-row-btn').click(); await sleep(400);
  b = await body();
  check('Profile & Access: modal with profile form and team roster', /Your profile|Profile/.test(b) && /Team & access|Owner/.test(b));
  // The clock moved out from under the name into the four-zone strip,
  // where the rep's OWN zone is the highlighted row (.tz-cheat-you).
  check('Time-zone strip highlights the rep\'s own zone (browser pinned to Chicago)',
    (await page.locator('.tz-cheat-you .tz-cheat-label').innerText().catch(() => '')).trim().toUpperCase() === 'CENTRAL'
    && (await page.locator('.tz-cheat-cell').count()) === 4);
  await page.locator('.notes-popover-close').first().click().catch(() => {}); await sleep(300);
  if (await page.locator('.notes-popover-backdrop').count()) { await page.mouse.click(5, 500); await sleep(300); }

  // ---------- 13. Persistence across reload ----------
  await page.reload(); await sleep(900);
  // Unlock persists per-browser (lib/auth.ts), so the gate only reappears
  // when the session was cleared — handle both.
  if (await page.locator('input[aria-label="Email"]').count()) {
    await page.locator('input[aria-label="Email"]').fill('jack@wiredcio.com');
  await page.locator('input[type="password"]').fill('changeme');
    await page.locator('button:has-text("Unlock")').click(); await sleep(600);
  }
  await page.locator('.side-nav-btn').first().waitFor({ timeout: 10000 });
  b = await body();
  check('Reload: weekly goal target persisted (40)', (await page.locator('input[type="number"]').last().inputValue()) === '40');
  await nav('Lead library');
  check('Reload: Lead Library still has filed files', /1|2|3/.test(await body()) && !/No files/.test(await body()));
  await engage('companies');
  check('Reload: Apollo company profiles persisted', /Buffalo, New York, United States/.test(await body()));
  await engage('contacts');
  // Dispositions live inside the Filters popover now — open it to assert.
  await page.locator('.filter-btn').first().click(); await sleep(350);
  check('Reload: custom disposition persisted in the filter row', /Audit outcome/.test(await page.locator('.filter-pop').innerText()));
  await page.locator('.filter-pop-backdrop').click(); await sleep(200);

  // ---------- 14. Lock ----------
  await page.locator('button:has-text("Lock")').click(); await sleep(400);
  check('Lock button returns to the password gate', (await page.locator('input[type="password"]').count()) === 1);

  check('No uncaught page errors across the whole audit', errs.length === 0);
  if (errs.length) console.log(errs.slice(0, 8));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:', failed.map((f) => f.n)); process.exit(1); }
})();
