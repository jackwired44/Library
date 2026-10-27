// Website visits: tag a company that visited wiredcio.com when we have a
// contact there. Per Jack: "pull website vistiors tabb from apollo in here
// with wiredcio domain and try to store it as a tag with companies if their
// company searched us and we have a contact there". Apollo is a fake
// connector here; the request shape and the "stats not found" answer were
// rehearsed live. The success payload was not observable live (no visits on
// record), so the fake returns a plausible one and the reader is defensive.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company','Full Name','Title','Email','Phone','Comments'];
const SIGNAL = 'Looking to move from Google Workspace to Microsoft 365 for 240 users and want a partner to run it.';
const LEADS = path.join(os.tmpdir(), 'webvisits-leads.csv');
fs.writeFileSync(LEADS, csv(HEAD, [
  ['VISITOR CO','Ada Brant','IT Director','ada@visitor.com','312-555-0101', SIGNAL],
  ['QUIET CO','Ben Cole','CFO','ben@quiet.com','312-555-0102', SIGNAL],
  ['UNKNOWN CO','Nia Rowe','CIO','nia@unknown.com','312-555-0103', SIGNAL],
]));

const FAKE = () => {
  window.__calls = [];
  const contacts = {
    'ada@visitor.com': [{ name: 'Ada Brant', email: 'ada@visitor.com', organization_id: 'org-visitor', contact_campaign_statuses: [] }],
    'ben@quiet.com': [{ name: 'Ben Cole', email: 'ben@quiet.com', organization_id: 'org-quiet', contact_campaign_statuses: [] }],
  };
  const perms = { state: async () => 'granted', request: async () => ({}) };
  window.claude = { use: async name => name === 'permissions' ? perms : name !== 'mcp' ? null : {
    listTools: async () => ({ servers: [{ server: 'Apollo.io', tools: [{ name: 'apollo_contacts_search' }, { name: 'apollo_emailer_campaigns_search' }, { name: 'apollo_website_visitors_domain_aggregates' }] }] }),
    callTool: async (server, tool, args) => {
      window.__calls.push({ tool, args });
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { emailer_campaigns: [], pagination: { total_pages: 1 } } };
      if (tool.endsWith('website_visitors_domain_aggregates')) {
        if (args.organization_id === 'org-visitor') return { payload: { stats: { total_visits: 7, unique_visitors: 2, top_paths: [{ path: '/services/managed-it', visits: 4 }, { path: '/contact-us', visits: 1 }] } } };
        return { payload: { error: 'stats not found' } };
      }
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
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', LEADS);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr')); await sleep(800);
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(900);

  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(700);
  ok('before an Apollo check there is no company id, so nothing to check', /Check 0 companies for site visits/.test(await main()));
  await page.locator('button', { hasText: /Check 3 in Apollo/ }).click();
  await page.waitForFunction(() => /Check 2 companies for site visits/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
  ok('after the Apollo check, the two matched companies can be checked', true);
  await page.locator('button', { hasText: /Check 2 companies for site visits/ }).click();
  await page.waitForFunction(() => /visited wiredcio\.com, \d+ did not/.test(document.querySelector('main').innerText), null, { timeout: 60000 });
  await sleep(500);
  const t = await main();
  ok('one visited, one did not', /1 visited wiredcio\.com, 1 did not/.test(t), t.slice(0, 300));
  const calls = (await page.evaluate(() => window.__calls)).filter(c => c.tool.endsWith('website_visitors_domain_aggregates'));
  ok('one report per company, on wiredcio.com, back to October 2025', calls.length === 2 && calls.every(c => c.args.domain === 'wiredcio.com' && c.args.from === '20251001'), JSON.stringify(calls.map(c => c.args)));
  ok('only read tools were called', (await page.evaluate(() => window.__calls)).every(c => /search|aggregates/.test(c.tool)));
  const row = co => page.locator('.data-table tbody tr', { hasText: co }).first();
  ok('the visiting company\'s lead carries the tag', await row('VISITOR CO').locator('[aria-label="Visited wiredcio.com"]').count() === 1);
  ok('  the quiet one does not', await row('QUIET CO').locator('[aria-label="Visited wiredcio.com"]').count() === 0);
  await page.locator('button', { hasText: /Visited wiredcio\.com \(1\)/ }).click(); await sleep(400);
  const rows = await page.locator('.data-table tbody tr').allInnerTexts();
  ok('the Visited filter narrows to that lead', rows.length === 1 && /VISITOR CO/.test(rows[0]), JSON.stringify(rows.map(r => r.slice(0, 30))));
  await row('VISITOR CO').locator('td').nth(1).click(); await sleep(800);
  const d = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok('the lead record shows the visits and pages', /visited wiredcio\.com/i.test(d) && /7 visits/.test(d) && /\/services\/managed-it/.test(d), d.slice(0, 200));
  await page.keyboard.press('Escape'); await sleep(300);
  await page.reload(); await sleep(1500);
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(700);
  ok('the tag survives a reload', /Visited wiredcio\.com \(1\)/.test(await main()));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
