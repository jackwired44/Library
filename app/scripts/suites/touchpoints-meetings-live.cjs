// Touchpoints and the Meetings lock.
//
// Per Jack: "this platform manages leads and where they stand in apollo so i
// can better manage all the leads and understand how many touch points have
// been made calls or emails", and "we need to have a meetings column in here
// to manage the leads that means we arent to reach out again and the account
// manager should only".
//
// Apollo is a fake MCP connector shaped like the real responses rehearsed in
// the build session (contacts_search, phone_calls_search with outcome facets,
// emailer_messages_search). The deals/meetings file is the import format
// lib/engagements.ts reads.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'touch-leads.csv');
fs.writeFileSync(LEADS, csv(['Company', 'Full Name', 'Title', 'Email', 'Phone', 'Comments'], [
  ['ACTIVE CO', 'Ada Brant', 'IT Director', 'ada@active.com', '312-555-0101', SIGNAL],
  ['DEAL CO', 'Ben Cole', 'CFO', 'ben@dealco.com', '312-555-0102', SIGNAL],
  ['MEETING CO', 'Nia Rowe', 'CIO', 'nia@meetingco.com', '312-555-0103', SIGNAL],
  ['MEETING CO', 'Sam Hart', 'Controller', 'sam@meetingco.com', '312-555-0105', SIGNAL],
  ['CUSTOMER LLC', 'Cy Park', 'COO', 'cy@customer.io', '312-555-0106', SIGNAL],
  ['FREE CO', 'Gail Ross', 'Owner', 'gail@gmail.com', '312-555-0107', SIGNAL],
]));
const DEALS = path.join(os.tmpdir(), 'touch-deals.csv');
fs.writeFileSync(DEALS, csv(['Source', 'Company', 'Domain', 'Email', 'Contact', 'Stage', 'Date', 'Link'], [
  ['HubSpot', 'Deal Company', '', 'ben@dealco.com', 'Ben Cole', 'Discovery', '2026-10-01', ''],
  ['Echo', 'Meeting Co', '', '', '', 'Discovery', '2026-10-15', ''],
  ['Notion', 'Customer', 'customer.io', '', '', 'Won', '2026-05-01', ''],
  ['Notion', 'Gmail account', 'gmail.com', '', '', 'Lost', '2026-04-01', ''],
  ['', 'No source', '', 'x@y.com', '', 'Lost', '', ''],
]));

