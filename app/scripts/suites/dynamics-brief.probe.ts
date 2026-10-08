// The Dynamics line, the Product Area classifier, and the partner Auto-DQ.
//
// Per Jack, in one thread: "pull back on the matched snippet for dynamics i
// want that a bit shorter and more focused on the real notes", "i dont need
// a score for dynamics", "i just need the platform in dyanmics mentioned
// the user count if theres info on a partner and timeline", "if theymention
// a pain they havce", "make sure if it indicates they are a microsoft
// partner to push to bad leads", and "most of this will not alr be on
// dynamics so if it indicates they are let me know".
import {
  classifyProductArea, extractTimeline, leadClaimsToBePartner,
  isCompetitorDomain, alreadyOnDynamics, rivalPlatformNamed,
  scanParsedFiles, COMPETITOR_DQ_LABEL,
} from "../../src/lib/detection";
import { parseCSVText } from "../../src/lib/csv";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d));
};
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const scan = (comments: string, company = "Acme Freight", productArea = "", email = "ada@acmefreight.com") => {
  const csv = ["Company,Full Name,Title,Email,Phone,Product Area,Comments",
    [company, "Ada Brant", "IT Director", email, "312-555-0100", productArea, comments].map(q).join(",")].join("\n");
  return scanParsedFiles([parseCSVText("t.csv", csv)]).results[0];
};

console.log("=== Product Area: one column, five kinds of value ===");
// Charted on the real seven-file upload: 457 distinct values over 5,599 rows.
for (const [v, kind] of [
  ["Azure", "product"], ["M365", "product"], ["Dynamics CRM", "product"],
  ["Dynamics CRM Online", "product"], ["Power Automate", "product"],
  ["Baseline", "segment"], ["Growth", "segment"], ["AI Business Solutions", "segment"],
  ["Cloud and AI Platforms", "segment"],
  ["Microsoft Corporation", "microsoft"], ["Microsoft Corp", "microsoft"],
  ["microsoft corporation", "microsoft"], ["Direct", "microsoft"],
  ["CDW Logistics LLC", "partner"], ["Insight", "partner"], ["Datadog", "partner"],
  ["", "none"], ["4518215", "none"],
] as const) ok(`${JSON.stringify(v) || "(blank)"} -> ${kind}`, classifyProductArea(v).kind === kind,
               classifyProductArea(v).kind);

ok("case and legal suffix collapse to one value",
   classifyProductArea("CDW Logistics LLC").label !== "" &&
   classifyProductArea("Blue Yonder").kind === classifyProductArea("BLUE YONDER").kind);
// The anchor matters: a reseller NAMED after a product is still a partner.
ok("a partner whose NAME contains a product word is still a partner",
   classifyProductArea("MCIT Business Solutions").kind === "partner" &&
   classifyProductArea("Azure Data Group").kind === "partner");

console.log("\n=== the segment labels stop being printed as facts ===");
// 253 real rows said "Microsoft is already pitching them Growth"; the most
// common "Partner on record" value was "Baseline" (29 rows).
for (const seg of ["Growth", "Baseline", "AI Business Solutions", "Cloud and AI Platforms"]) {
  const r = scan("Renewing Microsoft 365 E3 for 300 users this year.", "Acme Freight", seg);
  ok(`"${seg}" is never printed as a product or a partner`,
     !/pitching them/.test(r.notesSummary) && !/Partner on record/.test(r.notesSummary), r.notesSummary);
}
{
  const r = scan("Renewing Microsoft 365 E3 for 300 users this year.", "Acme Freight", "CDW Logistics LLC");
  ok("a real partner name still reads as the partner", /Partner on record: CDW/.test(r.notesSummary), r.notesSummary);
}

console.log("\n=== the Dynamics line: facts only ===");
{
  const r = scan("Looking at Dynamics 365 Business Central for 20 users. Timeline: 3/30/2027", "Acme Freight", "CDW Logistics LLC");
  ok("no score head", !/^\(\d+\)/.test(r.notesSummary), r.notesSummary);
  ok("  no generated question", !/\bAsk /.test(r.notesSummary), r.notesSummary);
  ok("  names the platform", /Business Central/.test(r.notesSummary), r.notesSummary);
  ok("  states the user count", /20 seats/.test(r.notesSummary), r.notesSummary);
  ok("  names the partner", /partner: CDW/.test(r.notesSummary), r.notesSummary);
  ok("  carries the timeline", /3\/30\/2027/.test(r.notesSummary), r.notesSummary);
}
{
  // A thin row stays SHORT rather than padded. Only 43% of real Dynamics
  // rows state a seat count, 37% a timeline and 7% a pain.
  const r = scan("Interested in Dynamics 365.");
  ok("a row stating nothing else is just the platform", r.notesSummary.trim() === "Dynamics 365", r.notesSummary);
  ok("  and says nothing about a missing seat count", !/no seat count/.test(r.notesSummary));
}
{
  const r = scan("Dynamics 365 Business Central evaluation. The team is drowning in manual double-entry between systems.");
  ok("a stated pain is quoted", /"manual double-entry"/.test(r.notesSummary), r.notesSummary);
}
{
  const r = scan("Looking at Dynamics 365.", "Acme Freight", "Microsoft Corporation");
  ok("Microsoft in the partner slot reads as direct", /direct with Microsoft/.test(r.notesSummary), r.notesSummary);
}
{
  // The Product Area sometimes repeats the customer's own name.
  const r = scan("Looking at Dynamics 365.", "Stoneridge Software", "Stoneridge Software LLC");
  ok("the customer's own name is never reported as their partner",
     !/partner: Stoneridge/.test(r.notesSummary), r.notesSummary);
}

