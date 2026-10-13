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

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
