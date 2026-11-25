// Run: node --test sequence-hygiene/test
// Every person, company and id below is made up.
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rules.js");
const { DEFAULTS } = require("../src/config.js");

const cfg = JSON.parse(JSON.stringify(DEFAULTS));
cfg.callSequences = { dynamics: ["seqCall"], m365: [] };
const O = cfg.outcomes;
const NOW = Date.parse("2026-11-23T12:00:00Z");
const TARGET = { id: "seqTarget", name: "Test Email Sequence" };
const SEQS = {
  seqTarget: { name: "Test Email Sequence", numSteps: 3, steps: [1, 2, 3].map((n) => ({ position: n, type: "auto_email" })) },
  seqCall: { name: "Test Call Sequence", numSteps: 6, steps: [
    { position: 1, type: "call" }, { position: 2, type: "auto_email" }, { position: 3, type: "call" },
    { position: 4, type: "linkedin_step_connect" }, { position: 5, type: "call" }, { position: 6, type: "auto_email" }] },
  seqOld: { name: "Old Sequence", numSteps: 6, steps: [
    { position: 1, type: "auto_email" }, { position: 2, type: "call" }, { position: 3, type: "auto_email" },
    { position: 4, type: "linkedin_step_message" }, { position: 5, type: "call" }, { position: 6, type: "auto_email" }] },
};

let n = 0;
function person(over = {}) {
  n += 1;
  const id = over.apolloId || `c${n}`;
  return {
    apolloId: id, name: over.name || `Pat Example${n}`, first: "Pat", last: `Example${n}`,
    email: over.email !== undefined ? over.email : `pat${n}@acme${n}.example`, emailStatus: "verified", title: "Controller",
    company: over.company || `Acme ${n} Inc`, companyKey: R.companyKey(over.company || `Acme ${n} Inc`),
    domain: over.domain || (over.email ? R.emailDomain(over.email) : `acme${n}.example`),
    stageId: null, unsubscribed: false, callOptedOut: false, customText: "Interested in Dynamics 365 Business Central",
    enrollments: [{ sequenceId: "seqTarget", sequenceName: "Test Email Sequence", status: "paused", addedAt: "2026-11-23T10:00:00Z", apolloContactId: id }],
    calls: [], emails: [], meetings: [], deals: [], outlookMail: [], clientFlags: [], sourceChecks: {},
    link: `https://app.apollo.io/#/contacts/${id}`,
    ...over,
  };
}
const call = (over) => ({ id: `call${Math.random()}`, contactId: "x", outcomeId: null, durationSec: 0, summary: "", trellusUrl: null, at: "2026-11-01T15:00:00Z", caller: "Jack", ...over });
function run(people, extra = {}) {
  return R.evaluateRun({ cfg, now: NOW, target: TARGET, sequences: SEQS, product: "dynamics", targetEmailOnly: true, people, ...extra }).people;
}
const one = (p, extra) => run([p], extra)[0];
const rules = (p) => p.findings.map((f) => f.rule);

// ---------- baseline ----------
test("a clean lead with nothing on file is KEEP / never touched", () => {
  const p = one(person());
  assert.equal(p.bucket, "KEEP");
  assert.equal(p.status, "never");
  assert.equal(p.keepGroup, "Never touched");
});

