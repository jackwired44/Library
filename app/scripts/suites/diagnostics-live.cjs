// Diagnostics: every count checked against every other, and the gaps.
// Per Jack: "make sure a diagnostic is ran so i can see where
// inefficiencies are … numericals to match and be mapped properly".
// (Fixture shared with upload-check-live.) Upload -> Save & check in Apollo, in one click. Per Jack: "when i upload
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
const LEADS = path.join(os.tmpdir(), 'diag-leads.csv');
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
  // Downloads go straight through; the name box is tested in download-name-live.
  await page.addInitScript(() => { try { localStorage.setItem('askFileName', '0'); } catch { /* ignore */ } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const nav = async name => { const inApollo = name === 'In Apollo'; await page.locator('.side-nav-btn', { hasText: inApollo ? 'All leads' : name }).first().click(); await sleep(400); if (inApollo) await page.locator('.seg-btn', { hasText: 'Apollo standing' }).first().click(); await sleep(600); await page.evaluate(() => document.querySelectorAll('details.fold').forEach((d) => { d.open = true; })); await sleep(100); };
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const rowOf = async co => (await page.locator('.data-table tbody tr', { hasText: co }).first().innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await nav('Main Scanner');
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await sleep(800);
  await page.locator('button[aria-label="Save to platform"]', { hasText: 'Save only' }).click(); await sleep(900);

  console.log('\n== before any Apollo check ==');
  await page.locator('button[aria-label="Diagnostics"]').click(); await sleep(900);
  let t = await main();
  ok('Diagnostics opens from the sidebar', /Diagnostics/.test(t) && /over 4 leads/.test(t), t.slice(0, 300));
  ok('  every check passes on clean data', /All \d+ checks pass — the numbers match/.test(t), t.slice(0, 900));
  const gap = async id => (await page.locator(`tr[data-gap="${id}"]`).innerText()).replace(/\s+/g, ' ');
  ok('  the gap for Strong Signal never checked counts all 3', /\b3\b.*100% of 3/.test(await gap('strong-unchecked')), await gap('strong-unchecked'));
  ok('  and the any-tier unchecked gap counts all 4', /\b4\b.*100% of 4/.test(await gap('unchecked')), await gap('unchecked'));
  const fh = (await page.locator('[aria-label="File health"]').innerText()).replace(/\s+/g, ' ');
  ok('  the file table lists the upload', /diag-leads\.csv 4 3 0/.test(fh), fh);

  console.log('\n== after a check, the numbers move together ==');
  await page.locator('.side-nav-btn', { hasText: 'Home' }).first().click(); await sleep(700);
  await page.locator('button', { hasText: /^Check next 4$/ }).first().click();
  await page.waitForFunction(() => /Done:/.test(document.querySelector('[aria-label="Apollo check progress"]')?.textContent || ''), null, { timeout: 60000 });
  await page.locator('button[aria-label="Diagnostics"]').click(); await sleep(900);
  t = await main();
  ok('  every check still passes', /All \d+ checks pass/.test(t), t.slice(0, 900));
  ok('  Strong Signal unchecked drops to 0', /^\S+ Strong Signal leads never checked against Apollo .* 0 /.test(await gap('strong-unchecked')), await gap('strong-unchecked'));
  ok('  and 1 Strong Signal lead needs a sequence (the one not in Apollo; the ended one was reached)', /\b1\b.*33% of 3/.test(await gap('strong-needs')), await gap('strong-needs'));
  const st = (await page.locator('[aria-label="Apollo standing totals"]').innerText()).replace(/\s+/g, ' ');
  ok('  standing totals match In Apollo', /1 Active in a sequence/.test(st) && /1 Sequence ended, reached/.test(st) && /2 Not in Apollo/.test(st), st);
  await page.locator(`tr[data-gap="strong-needs"] button`).click(); await sleep(700);
  ok('  a gap\'s Fix button opens the view that fixes it', /Whether each lead here is in Apollo/.test(await main()));

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
