// The Dynamics 365 View tabs.
//
// Four tabs, locked per Jack: All Dynamics 365, Business Central / ERP,
// Sales / CRM, Everything else. Three membership rules have been given
// explicitly and none of them was covered by a suite until now:
//   1. Business Central / ERP beats Sales / CRM when a row hits both.
//   2. Supply Chain Management always goes with Everything else.
//   3. The tab is NOT the ranking — SCM stays in the tier-0 block.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
function scan(notes: string[]) {
  const csv = ["Company,Full Name,Title,Email,Phone,Comments"]
    .concat(notes.map((n, i) => [`C${i}`, `P V${i}`, "IT Director", `p${i}@x${i}.com`, "312-555-0100", n].map(q).join(","))).join("\n");
  const by = new Map(scanParsedFiles([parseCSVText("t.csv", csv)]).results.map((x) => [x.id, x]));
  return notes.map((_, i) => by.get(`0-${i}`));
}
/** Exactly what the Scanner and the Lead Library render off. */
const tabOf = (r: ReturnType<typeof scan>[number]) =>
  !r ? "no row" : r.isBusinessCentral ? "Business Central / ERP" : r.isSalesCrm ? "Sales / CRM" : "Everything else";

console.log("\n== the tabs a lead lands in ==");
for (const [note, want] of [
  ["Looking at Dynamics 365 Business Central for 40 users.", "Business Central / ERP"],
  ["We need a new ERP for 40 users, currently on spreadsheets.", "Business Central / ERP"],
  ["Evaluating Dynamics 365 Sales for the team, about 30 seats.", "Sales / CRM"],
  ["Interested in Dynamics CRM for 30 users.", "Sales / CRM"],
  // Documented, pre-existing: tier-0 module names that are NOT the two tab
  // keywords stay in Everything else.
  ["Rolling out Dynamics 365 Finance and Operations for 60 users.", "Everything else"],
  ["Looking at Dynamics 365 Customer Engagement for 60 users.", "Everything else"],
] as [string, string][]) {
  const got = tabOf(scan([note])[0]);
  ok(`${want.padEnd(23)} <- ${note.slice(0, 52)}`, got === want, `got ${got}`);
}

console.log("\n== Business Central / ERP beats Sales / CRM ==");
const both = scan(["Business Central for finance, and we also want to grow our CRM side. 40 users."])[0];
ok("a row hitting both tabs is Business Central only", both?.isBusinessCentral === true && both?.isSalesCrm === false,
   tabOf(both));
ok("the two flags are never both true", !(both?.isBusinessCentral && both?.isSalesCrm));

console.log("\n== Supply Chain Management always goes with Everything else ==");
for (const note of [
  "Evaluating Dynamics 365 Supply Chain Management for 80 users.",
  // The word ERP is what a supply-chain note almost always carries —
  // 33 real rows sat in the BC tab on this alone.
  "Supply Chain Management is the ERP piece we need, 80 users.",
  // Manufacturing/distribution language trips the bare `sales` keyword —
  // 10 real rows sat in Sales / CRM on this alone.
  // Prefixed now: a bare "supply chain management" no longer makes a row
  // Dynamics at all (see the looseness section below).
  "Manufacturing Sales/distribution Warehousing — Dynamics 365 supply chain management for 80 users.",
  "Interested in D365 SCM for 80 users.",
  "Dynamics 365 supply chain mgmt, 80 seats.",
]) {
  const r = scan([note])[0];
  ok(`Everything else <- ${note.slice(0, 52)}`, tabOf(r) === "Everything else", `got ${tabOf(r)}`);
}

console.log("\n== but naming Business Central outright still wins ==");
// 127 real rows say both. "We want Business Central" belongs in the BC tab
// whatever else the note mentions.
const bcAndScm = scan(["We want Dynamics 365 Business Central to fix our supply chain management, 80 users."])[0];
ok("Business Central + supply chain stays Business Central / ERP",
   tabOf(bcAndScm) === "Business Central / ERP", tabOf(bcAndScm));

console.log("\n== the tab is not the ranking, and not the download ==");
const scmRow = scan(["Evaluating Dynamics 365 Supply Chain Management for 80 users."])[0];
ok("SCM still ranks in the tier-0 (ERP) block", scmRow?.dynamicsModuleTier === 0, String(scmRow?.dynamicsModuleTier));
ok("SCM still files under Dynamics 365", scmRow?.category === "dynamics365", String(scmRow?.category));
ok("SCM still qualifies as Strong Signal", scmRow?.tier === "signal", String(scmRow?.tier));
ok("SCM still carries its seat count", scmRow?.dynamicsSeatCount === 80, String(scmRow?.dynamicsSeatCount));
// A tab change must never move a lead between download files.
const bcRow = scan(["Looking at Dynamics 365 Business Central for 40 users."])[0];
ok("a BC lead and an SCM lead download in the same category",
   bcRow?.category === scmRow?.category, `${bcRow?.category} vs ${scmRow?.category}`);

