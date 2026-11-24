// A live HubSpot deal must never sit in a cold sequence.
// Per Jack (2026-11-24), naming a real one in Jacks Dynamics Sequence:
// "remove anyone like this, this is an active deal."
//
// Pulls HubSpot in All leads, then runs the Sequence Scanner and proves the
// deal group holds exactly the right people and removes them. Apollo and
// HubSpot are both mocked — the real connectors only exist inside the
// claude.ai viewer.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || undefined;
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MOCK = () => {
  const SEQ = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const NOTE = '68abe2198cb839001d7d67c3';
  const contacts = [
    // On an open deal — must come out, whatever Apollo says about them.
    { id: 'd1', name: 'Deal Dan', email: 'dan@energyworksusa.com', organization_name: 'EnergyWorks', account_id: 'a1', typed_custom_fields: { [NOTE]: 'Wants Business Central.' } },
    // A colleague at the same company: the lock is company-wide on purpose.
    { id: 'd2', name: 'Deal Colleague', email: 'pat@energyworksusa.com', organization_name: 'EnergyWorks', account_id: 'a1', typed_custom_fields: { [NOTE]: 'Wants E3.' } },
    // No domain in HubSpot, matched on the company name instead.
    { id: 'd3', name: 'Guard Gus', email: 'gus@spaceguard.io', organization_name: 'SpaceGuard', account_id: 'a2', typed_custom_fields: { [NOTE]: 'Wants Dynamics 365.' } },
    // A won deal is a customer — still the account manager's, not cold.
    { id: 'd4', name: 'Cust Cora', email: 'cora@oldcustomer.com', organization_name: 'Old Customer', account_id: 'a3', typed_custom_fields: { [NOTE]: 'Wants Copilot.' } },
    // Had a meeting AND is on a deal: the deal is the louder reason.
    { id: 'd5', name: 'Both Bea', email: 'bea@lostlead.com', organization_name: 'Lost Lead Co', account_id: 'a4', typed_custom_fields: { [NOTE]: 'Wants Teams.' } },
    // Nothing anywhere — stays Fresh, and proves the group is not catching
    // everyone.
    { id: 'f1', name: 'Fresh Fred', email: 'fred@freshprospect.com', organization_name: 'Fresh Prospect', account_id: 'a5', typed_custom_fields: { [NOTE]: 'Wants E5 (40 users).' } },
    // A gmail lead at a company with no deal: a free domain must never
    // block every other gmail lead with it.
    { id: 'f2', name: 'Gmail Gail', email: 'gail@gmail.com', organization_name: 'Gail Consulting', account_id: 'a6', typed_custom_fields: { [NOTE]: 'Wants Intune.' } },
  ];
  const calls = {
    a4: [{ id: 'k1', contact_id: 'd5', duration: 600, phone_call_outcome_id: '6a024dabd777bd000d626376', start_time: '2026-11-10T15:00:00Z', caller_name: 'Jack Snellgrove' }],
  };
  const HS = [
    { id: 1, properties: { name: 'EnergyWorks', domain: 'energyworksusa.com', lifecyclestage: 'opportunity', num_associated_deals: '1', createdate: '2026-11-23T18:39:55.663Z' } },
    { id: 2, properties: { name: 'SpaceGuard', lifecyclestage: 'opportunity', num_associated_deals: '2', createdate: '2026-11-23T15:59:14.925Z' } },
    { id: 3, properties: { name: 'Old Customer', domain: 'oldcustomer.com', lifecyclestage: 'customer', num_associated_deals: '3', createdate: '2026-02-01T10:00:00.000Z' } },
    { id: 4, properties: { name: 'Lost Lead Co', domain: 'lostlead.com', lifecyclestage: 'other', num_associated_deals: '1', createdate: '2026-05-05T10:00:00.000Z' } },
  ];
  window.__writes = [];
  window.claude = { use: async (n) => n === 'permissions' ? null : ({
    listTools: async () => ({ servers: [
      { server: 'Apollo.io', authStatus: 'connected', tools: ['apollo_emailer_campaigns_search', 'apollo_contacts_search', 'apollo_phone_calls_search', 'apollo_emailer_messages_search', 'apollo_email_accounts_index', 'apollo_emailer_campaigns_remove_or_stop_contact_ids'].map(name => ({ name })) },
      { server: 'HubSpot', authStatus: 'connected', tools: [{ name: 'search_crm_objects' }] },
    ] }),
    callTool: async (server, tool, input) => {
      if (tool === 'search_crm_objects') return { payload: { results: HS, total: HS.length, offset: HS.length, urlTemplate: 'https://app.hubspot.com/contacts/1/record/0-2/{id}' } };
      if (tool.endsWith('emailer_campaigns_search')) return { payload: { pagination: { total_pages: 1 }, emailer_campaigns: [
        { id: SEQ, name: 'Jacks Dynamics Sequence', user_id: 'jack', active: true, emailer_steps: [{ id: SEQ + 's1', position: 1, type: 'call' }] }] } };
      if (tool.endsWith('email_accounts_index')) return { payload: { email_accounts: [{ id: 'mb1', email: 'jack@wiredcio.com', user_id: 'jack', owner_name: 'Jack', default: true }] } };
      if (tool.endsWith('contacts_search')) return { payload: { pagination: { total_pages: 1 }, contacts: contacts.map(c => ({ ...c, contact_campaign_statuses: [{ emailer_campaign_id: SEQ, status: 'active', current_step_id: SEQ + 's1' }] })) } };
      if (tool.endsWith('phone_calls_search')) { const all = Object.values(calls).flat(); return { payload: { pagination: { total_pages: 1 }, phone_calls: input.contact_id ? all.filter(c => c.contact_id === input.contact_id) : all } }; }
      if (tool.endsWith('emailer_messages_search')) return { payload: { pagination: { total_pages: 1 }, emailer_messages: [] } };
      if (tool.endsWith('remove_or_stop_contact_ids')) {
        window.__writes.push(['remove', input.emailer_campaign_ids[0], input.contact_ids, input.mode]);
        return { payload: { contacts: input.contact_ids.map(id => ({ id, emailer_campaign_ids: [] })) } };
      }
      throw { code: 'tool_error', message: 'unmocked ' + tool };
    },
  }) };
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(60000);
  await page.addInitScript(MOCK);
  await page.addInitScript(() => { try { localStorage.setItem('apolloAutoSync', 'off'); localStorage.setItem('skipFileNameBox', '1'); } catch { /* */ } });
  await page.goto(BASE);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  // --- run the check with no HubSpot data at all -------------------------
  await page.locator('aside button:has-text("Sequence Scanner")').first().click(); await sleep(500);
  await page.click('button:has-text("Load sequences")'); await sleep(600);
  await page.locator('label:has-text("Jacks Dynamics Sequence") input').check();
  await page.click('button:has-text("Run check (1)")'); await sleep(1500);

  const fresh = page.locator('[data-fresh-check]');
  ok('the fresh check ran', await fresh.count() === 1);
  // It must say the deal check is not live rather than quietly reporting
  // everyone as clean.
  const bar = fresh.locator('[data-hubspot-bar]');
  ok('it says no HubSpot deals are loaded', /No HubSpot deals loaded/.test(await bar.innerText()), await bar.innerText());
  ok('nobody is in the deal group yet', Number((await fresh.locator('[data-fresh-group="deal"]').innerText()).match(/\d+/)?.[0]) === 0);

  // --- pull HubSpot, from where the removing happens ---------------------
  const pull = bar.locator('button[aria-label="Pull from HubSpot"]');
  ok('the HubSpot pull button is right there', await pull.count() === 1);
  await pull.click(); await sleep(1200);
  const note = await bar.locator('[aria-label="HubSpot notice"]').innerText().catch(() => '');
  ok('it says what it read', /Read 4 companies/.test(note), note);
  ok('the bar now says the check is live', /Checking against 4 HubSpot companies/.test(await bar.innerText()), await bar.innerText());
  // The groups regrade as the deals land — no second Apollo run needed.
  await sleep(400);
  const tile = fresh.locator('[data-fresh-group="deal"]');
  ok('there is a deal group', await tile.count() === 1);
  const n = Number((await tile.innerText()).match(/\d+/)?.[0]);
  ok('it holds the five people at a deal company', n === 5, String(n));

  await tile.click(); await sleep(400);
  const rows = (await fresh.locator('tbody tr').allInnerTexts()).join(' | ');
  for (const who of ['Deal Dan', 'Deal Colleague', 'Guard Gus', 'Cust Cora', 'Both Bea']) {
    ok(`${who} is in the deal group`, rows.includes(who), rows);
  }
  ok('Fresh Fred is not', !rows.includes('Fresh Fred'), rows);
  ok('a gmail lead is not dragged in by its domain', !rows.includes('Gmail Gail'), rows);
  ok('it names the HubSpot record as the reason', /HubSpot deal/.test(rows), rows);
  ok('it says how it matched', /matched on (their email|the company web domain|the company name)/.test(rows), rows);
  // A meeting is a reason to remove too, but the deal is the one that says
  // whose account this is — so it wins the row.
  ok('a deal outranks a logged meeting', rows.includes('Both Bea')
    && Number((await fresh.locator('[data-fresh-group="meeting"]').innerText()).match(/\d+/)?.[0]) === 0);

  // --- remove them -------------------------------------------------------
  await page.locator('button:has-text("Remove all 5")').first().click(); await sleep(500);
  const confirm = page.locator('button', { hasText: /^Remove 5\b/ });
  if (await confirm.count()) { await confirm.first().click(); await sleep(1200); }
  const writes = await page.evaluate(() => window.__writes);
  const removed = writes.filter(w => w[0] === 'remove').flatMap(w => w[2]);
  ok('exactly the five were removed', removed.length === 5 && ['d1', 'd2', 'd3', 'd4', 'd5'].every(id => removed.includes(id)), JSON.stringify(writes));
  ok('the fresh lead was never touched', !removed.includes('f1') && !removed.includes('f2'));
  ok('nothing else was written to Apollo', writes.every(w => w[0] === 'remove'), JSON.stringify(writes.map(w => w[0])));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
