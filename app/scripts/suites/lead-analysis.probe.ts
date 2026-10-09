// The lead-analysis layer: dates in notes, raw notes, received month,
// per-file upload dates, and the dated call history from a sync.
import { extractNoteDates, hasUpcomingDate, soonestUpcoming, isIntentDate } from "../../src/lib/noteDates";
import { appendSegment } from "../../src/lib/rawNotes";
import { mergeLeads, type LeadInput } from "../../src/lib/leadStore";
import { parseHistoryCell, parseApolloSync, applyApolloSync } from "../../src/lib/apolloSync";
import { wasReached, contactStateOf } from "../../src/lib/leadStatus";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const A = new Date("2026-10-08T12:00:00");
const one = (t: string) => extractNoteDates(t, A);

// --- extraction: what counts as a date, and what it is about
let d = one("Estimated Close Date: June 30, 2026 Orchestration Note: ETC");
ok("full date with a month name", d[0]?.iso === "2026-06-30" && d[0]?.about === "close", JSON.stringify(d));
d = one("Timeline: 3/31/2027 Partner: Truly SMB");
ok("US m/d/yyyy, timeline", d[0]?.iso === "2027-03-31" && d[0]?.about === "timeline", JSON.stringify(d));
d = one("until renewal (12/18/26), then push for E7");
ok("2-digit year, renewal", d[0]?.iso === "2026-12-18" && d[0]?.about === "renewal", JSON.stringify(d));
d = one("Estimated close: October 2026.");
ok("month + year resolves to the month's end", d[0]?.iso === "2026-10-31" && d[0]?.kind === "month");
d = one("Inferred close window: Q3 2026");
ok("quarter resolves to the quarter's end", d[0]?.iso === "2026-09-30" && d[0]?.kind === "quarter");
d = one("Estimated Close Date: Q4 FY26");
ok("fiscal year is kept with NO guessed day", d.some((x) => x.kind === "fiscal" && !x.iso), JSON.stringify(d));
d = one("Looking to make decision on move to Business Central in next 60 days.");
ok("relative wording resolves against the anchor", d[0]?.iso === "2026-12-07" && d[0]?.about === "close", JSON.stringify(d));
d = one("considering buying copilot licenses by end of month");
ok("end of month", d[0]?.iso === "2026-10-31");

// --- not dates
ok("a phone number is not a date", one("Call 312-555-0101 or +1 (480) 898-0100").length === 0);
ok("a seat count is not a date", one("240 users on Microsoft 365 E3, 15 seats").length === 0);
ok("a version number is not a date", one("upgrade from version 15 to 16.2").length === 0);
ok("a CRM entry stamp alone is not a date", one("JS - 18/Jun - Customer asked for a quote").length === 0);
ok("an impossible day is rejected", one("on 2/30/2026 we met").length === 0);

// --- log stamps: visible, never "upcoming"
d = one("APA - 25/Sep - APA 9/25/2026 Oppty & Account info corrected");
ok("a date right after an entry stamp is a log stamp", d[0]?.about === "logged", JSON.stringify(d));
d = one("Date of Call: June 17, 2026 #CLMPostAI");
ok("Date of Call is a log stamp", d[0]?.about === "logged");
d = one("2026-12-23 06:00:32 PDT : Call me.");
ok("a seconds-precision timestamp is a log stamp", d[0]?.about === "logged");
ok("  and a FUTURE log stamp still is not an upcoming date", !hasUpcomingDate(d, "2026-10-08"));
d = one("Sent: Thursday, May 21, 2026 11:07 AM To: Brandon");
ok("an email header is a log stamp", d[0]?.about === "logged", JSON.stringify(d));
d = one("Date: 9/23/2026 ? Time: 09:00 ?? Created by: Sofia");
ok("an inbound booking reads as a meeting", d[0]?.about === "meeting", JSON.stringify(d));

// --- upcoming
const mix = one("Close Date: 9/4/2026 Status: Closed Won. Renewal on 1/15/2027. JV - 20/May - 5/20/2026 - JV");
ok("upcoming ignores past and logged", hasUpcomingDate(mix, "2026-10-08") && soonestUpcoming(mix, "2026-10-08")?.iso === "2027-01-15");
ok("isIntentDate splits them", mix.filter(isIntentDate).length === 2 && mix.filter((x) => !isIntentDate(x)).length === 1, JSON.stringify(mix));
ok("duplicates collapse", one("Timeline: Q3 2026. Again, Q3 2026.").length === 1);

// --- raw notes
const s1 = appendSegment(undefined, "k", { at: "2026-10-01", file: "a.csv", text: "First note." })!;
ok("raw note stored", s1.segments.length === 1);
ok("the same words again are not stored twice", appendSegment(s1, "k", { at: "2026-10-05", file: "b.csv", text: "  first   NOTE. " }) === null);
const s2 = appendSegment(s1, "k", { at: "2026-10-05", file: "b.csv", text: "A different note." })!;
ok("different text is a new version, newest first", s2.segments.length === 2 && s2.segments[0].file === "b.csv");
ok("a huge note is cut and says so", /cut at/.test(appendSegment(undefined, "k", { at: "", file: "", text: "x".repeat(25_000) })!.segments[0].text));