console.log("\n== the rule is scoped to the Dynamics tabs, nothing else ==");
// Per Jack, "dynamics filtering … is loose": a bare "supply chain team" used
// to make this a Dynamics 365 lead and pull it out of M365/Azure. Everyday
// module words now need a Dynamics prefix, so it files where it belongs.
const mixed = scan(["Moving off Google Workspace to Microsoft 365 for our supply chain team, 80 users."])[0];
ok("a note mentioning a supply chain TEAM is not a Dynamics lead", mixed?.category === "m365Tenant", String(mixed?.category));
// A real M365/Azure lead is untouched by any of this.
const m365 = scan(["Moving off Google Workspace to Microsoft 365 for 80 staff."])[0];
ok("a real M365/Azure lead still files as M365/Azure", m365?.category === "m365Tenant", String(m365?.category));
ok("and carries no Dynamics tab flags", m365?.isBusinessCentral === false && m365?.isSalesCrm === false);
ok("and keeps its own Google sub-view", m365?.isGoogleWorkspaceMigration === true, String(m365?.isGoogleWorkspaceMigration));

console.log("\n== Sales / CRM is a sales platform, per Jack ==");
for (const [note, want] of [
  ["Evaluating Dynamics 365 Customer Insights for 30 users.", "Sales / CRM"],
  ["Want Dynamics 365 Sales Professional for 12 reps.", "Sales / CRM"],
  ["Need a CRM — looking at Dynamics 365, 20 users.", "Sales / CRM"],
  // A sales TEAM is not a sales platform.
  ["Dynamics 365 Business Central for our sales team, 25 users.", "Business Central / ERP"],
  ["Dynamics 365 Field Service for 30 techs, the sales team wants a CRM too.", "Everything else"],
  ["Rolling out Dynamics 365 Finance and Operations, sales and CRM later.", "Everything else"],
  ["Dynamics 365 for our sales and distribution business, 40 users.", "Everything else"],
] as [string, string][]) {
  const got = tabOf(scan([note])[0]);
  ok(`${want.padEnd(23)} <- ${note.slice(0, 52)}`, got === want, `got ${got}`);
}
const salesNote = scan(["Need a CRM — looking at Dynamics 365, 20 users."])[0];
ok("a Sales / CRM lead's note names the sales platform", /^Sales platform: /.test(salesNote?.notesSummary ?? ""), salesNote?.notesSummary);

console.log("\n== F&O is not Business Central, even when it says ERP ==");
const fno = scan(["Dynamics 365 Finance and Operations is the ERP we want, 120 users."])[0];
ok("F&O + ERP lands in Everything else", tabOf(fno) === "Everything else", tabOf(fno));

console.log("\n== everyday words are not Dynamics leads on their own ==");
for (const note of [
  "Our customer service team handles all calls.",
  "Field service techs need laptops.",
  "Human resources is moving offices.",
  "Supply chain management is their core business.",
]) {
  const r = scan([note])[0];
  ok(`not Dynamics <- ${note.slice(0, 50)}`, !r || r.category !== "dynamics365", r ? `${r.category}` : "no row");
}