const FAKE = () => {
  window.__calls = [];
  const contacts = {
    'ada@active.com': [{ id: 'c-ada', name: 'Ada Brant', email: 'ada@active.com', owner_id: '68bf4ba5f68a0600194acd11',
      contact_campaign_statuses: [{ emailer_campaign_id: 'seq1', status: 'active', added_at: '2026-10-01T10:00:00Z', current_step_position: 3 }] }],
  };
  const NA = 'o-na', GK = 'o-gk', VM = 'o-vm';
  const facets = [{ value: NA, display_name: 'No Answer', count: 0 }, { value: GK, display_name: 'Gatekeeper / Front Desk', count: 0 }, { value: VM, display_name: 'Left Voicemail', count: 0 }];
  const calls = [
    { contact_id: 'c-ada', start_time: '2026-10-16T22:34:04Z', phone_call_outcome_id: GK, caller_name: 'Jack Snellgrove', campaign_name: 'Carly Main Sequence', campaign_position: 3 },
    { contact_id: 'c-ada', start_time: '2026-10-10T15:00:00Z', phone_call_outcome_id: NA, caller_name: 'Carly Parks', campaign_name: 'Carly Main Sequence', campaign_position: 1 },
    { contact_id: 'c-ada', start_time: '2026-10-12T15:00:00Z', phone_call_outcome_id: VM, caller_name: 'Carly Parks' },
  ];
  const emails = [
    { contact_id: 'c-ada', emailer_campaign_id: 'seq1', status: 'completed', delivered: true, opened: true, replied: false, bounced: false },
    { contact_id: 'c-ada', emailer_campaign_id: 'seq1', status: 'completed', delivered: true, opened: false, replied: false, bounced: false },
    { contact_id: 'c-other', emailer_campaign_id: 'seq1', status: 'completed', delivered: true, opened: true, replied: true, bounced: false },
  ];
  const perms = { state: async () => 'granted', request: async () => ({}) };
  const downloads = { save: async () => {} };
  window.claude = { use: async name => name === 'permissions' ? perms : name === 'downloads' ? downloads : name !== 'mcp' ? null : {
    listTools: async () => ({ servers: [{ server: 'Apollo.io', tools: [
      { name: 'apollo_contacts_search' }, { name: 'apollo_emailer_campaigns_search' },
      { name: 'apollo_phone_calls_search' }, { name: 'apollo_emailer_messages_search' }] }] }),
    callTool: async (server, tool, args) => {
      window.__calls.push({ tool, args });
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { emailer_campaigns: [{ id: 'seq1', name: 'Carly Main Sequence', num_steps: 5, emailer_steps: [] }], pagination: { total_pages: 1 } } };
      if (tool.endsWith('phone_calls_search')) {
        const list = calls.filter(c => c.contact_id === args.contact_id);
        return { payload: { phone_calls: list, pagination: { total_entries: list.length }, faceting: { phone_call_stats_facets: facets } } };
      }
      if (tool.endsWith('emailer_messages_search')) return { payload: { emailer_messages: emails.filter(e => e.emailer_campaign_id === args.emailer_campaign_id) } };
      return { payload: { contacts: contacts[args.q_keywords] || [] } };
    },
  } };
};

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1700, height: 950 } });
  await ctx.addInitScript(FAKE);
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('skipFileNameBox', '1'); } catch { /* ignore */ } });
  // These checks read columns All leads now hides by default; show every column.
  await page.addInitScript(() => { try { if (localStorage.getItem('allLeadsHiddenParts2') === null) { localStorage.setItem('allLeadsHiddenParts2', '[]'); localStorage.setItem('allLeadsPanelsRemoved1', '1'); localStorage.setItem('allLeadsPanelsRemoved2', '1'); } } catch { /* ignore */ } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const nav = async (name, sub) => {
    await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(500);
    if (sub) { await page.locator('.seg-btn', { hasText: sub }).first().click(); await sleep(500); }
    await page.evaluate(() => document.querySelectorAll('details.fold').forEach((d) => { d.open = true; })); await sleep(150);
  };
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const cell = async (co, col, nth = 0) => (await page.locator('.data-table tbody tr', { hasText: co }).nth(nth).locator(`td[data-col="${col}"]`).innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(800);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  console.log('\n== touchpoints from Apollo ==');
  await nav('All leads');
  let t = await main();
  ok('All leads has Meetings and Touchpoints columns', /Meetings/i.test(t) && /Touchpoints/i.test(t));
  await page.locator('.data-table tbody tr', { hasText: 'ACTIVE CO' }).first().locator('input[type=checkbox]').check(); await sleep(200);
  await page.locator('button', { hasText: /Check 1 in Apollo/ }).click();
  await page.waitForFunction(() => /Apollo check done/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
  await sleep(500);
  const touch = await cell('ACTIVE CO', 'touches');
  ok('calls counted from the call log', /3 calls/.test(touch), touch);
  ok('emails counted for this contact only (2, not 3)', /2 emails/.test(touch), touch);
  ok('opens and replies shown', /1 opened · 0 replied/.test(touch), touch);
  const ada = (await page.locator('.data-table tbody tr', { hasText: 'ACTIVE CO' }).first().innerText()).replace(/\s+/g, ' ');
  ok('last outcome is the newest call, by date', /Gatekeeper \/ Front Desk · 2026-10-16/.test(ada), ada);
  const calls = await page.evaluate(() => window.__calls);
  ok('call search filters by the Apollo contact id', calls.some(c => c.tool.endsWith('phone_calls_search') && c.args.contact_id === 'c-ada'));
  ok('email search scoped to the contact\'s sequence', calls.some(c => c.tool.endsWith('emailer_messages_search') && c.args.emailer_campaign_id === 'seq1'));
  ok('nothing but read tools called', calls.every(c => /_search$/.test(c.tool)), JSON.stringify(calls.map(c => c.tool)));
  ok('an unchecked lead shows no touchpoint numbers', /^—$/.test((await cell('DEAL CO', 'touches')).trim()), await cell('DEAL CO', 'touches'));
  const exportBefore = (t.match(/Export (\d+) for Apollo/) || [])[1];

  console.log('\n== importing deals and meetings ==');
  await page.setInputFiles('input[aria-label="Import deals and meetings"]', DEALS); await sleep(900);
  t = await main();
  ok('the import reports what came in', /Imported 4 deals and meetings/.test(t) && /1 rows skipped/.test(t), (t.match(/Imported[^.]*\./) || [t.slice(0, 200)])[0]);
  ok('the button shows how many are on file', /Import deals & meetings \(4 on file\)/.test(t));
  const deal = await cell('DEAL CO', 'meetings');
  ok('matched by email: Account manager only + HubSpot deal', /Account manager only/.test(deal) && /HubSpot deal · Discovery/.test(deal), deal);
  ok('a meeting blocks every contact at the company (Nia)', /Account manager only/.test(await cell('MEETING CO', 'meetings', 0)) && /Echo meeting/.test(await cell('MEETING CO', 'meetings', 0)));
  ok('  and Sam', /Account manager only/.test(await cell('MEETING CO', 'meetings', 1)));
  ok('a won deal reads Customer, matched by domain', /Customer · AM only/.test(await cell('CUSTOMER LLC', 'meetings')), await cell('CUSTOMER LLC', 'meetings'));
  ok('a free email domain never blocks a lead', /^—$/.test((await cell('FREE CO', 'meetings')).trim()), await cell('FREE CO', 'meetings'));
  ok('a lead with no deal or meeting reads —', /^—$/.test((await cell('ACTIVE CO', 'meetings')).trim()));
  const exportAfter = (t.match(/Export (\d+) for Apollo/) || [])[1];
  ok('Account manager only leads leave the download (4 fewer)', Number(exportBefore) - Number(exportAfter) === 4, `${exportBefore} -> ${exportAfter}`);

  console.log('\n== where they stand ==');
  const standing = (await page.locator('[aria-label="Apollo standing"]').innerText()).replace(/\s+/g, ' ');
  ok('Apollo standing has an Account manager only tile with 4', /4 Account manager only/.test(standing), standing);
  // Look the rest up: none are in the fake Apollo, so without the lock they
  // would all read "Not in Apollo" and land in Needs a sequence.
  await page.locator('.data-table tbody tr', { hasText: 'ACTIVE CO' }).first().locator('input[type=checkbox]').uncheck(); await sleep(200);
  await page.locator('button', { hasText: /Check \d+ in Apollo/ }).first().click();
  await page.waitForFunction(() => /Apollo check done/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
  await nav('All leads', 'Apollo standing');
  await page.selectOption('select[aria-label="Apollo standing"]', 'needs'); await sleep(300);
  const needsRows = (await page.locator('.data-table tbody').innerText()).replace(/\s+/g, ' ');
  ok('Needs a sequence keeps a lead not in Apollo (FREE CO)', /FREE CO/.test(needsRows), needsRows.slice(0, 300));
  ok('  and leaves the Account manager only leads out', !/DEAL CO|MEETING CO|CUSTOMER LLC/.test(needsRows), needsRows.slice(0, 300));
  await page.reload(); await sleep(1300);
  await nav('All leads');
  ok('survives a reload', /Account manager only/.test(await cell('DEAL CO', 'meetings')) && /3 calls/.test(await cell('ACTIVE CO', 'touches')));
  console.log('\n== customize All leads ==');
  await nav('All leads');
  await page.locator('button', { hasText: 'Customize' }).first().click(); await sleep(200);
  const dlg = page.locator('[aria-label="Customize all leads"]');
  await dlg.locator('label', { hasText: 'Email deliverability' }).locator('input').uncheck(); await sleep(150);
  await dlg.locator('label', { hasText: /^Meetings$/ }).locator('input').uncheck(); await sleep(150);
  await page.mouse.click(5, 5); await sleep(200);
  ok('hiding a panel removes it', await page.locator('[aria-label="Email deliverability"]').count() === 0);
  const meetingsVisible = await page.locator('th[data-col="meetings"]').first().isVisible();
  ok('hiding a column hides its header', !meetingsVisible);
  ok('  and its cells', !(await page.locator('td[data-col="meetings"]').first().isVisible()));
  await page.locator('button[aria-label="Search and filters"]').click(); await sleep(200);
  ok('the arrow folds search and filters away', await page.locator('input[aria-label="Keywords in notes"]').count() === 0);
  ok('  and the folded header still says how many show', /of \d+ shown/.test(await page.locator('button[aria-label="Search and filters"]').innerText()));
  await page.reload(); await sleep(1300);
  await nav('All leads');
  ok('all three choices survive a reload',
    await page.locator('[aria-label="Email deliverability"]').count() === 0
    && !(await page.locator('th[data-col="meetings"]').first().isVisible())
    && await page.locator('input[aria-label="Keywords in notes"]').count() === 0);
  await page.locator('button[aria-label="Search and filters"]').click(); await sleep(200);
  await page.locator('button', { hasText: 'Customize' }).first().click(); await sleep(200);
  await page.locator('button', { hasText: 'Show everything' }).click(); await sleep(200);
  await page.mouse.click(5, 5); await sleep(200);
  ok('Show everything brings them back', await page.locator('[aria-label="Email deliverability"]').count() === 1
    && await page.locator('th[data-col="meetings"]').first().isVisible() && await page.locator('select[aria-label="Uploaded file"]').count() === 1);
  await nav('Diagnostics'); await sleep(500);
  const diag = await main();
  ok('Diagnostics invariants still hold', !/✗|FAIL/.test((diag.match(/Invariants.{0,1500}/) || [''])[0]), (diag.match(/Invariants.{0,600}/) || [''])[0]);
  ok('no page errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