console.log("\n=== already on Dynamics, or on a rival ===");
{
  const r = scan("The customer is a current D365 customer and is looking to expand their usage in Dataverse.");
  ok("an existing Dynamics customer is flagged", /already on Dynamics/.test(r.notesSummary), r.notesSummary);
}
{
  const r = scan("Evaluating Dynamics 365 Business Central. Deeper integration with their existing CRM (Salesforce) was discussed.");
  ok("a rival named instead is the displacement angle", /on Salesforce today/.test(r.notesSummary), r.notesSummary);
  ok("  and it is not claimed as already-on-Dynamics", !/already on Dynamics/.test(r.notesSummary));
}
ok("a greenfield evaluation claims neither",
   !alreadyOnDynamics("evaluating a Dynamics 365 Business Central solution for 20 users") &&
   !rivalPlatformNamed("evaluating a Dynamics 365 Business Central solution for 20 users"));

console.log("\n=== timeline: a timeline has to name a time ===");
for (const [text, want] of [
  ["Timeline: 3/30/2027 Partner: Microsoft Corporation", "3/30/2027"],
  ["Target close date 03/02/2027.", "03/02/2027"],
  ["data warehouse targeted for next quarter or next year", "next quarter"],
  ["Timeline: Next 3 months", "Next 3 months"],
] as const) ok(`${JSON.stringify(text.slice(0, 44))} -> ${want}`, extractTimeline(text) === want, extractTimeline(text));
// A labelled field saying there ISN'T one must not become a timeline.
for (const text of [
  "Timeline: Not explicitly mentioned",
  "Timeline: TBD",
  "they do not yet have a defined budget",
  "do not currently have enough information to establish a budget",
]) ok(`no timeline from ${JSON.stringify(text.slice(0, 46))}`, extractTimeline(text) === "", extractTimeline(text));

console.log("\n=== the partner / IT-company Auto-DQ ===");
// THE TRAP: 59 real rows carry "Partner: Microsoft Corporation", meaning
// MICROSOFT is their partner of record — they buy direct. Only 2 rows say
// the customer IS a partner. A rule matching "Microsoft partner" anywhere
// would have dumped 59 good leads to catch 2.
for (const t of [
  "The customer is a Microsoft partner and would like to learn more about how Dynamics 365 could support them.",
  "They are a Microsoft partner, comfortable with implementation, and have been testing for a year.",
  "The company is an IT services company.",
  "We are a Microsoft gold partner.",
]) ok(`DQ: ${JSON.stringify(t.slice(0, 52))}`, leadClaimsToBePartner(t), "");
for (const t of [
  "Timeline: 3/30/2027 Partner: Microsoft Corporation",
  "Partner: Microsoft Corporation (direct - no Tier1 or Tier2 partner on the tenant)",
  "Partner: Heartland Business Systems LLC BANT Budget $6,810 identified budget",
  "Looking for a partner to implement Dynamics 365 Business Central.",
]) ok(`KEPT: ${JSON.stringify(t.slice(0, 52))}`, !leadClaimsToBePartner(t), "");
{
  const r = scan("The customer is a Microsoft partner and wants Dynamics 365 Business Central for 40 users.");
  ok("a partner who wants Dynamics for themselves is a Bad Lead",
     r.tier === "dq" && r.dqReasons.includes(COMPETITOR_DQ_LABEL), `${r.tier} / ${r.dqReasons.join(", ")}`);
}
{
  // "Partner: <name>" is ALSO CRM-opportunity metadata, which a separate,
  // pre-existing rule disqualifies on its own. So this asserts the narrow
  // thing: the competitor rule specifically must not fire.
  const r = scan("Looking at Dynamics 365 Business Central for 40 users. Timeline: 3/30/2027 Partner: Microsoft Corporation");
  ok("  while a lead whose partner IS Microsoft is not a COMPETITOR",
     !r.dqReasons.includes(COMPETITOR_DQ_LABEL), r.dqReasons.join(", "));
  const clean = scan("Looking at Dynamics 365 Business Central for 40 users, buying direct from Microsoft.");
  ok("  and the same lead without CRM metadata stays Strong Signal",
     clean.tier === "signal", `${clean.tier} / ${clean.dqReasons.join(", ")}`);
}

console.log("\n=== the email domain, read as text ===");
// The scanner has no network, so a domain can only be read, never looked up.
for (const e of ["ada@managedservicesgroup.com", "bo@cloudservicespartners.com", "cy@itsolutionsinc.com"])
  ok(`competitor domain: ${e}`, isCompetitorDomain(e));
for (const e of ["ada@acmefreight.com", "bo@northwind.com", "cy@gmail.com", "dana@summittech.com", "eve@itworks.org"])
  ok(`  NOT a competitor domain: ${e}`, !isCompetitorDomain(e));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
