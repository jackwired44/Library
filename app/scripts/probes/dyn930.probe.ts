import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, topPriorityReason } from "../../src/lib/detection";
const F = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/9deefce3-Book9-30.csv";
const { results, rowsScanned, duplicatesRemoved, noSignalRows } =
  scanParsedFiles([parseCSVText("Book9-30.csv", fs.readFileSync(F, "utf8"))]);
const strong = results.filter((r) => r.tier === "signal");
const dyn = strong.filter((r) => r.category === "dynamics365");
const f = (r: any) => r.row.__f || {};
console.log(`${rowsScanned} rows read · ${duplicatesRemoved} duplicates merged · ${noSignalRows.length} no signal · ${results.length} processed`);
console.log(`Strong Signal ${strong.length} — Dynamics 365 ${dyn.length}, M365/Azure ${strong.length - dyn.length}`);
const sub = (r: any) => r.isBusinessCentral ? "BC/ERP" : r.isSalesCrm ? "Sales/CRM" : "Other";
console.log(`  of the ${dyn.length}: ${dyn.filter((r)=>sub(r)==="BC/ERP").length} BC/ERP · ${dyn.filter((r)=>sub(r)==="Sales/CRM").length} Sales/CRM · ${dyn.filter((r)=>sub(r)==="Other").length} Other`);
const seats = (r: any) => r.dynamicsSeatCount ?? r.licensing?.count ?? null;
const sorted = [...dyn].sort((a, b) => (b.mainScore?.score ?? 0) - (a.mainScore?.score ?? 0));
console.log(`\n${"#".padStart(3)}  SCORE  SEATS  VIEW       COMPANY / CONTACT`);
sorted.forEach((r, i) => {
  const x = f(r);
  const pin = topPriorityReason(r as any);
  console.log(`\n${String(i + 1).padStart(3)}. (${String(r.mainScore?.score ?? 0).padStart(2)})  ${String(seats(r) ?? "—").padStart(4)}  ${sub(r).padEnd(9)}  ${x.company || "(blank)"}${pin ? `  ★${pin}` : ""}`);
  console.log(`      ${[x.fullName, x.title].filter(Boolean).join(" · ") || "(no contact)"}${x.email ? `  ${x.email}` : ""}${x.workPhone ? `  ${x.workPhone}` : ""}`);
  console.log(`      ${r.notesSummary}`);
});
