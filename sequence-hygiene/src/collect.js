// Sequence Hygiene: connector layer. Calls the viewer's own claude.ai connectors through the
// Artifact `mcp` capability, keeps Apollo inside its rate limits, checkpoints progress so a run
// can stop and resume, and hands normalized data to the rules engine.
(function (root) {
  const R = root.SH_RULES;
  const SERVERS = {
    apollo: "Apollo.io",
    hubspot: "HubSpot",
    echo: "Echo MCP",
    switchboard: "WiredCIO Switchboard",
    psa: "WiredCIO PSA",
    m365: "Microsoft 365",
  };
  const MANIFEST = [
    { server: SERVERS.apollo, tools: ["apollo_emailer_campaigns_search", "apollo_contacts_search", "apollo_phone_calls_search",
      "apollo_emailer_messages_search", "apollo_emailer_campaigns_remove_or_stop_contact_ids", "apollo_emailer_campaigns_add_contact_ids"] },
    { server: SERVERS.hubspot, tools: ["search_crm_objects"] },
    { server: SERVERS.echo, tools: ["search_meetings"] },
    { server: SERVERS.switchboard, tools: ["get_company"] },
    { server: SERVERS.psa, tools: ["whoami"] },
    { server: SERVERS.m365, tools: ["outlook_email_search", "outlook_calendar_search"] },
  ];
  // Sources this tool cannot reach today. Shown as "not checked" on every row of every run.
  const ALWAYS_UNAVAILABLE = [
    { source: "Trellus (direct)", reason: "No Trellus connector. Trellus summaries and transcript links are read from Apollo call notes instead." },
    { source: "PSA client accounts", reason: "The PSA connector only lists your own projects and tickets, not all client accounts." },
    { source: "HubSpot logged activity", reason: "Your HubSpot connection lacks permission to read logged emails, calls, meetings and notes." },
    { source: "Teams chats", reason: "Not searched in this version." },
  ];
  const HARD_DENIALS = new Set(["needs_reauth", "server_not_connected", "selection_required", "not_in_manifest", "blocked_by_policy", "approval_required", "not_granted", "capability_disabled", "capability_removed", "server_not_found"]);
  const FIXES = {
    needs_reauth: "Reconnect it in claude.ai Settings → Connectors.",
    server_not_connected: "Add it in claude.ai Settings → Connectors.",
    selection_required: "Choose which connector to use when claude.ai asks.",
    not_in_manifest: "It was turned off for this page. Turn it back on from the page's permissions menu.",
    approval_required: "Allow it when claude.ai asks.",
    blocked_by_policy: "Your organization blocks this tool.",
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Runs fn over items, `size` at a time. Every item settles before the first error is rethrown,
  // so finished work is never thrown away.
  async function pool(items, size, fn) {
    let i = 0, firstErr = null;
    const worker = async () => {
      while (i < items.length && !firstErr) {
        const item = items[i++];
        try { await fn(item); } catch (e) { if (!firstErr) firstErr = e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
    if (firstErr) throw firstErr;
  }

  class SourceDown extends Error { constructor(source, code, msg) { super(msg); this.source = source; this.code = code; } }
  class BudgetHit extends Error { constructor(tool, resumeAt) { super(`Apollo limit reached for ${tool}`); this.tool = tool; this.resumeAt = resumeAt; } }
  class Stopped extends Error { constructor() { super("Stopped"); } }

  // Every JSON text block of a tool result. Some connectors (Microsoft 365) return one block per item.
  function blocks(result) {
    const out = [];
    for (const b of (result && result.content) || []) {
      if (b.type !== "text") continue;
      try { out.push(JSON.parse(b.text)); } catch { /* plain text block */ }
    }
    if (!out.length && result && result.payload && typeof result.payload === "object") out.push(result.payload);
    return out;
  }

  class Collector {
    constructor({ mcp, store, cfg, log }) {
      this.mcp = mcp; this.store = store; this.cfg = cfg; this.log = log || (() => {});
      this.down = {}; // source -> reason, for the whole run
      this.stopFlag = false;
      this.budget = { stamps: {} };
    }
    stop() { this.stopFlag = true; }

    async loadBudget() { this.budget = (await this.store.get("budget")) || { stamps: {} }; }
    async saveBudget() { await this.store.set("budget", this.budget); }
    spend(tool) {
      const lim = (this.cfg.budgets || {})[tool];
      if (!lim) return;
      const now = Date.now();
      const arr = (this.budget.stamps[tool] || []).filter((t) => now - t < 86400000);
      const hour = arr.filter((t) => now - t < 3600000);
      if (hour.length >= lim.hour) throw new BudgetHit(tool, hour[0] + 3600000);
      if (arr.length >= lim.day) throw new BudgetHit(tool, arr[0] + 86400000);
      arr.push(now);
      this.budget.stamps[tool] = arr;
    }
    budgetLeft(tool) {
      const lim = (this.cfg.budgets || {})[tool];
      const now = Date.now();
      const arr = (this.budget.stamps[tool] || []).filter((t) => now - t < 3600000);
      return lim ? lim.hour - arr.length : Infinity;
    }

    // One connector call. Read-only calls get one retry when the error says a retry may work.
    async call(key, tool, input, { write = false } = {}) {
      if (this.stopFlag) throw new Stopped();
      const server = SERVERS[key];
      if (this.down[key]) throw new SourceDown(key, "down", this.down[key]);
      if (key === "apollo") this.spend(tool);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // Reads get a time limit so one slow source can't stall a whole check. Writes never do:
          // a cancelled write has an unknown outcome.
          const opts = write ? { cache: false } : (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(this.readTimeoutMs || 90000) } : undefined);
          const res = await this.mcp.callTool(server, tool, input, opts);
          return { payload: res.payload, blocks: blocks(res) };
        } catch (e) {
          const code = (e && e.code) || "upstream_error";
          if (HARD_DENIALS.has(code)) {
            this.down[key] = `${server}: ${FIXES[code] || e.message || code}`;
            throw new SourceDown(key, code, this.down[key]);
          }
          const text = `${(e && e.message) || ""} ${JSON.stringify((e && e.result) || "")}`;
          if (/RATE_LIMIT|maximum number of api calls/i.test(text)) {
            const m = text.match(/retry_after_seconds\\?"?\s*:\s*(\d+)/) || text.match(/Wait (\d+) seconds/i);
            throw new BudgetHit(tool, Date.now() + ((m ? Number(m[1]) : 3600) + 30) * 1000);
          }
          if (!write && e && (e.retryable || code === "cancelled") && attempt === 0) { await sleep(Math.min(e.retryAfterMs || 1500, 60000) + Math.random() * 800); continue; }
          throw Object.assign(new Error(`${server} ${tool}: ${e && e.message ? e.message : code}`), { code });
        }
      }
    }
  }

  // ---------- Apollo ----------
  const CONTACT_FIELDS = [{ contacts: ["id", "name", "first_name", "last_name", "email", "email_status", "title", "organization_name",
    "contact_stage_id", "email_unsubscribed", "call_opted_out", "owner_id", "last_activity_date", "typed_custom_fields", "deals",
    { account: ["id", "name", "domain"] },
    { contact_campaign_statuses: ["id", "emailer_campaign_id", "emailer_campaign_name", "status", "added_at", "finished_at",
      "current_step_position", "inactive_reason", "send_email_from_email_account_id", "added_by_user_id", "emailer_campaign_archived"] }] }];

  async function listSequences(col) {
    const out = {};
    for (let page = 1; page < 40; page++) {
      const { payload } = await col.call("apollo", "apollo_emailer_campaigns_search", { page: String(page), per_page: "50" });
      for (const s of (payload && payload.emailer_campaigns) || []) {
        out[s.id] = {
          id: s.id, name: s.name, active: !!s.active, archived: !!s.archived, owner: s.user_id,
          numSteps: s.num_steps || (s.emailer_steps || []).length,
          steps: (s.emailer_steps || []).map((x) => ({ position: x.position, type: x.type })),
          delivered: s.unique_delivered || 0, scheduled: s.unique_scheduled || 0, link: s.sequence_url,
        };
      }
      const pg = payload && payload.pagination;
      if (!pg || page >= pg.total_pages) break;
    }
    return out;
  }

  async function sequenceContacts(col, seqId, onPage) {
    const people = [];
    let total = null;
    for (let page = 1; page <= 500; page++) {
      const { payload } = await col.call("apollo", "apollo_contacts_search", { emailer_campaign_ids: [seqId], per_page: 100, page, fields: CONTACT_FIELDS });
      for (const c of (payload && payload.contacts) || []) people.push(R.adaptApolloContact(c));
      const pg = payload && payload.pagination;
      total = pg ? pg.total_entries : people.length;
      if (onPage) onPage(people.length, total);
      if (!pg || page >= pg.total_pages) break;
    }
    if (total != null && people.length !== total) throw new Error(`Apollo returned ${people.length} of ${total} contacts in the sequence; run again to retry`);
    return people;
  }

  // Everything Apollo holds for one person, across every contact record that shares the email.
  async function apolloPerson(col, p) {
    const ids = new Set([p.apolloId]);
    if (p.email) {
      const { payload } = await col.call("apollo", "apollo_contacts_search", { q_keywords: p.email, per_page: 25, fields: CONTACT_FIELDS });
      for (const raw of (payload && payload.contacts) || []) {
        if (R.normEmail(raw.email) !== p.email || raw.id === p.apolloId) continue;
        const dup = R.adaptApolloContact(raw);
        ids.add(dup.apolloId);
        p.duplicateRecords = (p.duplicateRecords || []).concat({ id: dup.apolloId, link: dup.link });
        p.enrollments = p.enrollments.concat(dup.enrollments.filter((e) => !p.enrollments.some((x) => x.sequenceId === e.sequenceId && x.apolloContactId === e.apolloContactId)));
        p.deals = p.deals.concat(dup.deals);
        if (dup.unsubscribed) p.unsubscribed = true;
        if (dup.callOptedOut) p.callOptedOut = true;
        if (!p.stageId && dup.stageId) p.stageId = dup.stageId;
        if (dup.customText) p.customText = [p.customText, dup.customText].filter(Boolean).join(" | ");
      }
    }
    p.apolloIds = [...ids];
    p.calls = []; p.rejected = (p.rejected || 0);
    for (const id of ids) {
      for (let page = 1; page <= 4; page++) {
        const { payload } = await col.call("apollo", "apollo_phone_calls_search", { contact_id: id, per_page: 50, page });
        for (const raw of (payload && payload.phone_calls) || []) {
          const r = R.adaptApolloCall(raw, [id]);
          if (r.ok) p.calls.push(trimCall(r.call)); else p.rejected += 1;
        }
        const pg = payload && payload.pagination;
        if (!pg || page >= pg.total_pages) break;
      }
    }
    p.emails = [];
    if (p.email) {
      for (let page = 1; page <= 3; page++) {
        const { payload } = await col.call("apollo", "apollo_emailer_messages_search", { q_keywords: p.email, per_page: "50", page: String(page) });
        for (const raw of (payload && payload.emailer_messages) || []) {
          const r = R.adaptApolloMessage(raw, [...ids]);
          if (r.ok) p.emails.push(r.email); else p.rejected += 1;
        }
        const pg = payload && payload.pagination;
        if (!pg || page >= pg.total_pages) break;
      }
    }
  }
  function trimCall(c) { return { ...c, summary: (c.summary || "").slice(0, 1500) }; }

  // ---------- company-level sources ----------
  async function companySources(col, company, cfg, bulk) {
    // company: {key, name, domain, emails:Set, people:[{uid,nameKey,email}]}
    const found = { sources: [], personMeetings: {}, personMail: {}, personClient: {}, personDeals: {}, checks: {} };
    const freeDomain = R.isFree(company.domain, cfg);
    const sameCo = (name, domain) => (company.key && R.companyKey(name) === company.key) || (!freeDomain && domain && R.normDomain(domain) === company.domain);

    // Switchboard: deals, proposals, client rooms
    try {
      if (company.name) {
        const { payload } = await col.call("switchboard", "get_company", { company: company.name });
        for (const raw of (payload && payload.companies) || []) {
          const c = R.adaptSwitchboardCompany(raw);
          if (!sameCo(c.name, c.domain)) continue;
          for (const d of c.deals) {
            const client = d.won || /active/i.test(d.clientRoom || "");
            found.sources.push({ companyKey: company.key, domain: freeDomain ? null : company.domain, kind: client ? "client" : "contact", reason: `Switchboard deal "${d.name}" (${d.stage || "no stage"})`, source: "Switchboard", at: d.at, link: d.link });
          }
        }
      }
      found.checks.Switchboard = { state: "checked" };
    } catch (e) { found.checks.Switchboard = failState(e); }

    // Echo: recorded sales and delivery meetings (from the bulk pull when there is one)
    if (bulk && bulk.echo) {
      for (const m of bulk.echo.get(company.key) || []) {
        if (m.track !== "Sales" && m.track !== "Delivery") continue;
        found.sources.push({ companyKey: company.key, domain: freeDomain ? null : company.domain, kind: m.track === "Delivery" ? "client" : "contact", reason: `Echo ${m.track.toLowerCase()} meeting "${m.title}"`, source: "Echo", at: m.at, link: m.link });
        for (const pp of company.people) if (pp.nameKey && m.people.includes(pp.nameKey)) (found.personMeetings[pp.uid] = found.personMeetings[pp.uid] || []).push({ title: m.title, at: m.at, link: m.link, source: "Echo", type: m.type });
      }
      found.checks.Echo = { state: "checked" };
    } else try {
      if (company.name) {
        const { payload } = await col.call("echo", "search_meetings", { company: company.name, limit: 50 });
        for (const raw of (payload && payload.meetings) || []) {
          const m = R.adaptEchoMeeting(raw);
          if (m.track === "Internal" || m.companyKey !== company.key) continue;
          found.sources.push({ companyKey: company.key, domain: freeDomain ? null : company.domain, kind: m.track === "Delivery" ? "client" : "contact", reason: `Echo ${m.track.toLowerCase()} meeting "${m.title}"`, source: "Echo", at: m.at, link: m.link });
          for (const pp of company.people) if (pp.nameKey && m.people.includes(pp.nameKey)) {
            (found.personMeetings[pp.uid] = found.personMeetings[pp.uid] || []).push({ title: m.title, at: m.at, link: m.link, source: "Echo", type: m.type });
          }
        }
      }
      found.checks.Echo = { state: "checked" };
    } catch (e) { found.checks.Echo = failState(e); }

    // HubSpot: company lifecycle + deals (from the bulk pull when there is one)
    if (bulk && bulk.hubspot) {
      const hits = [...(bulk.hubspot.byKey.get(company.key) || []), ...(!freeDomain && company.domain ? bulk.hubspot.byDomain.get(company.domain) || [] : [])];
      for (const hc of [...new Map(hits.map((h) => [h.id, h])).values()]) {
        const client = hc.lifecycle === "customer";
        found.sources.push({ companyKey: company.key, domain: freeDomain ? null : company.domain, kind: client ? "client" : "contact", reason: client ? `HubSpot lifecycle stage is Customer (${hc.name})` : `HubSpot company has ${hc.numDeals} deal${hc.numDeals === 1 ? "" : "s"} (${hc.name})`, source: "HubSpot", link: hc.link });
      }
      found.checks.HubSpot = { state: "checked" };
    } else try {
      const q = !freeDomain && company.domain ? company.domain : company.name;
      if (q) {
        const { payload } = await col.call("hubspot", "search_crm_objects", { objectType: "COMPANY", query: q, limit: 10,
          properties: ["name", "domain", "lifecyclestage", "num_associated_deals"], chatInsights: { userIntent: "Check whether a company is a client or has deals", satisfaction: "NEUTRAL" } });
        for (const raw of (payload && payload.results) || []) {
          const hc = R.adaptHubspotCompany(raw, payload.urlTemplate);
          if (!sameCo(hc.name, hc.domain)) continue;
          if (hc.lifecycle === "customer") found.sources.push({ companyKey: company.key, domain: freeDomain ? null : company.domain, kind: "client", reason: `HubSpot lifecycle stage is Customer (${hc.name})`, source: "HubSpot", link: hc.link });
          if (hc.numDeals > 0) {
            const dres = await col.call("hubspot", "search_crm_objects", { objectType: "DEAL", limit: 20,
              filterGroups: [{ associatedWith: [{ objectType: "companies", operator: "EQUAL", objectIdValues: [Number(hc.id)] }] }],
              properties: ["dealname", "dealstage", "closedate", "createdate", "hs_is_closed", "hs_is_closed_won"], chatInsights: { userIntent: "<unchanged>", satisfaction: "NEUTRAL" } });
            for (const rd of (dres.payload && dres.payload.results) || []) {
              const d = R.adaptHubspotDeal(rd, dres.payload.urlTemplate);
              found.sources.push({ companyKey: company.key, domain: freeDomain ? null : company.domain, kind: d.won ? "client" : "contact", reason: `HubSpot deal "${d.name}" (${d.stage})`, source: "HubSpot", at: d.at, link: d.link });
            }
          }
        }
      }
      found.checks.HubSpot = { state: "checked" };
    } catch (e) { found.checks.HubSpot = failState(e); }

    // Outlook: anything they (or anyone at their domain) wrote to us, in each mailbox
    try {
      const mailboxes = [null].concat(cfg.extraMailboxes || []);
      const senders = freeDomain ? [...company.emails] : [company.domain];
      for (const box of mailboxes) {
        for (const sender of senders) {
          if (!sender) continue;
          const input = { sender, limit: 25 };
          if (box) input.mailboxOwnerEmail = box;
          const { blocks: bl } = await col.call("m365", "outlook_email_search", input);
          for (const raw of bl.filter((b) => b && b.id && b.sender)) {
            const m = R.adaptOutlookMail(raw, box || "your mailbox");
            const person = company.people.find((pp) => pp.email && pp.email === m.from);
            if (person) (found.personMail[person.uid] = found.personMail[person.uid] || []).push(m);
            else if (!m.autoReply && !freeDomain && m.from.endsWith(`@${company.domain}`)) {
              found.sources.push({ companyKey: company.key, domain: company.domain, kind: "contact", reason: `${m.fromName || m.from} wrote to us: "${m.subject}"`, source: `Outlook (${m.mailbox})`, at: m.at, link: m.link });
            }
          }
        }
      }
      found.checks.Outlook = { state: "checked" };
    } catch (e) { found.checks.Outlook = failState(e); }
    return found;
  }

  // ---------- bulk company data (one pass per run instead of one call per company) ----------
  async function bulkEcho(col, onProgress) {
    const meetings = [];
    for (const track of ["Sales", "Delivery"]) {
      let until = null;
      for (let page = 0; page < 30; page++) {
        const input = { track, limit: 100 };
        if (until) input.until = until;
        const { payload } = await col.call("echo", "search_meetings", input);
        const batch = (payload && payload.meetings) || [];
        meetings.push(...batch);
        if (onProgress) onProgress(meetings.length);
        if (batch.length < 100) break;
        const oldest = batch.map((m) => m.started_at).sort()[0];
        const next = oldest ? oldest.slice(0, 10) : null;
        if (!next || next === until) break;
        until = next;
      }
    }
    const byKey = new Map();
    const seen = new Set();
    for (const raw of meetings) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      const m = R.adaptEchoMeeting(raw);
      if (!m.companyKey || m.companyKey === "unlinked") continue;
      if (!byKey.has(m.companyKey)) byKey.set(m.companyKey, []);
      byKey.get(m.companyKey).push(m);
    }
    return byKey;
  }
  async function bulkHubspot(col) {
    const byKey = new Map(), byDomain = new Map();
    let offset = 0;
    for (let page = 0; page < 50; page++) {
      const input = { objectType: "COMPANY", limit: 200, properties: ["name", "domain", "lifecyclestage", "num_associated_deals"],
        filterGroups: [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "customer" }] }, { filters: [{ propertyName: "num_associated_deals", operator: "GT", value: "0" }] }],
        chatInsights: { userIntent: "Find client and deal companies to clean a prospecting sequence", satisfaction: "NEUTRAL" } };
      if (offset) input.offset = offset;
      const { payload } = await col.call("hubspot", "search_crm_objects", input);
      const results = (payload && payload.results) || [];
      for (const raw of results) {
        const c = R.adaptHubspotCompany(raw, payload.urlTemplate);
        if (c.key) { if (!byKey.has(c.key)) byKey.set(c.key, []); byKey.get(c.key).push(c); }
        if (c.domain) { if (!byDomain.has(c.domain)) byDomain.set(c.domain, []); byDomain.get(c.domain).push(c); }
      }
      offset = payload && payload.offset;
      if (!results.length || !offset || (payload.total != null && offset >= payload.total)) break;
    }
    return { byKey, byDomain };
  }

  // HubSpot contact record: client lifecycle or deals on the person.
  async function hubspotPerson(col, p) {
    if (!p.email) return;
    const { payload } = await col.call("hubspot", "search_crm_objects", { objectType: "CONTACT", query: p.email, limit: 5,
      properties: ["email", "lifecyclestage", "num_associated_deals"], chatInsights: { userIntent: "Check whether a contact is a client or has deals", satisfaction: "NEUTRAL" } });
    for (const raw of (payload && payload.results) || []) {
      const hc = R.adaptHubspotContact(raw, payload.urlTemplate);
      if (hc.email !== p.email) continue;
      if (hc.lifecycle === "customer") p.clientFlags = (p.clientFlags || []).concat({ reason: "HubSpot lifecycle stage is Customer", source: "HubSpot", link: hc.link });
      if (hc.numDeals > 0) p.deals = (p.deals || []).concat({ source: "HubSpot", name: `${hc.numDeals} deal${hc.numDeals > 1 ? "s" : ""} on the HubSpot contact`, stage: "", closed: false, won: false, link: hc.link });
    }
  }

  // Outlook calendar, once per run: every event with someone outside Wired CIO.
  const OWN_DOMAINS = ["wiredcio.com", "wired-cio.com", "wiredcio.co", "wiredcio.us", "wiredcio.net", "grandstrategygroup.com"];
  async function calendarIndex(col, cfg, onProgress) {
    const byEmail = new Map(), byDomain = new Map(), seen = new Set();
    const months = cfg.calendarMonths || 24;
    const end = new Date(); end.setMonth(end.getMonth() + 3);
    const total = months + 3;
    let done = 0;
    const month = async (m) => {
      const to = new Date(end); to.setMonth(end.getMonth() - m);
      const from = new Date(to); from.setMonth(to.getMonth() - 1);
      for (let offset = 0; offset <= 1000; offset += 25) {
        const { blocks: bl } = await col.call("m365", "outlook_calendar_search", { query: "*", afterDateTime: from.toISOString(), beforeDateTime: to.toISOString(), limit: 25, offset });
        const events = bl.filter((b) => b && b.id && b.attendees);
        for (const raw of events) {
          const ev = R.adaptCalendarEvent(raw);
          if (ev.cancelled || seen.has(ev.id)) continue;
          seen.add(ev.id);
          const external = ev.attendees.filter((a) => a.includes("@") && !OWN_DOMAINS.includes(a.split("@")[1]));
          for (const a of external) {
            if (!byEmail.has(a)) byEmail.set(a, []);
            byEmail.get(a).push(ev);
            const d = a.split("@")[1];
            if (!byDomain.has(d)) byDomain.set(d, []);
            if (!byDomain.get(d).includes(ev)) byDomain.get(d).push(ev);
          }
        }
        const more = bl.find((b) => b && b.nextOffset != null);
        if (!more) break;
      }
      done += 1;
      if (onProgress) onProgress(done, total);
    };
    await pool(Array.from({ length: total }, (_, m) => m), 4, month);
    return { byEmail, byDomain };
  }

  function failState(e) {
    if (e instanceof BudgetHit || e instanceof Stopped) throw e;
    return { state: "error", reason: e && e.message ? e.message : "error" };
  }

  // ---------- writes ----------
  async function removeOrStop(col, contactIds, sequenceId, mode, reason) {
    const input = { contact_ids: contactIds, emailer_campaign_ids: [sequenceId], mode };
    if (mode === "stop") input.stop_reason = reason || "Sequence Hygiene";
    return col.call("apollo", "apollo_emailer_campaigns_remove_or_stop_contact_ids", input, { write: true });
  }
  async function addToSequence(col, contactIds, sequenceId, mailbox, status) {
    return col.call("apollo", "apollo_emailer_campaigns_add_contact_ids", {
      id: sequenceId, emailer_campaign_id: sequenceId, contact_ids: contactIds, send_email_from_email_account_id: mailbox, status: status || "active",
    }, { write: true });
  }

  root.SH_COLLECT = {
    SERVERS, MANIFEST, ALWAYS_UNAVAILABLE, OWN_DOMAINS, Collector, pool, SourceDown, BudgetHit, Stopped, blocks,
    listSequences, sequenceContacts, apolloPerson, companySources, bulkEcho, bulkHubspot, hubspotPerson, calendarIndex, removeOrStop, addToSequence,
  };
})(typeof window !== "undefined" ? window : globalThis);