console.log("\n== a bare or negated ERP/CRM never steals an M365/Azure lead ==");
// Jack's real row (HIMMEL HOSPITALITY GROUP): an Azure migration that
// filed as Dynamics 365 off "no ERP; CRM is Zoho".
const himmel = scan(["Hybrid today, on-premises Exchange still running. Active Directory in place; no separate database platform, no ERP; CRM is Zoho. 55 Business Standard and 26 Business Premium licenses, purchased directly with Microsoft. We want to move entirely to cloud; Azure migration is the number one priority. We're not looking for anything fancy."])[0];
ok("files as M365 / Azure, not Dynamics", himmel?.category === "m365Tenant", String(himmel?.category));
ok("is still Strong Signal", himmel?.tier === "signal", String(himmel?.tier));
ok("'not looking for anything fancy' is not read as the deal reversing", !/reverses|reversed/i.test(himmel?.notesSummary ?? ""), himmel?.notesSummary);
// Per Jack, a migration note is "what they are wanting to migrate and if
// theres a clear timeline", so the SKU list gives way to the move; the
// estate's biggest stated count still rides along, and no count is ever
// pinned to a SKU that did not state it.
ok("a migration note names the move and carries the stated count", /Moving entirely to the cloud\. 55 seats\./.test(himmel?.notesSummary ?? "") && !/26 seats on|Business Standard \(26/.test(himmel?.notesSummary ?? ""), himmel?.notesSummary);
const noErp = scan(["We have no ERP today and run everything on spreadsheets."])[0];
ok("'no ERP' alone is not a Dynamics lead", !noErp || noErp.category !== "dynamics365", noErp ? noErp.category : "no row");
const wantErp = scan(["We need a new ERP for 40 users, currently on spreadsheets."])[0];
ok("but wanting an ERP still is", wantErp?.category === "dynamics365", String(wantErp?.category));

console.log("\n== Microsoft's scorecard is not the lead (Book9-30) ==");
const SC = "Product Propensity Details: - M365: Act Now (High Fit; High Prioritization Index) - D365 BC: Nurture (Low Fit; High Prioritization Index) - D365 F&O: Unknown (Unknown Fit; Unknown Prioritization Index) - D365 Sales Pro: Educate (Very Low Fit; Very Low Prioritization Index) - Has O365: Yes - Has D365: No. ";
const copilot = scan([SC + "Customer wants to bring in a partner to roll out Microsoft 365 Copilot."])[0];
ok("a Copilot lead with a scorecard files M365, not Dynamics", copilot?.category === "m365Tenant", String(copilot?.category));
const bcSc = scan([SC + "Evaluating Dynamics 365 Business Central for 20 users."])[0];
ok("a real BC lead with a scorecard keeps the BC tab (scorecard F&O ignored)", tabOf(bcSc) === "Business Central / ERP", tabOf(bcSc));
const salesSc = scan([SC + "Evaluating Dynamics 365 Sales for 25 users."])[0];
ok("a real Sales lead with a scorecard keeps the Sales tab (scorecard BC ignored)", tabOf(salesSc) === "Sales / CRM", tabOf(salesSc));
const darcy = scan(["The Dynamics (BC) project has not been approved yet. Need: Dynamics ERP & CRM."])[0];
ok('"Dynamics (BC)" is a Dynamics lead on the BC tab', darcy?.category === "dynamics365" && tabOf(darcy) === "Business Central / ERP", `${darcy?.category} ${tabOf(darcy)}`);

console.log("\n== the notes, not the Product Area code, pick the tab ==");
function scanPA(pa: string, note: string) {
  const csv = ["Company,Full Name,Title,Email,Phone,msp_primaryproductcodename,Comments",
    ["Acme", "Pat Vale", "CFO", "pat@acme.com", "3125550100", pa, note].map(q).join(",")].join("\n");
  return scanParsedFiles([parseCSVText("t.csv", csv)]).results[0];
}
const fin = scanPA("Dynamics ERP", "Service: Dynamics 365 Finance - 13 users");
ok("Dynamics 365 Finance under PA 'Dynamics ERP' is not Business Central", tabOf(fin) === "Everything else", tabOf(fin));
const hr = scanPA("Dynamics CRM", "service - Microsoft Dynamics 365 Human Resources - 5 users");
ok("Dynamics 365 Human Resources under PA 'Dynamics CRM' is not Sales / CRM", tabOf(hr) === "Everything else", tabOf(hr));
const locked = scanPA("Dynamics CRM", "f1Locked out of teams");
ok("a login problem beside a phone number is not a Strong Dynamics lead", locked?.tier !== "signal", `${locked?.tier} ${locked?.dqReasons}`);

console.log("\n== Strong Dynamics has to be about a new platform ==");
for (const [note, want] of [
  ["Customer is evaluating Dynamics 365 Business Central to replace QuickBooks.", "signal"],
  ["Service - Dynamics 365 Business Central - 20 users", "signal"],
  ["Lead ID: 7-3X Products: Dynamics 365 Business Central, budget approved this year. Customer POC: Isaac Smith", "signal"],
  ["Also on file for the tenant: Business Premium (63), Dynamics 365 Business Central Essentials (9). Budget approved this year for a Copilot pilot.", "mention"],
  ["Most-used applications: Outlook, Excel and Business Central. Interested in a Copilot rollout plan with a partner, budget this year.", "mention"],
  ["2026-09-25 14:52:46 PDT : Need help with Dynamics 365, budget this year", "mention"],
] as [string, string][]) {
  const r = scan([note])[0];
  ok(`${want.padEnd(7)} <- ${note.slice(0, 60)}`, r?.category === "dynamics365" && r?.tier === want, `${r?.category} ${r?.tier}`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
