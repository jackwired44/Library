// Regression guard for three confirmed attribution bugs. Each one put the
// WRONG DATA on a lead Jack would call, without anything on screen saying so.
import { parseSmcLead, bestContact } from "../../src/lib/smcLead";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow } from "../../src/lib/scanner2";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const scanCsv = (rows: string[][], head: string) => {
  const csv = [head].concat(rows.map((r) => r.map(esc).join(","))).join("\n");
  const parsed = [parseCSVText("t.csv", csv)];
  const prof = profileColumns(parsed);
  return scan2(parsed, { ...emptyRuleSet("t"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
};

console.log("\n== one person's phone and email never land on another person ==");
const twoPeople = "Customer TPID: 555001 Company Name: New Leaf First Name: Christopher Last Name: Hallski Job Title: IT Manager First Name: Dana Last Name: Reyes Job Title: CFO Phone: 312-555-0147 Email: dana@newleaf.com";
const l = parseSmcLead(twoPeople);
const chris = l.contacts.find((c) => c.firstName === "Christopher")!;
const dana = l.contacts.find((c) => c.firstName === "Dana")!;
ok("both people parsed", !!chris && !!dana);
ok("Christopher does not carry Dana's email", chris.email !== "dana@newleaf.com", chris.email);
ok("Christopher does not carry Dana's phone", chris.phone !== "312-555-0147", chris.phone);
ok("Dana keeps her own email and phone", dana.email === "dana@newleaf.com" && dana.phone === "312-555-0147");
const exported = scanCsv([["", twoPeople, "NULL"]], "companyname,description,campaignidname");
if (exported.rows[0]) {
  const e = toApolloRow(exported.rows[0]);
  const nameIsDana = /Dana/.test(e["First Name"]);
  const mailIsDana = /dana@/.test(e.Email);
  ok("the exported name and email belong to the SAME person", nameIsDana === mailIsDana,
     `${e["First Name"]} / ${e.Email}`);
}

console.log("\n== two different people at one account both survive ==");
const mk = (tp: string, fn: string, ln: string, prod: string) =>
  `Customer TPID: ${tp} Company Name: Acme First Name: ${fn} Last Name: ${ln} Job Title: CIO Phone: 312-555-0100 Email: ${fn.toLowerCase()}@acme.com SMC Type: Medium Product Propensity Details (as pulled from Cloud Ascent on 2026-06-01): - Azure: ${prod === "Azure" ? "Act Now (High Fit; High Prioritization Index)" : "Unknown (Unknown Fit; Unknown Prioritization Index)"} - M365: Unknown (Unknown Fit; Unknown Prioritization Index) - D365 BC: ${prod === "BC" ? "Act Now (High Fit; High Prioritization Index)" : "Unknown (Unknown Fit; Unknown Prioritization Index)"} - D365 F&O: Unknown (Unknown Fit; Unknown Prioritization Index) - D365 Sales Pro: Unknown (Unknown Fit; Unknown Prioritization Index) - Surface: Unknown (Unknown Fit; Unknown Prioritization Index) Product Ownership Details / Potential For Customer Adds (as pulled on 2026-06-01): - Has O365: Yes - Has Azure: No - Has D365: No`;
const acct = scanCsv([
  ["", mk("999111", "Ann", "Lee", "Azure"), "US~US~FY26~CMP~Azure Migrate~SRAIM1"],
  ["", mk("999111", "Bob", "Ray", "BC"), "US~US~FY26~CMP~Business Central~SRAIM2"],
], "companyname,description,campaignidname");
ok("a shared Customer TPID does not merge two different people", acct.rows.length === 2, `kept ${acct.rows.length}, merged ${acct.duplicatesMerged}`);
ok("each person gets their own curation key", new Set(acct.rows.map((r) => r.leadKey)).size === 2, JSON.stringify(acct.rows.map((r) => r.leadKey)));
ok("the second person's product line is not lost", acct.rows.some((r) => r.productLine === "Dynamics 365"), JSON.stringify(acct.rows.map((r) => r.productLine)));
// The same TPID twice with NO person named is genuinely indistinguishable.
const anon = scanCsv([
  ["", "Customer TPID: 777222 Company Name: Anon Co", "NULL"],
  ["", "Customer TPID: 777222 Company Name: Anon Co", "NULL"],
], "companyname,description,campaignidname");
ok("the same account with nobody named still merges", anon.rows.length === 1, `kept ${anon.rows.length}`);

console.log("\n== a labelled value beats the same word in prose ==");
const prose = parseSmcLead("Company Name: Contoso Profiler comment: no immediate need identified, budget unclear. Budget: 250000 Authority: Naveen Sathiya Need: Cloud and Security modernisation Timeline: 2 months");
ok("Budget reads the labelled number, not the prose", prose.bant.budget === "250000", prose.bant.budget);
ok("Need reads the labelled need, not the prose", /Cloud and Security modernisation/.test(prose.bant.need || ""), prose.bant.need);
const noBant = parseSmcLead("Customer TPID: 1 Company Name: X Profiler comment: they do not need anything right now, budget is frozen.");
ok("prose alone does not fabricate BANT", !noBant.bant.budget && !noBant.bant.need, JSON.stringify(noBant.bant));


console.log("\n== the person is found where these rows actually name them ==");
// Per Jack: every lead has a contact at the company. On rows with no
// "First Name:" block, that person is in the BANT Authority field.
const authCases: [string, string, string][] = [
  // Real row shape: the short form needs its Budget clause to parse.
  ["B – Assumed minimum value: $10,000 placeholder A – Owner: Eric Wells N – Solution: Data & Analytics T – Timeline: TBD", "Eric Wells", ""],
  ["Business Name: Ana Data B: 200 A: Naveen Sathiya N: Cloud T: 2 months", "Naveen Sathiya", ""],
  ["Budget: $1000 Authority: Richard Folkedahl Need: Copilot Timeline: 11/30/2026", "Richard Folkedahl", ""],
  ["B:4,000 A: DANIEL CARRION N: DYNAMICS PROJECT T:BY END September", "DANIEL CARRION", ""],
  ["• Budget: 34200 • Authority: Confirmed – George Morris (President / CISO) • Need: AI • Timeline: Q2", "George Morris", "President / CISO"],
];
for (const [blob, who, title] of authCases) {
  const c = bestContact(parseSmcLead(blob));
  const got = c ? `${c.firstName} ${c.lastName}`.trim() : "";
  ok(`names "${who}" from the Authority field`, got === who, `got "${got}"`);
  if (title) ok(`reads the title "${title}" alongside the name`, c?.title === title, c?.title);
}
// Conservative: a row that names nobody must stay blank rather than guess.
for (const blob of [
  "F2 Customer TPID: 1314249 SMC Type: Medium",
  "Discovery Customer TPID: 126649047 #13743",
  "NULL",
  "Budget: 200 Authority: TBD Need: unclear Timeline: none",
]) {
  const c = bestContact(parseSmcLead(blob));
  ok(`no person invented for "${blob.slice(0, 34)}..."`, !c, c ? `${c.firstName} ${c.lastName}` : "");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
