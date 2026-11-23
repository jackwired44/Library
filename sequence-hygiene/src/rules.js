// Sequence Hygiene: the rules engine. Pure functions only. No network, no DOM.
// Raw connector payloads are turned into one normalized shape by the adapt* functions,
// then evaluateRun() applies every rule and returns buckets, statuses, findings and totals.
(function (root) {
  const DAY = 86400000;

  // ---------- normalizing ----------
  const lc = (s) => (s == null ? "" : String(s)).trim().toLowerCase();
  function normEmail(e) { const v = lc(e); return v.includes("@") ? v : ""; }
  function emailDomain(e) { const v = normEmail(e); return v ? v.split("@")[1] : ""; }
  function normDomain(d) {
    let v = lc(d).replace(/^https?:\/\//, "").replace(/^www\./, "");
    return v.split("/")[0];
  }
  const SUFFIXES = new Set(["inc", "incorporated", "llc", "l l c", "ltd", "limited", "corp", "corporation", "co",
    "company", "plc", "lp", "llp", "pc", "pllc", "the", "gmbh", "sa", "ag", "bv"]);
  function companyKey(name) {
    let v = lc(name).replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    const parts = v.split(" ").filter((p) => p && !SUFFIXES.has(p));
    return parts.join(" ");
  }
  function nameKey(first, last, full) {
    const f = lc(first), l = lc(last);
    const v = f || l ? `${f} ${l}` : lc(full);
    return v.replace(/[^a-z ]+/g, "").replace(/\s+/g, " ").trim();
  }
  function isFree(domain, cfg) { return !domain || (cfg.freeDomains || []).map(lc).includes(lc(domain)); }
  const toMs = (s) => { if (!s) return null; const t = Date.parse(s); return Number.isNaN(t) ? null : t; };

  // ---------- adapters (raw connector payload -> normalized) ----------
  function adaptApolloContact(raw) {
    const acc = raw.account || {};
    const custom = raw.typed_custom_fields && typeof raw.typed_custom_fields === "object"
      ? Object.values(raw.typed_custom_fields).filter((v) => typeof v === "string").join(" | ") : "";
    const email = normEmail(raw.email);
    return {
      apolloId: raw.id,
      name: raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(" "),
      first: raw.first_name || "", last: raw.last_name || "",
      email, emailStatus: lc(raw.email_status),
      title: raw.title || "",
      company: raw.organization_name || acc.name || "",
      companyKey: companyKey(raw.organization_name || acc.name || ""),
      domain: normDomain(acc.domain || "") || emailDomain(email),
      accountId: acc.id || raw.account_id || null,
      accountName: acc.name || "",
      stageId: raw.contact_stage_id || null,
      unsubscribed: !!raw.email_unsubscribed,
      callOptedOut: !!raw.call_opted_out,
      ownerId: raw.owner_id || null,
      lastActivity: raw.last_activity_date || null,
      customText: custom,
      enrollments: (raw.contact_campaign_statuses || []).map((s) => ({
        sequenceId: s.emailer_campaign_id, sequenceName: s.emailer_campaign_name || "",
        status: lc(s.status), addedAt: s.added_at || null, finishedAt: s.finished_at || null,
        step: s.current_step_position ?? null, reason: s.inactive_reason || s.finished_reason || "",
        archived: !!s.emailer_campaign_archived, mailbox: s.send_email_from_email_account_id || null,
        addedBy: s.added_by_user_id || null, apolloContactId: raw.id,
      })),
      deals: (raw.deals || []).map((d) => ({
        source: "Apollo", id: d.id, name: d.name || "Apollo deal", stage: d.stage_name || "",
        closed: !!(d.is_closed || d.closed_date), won: !!d.is_won, at: d.closed_date || d.created_at || null,
        link: d.id ? `https://app.apollo.io/#/opportunities/${d.id}` : null,
      })),
      link: `https://app.apollo.io/#/contacts/${raw.id}`,
    };
  }

  const TRELLUS_RE = /https:\/\/app\.trellus\.ai\/\S+/i;
  function splitCallNote(note) {
    const text = note || "";
    const m = text.match(TRELLUS_RE);
    const summary = text
      .replace(TRELLUS_RE, "")
      .replace(/Recording:\s*/gi, "")
      .replace(/Called\s+\+?[\d\s().-]+\s*\([A-Z_ ]+\)\.?/g, "")
      .replace(/\s+/g, " ").trim();
    return { trellusUrl: m ? m[0].replace(/[).,]+$/, "") : null, summary };
  }

  // Returns {ok:false} for a call whose contact_id is not the contact we asked about (the call
  // search can hand back calls for other people, so every result is verified).
  function adaptApolloCall(raw, expectedIds) {
    const ids = new Set([].concat(expectedIds || []));
    if (!raw || !ids.has(raw.contact_id)) return { ok: false, reason: "call belongs to another contact" };
    const { trellusUrl, summary } = splitCallNote(raw.note_text || raw.note);
    return {
      ok: true,
      call: {
        id: raw.id, contactId: raw.contact_id, outcomeId: raw.phone_call_outcome_id || null,
        durationSec: Number(raw.duration) || 0, summary, trellusUrl,
        at: raw.start_time || raw.end_time || null, caller: raw.caller_name || raw.user_id || "",
        sequenceId: raw.emailer_campaign_id || null, sequenceName: raw.campaign_name || "",
        step: raw.campaign_position ?? null, inbound: !!raw.inbound,
        link: `https://app.apollo.io/#/contacts/${raw.contact_id}`,
      },
    };
  }

  function adaptApolloMessage(raw, expectedIds) {
    const ids = new Set([].concat(expectedIds || []));
    if (!raw || !ids.has(raw.contact_id)) return { ok: false, reason: "email belongs to another contact" };
    return {
      ok: true,
      email: {
        id: raw.id, contactId: raw.contact_id, sequenceId: raw.emailer_campaign_id || null,
        status: lc(raw.status), delivered: !!raw.delivered, opened: !!raw.opened, replied: !!raw.replied,
        bounced: !!raw.bounced, unsubscribed: !!raw.unsubscribe, spamBlocked: !!raw.spam_blocked,
        subject: (raw.variant && raw.variant.subject) || raw.subject || "",
        at: raw.completed_at || raw.sent_at || raw.due_at || raw.created_at || null,
        link: raw.emailer_campaign_id ? `https://app.apollo.io/#/sequences/${raw.emailer_campaign_id}` : null,
      },
    };
  }

  const AUTO_REPLY_RE = /\b(automatic reply|auto(?:matic)?[- ]?reply|autoreply|out of (?:the )?office|ooo|undeliverable|delivery status notification|mail delivery (?:failed|subsystem)|returned mail|away from the office|on vacation)\b/i;
  function adaptOutlookMail(raw, mailbox) {
    return {
      id: raw.id, from: lc(raw.sender), fromName: raw.senderName || "", subject: raw.subject || "",
      at: raw.receivedDateTime || raw.sentDateTime || null, link: raw.webLink || null,
      mailbox: mailbox || "me", autoReply: AUTO_REPLY_RE.test(raw.subject || ""),
    };
  }
  function adaptCalendarEvent(raw) {
    const att = (raw.attendees || []).map(lc);
    if (raw.organizer) att.push(lc(raw.organizer));
    return {
      id: raw.id, subject: raw.subject || "", at: raw.start && raw.start.dateTime ? raw.start.dateTime : null,
      attendees: [...new Set(att)], cancelled: !!raw.isCancelled, link: raw.webLink || null,
    };
  }
  function adaptEchoMeeting(raw) {
    return {
      id: raw.id, title: raw.title || "", company: raw.company || "", companyKey: companyKey(raw.company || ""),
      track: raw.track || "", type: raw.type || "", at: raw.started_at || null,
      people: (raw.people || []).map((p) => nameKey("", "", p)), link: raw.url || null,
    };
  }
  function adaptSwitchboardCompany(raw) {
    const deals = (raw.deals || []).map((d) => ({
      source: "Switchboard", id: d.id, name: d.name || raw.name || "Switchboard deal", stage: d.stage || "",
      closed: !!d.closed_on || /closed|lost|won/i.test(d.stage || ""), won: /won/i.test(d.stage || ""),
      at: d.closed_on || d.stage_changed_at || d.created_at || null, link: d.url || null,
      clientRoom: d.room_status || (d.room && d.room.status) || null,
    }));
    return { name: raw.name || "", key: companyKey(raw.name || ""), domain: normDomain(raw.domain || ""), deals };
  }
  function adaptHubspotCompany(raw, urlTemplate) {
    const p = raw.properties || {};
    return {
      id: raw.id, name: p.name || raw.displayName || "", key: companyKey(p.name || raw.displayName || ""),
      domain: normDomain(p.domain || ""), lifecycle: lc(p.lifecyclestage), numDeals: Number(p.num_associated_deals) || 0,
      link: urlTemplate ? urlTemplate.replace("{id}", raw.id) : null,
    };
  }
  function adaptHubspotDeal(raw, urlTemplate) {
    const p = raw.properties || {};
    return {
      source: "HubSpot", id: raw.id, name: p.dealname || raw.displayName || "HubSpot deal", stage: p.dealstage || "",
      closed: p.hs_is_closed === "true", won: p.hs_is_closed_won === "true", at: p.closedate || p.createdate || null,
      link: urlTemplate ? urlTemplate.replace("{id}", raw.id) : null,
    };
  }
  function adaptHubspotContact(raw, urlTemplate) {
    const p = raw.properties || {};
    return {
      id: raw.id, email: normEmail(p.email), lifecycle: lc(p.lifecyclestage), numDeals: Number(p.num_associated_deals) || 0,
      link: urlTemplate ? urlTemplate.replace("{id}", raw.id) : null,
    };
  }

  // ---------- call classification (rules 1, 2, 3) ----------
  const GATE_RE = /\b(gatekeeper|receptionist|front[- ]desk|front office|operator|secretary|assistant|voice ?mail|left (?:a |her |him )?(?:message|vm)|no answer|did not answer|didn'?t answer|did not pick up|didn'?t pick up|unavailable|not available|not in (?:the office|today)|out of (?:the )?office|automated (?:system|attendant)|phone tree|ivr|dial[- ]by[- ]name|took (?:a |his |jack'?s |carly'?s )?(?:message|name|number)|pass (?:along|on) the message|transferred)\b/i;
  const DECLINE_RE = /\b(not interested|declined|no interest|not a fit|no need|do not (?:call|contact)|don'?t (?:call|contact)|asked (?:us |jack |carly )?not to|uninterested|happy with (?:their|the|our) current|already have (?:a|an) (?:partner|provider|msp)|no longer interested)\b/i;
  const MEETING_RE = /\b(booked|scheduled (?:a |an )?(?:meeting|call|demo|intro|discovery)|set (?:up )?(?:a |an )?(?:meeting|call|demo|time|intro)|agreed to (?:a |an )?(?:meeting|call|demo|intro)|calendar invite|sent (?:an? )?invite|meeting (?:on|for|next)|demo (?:on|for|next))\b/i;
  const ENGAGED_RE = /\b(quote|pricing|proposal|evaluat\w*|currently looking at|considering|requested (?:more )?(?:info|information|details)|asked (?:for|jack to|carly to|us to) (?:send|more|info|pricing)|send (?:over )?(?:info|information|details|pricing)|call (?:him|her|them) back|follow[- ]up (?:call|meeting) (?:on|for|next))\b/i;
  const SPOKE_RE = /\b(spoke (?:with|to)|talked (?:with|to)|conversation with|had a (?:great |good |brief |quick )?(?:call|conversation|chat)|discussed|connected with|reached (?:him|her|them)|(?:he|she|they) (?:said|mentioned|confirmed|explained|indicated|shared|noted)|told (?:jack|carly|us|him))\b/i;

  // Looks at a call's written summary (Trellus AI summary carried in the Apollo note).
  // Sentences about a gatekeeper or voicemail are set aside first, so "spoke to the receptionist"
  // never counts as a conversation with the prospect.
  function analyzeCallSummary(text) {
    const t = (text || "").trim();
    if (!t) return { kind: "none" };
    const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
    const prospect = sentences.filter((s) => !GATE_RE.test(s));
    const gateOnly = prospect.length < sentences.length;
    const body = prospect.join(" ");
    const quote = (re) => { const s = prospect.find((x) => re.test(x)); return s || ""; };
    if (DECLINE_RE.test(body)) return { kind: "declined", quote: quote(DECLINE_RE) };
    if (MEETING_RE.test(body)) return { kind: "meeting", quote: quote(MEETING_RE) };
    if (ENGAGED_RE.test(body)) return { kind: "engaged", quote: quote(ENGAGED_RE) };
    if (SPOKE_RE.test(body)) return { kind: "spoke", quote: quote(SPOKE_RE) };
    return { kind: gateOnly ? "gatekeeper" : "none" };
  }

  // -> {effect:'remove'|'review'|'touch', status, rule, reason, connected}
  function classifyCall(call, cfg) {
    const o = cfg.outcomes;
    const label = (cfg.outcomeLabels || {})[call.outcomeId] || (call.outcomeId ? "Unknown outcome" : "No disposition");
    const src = call.trellusUrl ? "Trellus summary (in Apollo call note)" : "Apollo call note";
    const fromSummary = () => {
      const a = analyzeCallSummary(call.summary);
      if (a.kind === "declined") return { effect: "remove", status: "closed", rule: 2, connected: true, reason: `Call logged "${label}" but the summary says they declined: "${a.quote}"`, source: src };
      if (a.kind === "meeting") return { effect: "remove", status: "live", rule: 2, connected: true, reason: `Call logged "${label}" but the summary shows a meeting or follow-up was set: "${a.quote}"`, source: src };
      if (a.kind === "engaged") return { effect: "remove", status: "live", rule: 2, connected: true, reason: `Call logged "${label}" but the summary shows they engaged: "${a.quote}"`, source: src };
      if (a.kind === "spoke") return { effect: "remove", status: "contacted", rule: 2, connected: true, reason: `Call logged "${label}" but the summary says they spoke: "${a.quote}"`, source: src };
      return null;
    };
    switch (call.outcomeId) {
      case o.meetingBooked: case o.infoRequested: case o.callBack: case o.pendingReview:
        return { effect: "remove", status: "live", rule: 1, connected: true, reason: `Call outcome: ${label}`, source: "Apollo calls" };
      case o.notInterested: case o.doNotContact:
        return { effect: "remove", status: "closed", rule: 1, connected: true, reason: `Call outcome: ${label}`, source: "Apollo calls" };
      case o.wrongNumber:
        return { effect: cfg.wrongNumber === "remove" ? "remove" : "review", status: "touched", rule: 1, connected: false, reason: "Call outcome: Wrong number (bad phone, not a conversation)", source: "Apollo calls" };
      case o.gatekeeper: case o.noAnswer: case o.leftVoicemail:
        return fromSummary() || { effect: "touch", status: "touched", rule: 3, connected: false, reason: `Call: ${label}`, source: "Apollo calls" };
      case null: case undefined: case "": {
        if (call.durationSec >= cfg.longCallSec) return { effect: "remove", status: "contacted", rule: 2, connected: true, reason: `No-disposition call lasted ${fmtDur(call.durationSec)}`, source: "Apollo calls" };
        const s = fromSummary();
        if (s) return s;
        if (call.durationSec >= cfg.midCallSec && !call.summary) return { effect: "remove", status: "contacted", rule: 2, connected: true, reason: `No-disposition call lasted ${fmtDur(call.durationSec)} with no note`, source: "Apollo calls" };
        return { effect: "touch", status: "touched", rule: 2, connected: false, reason: "Call: No disposition", source: "Apollo calls" };
      }
      default:
        return fromSummary() || { effect: "review", status: "touched", rule: 1, connected: false, reason: "Call outcome not recognized; check it", source: "Apollo calls" };
    }
  }
  function fmtDur(s) { const m = Math.floor(s / 60), r = s % 60; return `${m}m ${String(r).padStart(2, "0")}s`; }

  // ---------- product fit (rule 17) ----------
  function kwRegex(list) {
    const parts = list.map((k) => k.trim()).filter(Boolean)
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
    return parts.length ? new RegExp(`(?:^|[^A-Za-z0-9])(?:${parts.join("|")})(?![A-Za-z0-9])`, "i") : null;
  }
  // Short all-caps tokens (NAV, GP, AX, ERP) only count when written in capitals.
  function hasKeyword(text, list) {
    const loose = list.filter((k) => !/^[A-Z&]{2,4}$/.test(k.trim()));
    const strict = list.filter((k) => /^[A-Z&]{2,4}$/.test(k.trim()));
    const r1 = kwRegex(loose);
    if (r1 && r1.test(text)) return true;
    return strict.some((k) => new RegExp(`(?:^|[^A-Za-z0-9])${k.replace(/&/g, "&")}(?![A-Za-z0-9])`).test(text));
  }
  function productFit(text, product, cfg) {
    if (!product) return null;
    const t = text || "";
    const mine = hasKeyword(t, cfg.keywords[product] || []);
    const other = Object.keys(cfg.keywords).filter((p) => p !== product).find((p) => hasKeyword(t, cfg.keywords[p]));
    if (mine) return null;
    if (other) return { reason: `Notes point to ${other === "m365" ? "M365 / Azure" : "Dynamics"}, not this sequence's product` };
    return { reason: "No product signal in the notes" };
  }

  // ---------- evaluation ----------
  const STATUS_RANK = { never: 0, touched: 1, contacted: 2, live: 3, closed: 4 };
  const STATUS_LABEL = { never: "Never touched", touched: "Touched, no contact", contacted: "Contacted, went nowhere", live: "Live / next step pending", closed: "Closed" };
  const RULE_LABEL = {
    0: "Source not checked", 1: "Call outcome", 2: "Hidden conversation", 3: "Opted out of calls", 4: "Replied",
    5: "Email blocked", 6: "Real email thread", 7: "Meeting", 8: "Apollo stage", 9: "Deal or proposal", 10: "Active client",
    11: "Earlier sequence ended on contact", 12: "Active in another sequence", 13: "Already in call sequence",
    14: "Colleague in call sequence", 15: "Several from one company", 16: "Duplicate", 17: "Product fit", 18: "Company already engaged",
  };

  let DISABLED = new Set();
  function addF(p, f) { if (!DISABLED.has(f.rule)) p.findings.push(f); }

  // Per-person rules. ctx: {cfg, target, sequences, product, targetEmailOnly, now}
  function personFindings(p, ctx) {
    const { cfg, target } = ctx;
    p.findings = [];
    p.statusEvidence = [];
    const bump = (s) => p.statusEvidence.push(s);

    // Rule 3 / 5: opt-outs and email health
    if (p.callOptedOut) { addF(p, { rule: 3, effect: "remove", status: "closed", reason: "Opted out of calls", source: "Apollo contacts", link: p.link, scope: "person" }); bump("closed"); }
    if (p.unsubscribed) { addF(p, { rule: 5, effect: "remove", status: "closed", reason: "Unsubscribed from email", source: "Apollo contacts", link: p.link, scope: "person" }); bump("closed"); }
    if (!p.email) { addF(p, { rule: 5, effect: "remove", status: "closed", reason: "No email address", source: "Apollo contacts", link: p.link, scope: "person" }); bump("closed"); }
    else if (["invalid", "unavailable", "bounced"].includes(p.emailStatus)) { addF(p, { rule: 5, effect: "remove", status: "closed", reason: `Email status: ${p.emailStatus}`, source: "Apollo contacts", link: p.link, scope: "person" }); bump("closed"); }

    // Rule 8: stage
    if (p.stageId && cfg.removeStages[p.stageId]) {
      const name = cfg.removeStages[p.stageId];
      const st = name === "Not Interested" ? "closed" : name === "Review + Email" ? "contacted" : "live";
      addF(p, { rule: 8, effect: "remove", status: st, reason: `Apollo stage: ${name}`, source: "Apollo contacts", link: p.link, scope: "person" }); bump(st);
    } else if (p.stageId && !cfg.okStages[p.stageId] && !(cfg.allStages || {})[p.stageId]) {
      addF(p, { rule: 8, effect: "review", status: null, reason: "Apollo stage not in the settings list", source: "Apollo contacts", link: p.link, scope: "person" });
    }

    // Rules 1-3: calls
    p.callResults = (p.calls || []).map((c) => ({ call: c, cls: classifyCall(c, cfg) }));
    for (const { call, cls } of p.callResults) {
      bump(cls.status);
      if (cls.effect !== "touch") addF(p, { rule: cls.rule, effect: cls.effect, status: cls.status, reason: cls.reason, source: cls.source, at: call.at, link: call.trellusUrl || call.link, scope: "person" });
    }

    // Rules 4-5: Apollo email
    for (const e of p.emails || []) {
      if (e.replied) { addF(p, { rule: 4, effect: "remove", status: "contacted", reason: `Replied to "${e.subject || "a sequence email"}"`, source: "Apollo email", at: e.at, link: e.link, scope: "person" }); bump("contacted"); }
      else if (e.unsubscribed) { addF(p, { rule: 5, effect: "remove", status: "closed", reason: "Unsubscribed via a sequence email", source: "Apollo email", at: e.at, link: e.link, scope: "person" }); bump("closed"); }
      else if (e.bounced || e.spamBlocked) { addF(p, { rule: 5, effect: "remove", status: "closed", reason: e.bounced ? "Email bounced" : "Email spam-blocked", source: "Apollo email", at: e.at, link: e.link, scope: "person" }); bump("closed"); }
      else if (e.delivered || e.status === "completed") bump("touched");
    }

    // Rule 4/6: Outlook mail from the person (auto-replies ignored)
    for (const m of p.outlookMail || []) {
      if (m.autoReply) { bump("touched"); continue; }
      if (m.from === p.email) { addF(p, { rule: 6, effect: "remove", status: "contacted", reason: `Wrote to us: "${m.subject}"`, source: `Outlook (${m.mailbox})`, at: m.at, link: m.link, scope: "person" }); bump("contacted"); }
    }

    // Rule 7: meetings with the person
    for (const m of p.meetings || []) {
      const future = toMs(m.at) && toMs(m.at) > ctx.now;
      const st = future ? "live" : "contacted";
      addF(p, { rule: 7, effect: "remove", status: st, reason: `${future ? "Upcoming" : "Held"} meeting: ${m.title}`, source: m.source, at: m.at, link: m.link, scope: "person" }); bump(st);
    }

    // Rule 9: deals on the person
    for (const d of p.deals || []) {
      const st = d.won ? "closed" : d.closed ? "contacted" : "live";
      addF(p, { rule: d.won ? 10 : 9, effect: "remove", status: st, reason: `${d.source} deal "${d.name}"${d.stage ? ` (${d.stage})` : ""}`, source: d.source, at: d.at, link: d.link, scope: "person" }); bump(st);
    }

    // Rule 10: client flags carried on the person (HubSpot lifecycle customer)
    for (const c of p.clientFlags || []) { addF(p, { rule: 10, effect: "remove", status: "closed", reason: c.reason, source: c.source, link: c.link, scope: "person" }); bump("closed"); }

    // Rules 11-13: sequence history
    const others = (p.enrollments || []).filter((e) => e.sequenceId !== target.id);
    for (const e of others) {
      const seqName = e.sequenceName || (ctx.sequences[e.sequenceId] || {}).name || e.sequenceId;
      bump(e.step && e.step > 0 ? "touched" : "touched");
      const reason = lc(e.reason);
      if (e.status === "finished" && reason && cfg.contactEndReasons.some((r) => reason.includes(lc(r)))) {
        addF(p, { rule: 11, effect: "remove", status: "contacted", reason: `"${seqName}" ended: ${e.reason}`, source: "Apollo sequences", at: e.finishedAt, link: `https://app.apollo.io/#/sequences/${e.sequenceId}`, scope: "person" }); bump("contacted");
      }
      if (["active", "paused"].includes(e.status)) {
        addF(p, { rule: 12, effect: "conflict", status: null, reason: `${e.status === "active" ? "Active" : "Paused"} in "${seqName}"`, source: "Apollo sequences", at: e.addedAt, link: `https://app.apollo.io/#/sequences/${e.sequenceId}`, scope: "person", sequenceId: e.sequenceId, apolloContactId: e.apolloContactId });
      }
      const callSeqs = (cfg.callSequences && ctx.product && cfg.callSequences[ctx.product]) || [];
      if (ctx.targetEmailOnly && callSeqs.includes(e.sequenceId)) {
        addF(p, { rule: 13, effect: "remove", status: null, reason: `Already ${e.status === "finished" ? "went through" : "in"} the call sequence "${seqName}"`, source: "Apollo sequences", at: e.addedAt, link: `https://app.apollo.io/#/sequences/${e.sequenceId}`, scope: "person" });
      }
    }

    // Rule 17: fit (review only)
    const fitText = [p.customText, ...(p.calls || []).map((c) => c.summary), ...(p.deals || []).map((d) => d.name)].filter(Boolean).join(" | ");
    const fit = productFit(fitText, ctx.product, cfg);
    if (fit) addF(p, { rule: 17, effect: "review", status: null, reason: fit.reason, source: "Apollo notes", link: p.link, scope: "person" });

    // Rule 0: per-person source failures
    for (const [src, chk] of Object.entries(p.sourceChecks || {})) {
      if (chk && chk.state === "error") addF(p, { rule: 0, effect: "review", status: null, reason: `${src} not checked: ${chk.reason || "error"}`, source: src, scope: "person" });
    }
    return p;
  }

  // Findings that make a COMPANY count as engaged (rule 18). Contact made, a meeting, a deal or a client.
  const CONTACT_RULES = new Set([1, 2, 4, 6, 7, 8, 9, 10, 11]);
  function isContactMade(f) {
    if (!CONTACT_RULES.has(f.rule) || f.effect !== "remove") return false;
    if (f.rule === 1 && f.status === "touched") return false;
    if (f.rule === 8 && !["live", "closed"].includes(f.status)) return false;
    return true;
  }

  // company index: key -> [{reason, source, at, link, fromPersonId}]
  function buildCompanyIndex(people, companySources, cfg) {
    const idx = new Map();
    const put = (k, e) => { if (!k) return; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(e); };
    for (const p of people) {
      for (const f of p.findings) {
        if (!isContactMade(f) || f.scope !== "person") continue;
        const e = { reason: `${p.name || p.email}: ${f.reason}`, source: f.source, at: f.at, link: f.link, fromPersonId: p.uid, kind: f.rule === 10 ? "client" : "contact" };
        if (!isFree(p.domain, cfg)) put(`d:${p.domain}`, e);
        put(`n:${p.companyKey}`, e);
      }
    }
    for (const c of companySources || []) {
      const e = { reason: c.reason, source: c.source, at: c.at, link: c.link, fromPersonId: c.fromPersonId || null, kind: c.kind || "contact" };
      if (c.domain && !isFree(c.domain, cfg)) put(`d:${normDomain(c.domain)}`, e);
      if (c.companyKey) put(`n:${c.companyKey}`, e);
    }
    return idx;
  }

  function evaluateRun(input) {
    const cfg = input.cfg;
    DISABLED = new Set((cfg.disabledRules || []).map(Number));
    const now = input.now || Date.now();
    const target = input.target;
    const sequences = input.sequences || {};
    const ctx = { cfg, target, sequences, product: input.product, targetEmailOnly: !!input.targetEmailOnly, now };
    const people = input.people.map((p, i) => ({ ...p, uid: p.uid || p.apolloId || `p${i}` }));
    people.forEach((p) => personFindings(p, ctx));
    const inRun = new Set(people.map((p) => p.apolloId));
    const colleagues = (input.colleagues || []).filter((c) => !inRun.has(c.apolloId))
      .map((c, i) => personFindings({ ...c, uid: c.uid || c.apolloId || `c${i}` }, ctx));

    // Rule 18: company already engaged (domain or company-name match)
    const idx = buildCompanyIndex(people.concat(colleagues), input.companySources || [], cfg);
    for (const p of people) {
      const seen = new Set();
      const hits = [];
      const tryKey = (k, basis) => {
        for (const e of idx.get(k) || []) {
          if (e.fromPersonId === p.uid) continue;
          const sig = `${e.source}|${e.reason}|${e.at}`;
          if (seen.has(sig)) continue;
          seen.add(sig); hits.push({ ...e, basis });
        }
      };
      if (!isFree(p.domain, cfg)) tryKey(`d:${p.domain}`, `email domain ${p.domain}`);
      if (p.companyKey) tryKey(`n:${p.companyKey}`, `company name "${p.company}"`);
      for (const h of hits) {
        const client = h.kind === "client";
        addF(p, { rule: client ? 10 : 18, effect: "remove", status: client ? "closed" : null, reason: `${client ? "Company is a client" : "Company already engaged"}: ${h.reason}`, source: h.source, at: h.at, link: h.link, scope: "company", basis: h.basis });
        if (client) p.statusEvidence.push("closed");
      }
    }

    // Rule 14: colleague active in the live call sequence for this product
    const callSeqs = (cfg.callSequences && ctx.product && cfg.callSequences[ctx.product]) || [];
    const activeCallers = new Map();
    for (const c of colleagues) {
      for (const e of c.enrollments || []) {
        if (callSeqs.includes(e.sequenceId) && ["active", "paused"].includes(e.status)) {
          const keys = [];
          if (!isFree(c.domain, cfg)) keys.push(`d:${c.domain}`);
          if (c.companyKey) keys.push(`n:${c.companyKey}`);
          for (const k of keys) { if (!activeCallers.has(k)) activeCallers.set(k, []); activeCallers.get(k).push({ c, e }); }
        }
      }
    }
    for (const p of people) {
      const keys = [];
      if (!isFree(p.domain, cfg)) keys.push(`d:${p.domain}`);
      if (p.companyKey) keys.push(`n:${p.companyKey}`);
      const hit = keys.flatMap((k) => activeCallers.get(k) || []).find(({ c }) => c.apolloId !== p.apolloId && lc(c.email) !== p.email);
      if (hit) addF(p, { rule: 14, effect: "conflict", status: null, reason: `Colleague ${hit.c.name} is active in call sequence "${hit.e.sequenceName}"`, source: "Apollo sequences", link: hit.c.link, scope: "company", sequenceId: hit.e.sequenceId });
    }

    // Rule 16: same person twice in this sequence -> keep one
    const groups16 = new Map();
    for (const p of people) {
      const k = p.email ? `e:${p.email}` : `n:${nameKey(p.first, p.last, p.name)}|${p.companyKey}`;
      if (!groups16.has(k)) groups16.set(k, []);
      groups16.get(k).push(p);
    }
    for (const g of groups16.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => (toMs(a.addedAt) || 0) - (toMs(b.addedAt) || 0));
      g.slice(1).forEach((p) => addF(p, { rule: 16, effect: "remove", status: null, reason: `Duplicate of ${g[0].name || g[0].email} already in this sequence`, source: "Apollo contacts", link: g[0].link, scope: "person" }));
    }

    // Bucket + status, then rule 15 (needs to know who is still a KEEP)
    for (const p of people) finalize(p, ctx);
    const byCompany = new Map();
    for (const p of people) {
      if (p.bucket === "REMOVE") continue;
      const k = !isFree(p.domain, cfg) ? `d:${p.domain}` : p.companyKey ? `n:${p.companyKey}` : null;
      if (!k) continue;
      if (!byCompany.has(k)) byCompany.set(k, []);
      byCompany.get(k).push(p);
    }
    for (const g of byCompany.values()) {
      if (g.length < 2) continue;
      const ranked = g.slice().sort((a, b) => rankKeep(a, cfg) - rankKeep(b, cfg));
      const best = ranked[0];
      best.companyPick = true;
      ranked.slice(1).forEach((p) => { addF(p, { rule: 15, effect: "review", status: null, reason: `${g.length} people from this company in the sequence; ${best.name || best.email} is the suggested one to keep`, source: "Apollo contacts", link: best.link, scope: "company" }); finalize(p, ctx); });
    }
    return { people, companyIndexSize: idx.size };
  }

  function titleRank(title, cfg) {
    const t = lc(title);
    const i = (cfg.titlePriority || []).findIndex((x) => t.includes(lc(x)));
    return i === -1 ? 999 : i;
  }
  function rankKeep(p, cfg) {
    return titleRank(p.title, cfg) * 100 + (p.emailStatus === "verified" ? 0 : 10) + STATUS_RANK[p.status] * 2;
  }

  function finalize(p, ctx) {
    const f = p.findings;
    p.bucket = f.some((x) => x.effect === "remove") ? "REMOVE"
      : f.some((x) => x.effect === "conflict") ? "CONFLICTS"
        : f.some((x) => x.effect === "review") ? "REVIEW" : "KEEP";
    let st = "never";
    for (const s of p.statusEvidence.concat(f.map((x) => x.status)).filter(Boolean)) if (STATUS_RANK[s] > STATUS_RANK[st]) st = s;
    p.status = st;
    if (p.bucket === "KEEP") p.keepGroup = st === "never" ? "Never touched" : "Touched, no contact";
    p.totals = totals(p, ctx);
    p.primaryReason = (f.find((x) => x.effect === "remove") || f.find((x) => x.effect === "conflict") || f.find((x) => x.effect === "review") || {}).reason || "";
    return p;
  }

  function totals(p, ctx) {
    const others = (p.enrollments || []).filter((e) => e.sequenceId !== ctx.target.id);
    const calls = (p.callResults || []);
    const emails = p.emails || [];
    let linkedin = 0;
    for (const e of others) {
      const seq = ctx.sequences[e.sequenceId];
      if (!seq || !seq.steps || !e.step) continue;
      const reached = e.status === "finished" ? e.step : e.step - 1;
      linkedin += seq.steps.filter((s) => s.position <= reached && /^linkedin/.test(s.type)).length;
    }
    const meetings = (p.meetings || []).length;
    const sent = emails.filter((e) => e.delivered || e.status === "completed").length;
    const times = [
      ...calls.map((c) => c.call.at), ...emails.map((e) => e.at), ...(p.meetings || []).map((m) => m.at),
      ...(p.outlookMail || []).map((m) => m.at), ...others.map((e) => e.addedAt),
    ].map(toMs).filter((x) => x && x <= ctx.now);
    const first = times.length ? Math.min(...times) : null;
    const last = times.length ? Math.max(...times) : null;
    let furthest = null;
    for (const e of others) {
      if (!e.step) continue;
      const seq = ctx.sequences[e.sequenceId];
      const total = seq && seq.numSteps ? seq.numSteps : null;
      if (!furthest || e.step > furthest.step) furthest = { step: e.step, total, sequenceName: e.sequenceName };
    }
    return {
      sequences: new Set(others.map((e) => e.sequenceId)).size,
      calls: calls.length, callsConnected: calls.filter((c) => c.cls.connected).length,
      emailsSent: sent, emailsOpened: emails.filter((e) => e.opened).length, emailsReplied: emails.filter((e) => e.replied).length,
      linkedin, meetings,
      touchpoints: calls.length + sent + linkedin + meetings,
      firstTouch: first ? new Date(first).toISOString() : null,
      lastTouch: last ? new Date(last).toISOString() : null,
      daysSince: last ? Math.floor((ctx.now - last) / DAY) : null,
      furthest,
      furthestLabel: furthest ? `step ${furthest.step}${furthest.total ? ` of ${furthest.total}` : ""}` : "",
    };
  }

  // One row per touchpoint, for the detail panel and the second CSV.
  function touchpoints(p, ctx) {
    const rows = [];
    const seqName = (id) => (ctx.sequences[id] || {}).name || "";
    for (const e of p.enrollments || []) {
      const seq = ctx.sequences[e.sequenceId];
      if (seq && seq.steps && e.step) {
        const reached = e.status === "finished" ? e.step : e.step - 1;
        for (const st of seq.steps.filter((x) => x.position <= reached && /^linkedin/.test(x.type))) {
          rows.push({ kind: "LinkedIn", at: null, sequence: e.sequenceName || seqName(e.sequenceId), step: `step ${st.position}`, type: st.type === "linkedin_step_connect" ? "LinkedIn connect" : "LinkedIn message", result: "Step passed (Apollo keeps no LinkedIn activity record)", link: `https://app.apollo.io/#/sequences/${e.sequenceId}`, source: "Apollo" });
        }
      }
      rows.push({ kind: "Sequence", at: e.addedAt, sequence: e.sequenceName || seqName(e.sequenceId), step: e.step ? `step ${e.step}${seq && seq.numSteps ? ` of ${seq.numSteps}` : ""}` : "", type: "Enrolled", result: `${e.status}${e.reason ? `: ${e.reason}` : ""}${e.finishedAt ? ` (finished ${e.finishedAt.slice(0, 10)})` : ""}`, by: (ctx.cfg.users || {})[e.addedBy] || "", link: `https://app.apollo.io/#/sequences/${e.sequenceId}`, source: "Apollo" });
    }
    for (const { call, cls } of p.callResults || []) {
      rows.push({ kind: "Call", at: call.at, sequence: call.sequenceName || seqName(call.sequenceId), step: call.step ? `step ${call.step}` : "", type: call.inbound ? "Inbound call" : "Call", result: `${(ctx.cfg.outcomeLabels || {})[call.outcomeId] || "No disposition"}${cls.connected ? " (connected)" : ""}`, duration: call.durationSec, by: call.caller, note: call.summary, link: call.trellusUrl || call.link, source: call.trellusUrl ? "Apollo + Trellus" : "Apollo" });
    }
    for (const e of p.emails || []) {
      const res = e.replied ? "Replied" : e.bounced ? "Bounced" : e.unsubscribed ? "Unsubscribed" : e.spamBlocked ? "Spam-blocked" : e.opened ? "Opened" : e.delivered ? "Delivered" : e.status || "";
      rows.push({ kind: "Email", at: e.at, sequence: seqName(e.sequenceId), step: "", type: "Auto email", result: res, subject: e.subject, link: e.link, source: "Apollo" });
    }
    for (const m of p.outlookMail || []) rows.push({ kind: "Email", at: m.at, sequence: "", step: "", type: "Inbound email", result: m.autoReply ? "Auto-reply (ignored)" : "They wrote", subject: m.subject, link: m.link, source: `Outlook (${m.mailbox})` });
    for (const m of p.meetings || []) rows.push({ kind: "Meeting", at: m.at, sequence: "", step: "", type: m.type || "Meeting", result: m.title, link: m.link, source: m.source });
    for (const d of p.deals || []) rows.push({ kind: "Deal", at: d.at, sequence: "", step: "", type: "Deal", result: `${d.name}${d.stage ? ` (${d.stage})` : ""}`, link: d.link, source: d.source });
    return rows.sort((a, b) => (toMs(b.at) || 0) - (toMs(a.at) || 0));
  }

  // ---------- rule catalog (what the Rules page shows) ----------
  // effect: what a hit does. params: which settings the rule reads, edited in place on the Rules page.
  const RULES = [
    { id: 1, group: "Phone", name: "Call outcome", effect: "remove", params: ["wrongNumber"],
      what: "Any logged outcome other than No Answer or Left Voicemail: Meeting Booked, Qualified / Pending Review, Info Requested, Call Back Scheduled, Not Interested, Do Not Contact.",
      why: "A disposition like that means someone already spoke with them." },
    { id: 2, group: "Phone", name: "Hidden conversation", effect: "remove", params: ["longCallSec", "midCallSec"],
      what: "A No Disposition or No Answer call that was really a conversation: long enough, or the Trellus summary in the call note says they spoke, set a meeting, asked for a quote, are evaluating, or declined.",
      why: "Trellus logs calls into Apollo with a duration of 0, so the summary is what usually catches these. Sentences about a gatekeeper or voicemail are ignored." },
    { id: 3, group: "Phone", name: "Opted out of calls", effect: "remove", params: [],
      what: "The contact is marked as opted out of calls. Gatekeeper-only calls and calls transferred to voicemail stay in.",
      why: "A hard block." },
    { id: 4, group: "Email", name: "Replied", effect: "remove", params: [],
      what: "They replied to any Apollo email, from anyone at Wired CIO, at any time.", why: "A reply is contact." },
    { id: 5, group: "Email", name: "Email blocked", effect: "remove", params: [],
      what: "Unsubscribed, bounced, spam-blocked, invalid or unavailable email, or no email at all.", why: "Can't be emailed." },
    { id: 6, group: "Email", name: "Real email thread", effect: "remove", params: ["extraMailboxes"],
      what: "They wrote to a Wired CIO mailbox in Outlook. Out-of-office and other auto-replies don't count, and neither do unreplied sequence emails.",
      why: "They engaged one to one." },
    { id: 7, group: "Meetings & CRM", name: "Meeting", effect: "remove", params: ["calendarMonths"],
      what: "An intro, discovery, demo or sales meeting with them: in Echo, or on the Outlook calendar. A meeting with anyone else at their company is caught by rule 18.",
      why: "A meeting is contact, booked or held." },
    { id: 8, group: "Meetings & CRM", name: "Apollo stage", effect: "remove", params: ["removeStages"],
      what: "Their Apollo contact stage is one you've marked as a remove stage.", why: "The stage already says where they stand." },
    { id: 9, group: "Meetings & CRM", name: "Deal or proposal", effect: "remove", params: [],
      what: "A deal or proposal on file for them or their company in Apollo, HubSpot or Switchboard, open or closed.", why: "They're already in the pipeline, or were." },
    { id: 10, group: "Meetings & CRM", name: "Active client", effect: "remove", params: [],
      what: "Their company is a client: HubSpot lifecycle Customer, a closed-won deal, a Switchboard client room, or delivery meetings in Echo. Applies at every contact and title.",
      why: "Clients are never prospected." },
    { id: 11, group: "Sequence history", name: "Earlier sequence ended on contact", effect: "remove", params: ["contactEndReasons"],
      what: "A past sequence ended for one of these reasons.", why: "Apollo already recorded that contact was made." },
    { id: 12, group: "Sequence history", name: "Active in another sequence", effect: "conflict", params: [],
      what: "They're active or paused in a different sequence.", why: "You choose whether to finish them there." },
    { id: 13, group: "Sequence history", name: "Already in the call sequence", effect: "remove", params: ["callSequences"],
      what: "They were ever in your live call sequence for the same product, active or finished. Only applies when the sequence you're checking is email only.",
      why: "The call sequence already covers them." },
    { id: 14, group: "Sequence history", name: "Colleague in the call sequence", effect: "conflict", params: ["callSequences"],
      what: "Someone else at their company is active in your live call sequence for this product.", why: "One outreach per company per motion." },
    { id: 15, group: "Sequence history", name: "Several from one company", effect: "review", params: ["titlePriority"],
      what: "More than one person from the same company is in this sequence. The best one stays in KEEP, the rest go to REVIEW.",
      why: "Pick who carries the conversation." },
    { id: 16, group: "Sequence history", name: "Duplicate", effect: "remove", params: [],
      what: "The same person twice in this sequence: same email, or same name and company.", why: "Keeps one copy." },
    { id: 17, group: "Fit", name: "Product fit", effect: "review", params: ["keywords"],
      what: "Their notes don't mention this sequence's product, or point to the other product. A bare CRM or sales doesn't count without Dynamics or D365.",
      why: "Never removes, only flags for you to decide." },
    { id: 18, group: "Company", name: "Company already engaged", effect: "remove", params: ["freeDomains"],
      what: "We've talked with, met with, or dealt with anyone at their company, or the company is a client. Matched by email domain or company name.",
      why: "Each hit says which it matched on, so name-only matches can be checked." },
    { id: 0, group: "Sources", name: "Source not checked", effect: "review", params: [],
      what: "A source that should have worked failed for this person during the run.", why: "Nothing is ever silently skipped." },
  ];

  // ---------- actions planning (pure) ----------
  // decisions: {uid: {action:'remove'|'keep'|'move'|'followup'|'skip', moveTo, note, finishElsewhere}}
  function planActions(people, decisions, target, opts) {
    const o = opts || {};
    const byUid = new Map(people.map((p) => [p.uid, p]));
    const plan = { removeHere: [], finishElsewhere: [], moveTo: [], tagged: [], kept: [], skipped: [] };
    const targetMode = o.targetEverSent ? "stop" : "remove";
    for (const [uid, d] of Object.entries(decisions || {})) {
      const p = byUid.get(uid);
      if (!p || !d) continue;
      const item = { uid, name: p.name, email: p.email, company: p.company, contactId: p.targetContactId || p.apolloId, note: d.note || "" };
      if (d.action === "remove" || d.action === "move") plan.removeHere.push({ ...item, mode: targetMode, reason: d.note || p.primaryReason || "Sequence Hygiene" });
      if (d.action === "move") plan.moveTo.push({ ...item, sequenceId: d.moveTo, mailbox: p.targetMailbox || null });
      if (d.action === "followup") plan.tagged.push(item);
      if (d.action === "keep") plan.kept.push(item);
      if (d.action === "skip") plan.skipped.push(item);
      if (d.finishElsewhere) {
        for (const f of p.findings.filter((x) => x.rule === 12 && x.sequenceId)) {
          plan.finishElsewhere.push({ ...item, contactId: f.apolloContactId || item.contactId, sequenceId: f.sequenceId, reason: `Finished by Sequence Hygiene: being handled in "${target.name}"` });
        }
      }
    }
    return plan;
  }

  // ---------- CSV ----------
  function csvCell(v) {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // keep spreadsheet formulas from running
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }
  function toCsv(rows, cols) {
    return [cols.map((c) => csvCell(c.label)).join(","), ...rows.map((r) => cols.map((c) => csvCell(typeof c.get === "function" ? c.get(r) : r[c.get])).join(","))].join("\r\n");
  }
  const CONTACT_COLS = [
    { label: "Bucket", get: "bucket" }, { label: "Status", get: (p) => STATUS_LABEL[p.status] },
    { label: "Name", get: "name" }, { label: "Email", get: "email" }, { label: "Title", get: "title" }, { label: "Company", get: "company" },
    { label: "Main reason", get: "primaryReason" },
    { label: "All reasons", get: (p) => p.findings.map((f) => `[${RULE_LABEL[f.rule]}] ${f.reason}`).join(" | ") },
    { label: "Sources", get: (p) => [...new Set(p.findings.map((f) => f.source))].join(" | ") },
    { label: "Sequences", get: (p) => p.totals.sequences }, { label: "Furthest step", get: (p) => p.totals.furthestLabel },
    { label: "Calls", get: (p) => p.totals.calls }, { label: "Calls connected", get: (p) => p.totals.callsConnected },
    { label: "Emails sent", get: (p) => p.totals.emailsSent }, { label: "Emails opened", get: (p) => p.totals.emailsOpened },
    { label: "Emails replied", get: (p) => p.totals.emailsReplied }, { label: "LinkedIn steps", get: (p) => p.totals.linkedin },
    { label: "Meetings", get: (p) => p.totals.meetings }, { label: "Total touchpoints", get: (p) => p.totals.touchpoints },
    { label: "First touch", get: (p) => (p.totals.firstTouch || "").slice(0, 10) }, { label: "Last touch", get: (p) => (p.totals.lastTouch || "").slice(0, 10) },
    { label: "Days since last touch", get: (p) => p.totals.daysSince },
    { label: "Not checked", get: (p) => (p.notChecked || []).join(" | ") },
    { label: "Apollo link", get: "link" },
  ];
  const TOUCH_COLS = [
    { label: "Name", get: "name" }, { label: "Email", get: "email" }, { label: "Company", get: "company" },
    { label: "Kind", get: "kind" }, { label: "Date", get: (r) => (r.at || "").slice(0, 10) }, { label: "Sequence", get: "sequence" },
    { label: "Step", get: "step" }, { label: "Type", get: "type" }, { label: "Result", get: "result" },
    { label: "Duration (s)", get: "duration" }, { label: "By", get: "by" }, { label: "Subject", get: "subject" },
    { label: "Note", get: "note" }, { label: "Source", get: "source" }, { label: "Link", get: "link" },
  ];

  const api = {
    lc, normEmail, emailDomain, normDomain, companyKey, nameKey, isFree, toMs, fmtDur,
    adaptApolloContact, adaptApolloCall, adaptApolloMessage, adaptOutlookMail, adaptCalendarEvent, adaptEchoMeeting,
    adaptSwitchboardCompany, adaptHubspotCompany, adaptHubspotDeal, adaptHubspotContact, splitCallNote,
    analyzeCallSummary, classifyCall, productFit, hasKeyword, evaluateRun, touchpoints, planActions, toCsv,
    CONTACT_COLS, TOUCH_COLS, STATUS_LABEL, STATUS_RANK, RULE_LABEL, RULES, isContactMade,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SH_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
