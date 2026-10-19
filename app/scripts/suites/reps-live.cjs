// Reps: Carly's and Jack's assigned leads, where they stand, where they went.
// Per Jack: "build a table for all of carlys leads and jacks", "want her to
// have access to her assigned leads and see where they all stand whats
// active high level view like a dash or chart of where it went".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'reps-leads.csv');
fs.writeFileSync(LEADS, csv(['Company', 'Full Name', 'Title', 'Email', 'Phone', 'Comments'], [
  ['C ACTIVE', 'Cara Active', 'CIO', 'cara@cactive.com', '312-555-0101', SIGNAL],
  ['C MEET', 'Cole Meet', 'CFO', 'cole@cmeet.com', '312-555-0102', SIGNAL],
  ['C OWNER', 'Cass Owner', 'COO', 'cass@cowner.com', '312-555-0103', SIGNAL],
  ['J DONE', 'Jo Done', 'CEO', 'jo@jdone.com', '312-555-0104', SIGNAL],
  ['NOBODY', 'Ned Body', 'Owner', 'ned@nobody.com', '312-555-0105', SIGNAL],
]));

const FAKE = () => {
  window.__calls = [];
  const ago = n => new Date(Date.now() - n * 86400000).toISOString();
  const NA = 'o-na', MB = 'o-mb';
  const facets = [{ value: NA, display_name: 'No Answer' }, { value: MB, display_name: 'Meeting Booked' }];
  const C = { id: 'carly-seq', name: 'Carly Main Sequence' }, J = { id: 'jack-seq', name: 'Jack Main Sequence' }, G = { id: 'gen', name: 'Wired CIO Email' };
  const contacts = {
    'cara@cactive.com': { id: 'c1', camps: [[C, 'active', 2]] },
    'cole@cmeet.com': { id: 'c2', camps: [[C, 'finished', 5]] },
    'cass@cowner.com': { id: 'c3', owner_id: '6a738903389433001cdab5da', camps: [[G, 'finished', 3]] },
    'jo@jdone.com': { id: 'c4', camps: [[J, 'finished', 5]] },
  };
  const calls = [
    { contact_id: 'c1', start_time: ago(3), phone_call_outcome_id: NA },
    { contact_id: 'c2', start_time: ago(9), phone_call_outcome_id: NA }, { contact_id: 'c2', start_time: ago(6), phone_call_outcome_id: MB },
    { contact_id: 'c4', start_time: ago(50), phone_call_outcome_id: NA }, { contact_id: 'c4', start_time: ago(45), phone_call_outcome_id: NA }, { contact_id: 'c4', start_time: ago(40), phone_call_outcome_id: NA },
  ];
  const perms = { state: async () => 'granted', request: async () => ({}) };
  const downloads = { save: async (f) => { window.__saved = f; } };
  window.claude = { use: async name => name === 'permissions' ? perms : name === 'downloads' ? downloads : name !== 'mcp' ? null : {
    listTools: async () => ({ servers: [{ server: 'Apollo.io', tools: [
      { name: 'apollo_contacts_search' }, { name: 'apollo_emailer_campaigns_search' }, { name: 'apollo_phone_calls_search' }, { name: 'apollo_emailer_messages_search' }] }] }),
    callTool: async (server, tool, args) => {
      window.__calls.push({ tool, args });
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { emailer_campaigns: [C, J, G].map(x => ({ ...x, num_steps: 5, emailer_steps: [] })), pagination: { total_pages: 1 } } };
      if (tool.endsWith('phone_calls_search')) { const l = calls.filter(c => c.contact_id === args.contact_id); return { payload: { phone_calls: l, pagination: { total_entries: l.length }, faceting: { phone_call_stats_facets: facets } } }; }
      if (tool.endsWith('emailer_messages_search')) return { payload: { emailer_messages: [] } };
      const c = contacts[args.q_keywords];
      if (!c) return { payload: { contacts: [] } };
      return { payload: { contacts: [{ id: c.id, email: args.q_keywords, owner_id: c.owner_id, contact_campaign_statuses: c.camps.map(([s, st, step]) => ({ emailer_campaign_id: s.id, status: st, added_at: ago(60), current_step_position: step })) }] } };
    },
  } };
};

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1700, height: 1000 } });
  await ctx.addInitScript(FAKE);
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('skipFileNameBox', '1'); } catch { /* ignore */ } });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const nav = async (name, sub) => {
    await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(500);
    if (sub) { await page.locator('.seg-btn', { hasText: sub }).first().click(); await sleep(500); }
  };
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const row = async (name) => (await page.locator('table[aria-label="Reps summary"] tbody tr', { hasText: name }).first().innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(800);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await nav('All leads', 'Leads');
  await page.locator('button', { hasText: /Check \d+ in Apollo/ }).first().click();
  await page.waitForFunction(() => /Apollo check done/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
  await sleep(500);

  console.log('\n== summary table ==');
  await nav('Reps');
  ok('Reps page is in the sidebar and opens', /Reps/.test(await main()) && await page.locator('table[aria-label="Reps summary"]').count() === 1);
  const carly = await row('Carly');
  ok('Carly: 3 leads (2 by sequence name, 1 by contact owner)', /^Carly 3 /.test(carly), carly);
  ok('  1 active now, 1 meeting', /^Carly 3 3 1 \d+ \d+ 1 /.test(carly), carly);
  const jack = await row('Jack');
  ok('Jack: 1 lead, finished with no contact', /^Jack 1 1 0 1 0 0 /.test(jack), jack);
  ok('Unassigned: the lead with no sequence or owner', /^Unassigned 1 /.test(await row('Unassigned')), await row('Unassigned'));
  ok('Jack has 1 ready to recycle (3 unanswered, 40 days ago)', / 1$/.test(jack), jack);

  console.log("\n== Carly's dashboard ==");
  let t = await main();
  ok('opens on Carly', /Where Carly's leads went/.test(t));
  const went = (await page.locator('[aria-label="Where the leads went"]').innerText()).replace(/\s+/g, ' ');
  ok('where they went: 3 assigned → 3 in a sequence → 2 called → 1 reached → 1 meeting', /Assigned 3 100%/.test(went) && /Put in a sequence 3 100%/.test(went) && /Called 2 67%/.test(went) && /Reached someone 1 33%/.test(went) && /Meeting booked 1 33%/.test(went), went);
  const stand = (await page.locator('[aria-label="Where they stand now"]').innerText()).replace(/\s+/g, ' ');
  ok('where they stand: In sequence, Meeting booked, finished', /In sequence 1/.test(stand) && /Meeting booked 1/.test(stand) && /Sequence finished 1/.test(stand), stand);
  const seqT = (await page.locator('table[aria-label="By sequence"]').innerText()).replace(/\s+/g, ' ');
  ok('by sequence: Carly Main Sequence 2 leads, 1 active, 1 reached, 1 meeting', /Carly Main Sequence — 0 0 2 1 1 1/.test(seqT), seqT);
  ok('  her contact-owner lead shows its sequence too', /Wired CIO Email — 0 0 1 /.test(seqT), seqT);
  ok("  every sequence named for Carly is listed, even with no leads", /Carly Main Sequence Recycled — 0 0 0 0 0 0/.test(seqT), seqT);
  ok("  Jack's sequences are not on Carly's page", !/Jack Main/.test(seqT), seqT);
  ok('  the main sequence order leads (Recycled first)', seqT.indexOf('Carly Main Sequence Recycled') < seqT.indexOf('Carly Main Sequence —'), seqT);
  await page.locator('table[aria-label="By sequence"] tbody tr', { hasText: 'Wired CIO Email' }).click(); await sleep(300);
  const bySeq = (await page.locator(`table[aria-label="Carly's leads"] tbody`).innerText()).replace(/\s+/g, ' ');
  ok('clicking a sequence filters her lead table to it', /C OWNER/.test(bySeq) && !/C ACTIVE/.test(bySeq), bySeq);
  await page.locator('button[aria-label="Clear sequence filter"]').click(); await sleep(300);
  const leadsT = (await page.locator(`table[aria-label="Carly's leads"]`).innerText()).replace(/\s+/g, ' ');
  ok("her lead table: her 3, not Jack's", /C ACTIVE/.test(leadsT) && /C MEET/.test(leadsT) && /C OWNER/.test(leadsT) && !/J DONE/.test(leadsT), leadsT.slice(0, 300));
  ok('  the active one shows its step', /Carly Main Sequence · step 2 of 5/.test(leadsT), leadsT);

  await page.locator('[aria-label="Where they stand now"] button', { hasText: 'In sequence' }).click(); await sleep(300);
  const filtered = (await page.locator(`table[aria-label="Carly's leads"] tbody`).innerText()).replace(/\s+/g, ' ');
  ok('clicking a bar filters her table', /C ACTIVE/.test(filtered) && !/C MEET/.test(filtered), filtered);
  await page.locator('button', { hasText: /Download 1/ }).click(); await sleep(600);
  const saved = await page.evaluate(() => window.__saved);
  ok('download carries rep and where it stands', !!saved && /carly-leads-/.test(saved.filename) && /Carly,Cara,Active/.test(saved.data) && /In sequence/.test(saved.data), saved && saved.data.slice(0, 300));

  console.log('\n== switching ==');
  await page.locator('[aria-label="Rep"] .seg-btn', { hasText: 'Jack' }).click(); await sleep(300);
  t = await main();
  ok("Jack's page", /Where Jack's leads went/.test(t) && /J DONE/.test(t) && !/C ACTIVE/.test((await page.locator(`table[aria-label="Jack's leads"]`).innerText())));
  const jSeq = (await page.locator('table[aria-label="By sequence"]').innerText()).replace(/\s+/g, ' ');
  ok("Jack's sequences: Main and Main Backup, no Carly", /Jack Main Sequence — 0 0 1 /.test(jSeq) && /Jack Main Backup Sequence — 0 0 0/.test(jSeq) && !/Carly/.test(jSeq), jSeq);
  await page.reload(); await sleep(1500); await nav('Reps');
  ok('remembers the last rep', /Where Jack's leads went/.test(await main()));
  const writes = (await page.evaluate(() => window.__calls)).filter(c => !/_search$/.test(c.tool));
  ok('nothing written to Apollo', writes.length === 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
