import * as fs from "fs";
import { parseCSVText, toCSV } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
const F = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/9deefce3-Book9-30.csv";
const { results } = scanParsedFiles([parseCSVText("Book9-30.csv", fs.readFileSync(F, "utf8"))]);
const dyn = results.filter((r) => r.tier === "signal" && r.category === "dynamics365");
const sub = (r: any) => r.isBusinessCentral ? "Business Central / ERP" : r.isSalesCrm ? "Sales / CRM" : "Everything else";
const seats = (r: any) => r.dynamicsSeatCount ?? r.licensing?.count ?? null;
const sorted = [...dyn].sort((a, b) => (b.mainScore?.score ?? 0) - (a.mainScore?.score ?? 0));
const LABELS = ["Score","Seats","View","Company Name","First Name","Title","Email","Work Direct Phone","Notes"];
const rows = sorted.map((r: any) => { const x = r.row.__f || {}; return {
  "Score": String(r.mainScore?.score ?? ""), "Seats": seats(r) == null ? "" : String(seats(r)),
  "View": sub(r), "Company Name": x.company || "", "First Name": x.fullName || "",
  "Title": x.title || "", "Email": x.email || "", "Work Direct Phone": x.workPhone || "",
  "Notes": r.notesSummary }; });
const out = "/tmp/claude-0/-home-user-Library/dd1348d8-8ff6-501c-af5d-361f8a90722b/scratchpad/strong-dynamics-9-30.csv";
fs.writeFileSync(out, toCSV(rows as any, LABELS));
console.log(`${rows.length} rows -> ${out}`);
