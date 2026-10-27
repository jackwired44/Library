// The recycle queue, end to end in a browser. Per Jack: "see when a lead
// that hasnt been contacted should be recontacted after x amount of
// unanswered attempts so i can recycle it down the road", and "itll sit in
// a queue where i can then re download those ones and assign them to a
// sequence in apollo … unless i can just build a manageable workflow here
// that i can see".
//
// Apollo is a fake connector shaped like the real responses. After the
// download, __resequenced flips and the next check shows the lead in a live
// sequence again, which is what closes the loop.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'recycle-leads.csv');
fs.writeFileSync(LEADS, csv(['Company', 'Full Name', 'Title', 'Email', 'Phone', 'Comments'], [
  ['READY CO', 'Rae Dunn', 'IT Director', 'rae@readyco.com', '312-555-0101', SIGNAL],
  ['REST CO', 'Ross Tate', 'CFO', 'ross@restco.com', '312-555-0102', SIGNAL],
  ['FEW CO', 'Faye Wu', 'CIO', 'faye@fewco.com', '312-555-0103', SIGNAL],
  ['NOPE CO', 'Nora Pike', 'COO', 'nora@nopeco.com', '312-555-0104', SIGNAL],
  ['DNC CO', 'Dan Cole', 'CEO', 'dan@dncco.com', '312-555-0105', SIGNAL],
  ['FRESH CO', 'Fred Shaw', 'Owner', 'fred@freshco.com', '312-555-0106', SIGNAL],
]));