// ---------- phone: rules 1-3 ----------
test("rule 1: each contact outcome removes with the right status", () => {
  const cases = [[O.meetingBooked, "live"], [O.infoRequested, "live"], [O.callBack, "live"], [O.pendingReview, "live"], [O.notInterested, "closed"], [O.doNotContact, "closed"]];
  for (const [outcomeId, status] of cases) {
    const p = one(person({ calls: [call({ outcomeId })] }));
    assert.equal(p.bucket, "REMOVE", outcomeId);
    assert.equal(p.status, status, outcomeId);
  }
});
test("trap: gatekeeper-only stays (KEEP, touched)", () => {
  const p = one(person({ calls: [call({ outcomeId: O.gatekeeper, summary: "The gatekeeper said Pat was unavailable and took Jack's number." })] }));
  assert.equal(p.bucket, "KEEP");
  assert.equal(p.status, "touched");
  assert.equal(p.keepGroup, "Touched, no contact");
});
test("no answer and left voicemail stay as touched", () => {
  for (const outcomeId of [O.noAnswer, O.leftVoicemail]) {
    const p = one(person({ calls: [call({ outcomeId })] }));
    assert.equal(p.bucket, "KEEP");
    assert.equal(p.status, "touched");
  }
});
test("transferred to voicemail stays", () => {
  const p = one(person({ calls: [call({ outcomeId: null, summary: "Front desk transferred Jack to voicemail; left a message." })] }));
  assert.equal(p.bucket, "KEEP");
});
test("trap: a 4-minute No Disposition call goes", () => {
  const p = one(person({ calls: [call({ outcomeId: null, durationSec: 241 })] }));
  assert.equal(p.bucket, "REMOVE");
  assert.ok(rules(p).includes(2));
  assert.equal(p.totals.callsConnected, 1);
});
test("rule 2: a 2-4 minute No Disposition call with no note goes; with a gatekeeper note it stays", () => {
  assert.equal(one(person({ calls: [call({ durationSec: 150 })] })).bucket, "REMOVE");
  assert.equal(one(person({ calls: [call({ durationSec: 150, summary: "Receptionist took a message." })] })).bucket, "KEEP");
  assert.equal(one(person({ calls: [call({ durationSec: 90 })] })).bucket, "KEEP");
});
test("trap: a Trellus summary showing a conversation overrides a No Answer log", () => {
  const p = one(person({ calls: [call({ outcomeId: O.noAnswer, trellusUrl: "https://app.trellus.ai/transcripts?id=fake", summary: "Jack spoke with Pat about Business Central. Pat said they are evaluating options and asked for pricing." })] }));
  assert.equal(p.bucket, "REMOVE");
  const f = p.findings.find((x) => x.rule === 2);
  assert.match(f.source, /Trellus/);
  assert.equal(f.link, "https://app.trellus.ai/transcripts?id=fake");
});
test("rule 2: summary wording maps to the right status", () => {
  assert.equal(one(person({ calls: [call({ summary: "Pat said they are not interested at this time." })] })).status, "closed");
  assert.equal(one(person({ calls: [call({ summary: "Jack and Pat set up a demo for next Tuesday." })] })).status, "live");
  assert.equal(one(person({ calls: [call({ summary: "Jack talked with Pat about their current ERP." })] })).status, "contacted");
});
test("rule 2: talking to the receptionist is not talking to the prospect", () => {
  const a = R.analyzeCallSummary("Jack spoke with the receptionist. She said Pat is out of the office this week.");
  assert.equal(a.kind, "gatekeeper");
});
test("rule 3: opted out of calls removes", () => {
  const p = one(person({ callOptedOut: true }));
  assert.equal(p.bucket, "REMOVE");
  assert.equal(p.status, "closed");
});
test("wrong number goes to REVIEW by default, REMOVE when set", () => {
  assert.equal(one(person({ calls: [call({ outcomeId: O.wrongNumber })] })).bucket, "REVIEW");
  cfg.wrongNumber = "remove";
  assert.equal(one(person({ calls: [call({ outcomeId: O.wrongNumber })] })).bucket, "REMOVE");
  cfg.wrongNumber = "review";
});

