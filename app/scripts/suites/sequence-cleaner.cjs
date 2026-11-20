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
  const A = 'aaaaaaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbbbbbb', R = 'dddddddddddddddddddddddd';
  const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
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
    { id: 'c7b', name: 'Deep Colleague', email: 'col@deepco.com', organization_name: 'DeepCo', account_id: 'a7', typed_custom_fields: { [NOTE]: 'Wants Business Central.' }, seq: B },
    { id: 'c11', name: 'Again Ann', email: 'ann@againco.com', organization_name: 'AgainCo', account_id: 'a11', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A, prior: [{ emailer_campaign_id: 'cccccccccccccccccccccccc', status: 'finished', finished_at: '2026-10-05T00:00:00Z', inactive_reason: 'completed_last_step' }] },
    { id: 'c12', name: 'Twin Three', email: 'three@twinco.com', organization_name: 'TwinCo', account_id: 'a4', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A },
    { id: 'c13', name: 'Vague Val', email: 'val@vagueco.com', organization_name: 'VagueCo', account_id: 'a13', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A },
    { id: 'c8', name: 'Callback Cal', email: 'cal@cbco.com', organization_name: 'CbCo', account_id: 'a8', added_at: '2026-11-15T00:00:00Z', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A },
    { id: 'c9', name: 'Zombie Zed', email: 'zed@zomco.com', organization_name: 'ZomCo', account_id: 'a9', typed_custom_fields: { [NOTE]: 'Wants Business Central.' }, seq: B, finished_at: '2026-11-17T17:24:00Z' },
    { id: 'c14', name: 'Pat', first_name: 'Pat', last_name: '', email: 'pat@patco.com', organization_name: 'PatCo', account_id: 'a14', phone_numbers: [{ sanitized_number: '+15555550101' }], typed_custom_fields: { [NOTE]: 'Old note from the first import.' }, seq: A },
    { id: 'c15', name: 'Pat Lee', first_name: 'Pat', last_name: 'Lee', email: 'plee@patco.com', organization_name: 'PatCo', account_id: 'a14', typed_custom_fields: { [NOTE]: 'Wants Business Central for 30 users.' }, seq: B },
    { id: 'c16', name: 'Mo Diaz', first_name: 'Mo', last_name: 'Diaz', email: 'mo@moco.com', organization_name: 'MoCo', account_id: 'a16', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: A },
    { id: 'c17', name: 'Maurice Diaz', first_name: 'Maurice', last_name: 'Diaz', email: 'MO@moco.com', organization_name: 'MoCo LLC', account_id: 'a16', typed_custom_fields: { [NOTE]: 'Wants E3.' }, seq: B },
    { id: 'r1', name: 'Ready Rita', email: 'rita@ritaco.com', organization_name: 'RitaCo', account_id: 'a20', typed_custom_fields: {}, seq: A, fin: daysAgo(15) },
    { id: 'r2', name: 'Fresh Fred', email: 'fred@fredco.com', organization_name: 'FredCo', account_id: 'a21', typed_custom_fields: {}, seq: A, fin: daysAgo(1) },
    { id: 'r3', name: 'Talked Tom', email: 'tom@tomco.com', organization_name: 'TomCo', account_id: 'a22', typed_custom_fields: {}, seq: A, fin: daysAgo(10) },
    { id: 'r4', name: 'Busy Bo', email: 'bo@boco.com', organization_name: 'BoCo', account_id: 'a23', typed_custom_fields: {}, seq: A, fin: daysAgo(10), prior: [{ emailer_campaign_id: B, status: 'active' }] },
    { id: 'r6', name: 'Dyn Dora', email: 'dora@doraco.com', organization_name: 'DoraCo', account_id: 'a25', typed_custom_fields: {}, seq: B, fin: daysAgo(12) },
    { id: 'r5', name: 'Old Olga', email: 'olga@olgaco.com', organization_name: 'OlgaCo', account_id: 'a24', typed_custom_fields: {}, seq: A, fin: daysAgo(60) },
    { id: 'c10', name: 'Reply Rae', email: 'rae@replyco.com', organization_name: 'ReplyCo', account_id: 'a10', typed_custom_fields: { [NOTE]: 'Wants Copilot.' }, seq: A },
  ];
  const calls = {
    a2: [{ id: 'k1', contact_id: 'c2', duration: 30, phone_call_outcome_id: '6a024dabd777bd000d626376', start_time: '2026-11-10T15:00:00Z', caller_name: 'Carly Parks' }],
    a7: [{ id: 'k2', contact_id: 'c7b', duration: 420, phone_call_outcome_id: null, start_time: '2026-10-01T15:00:00Z', caller_name: 'Jack Snellgrove' }],
    a13: [{ id: 'k4', contact_id: 'c13', duration: 0, phone_call_outcome_id: '6a73be64a0f3de000c6be57f', note_text: 'Spoke briefly, asked to call back', start_time: '2026-11-18T15:00:00Z', caller_name: 'Carly Parks' }],
    a20: [{ id: 'k20', contact_id: 'r1', duration: 0, phone_call_outcome_id: '66203bd7183e31042298047d', start_time: daysAgo(18), caller_name: 'Jack Snellgrove' }],
    a22: [{ id: 'k22', contact_id: 'r3', duration: 40, phone_call_outcome_id: '66203bd7183e310422980485', start_time: daysAgo(12), caller_name: 'Jack Snellgrove' }],
    a8: [{ id: 'k3', contact_id: 'c8', duration: 0, phone_call_outcome_id: '6a73be64a0f3de000c6be57f', note_text: 'Call back Friday at 2pm', start_time: '2026-11-13T15:00:00Z', caller_name: 'Jack Snellgrove' }],
  };
  window.__writes = [];
  const enrolled = c => [c.seq];
  window.claude = { use: async () => ({
    listTools: async () => ({ servers: [{ server: 'Apollo.io', authStatus: 'connected', tools: [
      'apollo_emailer_campaigns_search', 'apollo_contacts_search', 'apollo_phone_calls_search', 'apollo_emailer_messages_search',
      'apollo_email_accounts_index', 'apollo_emailer_campaigns_add_contact_ids', 'apollo_emailer_campaigns_remove_or_stop_contact_ids',
      'apollo_duplicate_contacts_merge', 'apollo_contacts_update'].map(name => ({ name })) }] }),
    callTool: async (server, tool, input) => {
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { pagination: { total_pages: 1 }, emailer_campaigns: [
        { id: A, name: 'Jack M365 Sequence', user_id: 'jack', active: true, emailer_steps: [{ id: A + 's1', position: 1, type: 'call' }] },
        { id: B, name: 'Jacks Dynamics Sequence', user_id: 'jack', active: false, emailer_steps: [{ id: B + 's1', position: 1, type: 'call' }] },
        { id: R, name: 'Jack Main Recycled', user_id: 'jack', active: true, emailer_steps: [{ id: R + 's1', position: 1, type: 'call' }] }] } };
      if (tool.endsWith('email_accounts_index')) return { payload: { email_accounts: [{ id: 'mb1', email: 'jack@wiredcio.com', user_id: 'jack', owner_name: 'Jack', default: true }] } };
      if (tool.endsWith('contacts_search')) {
        const seq = input.emailer_campaign_ids[0];
        return { payload: { pagination: { total_pages: 1 }, contacts: contacts.filter(c => c.seq === seq).map(c => ({ ...c, contact_campaign_statuses: st(c.seq, { ...(c.fin ? { status: 'finished', finished_at: c.fin, inactive_reason: 'completed_last_step' } : {}), ...(c.finished_at ? { finished_at: c.finished_at } : {}), ...(c.added_at ? { added_at: c.added_at } : {}) }, c.prior || []) })) } };
      }
      // Like real Apollo: account_id is ignored (whole team comes back); contact_id filters.
      if (tool.endsWith('phone_calls_search')) { const all = Object.values(calls).flat(); return { payload: { pagination: { total_pages: 1 }, phone_calls: input.contact_id ? all.filter((c) => c.contact_id === input.contact_id) : all } }; }
      if (tool.endsWith('emailer_messages_search')) return { payload: { pagination: { total_pages: 1 }, emailer_messages: input.emailer_campaign_id === A ? [{ contact_id: 'c10' }] : [] } };
      if (tool.endsWith('add_contact_ids')) {
        window.__writes.push(['add', input.emailer_campaign_id, input.contact_ids, input.send_email_from_email_account_id]);
        return { payload: { skipped_contact_ids: {}, contacts: input.contact_ids.map(id => ({ id, contact_campaign_statuses: [{ emailer_campaign_id: input.emailer_campaign_id }] })) } };
      }
      if (tool.endsWith('remove_or_stop_contact_ids')) {
        window.__writes.push(['remove', input.emailer_campaign_ids[0], input.contact_ids, input.mode, input.stop_reason]);
        return { payload: { contacts: input.contact_ids.map(id => ({ id, emailer_campaign_ids: [] })) } };
      }
      if (tool.endsWith('duplicate_contacts_merge')) { window.__writes.push(['merge', input.contacts[0].master_contact_id, input.contacts[0].duplicate_contact_ids]); return { payload: { message: 'Successfully Merged' } }; }
      if (tool.endsWith('contacts_update')) { window.__writes.push(['update', input.id, input.typed_custom_fields]); return { payload: { contact: { id: input.id } } }; }
      throw { code: 'tool_error', message: 'unmocked ' + tool };
    },
  }) };
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(MOCK);
  await page.addInitScript(() => { try { localStorage.setItem('apolloAutoSync', 'off'); } catch { /* */ } });
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
  ok('dated callback not flagged undated', !(await row('Callback Cal').innerText()).includes('no callback date'));
  ok('undated callback flagged', (await row('Vague Val').innerText()).includes('no callback date'));
  ok('history shows last disposition', (await row('Booked Bea').innerText()).includes('Meeting Booked') && (await row('Booked Bea').innerText()).includes('1 call'));
  ok('called-before-sequence flagged', (await row('Callback Cal').innerText()).includes('Called before this sequence'));
  ok('reply flagged', (await row('Reply Rae').innerText()).includes('Replied'));
  ok('clean lead hidden from Flagged view', !txt.includes('Clean Carl'));
  ok('gap about Echo/HubSpot stated', (await page.locator('text=Echo and HubSpot').count()) > 0);

  // One-click remove from a row, behind a confirm.
  await row('Booked Bea').locator('button', { hasText: 'Remove' }).click(); await sleep(200);
  ok('remove asks first', await page.locator('[role=dialog]').count() === 1 && (await page.evaluate(() => window.__writes.length)) === 0);
  await page.locator('[role=dialog] button', { hasText: /^Remove 1$/ }).click(); await sleep(500);
  const w1 = await page.evaluate(() => window.__writes);
  ok('remove writes exactly one removal', w1.length === 1 && w1[0][0] === 'remove' && w1[0][2][0] === 'c2', JSON.stringify(w1));
  ok('removed lead leaves the table', await row('Booked Bea').count() === 0);

  // Duplicates: first-name-only vs full name, and same email.
  await page.locator('[role=tab]', { hasText: 'Duplicates' }).click(); await sleep(300);
  const pat = page.locator('[data-dup-group]', { hasText: 'PatCo' });
  ok('first-name-only duplicate found', await pat.count() === 1 && (await pat.innerText()).includes('no last name'));
  ok('full name kept by default', (await pat.locator('[data-dup-contact]:has(input:checked)').innerText()).includes('Pat Lee'));
  const mo = page.locator('[data-dup-group]', { hasText: 'MoCo' });
  ok('same email confirmed even with different names', await mo.count() === 1 && (await mo.innerText()).includes('Same email, confirmed'));
  await pat.locator('label', { hasText: 'Old note from the first import' }).locator('input').check();
  await pat.locator('button', { hasText: 'Merge into kept contact' }).click(); await sleep(200);
  const dlg = await page.locator('[role=dialog]').innerText();
  ok('merge confirm names keep, delete and ids', dlg.includes('Keep:') && dlg.includes('c15') && dlg.includes('c14') && dlg.includes("can't be undone"));
  await page.locator('[role=dialog] button', { hasText: /^Merge$/ }).click(); await sleep(500);
  const w2 = await page.evaluate(() => window.__writes.slice(1));
  ok('merge keeps the full-name contact', w2[0] && w2[0][0] === 'merge' && w2[0][1] === 'c15' && w2[0][2][0] === 'c14', JSON.stringify(w2));
  ok('picked note written to the kept contact', w2[1] && w2[1][0] === 'update' && w2[1][1] === 'c15' && Object.values(w2[1][2])[0] === 'Old note from the first import.', JSON.stringify(w2));
  ok('merged group leaves the list', await page.locator('[data-dup-group]', { hasText: 'PatCo' }).count() === 0);
  ok('never enrolls anyone', !(await page.evaluate(() => window.__writes)).some((w) => w[0] === 'add'));

  // Same company tab.
  await page.locator('[role=tab]', { hasText: 'Same company' }).click(); await sleep(200);
  ok('same company groups across sequences', (await page.locator('[data-company-group]', { hasText: 'TwinCo' }).innerText()).includes('Twin Two'));
  // Recycle tab: refresh finds who's ready, push enrolls only them.
  await page.locator('[role=tab]', { hasText: 'Recycle' }).click(); await sleep(200);
  ok('recycle row defaults to the main sequence', (await page.locator('select[aria-label="Finished in"] option:checked').first().innerText()).includes('Jack M365'));
  ok('recycle row defaults to the recycled sequence', (await page.locator('select[aria-label="Push to"] option:checked').first().innerText()).includes('Jack Main Recycled'));
  await page.fill('input[aria-label="Timeframe in days"]', '30');
  await page.locator('[data-recycle] button', { hasText: 'Refresh' }).click(); await sleep(900);
  const rp = await page.locator('[data-recycle-pair]').innerText();
  ok('ready lead listed', rp.includes('Ready Rita'));
  ok('lead still resting is hidden by default', !rp.includes('Fresh Fred'));
  ok('outside the timeframe is not counted', !rp.includes('Old Olga'));
  ok('reached and busy leads left out with reasons', rp.includes('Not interested') && rp.includes('Active in another sequence'));
  await page.locator('[data-recycle] label', { hasText: 'Only show leads ready now' }).locator('input').uncheck(); await sleep(150);
  ok('untick shows who is waiting and when', (await page.locator('[data-recycle-pair]').innerText()).includes('Fresh Fred'));
  const before = await page.evaluate(() => window.__writes.length);
  await page.locator('[data-recycle-pair] button', { hasText: 'Push 1 to Jack Main Recycled' }).click(); await sleep(200);
  ok('push asks first', (await page.locator('[role=dialog]').innerText()).includes('real emails go out') && (await page.evaluate(() => window.__writes.length)) === before);
  await page.locator('[role=dialog] button', { hasText: /^Push 1$/ }).click(); await sleep(500);
  const w3 = await page.evaluate(() => window.__writes.slice(-1)[0]);
  ok('push enrolls only the ready lead from the owner mailbox', w3 && w3[0] === 'add' && w3[1] === 'dddddddddddddddddddddddd' && w3[2].join() === 'r1' && w3[3] === 'mb1', JSON.stringify(w3));
  // Per Jack: finished in Jacks Dynamics -> pick it -> push to Jack Main Recycled -> Refresh.
  await page.selectOption('select[aria-label="Finished in"]', { label: 'Jacks Dynamics Sequence' });
  await page.selectOption('select[aria-label="Push to"]', { label: 'Jack Main Recycled' });
  await page.locator('[data-recycle] button', { hasText: 'Refresh' }).click(); await sleep(900);
  const dp = await page.locator('[data-recycle-pair]').innerText();
  ok('any sequence can be the source', dp.includes('Jacks Dynamics Sequence → Jack Main Recycled') && dp.includes('Dyn Dora') && !dp.includes('Ready Rita'));
  await page.locator('[data-recycle-pair] button', { hasText: 'Push 1 to Jack Main Recycled' }).click(); await sleep(200);
  await page.locator('[role=dialog] button', { hasText: /^Push 1$/ }).click(); await sleep(500);
  const w4 = await page.evaluate(() => window.__writes.slice(-1)[0]);
  ok('pushes to the recycled sequence picked', w4 && w4[0] === 'add' && w4[1] === 'dddddddddddddddddddddddd' && w4[2].join() === 'r6', JSON.stringify(w4));
  // Slipped through: active leads whose calls already landed a meeting,
  // pending review, not interested or call back get finished (stopped).
  await page.locator('[role=tab]', { hasText: 'Check sequences' }).click(); await sleep(300);
  const sl = await page.locator('[data-slipped]').innerText();
  ok('slipped-through banner counts them', /3 slipped through/.test(sl) && sl.includes('Call Back Scheduled (2)') && sl.includes('Not interested (1)'), sl);
  const n0 = await page.evaluate(() => window.__writes.length);
  await page.locator('[data-slipped] button', { hasText: 'Finish all 3' }).click(); await sleep(200);
  ok('finish asks first and names the reason', (await page.locator('[role=dialog]').innerText()).includes('Call Back Scheduled') && (await page.evaluate(() => window.__writes.length)) === n0);
  await page.locator('[role=dialog] button', { hasText: /^Finish 3$/ }).click(); await sleep(500);
  const fw = await page.evaluate((n) => window.__writes.slice(n), n0);
  ok('finish stops them with the outcome as the reason', fw.length === 2 && fw.every((w) => w[0] === 'remove' && w[3] === 'stop') && fw.some((w) => w[4] === 'Call Back Scheduled' && w[2].length === 2) && fw.some((w) => w[4] === 'Not interested' && w[2].join() === 'c6'), JSON.stringify(fw));
  ok('banner clears after finishing', await page.locator('[data-slipped]').count() === 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
