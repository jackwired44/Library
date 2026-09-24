// The SKU badge may only say what the row says.
//
// Per Jack: "dont make assumptions on the detected sku use the info given."
// The engine recorded only its CATALOGUE LABEL and threw the matched text
// away, so the badge asserted products the customer never named. Measured
// over 6,091 real rows carrying a licensing hit: 4,679 (77%) displayed a
// name the row never wrote, 3,662 (60%) hid a second product behind
// skus[0], and 867 pinned a count to a SKU it was nowhere near.
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
const chips = (n: string) => (scan([n])[0]?.licensing?.hits ?? []).map((h) => h.matched + (h.count != null ? `·${h.count}` : ""));

console.log("\n== the badge quotes the row, it does not rename the product ==");
for (const [note, want] of [
  // the row never said "Pro" or "Premium" - the catalogue did
  ["We use Power BI across finance.", "Power BI"],
  // the row named F3; the catalogue label says "F1 / F3"
  ["Rolling out Microsoft 365 F3 for 200 frontline workers.", "Microsoft 365 F3"],
  // the row wrote a bare tier; the catalogue label is "Bare E3 / E5 mention"
  ["Currently on E5 across the business.", "E5"],
  ["Renewing Business Premium next month.", "Business Premium"],
] as [string, string][]) {
  const got = chips(note);
  ok(`row says ${JSON.stringify(want)}`, got.some((c) => c.split("·")[0] === want), JSON.stringify(got));
}

console.log("\n== every product the row named is shown, not just the first ==");
const many = chips("They have Microsoft 365 E3 and Power BI and SharePoint Online.");
ok("all three appear", ["Microsoft 365 E3", "Power BI", "SharePoint"].every((w) => many.some((c) => c.startsWith(w))), JSON.stringify(many));

console.log("\n== a count belongs to the product it was written beside ==");
// The old engine took the MAX count across every hit and pinned it to the
// first SKU: this row would have read "Microsoft 365 E3 · 300".
const split = chips("Microsoft 365 E3 for 5 users, and Microsoft 365 Copilot for 300 users.");
const e3 = split.find((c) => c.startsWith("Microsoft 365 E3")) ?? "";
const cop = split.find((c) => c.startsWith("Microsoft 365 Copilot")) ?? "";
ok("E3 carries 5, not 300", e3.endsWith("·5"), e3);
ok("Copilot carries 300", cop.endsWith("·300"), cop);
ok("no product borrows another's number", !split.some((c) => c.startsWith("Microsoft 365 E3") && c.endsWith("·300")), JSON.stringify(split));

console.log("\n== one mention is one chip, however many patterns caught it ==");
const dup = chips("Looking at Microsoft 365 E3 licensing. E3 is the current plan.");
ok("the bare mention collapses into the specific one", dup.filter((c) => /e3/i.test(c)).length === 1, JSON.stringify(dup));
const cl = chips("They bought Copilot licenses last quarter; Copilot is going well.");
ok("Copilot is not repeated in two phrasings", cl.length === 1, JSON.stringify(cl));

console.log("\n== qualification is untouched by any of this ==");
const r = scan(["Renewing 40 Microsoft 365 E3 licenses next month."])[0];
ok("still Strong Signal", r?.tier === "signal", String(r?.tier));
ok("skus still carries the catalogue label for the rules",
   (r?.licensing?.skus ?? []).includes("Microsoft 365 E3"), JSON.stringify(r?.licensing?.skus));
ok("the threshold still reads the stated count", r?.licensing?.count === 40, String(r?.licensing?.count));
ok("status still qualified", r?.licensing?.status === "qualified", String(r?.licensing?.status));
const low = scan(["Renewing 3 Microsoft 365 E3 licenses next month."])[0];
ok("a sub-threshold count is still a Bad Lead", low?.tier === "dq", String(low?.tier));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