// ---------- email: rules 4-6 ----------
test("trap: an unreplied sequence email stays (touched)", () => {
  const p = one(person({ emails: [{ id: "m1", delivered: true, status: "completed", subject: "hello" }] }));
  assert.equal(p.bucket, "KEEP");
  assert.equal(p.status, "touched");
  assert.equal(p.totals.emailsSent, 1);
});
test("rule 4: a reply removes", () => {
  const p = one(person({ emails: [{ id: "m1", delivered: true, replied: true, subject: "hello" }] }));
  assert.equal(p.bucket, "REMOVE");
  assert.equal(p.status, "contacted");
});
test("rule 5: unsubscribed, bounced, spam-blocked, invalid and no email all remove", () => {
  assert.equal(one(person({ unsubscribed: true })).bucket, "REMOVE");
  assert.equal(one(person({ emails: [{ id: "m", bounced: true }] })).bucket, "REMOVE");
  assert.equal(one(person({ emails: [{ id: "m", spamBlocked: true }] })).bucket, "REMOVE");
  assert.equal(one(person({ emailStatus: "invalid" })).bucket, "REMOVE");
  assert.equal(one(person({ email: "" })).bucket, "REMOVE");
});
test("rule 6: a real Outlook message from them removes; an auto-reply does not", () => {
  const e = "dana@realco.example";
  const ooo = one(person({ email: e, outlookMail: [R.adaptOutlookMail({ id: "1", sender: e, subject: "Automatic reply: Microsoft solutions" }, "me")] }));
  assert.equal(ooo.bucket, "KEEP");
  const real = one(person({ email: e, outlookMail: [R.adaptOutlookMail({ id: "2", sender: e, subject: "RE: Microsoft solutions" }, "me")] }));
  assert.equal(real.bucket, "REMOVE");
});

// ---------- meetings / CRM: rules 7-10 ----------
test("rule 7: an upcoming meeting is live, a past one is contacted", () => {
  assert.equal(one(person({ meetings: [{ title: "Intro", at: "2026-12-01T15:00:00Z", source: "Outlook calendar" }] })).status, "live");
  assert.equal(one(person({ meetings: [{ title: "Intro", at: "2026-10-01T15:00:00Z", source: "Echo" }] })).status, "contacted");
});
test("trap: an Echo meeting with a colleague at the same domain removes the whole company", () => {
  const a = person({ email: "a@globex.example", company: "Globex LLC" });
  const b = person({ email: "b@globex.example", company: "Globex LLC" });
  const res = run([a, b], { companySources: [{ companyKey: R.companyKey("Globex"), domain: "globex.example", reason: "Echo meeting: Globex discovery", source: "Echo", at: "2026-10-01T15:00:00Z", kind: "contact" }] });
  for (const p of res) {
    assert.equal(p.bucket, "REMOVE");
    assert.ok(rules(p).includes(18));
  }
});
test("rule 18: a colleague's own reply or connected call removes everyone else at the company", () => {
  const a = person({ email: "a@initech.example", company: "Initech", emails: [{ id: "m", replied: true }] });
  const b = person({ email: "b@initech.example", company: "Initech" });
  const [, pb] = run([a, b]);
  assert.equal(pb.bucket, "REMOVE");
  const f = pb.findings.find((x) => x.rule === 18);
  assert.match(f.basis, /email domain/);
});
test("rule 18: company-name match works when domains differ, and says so", () => {
  const a = person({ email: "a@umbrella-corp.example", company: "Umbrella Corporation", calls: [call({ outcomeId: O.meetingBooked })] });
  const b = person({ email: "b@umbrellagroup.example", company: "Umbrella Corp." });
  const [, pb] = run([a, b]);
  assert.equal(pb.bucket, "REMOVE");
  assert.match(pb.findings.find((x) => x.rule === 18).basis, /company name/);
});
test("rule 18: two people sharing only a free email domain are not linked", () => {
  const a = person({ email: "a@gmail.com", company: "Alpha Co", domain: "gmail.com", emails: [{ id: "m", replied: true }] });
  const b = person({ email: "b@gmail.com", company: "Beta Co", domain: "gmail.com" });
  const [, pb] = run([a, b]);
  assert.equal(pb.bucket, "KEEP");
});
test("rule 8: each remove stage removes; Follow Up and Open do not", () => {
  for (const id of Object.keys(cfg.removeStages)) assert.equal(one(person({ stageId: id })).bucket, "REMOVE", id);
  for (const id of Object.keys(cfg.okStages)) assert.equal(one(person({ stageId: id })).bucket, "KEEP", id);
  assert.equal(one(person({ stageId: "unknownstage" })).bucket, "REVIEW");
});
test("rule 9: a deal on file anywhere removes", () => {
  for (const source of ["Apollo", "HubSpot", "Switchboard"]) {
    const p = one(person({ deals: [{ source, name: "Test deal", stage: "Proposal", closed: false, won: false }] }));
    assert.equal(p.bucket, "REMOVE", source);
    assert.equal(p.status, "live", source);
  }
});
test("trap: a client in HubSpot / Switchboard / PSA goes even with a blank Apollo stage", () => {
  for (const source of ["HubSpot", "Switchboard", "PSA"]) {
    const a = person({ stageId: null, email: `x@client-${source}.example`, company: `Client ${source}` });
    const [p] = run([a], { companySources: [{ domain: `client-${source}.example`, companyKey: R.companyKey(`Client ${source}`), reason: `${source}: active client`, source, kind: "client" }] });
    assert.equal(p.bucket, "REMOVE", source);
    assert.equal(p.status, "closed", source);
    assert.ok(rules(p).includes(10), source);
  }
});

