// Upload -> Save & check in Apollo, in one click. Per Jack: "when i upload
// a lead list i need it to be saved to all leads than ran against in apollo
// it should be a simple workflow with a button or two to go forward". Apollo is stood in by a fake MCP
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
const LEADS = path.join(os.tmpdir(), 'uploadcheck-leads.csv');
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
  window.__saved = [];
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, data: String(data) }); } };
  window.claude = { use: async name => name === 'permissions' ? perms : name === 'downloads' ? downloads : name !== 'mcp' ? null : {
    listTools: async () => ({ servers: [{ server: 'Apollo.io', tools: [{ name: 'apollo_contacts_search' }, { name: 'apollo_emailer_campaigns_search' }] }] }),
    callTool: async (server, tool, args) => {
      window.__calls.push({ tool, args });
      if (tool.endsWith('contacts_search') && window.__rateLimitAfter != null
          && window.__calls.filter(c => c.tool.endsWith('contacts_search')).length > window.__rateLimitAfter)
        throw { code: 'tool_error', message: 'USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED: 400 contacts/search calls per hour' };
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
  const btn = page.locator('button[aria-label="Save and check in Apollo"]');
  ok('the scanner offers Save & check in Apollo', await btn.count() === 1 && /4 rows & check in Apollo/.test(await btn.innerText()), await btn.innerText().catch(() => ''));
  ok('  beside a plain Save only', await page.locator('button[aria-label="Save to platform"]', { hasText: 'Save only' }).count() === 1);
  await btn.click();
  await page.waitForFunction(() => /Apollo check done for/.test(document.querySelector('[aria-label="Upload Apollo check"]')?.textContent || ''), null, { timeout: 60000 });
  let s = (await page.locator('[aria-label="Upload Apollo check"]').innerText()).replace(/\s+/g, ' ');
  ok('one click saves and checks every lead in the upload', /4 of 4/.test(s), s);
  ok('  and says how many were found in Apollo', /2 in Apollo · 2 not in Apollo/.test(s), s);
  const looked = await page.evaluate(() => window.__calls.filter(c => c.tool.endsWith('contacts_search')).map(c => c.args.q_keywords));
  ok('  Strong Signal leads are looked up first', looked.slice(0, 3).every(e => /active|ended|new/.test(e)) && /review/.test(looked[3] || ''), JSON.stringify(looked));
  ok('  only read tools were called', (await page.evaluate(() => window.__calls.map(c => c.tool))).every(t => /search/.test(t)));
  await nav('All leads');
  ok('the leads are stored in All leads', /4 leads stored/.test(await main()), (await main()).slice(0, 200));
  ok('  the strip follows you to other views', await page.locator('[aria-label="Upload Apollo check"]').count() === 1);
  let t = await main();
  ok('  and All leads shows them all checked', /4 of 4 leads checked against Apollo/.test(t), t.slice(0, 500));
  ok('  with where each stands', /1 Active in a sequence/.test(t) && /1 Sequence ended, reached/.test(t) && /2 Not in Apollo/.test(t), t.slice(0, 600));
  await page.locator('[aria-label="Upload Apollo check"] button', { hasText: 'See where they stand' }).click(); await sleep(800);
  ok('"See where they stand" opens In Apollo', /Whether each lead here is in Apollo/.test(await main()));

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
