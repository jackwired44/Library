// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
//
// Follow-ups tab end to end, with window.claude mocked at the runtime
// boundary (Apollo calls/users, Outlook create_draft, and `sample`), in the
// exact shapes observed from the live connectors. Synthetic data only.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK = () => {
  const now = Date.now();
  const iso = (hoursAgo) => new Date(now - hoursAgo * 3600e3).toISOString();
  const contact = (id, first, last, company, email) => ({ id, first_name: first, last_name: last, name: `${first} ${last}`, title: 'Controller', organization_name: company, email, time_zone: 'America/Chicago', typed_custom_fields: { '68abe2198cb839001d7d67c3': 'Wants Business Central (40 users).' } });
  const SUM = 'Jack reached Dana, who is evaluating NetSuite and Business Central to replace Dynamics SL. Dana is looking to improve inventory reporting. She requested a follow-up email and suggested reconnecting after her NetSuite demo.';
  const page1 = [
    { id: 'c1', user_id: 'u-jack', contact_id: 'p1', phone_call_outcome_id: 'o-info', start_time: iso(1), note_text: SUM + '\nCalled +13125550100 (MOBILE). Recording: https://app.trellus.ai/transcripts?id=aaa', caller_name: 'Jack Test', contact: contact('p1', 'Dana', 'Reed', 'Acme Mfg', 'dana@acmemfg.com') },
    { id: 'c2', user_id: 'u-jack', contact_id: 'p2', phone_call_outcome_id: 'o-na', start_time: iso(2), note_text: 'Called +13125550101 (WORK). Recording: https://app.trellus.ai/transcripts?id=bbb', caller_name: 'Jack Test', contact: contact('p2', 'Omar', 'Lee', 'Birch Co', 'omar@birch.co') },
    { id: 'c3', user_id: 'u-jack', contact_id: 'p3', phone_call_outcome_id: 'o-info', start_time: iso(30), note_text: 'Called +13125550102 (WORK). Recording: https://app.trellus.ai/transcripts?id=ccc', caller_name: 'Jack Test', contact: contact('p3', 'Priya', 'Shah', 'Cedar LLC', 'priya@cedar.io') },
  ];
  const page2 = [
    { id: 'c4', user_id: 'u-jack', contact_id: 'p4', phone_call_outcome_id: 'o-info', start_time: iso(24 * 40), note_text: 'Old call', contact: contact('p4', 'Old', 'Lead', 'Old Co', 'old@old.co') },
  ];
  const facets = [
    { value: 'active', display_name: 'Active Calls', count: 0 },
    { value: 'o-info', display_name: 'Info Requested ', count: 3 },
    { value: 'o-na', display_name: 'No Answer', count: 1 },
  ];
  window.__calls = [];
  const mcp = {
    async listTools() {
      return { servers: [
        { server: 'Apollo.io', authStatus: 'connected', tools: [{ name: 'apollo_phone_calls_search' }, { name: 'apollo_users_api_profile' }, { name: 'apollo_users_search' }] },
        { server: 'Microsoft 365', authStatus: 'connected', tools: [{ name: 'outlook_create_draft' }] },
      ] };
    },
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input });
      if (tool === 'apollo_users_api_profile') return { payload: { id: 'u-jack', first_name: 'Jack', last_name: 'Test' } };
      if (tool === 'apollo_users_search') return { payload: { pagination: { total_pages: 1 }, users: [{ id: 'u-jack', name: 'Jack Test' }, { id: 'u-carly', name: 'Carly Test' }] } };
      if (tool === 'apollo_phone_calls_search') {
        const pg = input.page || 1;
        return { payload: { pagination: { per_page: input.per_page, total_pages: 2 }, phone_calls: pg === 1 ? page1 : page2, faceting: { phone_call_stats_facets: facets } } };
      }
      if (tool === 'outlook_create_draft') return { payload: { id: 'draft-1', webLink: 'https://outlook.office.com/mail/drafts/id/draft-1' } };
      throw { code: 'tool_error', message: 'unexpected tool' };
    },
  };
  const sample = async () => ({ text: '', truncated: false });
  sample.json = async (prompt) => {
    window.__prompt = prompt;
    return { subject: 'Business Central Next Steps', body: 'Hi Dana, following up after our call.\n\nSounds like SL is what makes inventory reporting harder than it needs to be, and you are comparing NetSuite and Business Central.\n\nFor next steps, we agreed to reconnect once your NetSuite demo wraps so we can compare notes.\n\nIf any questions come up in the meantime, feel free to reach out.' };
  };
  window.claude = { use: async (name) => (name === 'mcp' ? mcp : name === 'sample' ? sample : null) };
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, timezoneId: 'America/Chicago', permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme'); await page.click('button:has-text("Unlock")'); await sleep(900);

  await page.click('.side-nav-btn:has-text("Follow-ups")'); await sleep(700);
  let t = await page.locator('main').innerText();
  ok('tab renders with empty state', /Follow-ups/.test(t) && /click Pull calls/i.test(t), t.slice(0, 300));
  ok('defaults to Last 7 days', await page.locator('.seg-btn.active').innerText() === 'Last 7 days');

  await page.click('button:has-text("Pull calls")'); await sleep(1500);
  t = await page.locator('main').innerText();
  const calls = await page.evaluate(() => window.__calls.filter((c) => c.tool === 'apollo_phone_calls_search'));
  ok('pulled newest-first, scoped to me', calls[0].input.sort_by_field === 'start_time' && calls[0].input.sort_ascending === false && calls[0].input.user_id === 'u-jack', JSON.stringify(calls[0]?.input));
  ok('stopped paging once past the range start', calls.length === 2, String(calls.length));
  ok('disposition defaulted to Info Requested', (await page.locator('select[aria-label="Disposition"]').inputValue()) === 'o-info');
  ok('shows the two Info Requested leads', /Dana Reed/.test(t) && /Priya Shah/.test(t), t.slice(0, 600));
  ok('excludes No Answer and out-of-range calls', !/Omar Lee/.test(t) && !/Old Lead/.test(t));
  ok('link-only call flagged No call summary', /No call summary/.test(t));
  ok('recording link present', await page.locator('a:has-text("Recording ↗")').count() === 2);
  ok('scan note reports what happened', /Scanned 4 calls/.test(t) && /2 leads/.test(t), t.slice(0, 500));

  // Switch to Any disposition -> pull again shows Omar.
  await page.selectOption('select[aria-label="Disposition"]', '__all__');
  await page.click('button:has-text("Pull calls")'); await sleep(1200);
  t = await page.locator('main').innerText();
  ok('Any disposition includes the No Answer call', /Omar Lee/.test(t));
  await page.selectOption('select[aria-label="Disposition"]', 'o-info');
  await page.click('button:has-text("Pull calls")'); await sleep(1200);

  // Today preset narrows out the 30h-old call.
  await page.click('.seg-btn:has-text("Today")'); await sleep(400);
  t = await page.locator('main').innerText();
  ok('Today preset hides the 30-hour-old call', /Dana Reed/.test(t) && !/Priya Shah/.test(t), t.slice(0, 500));
  await page.click('.seg-btn:has-text("Custom")'); await sleep(300);
  ok('Custom shows two date pickers', await page.locator('input[aria-label="From date"]').count() === 1 && await page.locator('input[aria-label="To date"]').count() === 1);
  await page.click('.seg-btn:has-text("Last 7 days")'); await sleep(400);

  // Draft
  await page.locator('tr', { hasText: 'Dana Reed' }).locator('button:has-text("Draft")').click(); await sleep(1200);
  const body = await page.locator('textarea[aria-label="Body"]').inputValue();
  const subj = await page.locator('input[aria-label="Subject"]').inputValue();
  ok('draft opens with Jack\'s greeting', body.startsWith('Hi Dana, following up after our call.'), body.slice(0, 80));
  ok('draft ends with the reach-out line', /feel free to reach out\.$/.test(body));
  ok('subject lowercased', subj === 'business central next steps', subj);
  const prompt = await page.evaluate(() => window.__prompt || '');
  ok('prompt sent the call summary, not the AI research blobs', /Dynamics SL/.test(prompt) && !/SECTION 1/.test(prompt));
  ok('draft marked as drafted from the call', /Drafted from the call/.test(await page.locator('.fu-drawer').innerText()));

  await page.click('button:has-text("Create Outlook draft")'); await sleep(900);
  const od = await page.evaluate(() => window.__calls.find((c) => c.tool === 'outlook_create_draft'));
  ok('Outlook draft created with to/subject/text body', od && od.input.to[0] === 'dana@acmemfg.com' && od.input.bodyType === 'text' && /Hi Dana/.test(od.input.body), JSON.stringify(od?.input || {}).slice(0, 200));
  ok('never calls a send tool', !(await page.evaluate(() => window.__calls.some((c) => /send/i.test(c.tool)))));
  ok('confirms it landed in Drafts', /Outlook Drafts folder/.test(await page.locator('.fu-drawer').innerText()));
  await page.click('button[aria-label="Close"]'); await sleep(400);
  t = await page.locator('main').innerText();
  ok('row shows Drafted and Open draft', /Drafted/.test(t) && /Open draft/.test(t));

  // No-summary row: paste notes, then template draft.
  await page.locator('tr', { hasText: 'Priya Shah' }).locator('button:has-text("Draft")').click(); await sleep(600);
  ok('no-summary row asks for notes instead of drafting', (await page.locator('textarea[aria-label="Body"]').inputValue()) === '');
  await page.locator('.fu-source textarea').fill('Priya wants pricing for Business Central for 25 users. She asked us to send a quote next week.');
  await page.click('.fu-drawer button:has-text("Template")'); await sleep(500);
  const tb = await page.locator('textarea[aria-label="Body"]').inputValue();
  ok('template drafts from pasted notes', tb.startsWith('Hi Priya, following up after our call.') && /quote/.test(tb), tb);
  ok('labeled Template draft', /Template draft/.test(await page.locator('.fu-drawer').innerText()));
  await page.click('.fu-drawer button:has-text("Mark sent")'); await sleep(500);
  t = await page.locator('main').innerText();
  ok('sent row hidden by default', !/Priya Shah/.test(t));

  // Persistence across reload
  await page.reload(); await sleep(900);
  if (await page.locator('input[type=password]').count()) { await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme'); await page.click('button:has-text("Unlock")'); await sleep(900); }
  await page.click('.side-nav-btn:has-text("Follow-ups")'); await sleep(900);
  t = await page.locator('main').innerText();
  ok('Dana still Drafted after reload', /Dana Reed/.test(t) && /Drafted/.test(t), t.slice(0, 500));
  await page.click('text=Show sent & skipped'); await sleep(400);
  t = await page.locator('main').innerText();
  ok('Priya shows as Sent when included', /Priya Shah/.test(t) && /Sent/.test(t));

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