// ---------- sequence state: rules 11-16 ----------
test("rule 11: an earlier sequence that ended on contact removes", () => {
  for (const reason of ["talked on phone", "Replied", "interested", "meeting booked", "appointment set"]) {
    const p = one(person({ enrollments: [
      { sequenceId: "seqTarget", status: "paused" },
      { sequenceId: "seqOld", sequenceName: "Old Sequence", status: "finished", reason, step: 3, finishedAt: "2026-06-01T00:00:00Z" }] }));
    assert.equal(p.bucket, "REMOVE", reason);
  }
});
test("trap: a 6-step sequence finished at step 4 shows step 4 of 6 with the 4 touches listed", () => {
  const p = one(person({
    enrollments: [{ sequenceId: "seqTarget", status: "paused" },
      { sequenceId: "seqOld", sequenceName: "Old Sequence", status: "finished", reason: "Completed", step: 4, addedAt: "2026-05-01T00:00:00Z", finishedAt: "2026-05-20T00:00:00Z" }],
    emails: [{ id: "e1", sequenceId: "seqOld", delivered: true, at: "2026-05-01T00:00:00Z" }, { id: "e3", sequenceId: "seqOld", delivered: true, at: "2026-05-08T00:00:00Z" }],
    calls: [call({ outcomeId: O.noAnswer, sequenceId: "seqOld", sequenceName: "Old Sequence", step: 2, at: "2026-05-04T00:00:00Z" })],
  }));
  assert.equal(p.totals.furthestLabel, "step 4 of 6");
  assert.equal(p.totals.linkedin, 1);
  assert.equal(p.totals.touchpoints, 4);
  const tp = R.touchpoints(p, { cfg, sequences: SEQS, target: TARGET });
  const steps = tp.filter((t) => t.kind !== "Sequence");
  assert.equal(steps.length, 4); // 2 emails, 1 call, 1 LinkedIn step
  assert.deepEqual(steps.map((t) => t.kind).sort(), ["Call", "Email", "Email", "LinkedIn"]);
  assert.ok(tp.some((t) => t.kind === "Sequence" && t.step === "step 4 of 6"));
  assert.equal(p.bucket, "KEEP");
});
test("rule 12: active or paused in another sequence is a CONFLICT", () => {
  const p = one(person({ enrollments: [{ sequenceId: "seqTarget", status: "paused" }, { sequenceId: "seqOld", sequenceName: "Old Sequence", status: "active", step: 2 }] }));
  assert.equal(p.bucket, "CONFLICTS");
});
test("rule 13: ever in the live call sequence for this product -> out of an email-only sequence", () => {
  const p = one(person({ enrollments: [{ sequenceId: "seqTarget", status: "paused" }, { sequenceId: "seqCall", sequenceName: "Test Call Sequence", status: "finished", reason: "Completed", step: 6 }] }));
  assert.equal(p.bucket, "REMOVE");
  assert.ok(rules(p).includes(13));
  const notEmailOnly = run([person({ enrollments: [{ sequenceId: "seqTarget", status: "paused" }, { sequenceId: "seqCall", status: "finished", reason: "Completed", step: 6 }] })], { targetEmailOnly: false })[0];
  assert.ok(!rules(notEmailOnly).includes(13));
});
test("rule 14: a colleague active in the call sequence is a CONFLICT", () => {
  const p = person({ email: "p@hooli.example", company: "Hooli" });
  const colleague = { apolloId: "col1", name: "Col League", email: "col@hooli.example", domain: "hooli.example", company: "Hooli", companyKey: "hooli", enrollments: [{ sequenceId: "seqCall", sequenceName: "Test Call Sequence", status: "active", step: 2 }], calls: [], emails: [] };
  const [r] = run([p], { colleagues: [colleague] });
  assert.equal(r.bucket, "CONFLICTS");
  assert.ok(rules(r).includes(14));
});
test("rule 15: several from one company -> best one kept, rest to REVIEW", () => {
  const a = person({ email: "a@stark.example", company: "Stark", title: "Office Manager" });
  const b = person({ email: "b@stark.example", company: "Stark", title: "CFO" });
  const [pa, pb] = run([a, b]);
  assert.equal(pb.bucket, "KEEP");
  assert.ok(pb.companyPick);
  assert.equal(pa.bucket, "REVIEW");
});
test("rule 16: the same person twice keeps one", () => {
  const a = person({ email: "same@dupe.example", company: "Dupe", addedAt: "2026-11-01T00:00:00Z" });
  const b = person({ email: "SAME@dupe.example".toLowerCase(), company: "Dupe", addedAt: "2026-11-02T00:00:00Z" });
  const [pa, pb] = run([a, b]);
  assert.notEqual(pa.bucket, "REMOVE");
  assert.equal(pb.bucket, "REMOVE");
  assert.ok(rules(pb).includes(16));
});

