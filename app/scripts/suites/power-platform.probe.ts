// Per Jack (2026-11-22): Power Apps is its own product line unless the note
// says Dynamics; a Dynamics note with Power Platform sits on its own
// Dynamics tab; Google, migrations and Document Intelligence share one
// M365 / Azure tab.
import { scanParsedFiles, m365SubViewOf, dynamicsTabOfText, ACTIVE_BUCKET_KEYS, exportRowsForBucket } from "../../src/lib/detection";
import { productOf } from "../../src/lib/smartRules";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const fields = ["First Name", "Last Name", "Company", "Email", "Comments", "Product Area"];
const scan = (note: string, pa = "") => {
  const r = scanParsedFiles([{ name: "t.csv", fields, data: [{ "First Name": "Pat", "Last Name": "Lee", Company: "Acme Co", Email: "pat@acmeco.com", Comments: note, "Product Area": pa }] }]).results[0];
  return r;
};
const a = scan("Looking for a partner to build Power Apps and Power Automate flows for 40 users.");
ok("Power Apps with no Dynamics is the Power Platform line", a?.category === "powerPlatform", a?.category);
ok("…and still Strong Signal, as before", a?.tier === "signal", a?.tier);
const h = scan("Dataverse app build for 30 users with a partner.");
ok("Dataverse counts as Power Platform", h?.category === "powerPlatform", h?.category);
const b = scan("Wants Dynamics 365 Sales plus Power Apps for field reps, 25 users.");
ok("Power Apps on a note that says Dynamics stays Dynamics 365", b?.category === "dynamics365", b?.category);
ok("…on the Power Platform tab", !!b?.isPowerPlatform && !b?.isSalesCrm && !b?.isBusinessCentral);
const c = scan("Evaluating Dynamics 365 Business Central and Power Automate for 30 users.");
ok("Business Central named still wins the BC / ERP tab", !!c?.isBusinessCentral && !c?.isPowerPlatform);
const f = scan("Finance and Operations with Power Apps on top, 50 users of Dynamics.");
ok("F&O still wins Everything else", !f?.isPowerPlatform && !f?.isBusinessCentral && !f?.isSalesCrm, JSON.stringify({ p: f?.isPowerPlatform }));
const d = scan("Wants Dynamics 365 Sales for 20 users, demo please.");
ok("a Dynamics Sales lead is untouched", d?.category === "dynamics365" && !!d?.isSalesCrm && !d?.isPowerPlatform);
const pbi = scan("Need a partner to build Power BI dashboards for 30 users.");
ok("Power BI stays M365 / Azure", pbi?.category === "m365Tenant", pbi?.category);
ok("tab rule: BC beats Power Platform", dynamicsTabOfText("Business Central and Power Apps") === "bc");
ok("tab rule: Power Platform beats Sales", dynamicsTabOfText("Dynamics 365 Sales and Power Apps") === "power");
ok("tab rule: ERP alone is still BC", dynamicsTabOfText("Dynamics ERP project") === "bc");
const g = scan("Moving off Google Workspace to Microsoft 365 for 50 users.");
ok("Google move is on the merged migrations tab", g?.category === "m365Tenant" && m365SubViewOf(g!) === "migration");
const di = scan("Wants Azure Document Intelligence to extract invoices, need a partner.");
ok("Document Intelligence is on the merged migrations tab", !!di?.isDocumentIntelligence && m365SubViewOf(di!) === "migration");
const lic = scan("Need 40 Microsoft 365 Business Premium licenses, quote please.");
ok("plain licensing is Everything else", m365SubViewOf(lic!) === "other");
ok("Power Platform is a download bucket", ACTIVE_BUCKET_KEYS.includes("powerPlatform"));
ok("Power Platform download holds the Power Platform lead", exportRowsForBucket([a!], "powerPlatform").length === 1 && exportRowsForBucket([a!], "dynamics").length === 0);
ok("smart rules read the Power Platform line", productOf("Power Platform") === "power" && productOf("Dynamics 365") === "dynamics");
console.log(`${pass} / ${pass + fail}`);
if (fail) process.exit(1);
