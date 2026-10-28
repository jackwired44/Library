// Lists: run a list against Apollo. Per Jack: "in the lists tab i need to be
// able to run these against" Apollo. Each list gets a read-only "Check in
// Apollo" button (same run as Save & check), an Apollo column with the
// sequence and step, a summary on the list header, and a "Ready for a
// sequence only" filter the download follows. Apollo is a fake connector
// with the shapes rehearsed live; nothing is written to it.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'listapollo-leads.csv');
const GHOST = path.join(os.tmpdir(), 'listapollo-ghost.csv');
fs.writeFileSync(LEADS, csv(HEAD, [
  ['ACTIVE CO','Ada Brant','IT Director','ada@active.com','312-555-0101', SIGNAL],
  ['ENDED CO','Ben Cole','CFO','ben@ended.com','312-555-0102', SIGNAL],
  ['NEW CO','Nia Rowe','CIO','nia@new.com','312-555-0103', SIGNAL],
]));
fs.writeFileSync(GHOST, csv(HEAD, [['GHOST CO','Gus Hale','CIO','gus@ghost.com','312-555-0109', SIGNAL]]));

const FAKE = () => {
  window.__calls = [];
  const steps = [1, 2, 3, 4, 5].map(i => ({ id: 's' + i, position: i }));
  const contacts = {
    'ada@active.com': [{ name: 'Ada Brant', email: 'ada@active.com', contact_campaign_statuses: [{ emailer_campaign_id: 'seq1', status: 'active', added_at: '2026-10-01T10:00:00Z', current_step_id: 's2' }] }],
    'ben@ended.com': [{ name: 'Ben Cole', email: 'ben@ended.com', contact_campaign_statuses: [{ emailer_campaign_id: 'seq1', status: 'finished', added_at: '2026-07-28T21:09:19Z', finished_at: '2026-08-11T21:37:51Z', inactive_reason: 'talked on phone', current_step_id: 's5' }] }],
  };
  const perms = { state: async () => 'granted', request: async () => ({}) };
  window.__saved = [];
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, data: String(data) }); } };
  window.claude = { use: async name => name === 'permissions' ? perms : name === 'downloads' ? downloads : name !== 'mcp' ? null : {
    listTools: async () => ({ servers: [{ server: 'Apollo.io', tools: [{ name: 'apollo_contacts_search' }, { name: 'apollo_emailer_campaigns_search' }] }] }),
    callTool: async (server, tool, args) => {
      window.__calls.push({ tool, args });
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { emailer_campaigns: [{ id: 'seq1', name: 'Jack Main Sequence', num_steps: 5, emailer_steps: steps }], pagination: { total_pages: 1 } } };
      return { payload: { contacts: contacts[args.q_keywords] || [] } };
    },
  } };
};

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
  await ctx.addInitScript(FAKE);
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('skipFileNameBox', '1'); } catch { /* ignore */ } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(60000);
  const nav = async name => { await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); };
  const card = () => page.locator('[aria-label="List Call list"]');
  const rowOf = async co => (await card().locator('tbody tr', { hasText: co }).first().innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  // Three leads saved to All leads and put on a list, plus one from an
  // upload that is never saved.
  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 60000 });
  await sleep(800);
  const strip = page.locator('[role=group][aria-label="Add to list"]');
  await strip.locator('select').selectOption('__new__');
  await strip.locator('input[aria-label="New list name"]').fill('Call list');
  await strip.locator('button').click(); await sleep(500);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);
  await page.locator('button:has-text("Start over")').first().click(); await sleep(800);
  await page.setInputFiles('input[type=file]', GHOST);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 60000 });
  await sleep(800);
  const listId = await strip.locator('select option', { hasText: 'Call list' }).getAttribute('value');
  await strip.locator('select').selectOption(listId);
  await strip.locator('button').click(); await sleep(500);

  await nav('Lists');
  console.log('\n== before the check ==');
  let head = (await card().innerText()).replace(/\s+/g, ' ');
  ok('the list header sums up where its leads stand', /Apollo: 3 not checked · 1 not in All leads/.test(head), head.slice(0, 300));
  const btn = card().locator('button[aria-label="Check Call list in Apollo"]');
  ok('a Check in Apollo button counts the stored leads due (3)', /Check in Apollo \(3\)/.test(await btn.innerText()), await btn.innerText());
  await card().locator('button[title="Expand"]').click(); await sleep(300);
  ok('a row not saved in All leads says so', /Not stored/.test(await rowOf('GHOST CO')));
  ok('stored rows read Not checked', /Not checked/.test(await rowOf('NEW CO')));

  await btn.click();
  await page.waitForFunction(() => /Apollo check done for list "Call list"/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
  await sleep(800);
  const calls = await page.evaluate(() => window.__calls);
  const looked = calls.filter(c => c.tool.endsWith('contacts_search')).map(c => c.args.q_keywords);
  console.log('\n== the check ==');
  ok('the progress strip names the list', true);
  ok('one lookup per stored lead on the list, none for the unsaved row', looked.length === 3 && !looked.includes('gus@ghost.com'), JSON.stringify(looked));
  ok('only read tools were called', calls.every(c => /contacts_search|emailer_campaigns_search/.test(c.tool)));

  console.log('\n== where each list lead stands ==');
  const ada = await rowOf('ACTIVE CO');
  ok('active lead: Active, sequence and step', /Active/.test(ada) && /Jack Main Sequence/.test(ada) && /step 2 of 5/.test(ada), ada);
  const ben = await rowOf('ENDED CO');
  ok('ended after a conversation: reached, with Apollo\'s reason', /reached/i.test(ben) && /talked on phone/.test(ben), ben);
  ok('not found: Not in Apollo', /Not in Apollo/.test(await rowOf('NEW CO')));
  head = (await card().innerText()).replace(/\s+/g, ' ');
  ok('the summary updates: 1 ready, 1 active, 1 reached, 1 not stored', /1 ready for a sequence/.test(head) && /1 active/.test(head) && /1 ended · reached/.test(head) && /1 not in All leads/.test(head), head.slice(0, 300));
  ok('checked this week: the button has nothing due', await btn.isDisabled());

  console.log('\n== ready for a sequence only ==');
  await card().locator('input[aria-label="Ready for a sequence only in Call list"]').check(); await sleep(300);
  const rows = await card().locator('tbody tr').allInnerTexts();
  ok('only the lead ready for a sequence shows', rows.length === 1 && /NEW CO/.test(rows[0]), rows.join(' | '));
  ok('the download follows it', /Download CSV \(1 ready\)/.test(await card().innerText()));
  await card().locator('button', { hasText: 'Download CSV' }).click(); await sleep(600);
  const text = (await page.evaluate(() => window.__saved.map(x => x.data).join('\n')));
  ok('the downloaded CSV holds just that lead', /NEW CO/.test(text) && !/ACTIVE CO|ENDED CO|GHOST CO/.test(text), text.slice(0, 200));
  await card().locator('input[aria-label="Ready for a sequence only in Call list"]').uncheck(); await sleep(300);
  ok('unticking shows every row again', (await card().locator('tbody tr').count()) === 4);

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(fail ? 'list-apollo-live FAIL' : `list-apollo-live PASS ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
