// Committed regression suite for Engage → Sequence Cleaner.
// Apollo is mocked via window.claude.use("mcp") — the real connector only
// exists inside the claude.ai Artifact viewer. The mock records every write
// so the suite can prove move = enroll-then-remove and nothing else runs.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || undefined;
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MOCK = () => {
  const A = 'aaaaaaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const st = (seq, extra = {}, prior = []) => [{ emailer_campaign_id: seq, status: 'active', current_step_id: seq + 's1', ...extra }, ...prior];
  const PL = '68abe22a26a866001d3e1a08', NOTE = '68abe2198cb839001d7d67c3';
  const contacts = [
    { id: 'c1', name: 'Clean Carl', email: 'carl@cleanco.com', organization_name: 'CleanCo', account_id: 'a1', typed_custom_fields: { [PL]: 'M365 / Azure', [NOTE]: 'Wants E3 (40 users).' }, seq: A },
    { id: 'c2', name: 'Booked Bea', email: 'bea@bookedco.com', organization_name: 'BookedCo', account_id: 'a2', typed_custom_fields: { [NOTE]: 'Teams' }, seq: A },
    { id: 'c3', name: 'Dyn Dana', email: 'dana@dynco.com', organization_name: 'DynCo', account_id: 'a3', typed_custom_fields: { [NOTE]: 'Wants Dynamics 365 Business Central (10 users).' }, seq: A },
    { id: 'c4', name: 'Twin One', email: 'one@twinco.com', organization_name: 'TwinCo Inc', account_id: 'a4', typed_custom_fields: { [NOTE]: 'Wants E5.' }, seq: A },
    { id: 'c5', name: 'Twin Two', email: 'two@twinco.com', organization_name: 'TwinCo', account_id: 'a4', typed_custom_fields: { [NOTE]: 'Wants Business Central.' }, seq: B },
    { id: 'c6', name: 'Stage Sam', email: 'sam@stageco.com', organization_name: 'StageCo', account_id: 'a6', contact_stage_id: '66203bd7183e31042298045e', typed_custom_fields: { [NOTE]: 'Wants Intune.' }, seq: A },
    { id: 'c7', name: 'Deep Dee', email: 'dee@deepco.com', organization_name: 'DeepCo', account_id: 'a7', typed_custom_fields: { [NOTE]: 'Wants Defender.' }, seq: A },
    { id: 'c11', name: 'Again Ann', email: 'ann@againco.com', organization_name: 'AgainCo', account_id: 'a11', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A, prior: [{ emailer_campaign_id: 'cccccccccccccccccccccccc', status: 'finished', finished_at: '2026-10-05T00:00:00Z', inactive_reason: 'completed_last_step' }] },
    { id: 'c12', name: 'Twin Three', email: 'three@twinco.com', organization_name: 'TwinCo', account_id: 'a4', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A },
    { id: 'c13', name: 'Vague Val', email: 'val@vagueco.com', organization_name: 'VagueCo', account_id: 'a13', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A },
    { id: 'c8', name: 'Callback Cal', email: 'cal@cbco.com', organization_name: 'CbCo', account_id: 'a8', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A },
    { id: 'c9', name: 'Zombie Zed', email: 'zed@zomco.com', organization_name: 'ZomCo', account_id: 'a9', typed_custom_fields: { [NOTE]: 'Wants Business Central.' }, seq: B, finished_at: '2026-11-17T17:24:00Z' },
    { id: 'c10', name: 'Reply Rae', email: 'rae@replyco.com', organization_name: 'ReplyCo', account_id: 'a10', typed_custom_fields: { [NOTE]: 'Wants Copilot.' }, seq: A },
  ];
  const calls = {
    a2: [{ id: 'k1', contact_id: 'c2', duration: 30, phone_call_outcome_id: '6a024dabd777bd000d626376', start_time: '2026-11-10T15:00:00Z', caller_name: 'Carly Parks' }],
    a7: [{ id: 'k2', contact_id: 'cX', duration: 420, phone_call_outcome_id: null, start_time: '2026-10-01T15:00:00Z', caller_name: 'Jack Snellgrove' }],
    a13: [{ id: 'k4', contact_id: 'c13', duration: 0, phone_call_outcome_id: '6a73be64a0f3de000c6be57f', note_text: 'Spoke briefly, asked to call back', start_time: '2026-11-18T15:00:00Z', caller_name: 'Carly Parks' }],
    a8: [{ id: 'k3', contact_id: 'c8', duration: 0, phone_call_outcome_id: '6a73be64a0f3de000c6be57f', note_text: 'Call back Friday at 2pm', start_time: '2026-11-13T15:00:00Z', caller_name: 'Jack Snellgrove' }],
  };
  window.__writes = [];
  const enrolled = c => [c.seq];
  window.claude = { use: async () => ({
    listTools: async () => ({ servers: [{ server: 'Apollo.io', authStatus: 'connected', tools: [
      'apollo_emailer_campaigns_search', 'apollo_contacts_search', 'apollo_phone_calls_search', 'apollo_emailer_messages_search',
      'apollo_email_accounts_index', 'apollo_emailer_campaigns_add_contact_ids', 'apollo_emailer_campaigns_remove_or_stop_contact_ids'].map(name => ({ name })) }] }),
    callTool: async (server, tool, input) => {
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { pagination: { total_pages: 1 }, emailer_campaigns: [
        { id: A, name: 'Jack M365 Sequence', user_id: 'jack', active: true, emailer_steps: [{ id: A + 's1', position: 1, type: 'call' }] },
        { id: B, name: 'Jacks Dynamics Sequence', user_id: 'jack', active: false, emailer_steps: [{ id: B + 's1', position: 1, type: 'call' }] }] } };
      if (tool.endsWith('email_accounts_index')) return { payload: { email_accounts: [{ id: 'mb1', email: 'jack@wiredcio.com', user_id: 'jack', owner_name: 'Jack', default: true }] } };
      if (tool.endsWith('contacts_search')) {
        const seq = input.emailer_campaign_ids[0];
        return { payload: { pagination: { total_pages: 1 }, contacts: contacts.filter(c => c.seq === seq).map(c => ({ ...c, contact_campaign_statuses: st(c.seq, c.finished_at ? { finished_at: c.finished_at } : {}, c.prior || []) })) } };
      }
      if (tool.endsWith('phone_calls_search')) return { payload: { phone_calls: calls[input.account_id] || [] } };
      if (tool.endsWith('emailer_messages_search')) return { payload: { pagination: { total_pages: 1 }, emailer_messages: input.emailer_campaign_id === A ? [{ contact_id: 'c10' }] : [] } };
      if (tool.endsWith('add_contact_ids')) {
        window.__writes.push(['add', input.emailer_campaign_id, input.contact_ids, input.send_email_from_email_account_id]);
        return { payload: { skipped_contact_ids: {}, contacts: input.contact_ids.map(id => ({ id, contact_campaign_statuses: [{ emailer_campaign_id: input.emailer_campaign_id }] })) } };
      }
      if (tool.endsWith('remove_or_stop_contact_ids')) {
        window.__writes.push(['remove', input.emailer_campaign_ids[0], input.contact_ids]);
        return { payload: { contacts: input.contact_ids.map(id => ({ id, emailer_campaign_ids: [] })) } };
      }
      throw { code: 'tool_error', message: 'unmocked ' + tool };
    },
  }) };
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(MOCK);
  await page.goto(BASE);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(900);
  await page.locator('aside button:has-text("Sequence Scanner")').first().click(); await sleep(400);
  ok('cleaner screen opens', await page.locator('h2:has-text("Sequence Scanner")').count() === 1);
  await page.click('button:has-text("Load sequences")'); await sleep(500);
  ok('sequences listed', await page.locator('label:has-text("Jack M365 Sequence")').count() === 1 && await page.locator('label:has-text("Jacks Dynamics Sequence")').count() === 1);
  await page.locator('label:has-text("Jack M365 Sequence") input').check();
  await page.locator('label:has-text("Jacks Dynamics Sequence") input').check();
  await page.click('button:has-text("Run check (2)")'); await sleep(1200);
  const txt = await page.locator('.table-card table.data-table').innerText();
  const row = name => page.locator('.table-card table.data-table tbody tr').filter({ has: page.locator('strong', { hasText: new RegExp('^' + name + '$') }) });
  ok('meeting booked flagged', (await row('Booked Bea').innerText()).includes('Meeting booked'));
  ok('wrong product line flagged', (await row('Dyn Dana').innerText()).includes('Wrong product line'));
  ok('same company across sequences flagged', (await row('Twin One').innerText()).includes('Same company'));
  ok('stage flagged', (await row('Stage Sam').innerText()).includes('Stage: Not Interested'));
  ok('colleague deep call flagged', (await row('Deep Dee').innerText()).includes('colleague'));
  ok('callback listed', (await row('Callback Cal').innerText()).includes('Call back scheduled'));
  ok('zombie flagged', (await row('Zombie Zed').innerText()).includes('Finished but shown active'));
  ok('prior finished counted', (await row('Again Ann').innerText()).includes('Finished 1 sequence before'));
  ok('company check lists 2+ in one sequence', (await page.locator('.panel', { hasText: 'Company check' }).innerText()).includes('TwinCo'));
  ok('dated callback not flagged undated', !(await row('Callback Cal').innerText()).includes('no callback date'));
  ok('undated callback flagged', (await row('Vague Val').innerText()).includes('no callback date'));
  ok('reply flagged', (await row('Reply Rae').innerText()).includes('Replied'));
  ok('clean lead hidden from Flagged view', !txt.includes('Clean Carl'));
  ok('gap about Echo/HubSpot stated', (await page.locator('text=Echo and HubSpot').count()) > 0);

  await row('Dyn Dana').locator('input[type=checkbox]').check();
  ok('export offered when writes are off', await page.locator('.bulkbar button', { hasText: 'Export removal list' }).count() === 1);
  ok('write buttons hidden under the no-writes rule', await page.locator('.bulkbar button').filter({ hasText: /^Move$/ }).count() === 0 && await page.locator('.bulkbar button', { hasText: 'Remove from their sequence' }).count() === 0);
  ok('nothing written', (await page.evaluate(() => window.__writes.length)) === 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