// --- merge: per-file dates, received date, note dates
const inp = (o: Partial<LeadInput>): LeadInput => ({
  source: "csp", company: "Acme", contact: "Dana Reyes", title: "", email: "dana@acme.com", phone: "", mobilePhone: "",
  productArea: "", tier: "High priority", notes: "scanned", score: 60, sourceFile: "a.csv", ...o,
});
let { leads } = mergeLeads([], [inp({ receivedOn: "2026-09-12", rawNotes: "Renewal on 1/15/2027." })], "2026-10-01T10:00:00Z");
ok("received date stored", leads[0].receivedOn === "2026-09-12");
ok("file upload date stored", leads[0].fileSeen?.[0]?.file === "a.csv" && leads[0].fileSeen?.[0]?.at.startsWith("2026-10-01"));
ok("note dates extracted from the RAW note", leads[0].noteDates?.[0]?.iso === "2027-01-15", JSON.stringify(leads[0].noteDates));
({ leads } = mergeLeads(leads, [inp({ sourceFile: "b.csv", receivedOn: "2026-08-02", rawNotes: "Timeline: Q1 2027" })], "2026-10-05T10:00:00Z"));
ok("a second file adds a dated entry", leads[0].fileSeen?.length === 2 && leads[0].fileSeen?.[1].at.startsWith("2026-10-05"));
ok("the EARLIEST received date wins", leads[0].receivedOn === "2026-08-02");
ok("note dates accumulate across uploads", (leads[0].noteDates?.length ?? 0) === 2);
({ leads } = mergeLeads(leads, [inp({ sourceFile: "a.csv", receivedOn: null, rawNotes: "" })], "2026-10-09T10:00:00Z"));
ok("re-uploading the same file keeps its first upload date", leads[0].fileSeen?.length === 2 && leads[0].fileSeen?.[0].at.startsWith("2026-10-01"));
ok("  and an undated re-upload keeps the received date", leads[0].receivedOn === "2026-08-02");

// --- call history
const h = parseHistoryCell("2026-10-01 No Answer @CSP Leads:1; 2026-10-07 Meeting Booked @CSP Leads:2; junk; 2026-09-28T14:02:00Z Left Voicemail");
ok("history parses, newest first", h.length === 3 && h[0].outcome === "Meeting Booked" && h[0].step === 2 && h[0].sequence === "CSP Leads", JSON.stringify(h));
ok("a timestamp-form date is read", h[2].at === "2026-09-28" && h[2].outcome === "Left Voicemail");
const pf = { name: "s.csv", fields: ["Email", "Name", "Company", "Call History"], data: [
  { Email: "dana@acme.com", Name: "Dana Reyes", Company: "Acme", "Call History": "2026-10-01 No Answer; 2026-10-03 No Answer; 2026-10-07 Info Requested" },
] } as any;
const parsed = parseApolloSync([pf]);
ok("history-only file maps the column", parsed.unmapped.length === 0, parsed.unmapped.join(","));
ok("  the call count comes from the history", parsed.rows[0].callCount === 3);
ok("  the outcome tally too", parsed.rows[0].outcomes["No Answer"] === 2 && parsed.rows[0].outcomes["Info Requested"] === 1);
const applied = applyApolloSync(leads, parsed.rows).leads[0];
ok("  last outcome and date fall back to the newest call", applied.apollo?.lastOutcome === "Info Requested" && applied.apollo?.lastCallAt === "2026-10-07");
ok("  and the history is kept on the lead", applied.apollo?.history?.length === 3);
ok("Info Requested counts as reached", wasReached(applied.apollo));
ok("no-answers only does not", !wasReached({ ...applied.apollo!, outcomes: { "No Answer": 3, "Gatekeeper / Front Desk": 1 } }));

// --- emails sent, and the column that must not be stolen
const pf2 = { name: "s2.csv", fields: ["Work Email", "Emails Sent", "Name", "Company", "Call Count"], data: [
  { "Work Email": "dana@acme.com", "Emails Sent": "4", Name: "Dana Reyes", Company: "Acme", "Call Count": "2" },
] } as any;
const p2 = parseApolloSync([pf2]);
ok("the email ADDRESS is still read from 'Work Email'", p2.rows[0].email === "dana@acme.com", JSON.stringify(p2.rows[0]));
ok("the email COUNT comes from 'Emails Sent'", p2.rows[0].emailCount === 4);
const pf3 = { name: "s3.csv", fields: ["Email", "Name", "Company", "Call Count"], data: [
  { Email: "dana@acme.com", Name: "Dana Reyes", Company: "Acme", "Call Count": "2" },
] } as any;
ok("no emails column -> emailCount unknown, not 0", parseApolloSync([pf3]).rows[0].emailCount === undefined);
const withEmails = applyApolloSync(leads, p2.rows).leads[0];
ok("emailCount lands on the lead", withEmails.apollo?.emailCount === 4);

// --- contact state
const ap = (o: any) => ({ ...leads[0], apollo: { syncedAt: "2026-10-08", sequences: [], callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "", ...o } });
ok("no Apollo record -> Not in Apollo (unknown, never 'never')", contactStateOf(leads[0]) === "unknown");
ok("in Apollo, nothing logged -> never contacted", contactStateOf(ap({})) === "never");
ok("emails only -> attempted", contactStateOf(ap({ emailCount: 3 })) === "attempted");
ok("no-answers only -> attempted", contactStateOf(ap({ callCount: 4, outcomes: { "No Answer": 4 } })) === "attempted");
ok("a real conversation -> contact made", contactStateOf(ap({ callCount: 2, outcomes: { "No Answer": 1, "Call Back Scheduled": 1 } })) === "made");
ok("meeting booked", contactStateOf(ap({ callCount: 2, outcomes: { "Meeting Booked": 1 } })) === "meeting");
ok("not interested", contactStateOf(ap({ callCount: 1, outcomes: { "Not interested": 1 } })) === "no");

console.log(`lead-analysis ${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