// ---------- fit: rule 17 ----------
test("rule 17: wrong product or no product signal goes to REVIEW, never REMOVE", () => {
  assert.equal(one(person({ customText: "Needs Microsoft 365 licensing for 40 users" })).bucket, "REVIEW");
  assert.equal(one(person({ customText: "" })).bucket, "REVIEW");
  assert.equal(one(person({ customText: "Wants a better CRM for sales" })).bucket, "REVIEW");
  assert.equal(one(person({ customText: "Looking at D365 Sales" })).bucket, "KEEP");
});
test("rule 17: short codes only count in capitals", () => {
  assert.ok(R.hasKeyword("Running GP 2018", cfg.keywords.dynamics));
  assert.ok(!R.hasKeyword("the gp of the company", cfg.keywords.dynamics));
});

// ---------- sources ----------
test("trap: a call result belonging to another contact is rejected", () => {
  const r = R.adaptApolloCall({ id: "k1", contact_id: "someoneElse", phone_call_outcome_id: O.meetingBooked }, ["c-me"]);
  assert.equal(r.ok, false);
  const ok = R.adaptApolloCall({ id: "k2", contact_id: "c-me", phone_call_outcome_id: O.noAnswer, duration: 0, note_text: "Called +15555550100 (MOBILE). Recording: https://app.trellus.ai/transcripts?id=abc" }, ["c-me"]);
  assert.equal(ok.ok, true);
  assert.equal(ok.call.summary, "");
  assert.equal(ok.call.trellusUrl, "https://app.trellus.ai/transcripts?id=abc");
});
test("trap: an unreachable source shows 'not checked' and sends the row to REVIEW", () => {
  const p = one(person({ sourceChecks: { HubSpot: { state: "error", reason: "connector needs reconnecting" } } }));
  assert.equal(p.bucket, "REVIEW");
  assert.match(p.findings.find((f) => f.rule === 0).reason, /HubSpot not checked/);
});
test("Apollo contact adapter reads sequence history, stage and opt-outs", () => {
  const raw = { id: "a1", name: "Lee Sample", first_name: "Lee", last_name: "Sample", email: "Lee@Sample.example", email_status: "verified", organization_name: "Sample Industries, Inc.", contact_stage_id: "st", email_unsubscribed: false, call_opted_out: true, account: { id: "acc", domain: "sample.example" }, typed_custom_fields: { f1: "Dynamics 365", f2: 3 }, contact_campaign_statuses: [{ emailer_campaign_id: "s1", emailer_campaign_name: "S1", status: "finished", current_step_position: 3, inactive_reason: "talked on phone", finished_at: "2026-11-20T00:00:00Z" }] };
  const p = R.adaptApolloContact(raw);
  assert.equal(p.email, "lee@sample.example");
  assert.equal(p.companyKey, "sample industries");
  assert.equal(p.domain, "sample.example");
  assert.equal(p.customText, "Dynamics 365");
  assert.equal(p.enrollments[0].reason, "talked on phone");
  assert.equal(p.callOptedOut, true);
});
test("Apollo email adapter rejects another contact's message", () => {
  assert.equal(R.adaptApolloMessage({ id: "m", contact_id: "other" }, ["me"]).ok, false);
  const ok = R.adaptApolloMessage({ id: "m", contact_id: "me", replied: true, variant: { subject: "hi" } }, ["me"]);
  assert.equal(ok.email.replied, true);
  assert.equal(ok.email.subject, "hi");
});
test("Echo, calendar, Switchboard and HubSpot adapters", () => {
  const echo = R.adaptEchoMeeting({ id: "e", title: "Globex: Discovery", company: "Globex, LLC", track: "Sales", started_at: "2026-10-01T00:00:00Z", people: ["Pat Example"], url: "https://echo.example/m/e" });
  assert.equal(echo.companyKey, "globex");
  const cal = R.adaptCalendarEvent({ id: "c", subject: "Intro", attendees: ["Jack@WiredCIO.com", "pat@globex.example"], organizer: "jack@wiredcio.com", start: { dateTime: "2026-10-01T10:00:00" }, isCancelled: false });
  assert.ok(cal.attendees.includes("pat@globex.example"));
  const sb = R.adaptSwitchboardCompany({ name: "Globex", deals: [{ id: "d", name: "Globex BC", stage: "Closed Won", url: "https://sb.example/d" }] });
  assert.equal(sb.deals[0].won, true);
  const hc = R.adaptHubspotCompany({ id: 1, properties: { name: "Globex", domain: "www.globex.example", lifecyclestage: "customer", num_associated_deals: "2" } }, "https://hs.example/{id}");
  assert.equal(hc.domain, "globex.example");
  assert.equal(hc.link, "https://hs.example/1");
  const hd = R.adaptHubspotDeal({ id: 2, properties: { dealname: "Globex", dealstage: "closedwon", hs_is_closed: "true", hs_is_closed_won: "true" } });
  assert.equal(hd.won, true);
});