const FAKE = () => {
  window.__calls = []; window.__resequenced = false;
  const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
  const NA = 'o-na', VM = 'o-vm', NI = 'o-ni', DNC = 'o-dnc';
  const facets = [{ value: NA, display_name: 'No Answer' }, { value: VM, display_name: 'Left Voicemail' }, { value: NI, display_name: 'Not Interested' }, { value: DNC, display_name: 'Do Not Contact' }];
  const ids = { 'rae@readyco.com': 'c-rae', 'ross@restco.com': 'c-ross', 'faye@fewco.com': 'c-faye', 'nora@nopeco.com': 'c-nora', 'dan@dncco.com': 'c-dan' };
  const call = (id, d, o) => ({ contact_id: id, start_time: daysAgo(d), phone_call_outcome_id: o, caller_name: 'Carly Parks' });
  const calls = [
    call('c-rae', 40, NA), call('c-rae', 35, VM), call('c-rae', 30, NA),
    call('c-ross', 12, NA), call('c-ross', 8, NA), call('c-ross', 5, VM),
    call('c-faye', 30, NA),
    call('c-nora', 210, NI),
    call('c-dan', 90, NA), call('c-dan', 80, DNC),
  ];
  const perms = { state: async () => 'granted', request: async () => ({}) };
  const downloads = { save: async (f) => { window.__saved = f; } };
  window.claude = { use: async name => name === 'permissions' ? perms : name === 'downloads' ? downloads : name !== 'mcp' ? null : {
    listTools: async () => ({ servers: [{ server: 'Apollo.io', tools: [
      { name: 'apollo_contacts_search' }, { name: 'apollo_emailer_campaigns_search' }, { name: 'apollo_phone_calls_search' }, { name: 'apollo_emailer_messages_search' }] }] }),
    callTool: async (server, tool, args) => {
      window.__calls.push({ tool, args });
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { emailer_campaigns: [{ id: 'seq1', name: 'Carly Main Sequence', num_steps: 5, emailer_steps: [] }], pagination: { total_pages: 1 } } };
      if (tool.endsWith('phone_calls_search')) {
        const list = calls.filter(c => c.contact_id === args.contact_id);
        return { payload: { phone_calls: list, pagination: { total_entries: list.length }, faceting: { phone_call_stats_facets: facets } } };
      }
      if (tool.endsWith('emailer_messages_search')) return { payload: { emailer_messages: [] } };
      const id = ids[args.q_keywords];
      if (!id) return { payload: { contacts: [] } };
      const status = id === 'c-rae' && window.__resequenced ? 'active' : 'finished';
      return { payload: { contacts: [{ id, email: args.q_keywords, contact_campaign_statuses: [{ emailer_campaign_id: 'seq1', status, added_at: daysAgo(45) }] }] } };
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
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const nav = async (name, sub) => {
    await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(500);
    if (sub) { await page.locator('.seg-btn', { hasText: sub }).first().click(); await sleep(500); }
  };
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const tile = async (label) => (await page.locator('[aria-label="Recycle workflow"] .vault-tile', { hasText: label }).first().innerText()).replace(/\s+/g, ' ');
  const checkAll = async (recheck = false) => {
    await nav('All leads', 'Leads');
    if (recheck) { await page.locator('label', { hasText: "Re-check this week's" }).locator('input[type=checkbox]').check(); await sleep(300); }
    await page.locator('button', { hasText: /Check \d+ in Apollo/ }).first().click();
    await page.waitForFunction(() => /Apollo check done/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
    await sleep(500);
  };

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(800);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  console.log('\n== before any Apollo check ==');
  await nav('All leads', 'Recycle');
  let t = await main();
  ok('Recycle tab shows the rules in words', /22 days after its Apollo sequence ended with no reply/.test(t) && /3\+ unanswered calls/.test(t) && /after 6 months/.test(t), t.slice(0, 300));
  const chk = page.locator('[aria-label="Check for recycling"]');
  ok('Recycle has its own Check in Apollo button for the 6 not checked', /6 not checked in the last 7 days/.test(await chk.innerText()) && /Check 6 in Apollo/.test(await chk.locator('button').innerText()), await chk.innerText());
  ok('nothing is guessed: all 6 are Not checked', /Not checked: 6/.test(t), (t.match(/Not checked: \d+/) || [''])[0]);

  await checkAll();
  console.log('\n== after the Apollo check ==');
  const recCell = async (co) => (await page.locator('.data-table tbody tr', { hasText: co }).first().locator('td[data-col="recycle"]').innerText()).replace(/\s+/g, ' ');
  ok('All leads has a Recycle column', /Ready to recycle/.test(await recCell('READY CO')), await recCell('READY CO'));
  ok('  resting shows when it comes back', /Resting/.test(await recCell('REST CO')) && /Recycle on .*in 17d/.test(await recCell('REST CO')), await recCell('REST CO'));
  // Per Jack's "Both" rule: one unanswered call, but its sequence ended with
  // no reply 30 days ago, so it is ready for a new one.
  ok('  one call, sequence ended with no reply: Ready', /Ready to recycle/.test(await recCell('FEW CO')), await recCell('FEW CO'));

  // Per Jack: "a straight forward filter option in all leads to never
  // reached or never contacted, contacted not interested, meeting was
  // booked/ongoing conversations or next steps are fully set".
  const where = (await page.locator('[aria-label="Where it stands"]').innerText()).replace(/\s+/g, ' ');
  ok('Where it stands: 4 have not gone anywhere, 2 not interested (one do not contact)', /Hasn't gone anywhere \(4\)/.test(where) && /Not interested \(2\)/.test(where) && /In a sequence now \(0\)/.test(where), where);
  await page.locator('[aria-label="Where it stands"] button', { hasText: "Hasn't gone anywhere" }).click(); await sleep(400);
  const nowhere = (await page.locator('.data-table tbody').first().innerText()).replace(/\s+/g, ' ');
  ok('  clicking it shows only those four', /READY CO/.test(nowhere) && /FRESH CO/.test(nowhere) && !/NOPE CO/.test(nowhere) && !/DNC CO/.test(nowhere), nowhere.slice(0, 300));
  await page.locator('[aria-label="Where it stands"] button', { hasText: 'All' }).click(); await sleep(300);

  await nav('All leads', 'Recycle');
  t = await main();
  ok('Ready: 3 (3 unanswered, sequence ended, Not interested 7 months ago)', /^3 Ready to recycle/.test(await tile('Ready to recycle')), await tile('Ready to recycle'));
  ok('Resting: 1', /^1 Resting/.test(await tile('Resting')));
  ok('Do not contact is never recycled', /Not recycled: 1/.test(t));
  ok('a lead checked and not in Apollo reads Never sequenced, not Ready', /Never sequenced: 1/.test(t) && /Not checked: 0/.test(t), (t.match(/Never sequenced: \d+|Not checked: \d+/g) || []).join(' '));
  ok('sub-tab label carries the ready count', /Recycle \(3 ready\)/.test(t));
  const ready = (await page.locator('table[aria-label="Recycle queue"] tbody').innerText()).replace(/\s+/g, ' ');
  ok('Ready rows: READY CO with 3 unanswered, NOPE CO not interested', /READY CO/.test(ready) && /NOPE CO/.test(ready) && /FEW CO/.test(ready) && /Sequence ended, 1 unanswered/.test(ready) && /Not interested/.test(ready) && !/REST CO/.test(ready), ready);

  console.log('\n== download for Apollo ==');
  await page.locator('table[aria-label="Recycle queue"] tbody tr', { hasText: 'READY CO' }).locator('input[type=checkbox]').check();
  await page.locator('button', { hasText: /Download for Apollo 1 selected/ }).click(); await sleep(800);
  const saved = await page.evaluate(() => window.__saved);
  const text = saved ? (typeof saved.data === 'string' ? saved.data : '') : '';
  ok('a CSV was handed over', !!saved && /recycle-/.test(saved.filename), JSON.stringify(saved && saved.filename));
  ok('  shaped for an Apollo import: email, previous sequence, attempts', /First Name,Last Name,Email/.test(text) && /rae@readyco.com/.test(text) && /Carly Main Sequence/.test(text) && /3 unanswered attempts/.test(text), text.slice(0, 400));
  t = await main();
  ok('the notice says what to do next', /Load the file into Apollo/.test(t));
  ok('Ready 3 → 2, Downloaded 1', /^2 Ready/.test(await tile('Ready to recycle')) && /^1 Downloaded/.test(await tile('Downloaded')));

  console.log('\n== Back in a sequence, confirmed by Apollo ==');
  await page.evaluate(() => { window.__resequenced = true; });
  await checkAll(true);
  await nav('All leads', 'Recycle');
  await nav('All leads', 'Leads');
  ok('re-sequenced lead now reads In a sequence now, not Hasn\'t gone anywhere', /In a sequence now \(1\)/.test(await page.locator('[aria-label="Where it stands"]').innerText()) && /Hasn't gone anywhere \(3\)/.test(await page.locator('[aria-label="Where it stands"]').innerText()), await page.locator('[aria-label="Where it stands"]').innerText());
  await nav('All leads', 'Recycle');
  ok('the next check moves it to Back in a sequence', /^1 Back in a sequence/.test(await tile('Back in a sequence')) && /^0 Downloaded/.test(await tile('Downloaded')), await tile('Back in a sequence'));
  const writes = (await page.evaluate(() => window.__calls)).filter(c => !/_search$/.test(c.tool));
  ok('nothing written to Apollo', writes.length === 0, JSON.stringify(writes));

  console.log('\n== rules ==');
  await page.locator('button', { hasText: 'Rules' }).click(); await sleep(200);
  await page.fill('input[aria-label="Rest after last attempt"]', '5');
  await page.locator('input[aria-label="Rest after last attempt"]').press('Enter'); await sleep(400);
  ok('a 5-day rest moves REST CO to Ready', /^3 Ready/.test(await tile('Ready to recycle')), await tile('Ready to recycle'));
  await page.reload(); await sleep(1500);
  await nav('All leads', 'Recycle');
  ok('rules survive a reload', /5 days after its Apollo sequence ended/.test(await main()));
  await page.locator('button', { hasText: 'Rules' }).click(); await sleep(200);
  await page.fill('input[aria-label="Rest after last attempt"]', '0');
  await page.locator('input[aria-label="Rest after last attempt"]').press('Enter'); await sleep(300);
  ok('a 0 is ignored, not saved', /5 days after its Apollo sequence ended/.test(await main()));

  console.log('\n== Home ==');
  await nav('Home');
  t = await main();
  ok('Home shows Ready to recycle', /Ready to recycle/.test(t) && /Recycling later this month/.test(t));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
