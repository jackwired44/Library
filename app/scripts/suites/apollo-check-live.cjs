// The live per-lead Apollo check: every Strong Signal lead looked up in
// Apollo, and where it stands (sequence, step N of M, finished + why)
// written onto the lead. Read-only against Apollo.
//
// Per Jack: "pull in apollo data for any lead here and see if they are in a
// sequence finished or where it [is]", scoped to "the contacts in the all
// leads here for strong signal only". Apollo is stood in by a fake MCP
// connector so no real account is touched; the response shapes are the
// ones rehearsed live (contacts_search, emailer_campaigns_search).
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'apollocheck-leads.csv');
fs.writeFileSync(LEADS, csv(HEAD, [
  ['ACTIVE CO','Ada Brant','IT Director','ada@active.com','312-555-0101', SIGNAL],
  ['ENDED CO','Ben Cole','CFO','ben@ended.com','312-555-0102', SIGNAL],
  ['NEW CO','Nia Rowe','CIO','nia@new.com','312-555-0103', SIGNAL],
  ['REVIEW CO','Rae Lin','CFO','rae@review.com','312-555-0104', 'Mentioned Dynamics 365 in passing.'],
]));

const FAKE = () => {
  window.__calls = [];
  const steps = [1, 2, 3, 4, 5].map(i => ({ id: 's' + i, position: i }));
  const contacts = {
    'ada@active.com': [{ name: 'Ada Brant', email: 'ada@active.com', owner_id: '68bf4ba5f68a0600194acd11', last_activity_date: '2026-10-14T18:00:00Z', created_at: '2026-09-01T00:00:00Z',
      contact_campaign_statuses: [{ emailer_campaign_id: 'seq1', status: 'active', added_at: '2026-10-01T10:00:00Z', current_step_id: 's2' }] }],
    'ben@ended.com': [{ name: 'Ben Cole', email: 'other@ended.com', contact_emails: [{ email: 'ben@ended.com' }], owner_id: '6a738903389433001cdab5da',
      contact_campaign_statuses: [{ emailer_campaign_id: 'seq1', status: 'finished', added_at: '2026-07-28T21:09:19Z', finished_at: '2026-08-11T21:37:51Z',
        inactive_reason: 'talked on phone', current_step_id: 's5', current_step_position: 5 }] }],
  };
  window.__perm = [];
  const perms = { state: async n => (window.__perm.length ? 'granted' : 'prompt'), request: async names => { window.__perm.push(names); return {}; } };
  window.claude = { use: async name => name === 'permissions' ? perms : name !== 'mcp' ? null : {
    listTools: async () => ({ servers: [{ server: 'Apollo.io', tools: [{ name: 'apollo_contacts_search' }, { name: 'apollo_emailer_campaigns_search' }] }] }),
    callTool: async (server, tool, args) => {
      window.__calls.push({ tool, args });
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { emailer_campaigns: [{ id: 'seq1', name: 'Dynamics Sequence', num_steps: 5, emailer_steps: steps }], pagination: { total_pages: 1 } } };
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
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const nav = async name => { await page.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); };
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const rowOf = async co => (await page.locator('.data-table tbody tr', { hasText: co }).first().innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(1000);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  await nav('In Apollo');
  let t = await main();
  console.log('\n== before the check ==');
  ok('the button checks Strong Signal leads only (3, not 4)', /Check 3 Strong Signal leads/.test(t), t.slice(0, 400));
  await page.locator('.vault-tile', { hasText: 'Active in a sequence' }).click(); await sleep(300); // toggle to all
  ok('unchecked leads say so', /not checked yet/.test(await rowOf('NEW CO')));
  ok('the table defaults to Strong Signal only', !(await main()).includes('REVIEW CO'));

  await page.locator('button', { hasText: /Check 3 Strong Signal leads/ }).click();
  await page.waitForFunction(() => /Checked 3 of 3/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
  await sleep(600);
  t = await main();
  const calls = await page.evaluate(() => window.__calls);
  const looked = calls.filter(c => c.tool.endsWith('contacts_search')).map(c => c.args.q_keywords);

  console.log('\n== the check ==');
  ok('one lookup per Strong Signal lead, by email', looked.length === 3 && looked.includes('ada@active.com') && !looked.includes('rae@review.com'), JSON.stringify(looked));
  ok('only read tools were called', calls.every(c => /contacts_search|emailer_campaigns_search/.test(c.tool)));
  ok('progress counts: 2 in Apollo, 1 not', /2 in Apollo · 1 not in Apollo/.test(t), t.slice(0, 500));

  console.log('\n== where each lead stands ==');
  const ada = await rowOf('ACTIVE CO');
  ok('active lead: sequence + step N of M', /Dynamics Sequence/.test(ada) && /active/.test(ada) && /step 2 of 5/.test(ada), ada);
  ok('active lead: owner + last activity shown', /owner Jack/.test(ada) && /last activity 2026-10-14/.test(ada), ada);
  const ben = await rowOf('ENDED CO');
  ok('matched on a second address on the contact', /Ended/.test(ben), ben);
  ok('finished lead: step, end date and Apollo\'s reason', /step 5 of 5/.test(ben) && /ended 2026-08-11/.test(ben) && /talked on phone/.test(ben), ben);
  const nia = await rowOf('NEW CO');
  ok('not found reads as a checked "No"', /\bNo\b/.test(nia) && /Apollo check/.test(nia), nia);

  console.log('\n== it sticks, and All leads sees it ==');
  await page.reload(); await sleep(1200);
  await nav('In Apollo');
  await page.locator('.vault-tile', { hasText: 'Active in a sequence' }).click(); await sleep(300);
  ok('survives a reload', /step 2 of 5/.test(await rowOf('ACTIVE CO')));
  ok('re-run skips leads checked this week', /Check 0 Strong Signal leads/.test(await main()));
  await nav('All leads'); await sleep(600);
  const all = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  ok('All leads shows the sequence for the checked lead', /Dynamics Sequence/.test(all), all.slice(0, 600));

  ok('downloads still include live-checked leads (all 4 exportable)', /Export 4 for Apollo/.test(all), all.match(/Export[^·]{0,40}/)?.[0]);

  console.log('\n== All leads: check one lead, a page, or everything matched ==');
  ok('with nothing selected the button covers what is left unchecked (1)', /Check 1 in Apollo/.test(all), all.match(/Check \d+ in Apollo[^·]{0,12}/)?.[0]);
  await page.locator('.data-table tbody tr', { hasText: 'REVIEW CO' }).first().locator('input[type=checkbox]').check(); await sleep(300);
  let t2 = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  ok('selecting one lead scopes the button to it', /Check 1 in Apollo \(selected\)/.test(t2), t2.match(/Check \d+ in Apollo[^·]{0,12}/)?.[0]);
  const before = (await page.evaluate(() => window.__calls)).length;
  await page.locator('button', { hasText: /Check 1 in Apollo/ }).click();
  await page.waitForFunction(() => /Apollo check done/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
  const after = await page.evaluate(() => window.__calls);
  ok('only that one lead was looked up', after.slice(before).filter(c => c.tool.endsWith('contacts_search')).map(c => c.args.q_keywords).join() === 'rae@review.com', JSON.stringify(after.slice(before)));
  ok('Apollo access is asked for before the lookup', (await page.evaluate(() => window.__perm)).some(n => n.includes('mcp:Apollo.io')));
  ok('a lead not in Apollo reads "Not found" in All leads', /Not found/.test(await rowOf('REVIEW CO')), await rowOf('REVIEW CO'));
  await page.locator('input[type=checkbox][aria-label="Select this page"]').check(); await sleep(300);
  await page.locator('label', { hasText: "Re-check this week's" }).locator('input').check(); await sleep(200);
  t2 = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  ok('select the page + re-check covers all 4', /Check 4 in Apollo \(selected\)/.test(t2), t2.match(/Check \d+ in Apollo[^·]{0,12}/)?.[0]);
  console.log('\n== the lead view ==');
  await page.locator('.data-table tbody tr', { hasText: 'ACTIVE CO' }).first().locator('td').nth(1).click(); await sleep(800);
  const dlg = (await page.locator('[role=dialog]').innerText()).replace(/\s+/g, ' ');
  ok('lead view shows sequence, step and the live check date', /Dynamics Sequence · active · step 2 of 5/.test(dlg) && /Checked live/.test(dlg), dlg.slice(0, 500));
  await page.keyboard.press('Escape'); await sleep(300);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