// ---------- actions + CSV ----------
test("planActions: remove vs stop, move, finish elsewhere, follow-up tags nothing", () => {
  const a = person({ enrollments: [{ sequenceId: "seqTarget", status: "paused" }, { sequenceId: "seqOld", status: "active", apolloContactId: "a-old" }] });
  const b = person();
  const c = person();
  const res = run([a, b, c]);
  const decisions = { [res[0].uid]: { action: "remove", finishElsewhere: true }, [res[1].uid]: { action: "move", moveTo: "seqOther" }, [res[2].uid]: { action: "followup", note: "call next week" } };
  const neverSent = R.planActions(res, decisions, TARGET, { targetEverSent: false });
  assert.equal(neverSent.removeHere.length, 2);
  assert.equal(neverSent.removeHere[0].mode, "remove");
  assert.equal(neverSent.moveTo.length, 1);
  assert.equal(neverSent.finishElsewhere.length, 1);
  assert.equal(neverSent.finishElsewhere[0].sequenceId, "seqOld");
  assert.equal(neverSent.tagged.length, 1);
  const sent = R.planActions(res, decisions, TARGET, { targetEverSent: true });
  assert.equal(sent.removeHere[0].mode, "stop");
});
test("CSV escapes quotes, commas and spreadsheet formulas", () => {
  const csv = R.toCsv([{ a: 'He said "hi", ok', b: "=SUM(A1)" }], [{ label: "A", get: "a" }, { label: "B", get: "b" }]);
  assert.equal(csv, 'A,B\r\n"He said ""hi"", ok",\'=SUM(A1)');
});

test("rule catalog lists every rule 0-18 exactly once, each with a plain description", () => {
  const ids = R.RULES.map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 19 }, (_, i) => i));
  for (const r of R.RULES) { assert.ok(r.what && r.name && ["remove", "review", "conflict"].includes(r.effect), r.id); assert.equal(R.RULE_LABEL[r.id] !== undefined, true); }
});
test("a switched-off rule never fires", () => {
  cfg.disabledRules = [17];
  assert.equal(one(person({ customText: "" })).bucket, "KEEP");
  cfg.disabledRules = [1];
  assert.equal(one(person({ calls: [call({ outcomeId: O.meetingBooked })] })).bucket, "KEEP");
  cfg.disabledRules = [];
  assert.equal(one(person({ customText: "" })).bucket, "REVIEW");
});

test("rule 2: our rep declining to hold is not the prospect declining", () => {
  const a = R.analyzeCallSummary("The rep declined to hold and opted to call back next week to reach Pat regarding Microsoft Dynamics.");
  assert.notEqual(a.kind, "declined");
  assert.equal(one(person({ calls: [call({ outcomeId: O.noAnswer, summary: "The rep declined to hold and opted to call back next week to reach Pat regarding Microsoft Dynamics." })] })).bucket, "KEEP");
});
test("rule 2: someone else asking us to call back later is not a conversation", () => {
  const s = "Jack called for Pat. She mentioned to call back later in the day since Pat is on California time.";
  assert.notEqual(R.analyzeCallSummary(s).kind, "spoke");
  assert.equal(one(person({ calls: [call({ outcomeId: O.noAnswer, summary: s })] })).bucket, "KEEP");
});
test("rule 2: a real conversation in the same note still counts", () => {
  const s = "The receptionist transferred Jack. Pat said they are evaluating Business Central for next year.";
  assert.equal(one(person({ calls: [call({ outcomeId: O.noAnswer, summary: s })] })).bucket, "REMOVE");
});

// ---------- Skip steps ----------
const rawTask = (o) => ({ id: "t1", type: "phone_call", status: "scheduled", due_date: "2026-11-17", adherence_status: "overdue",
  contact: { id: "c1", name: "Pat Example" }, sequence: { id: "seqCall", name: "Test Call Sequence", step_position: 1 }, ...o });
test("tasks: a task from another sequence is dropped", () => {
  assert.equal(R.adaptApolloTask(rawTask({ sequence: { id: "seqOther", step_position: 1 } }), "seqCall"), null);
  const t = R.adaptApolloTask(rawTask(), "seqCall");
  assert.equal(t.step, 1); assert.equal(t.typeLabel, "Call"); assert.equal(t.overdue, true); assert.equal(t.contactId, "c1");
});
test("tasks: grouped by step then type, overdue counted, overdue-only filter", () => {
  const tasks = [
    rawTask({ id: "a", sequence: { id: "s", step_position: 3 } }),
    rawTask({ id: "b", sequence: { id: "s", step_position: 1 }, adherence_status: "open", due_date: "2026-11-20" }),
    rawTask({ id: "c", sequence: { id: "s", step_position: 1 }, due_date: "2026-11-12" }),
    rawTask({ id: "d", type: "linkedin_step_message", sequence: { id: "s", step_position: 1 } }),
  ].map((r) => R.adaptApolloTask(r, "s"));
  const g = R.groupTasksByStep(tasks);
  assert.deepEqual(g.map((x) => `${x.step}:${x.typeLabel}:${x.tasks.length}:${x.overdue}`), ["1:Call:2:1", "1:LinkedIn message:1:1", "3:Call:1:1"]);
  assert.equal(g[0].earliest, "2026-11-12");
  assert.equal(R.groupTasksByStep(tasks, { overdueOnly: true }).reduce((n, x) => n + x.tasks.length, 0), 3);
});
