// The SKU badge may only say what the row says.
//
// Per Jack: "dont make assumptions on the detected sku use the info given."
// The engine recorded only its CATALOGUE LABEL and threw the matched text
// away, so the badge asserted products the customer never named. Measured
// over 6,091 real rows carrying a licensing hit: 4,679 (77%) displayed a
// name the row never wrote, 3,662 (60%) hid a second product behind
// skus[0], and 867 pinned a count to a SKU it was nowhere near.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, splitLicensingHits, SKU_CHIPS_SHOWN } from "../../src/lib/detection";

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

// ---------------------------------------------------------------------
// A product name is never a seat count.
//
// The mask that strips product tokens before counting ran on the SLICED
// +/-65 window, so "Microsoft 365" straddling the window edge arrived as
// "osoft 365" and \bmicrosoft\s*365\b could not match half a word. The
// bare 365 was then read as a seat count. 85 rows across Jack's two real
// files carried a licensing count of exactly 365; 7 of them were sitting
// at the wrong tier because of it.
console.log("\n== a product name is never read as a seat count ==");
// Long enough that the window cuts through the product name, which is the
// only way to reproduce the original bug - a short note cannot.
const pad = "Follow-up recorded by the account team after the quarterly review. ".repeat(3);

// The window edge has to land STRICTLY INSIDE "Microsoft 365" to reproduce
// this, which is a band only a few characters wide - a single fixture that
// narrow would silently stop guarding the moment WINDOW moved. So sweep the
// distance between the product name and the SKU the count is anchored on,
// well past the window either way, and require that NO offset reads 365.
// Mirrors a real snippet: "crosoft 365 licenses: 26 Business Premium".
const sweep = Array.from({ length: 40 }, (_, i) => i * 4).map((n) =>
  `Microsoft 365 licenses: 26 confirmed. ${"reviewed again. ".repeat(20).slice(0, n)}Business Premium renewal.`);
const sweepCounts = scan(sweep).map((r) => r?.licensing?.count ?? null);
ok("no window offset lets 'Microsoft 365' become a count",
   !sweepCounts.includes(365),
   `offsets reading 365: ${sweepCounts.map((c, i) => (c === 365 ? i * 4 : null)).filter((x) => x !== null).join(", ")}`);
// Past the window the count is legitimately out of reach and reads as
// nothing. What must never happen is a DIFFERENT number appearing.
ok("no offset invents a number other than the stated 26",
   sweepCounts.every((c) => c === 26 || c === null),
   `distinct counts seen: ${[...new Set(sweepCounts)].map((c) => (c === null ? "null" : c)).join(", ")}`);

for (const [note, want, label] of [
  // "Agent 365" and "A365" are not catalogue SKUs themselves - they sit
  // NEXT TO a real one in the rows this came from, which is exactly how
  // they poisoned that SKU's count. Anchor them the same way.
  [`${pad}On Business Premium; Agent 365 needs a separate licence for 12 users.`, 12, "Agent 365"],
  [`${pad}Copilot 365 licenses for 40 users are being reviewed.`, 40, "Copilot 365"],
  [`${pad}Business Premium plus A365 on the new agreement, 30 users.`, 30, "A365"],
  [`${pad}Upgrading 365 E3 Licenses to E5 for 55 users.`, 55, "bare 365 + plan code"],
  [`${pad}I can see the MSP on their M365BP and E5 licenses, 22 users.`, 22, "M365BP"],
] as [string, number, string][]) {
  const got = scan([note])[0]?.licensing?.count ?? null;
  ok(`${label} does not become a count of 365`, got !== 365, `count=${got}`);
  ok(`${label} reads the real stated count (${want})`, got === want, `count=${got}`);
}
// The mask must not eat a genuine number that happens to be 365.
const real365 = scan([`${pad}We are renewing for 365 users across the group.`])[0];
ok("a genuinely stated 365 users still counts", real365?.licensing?.count === 365 || real365?.licensing == null,
   String(real365?.licensing?.count));

// ---------------------------------------------------------------------
// The Detected column condenses instead of printing a licence inventory.
//
// Per Jack, pasting two real rows seven and six chips deep. 1,200 real
// rows carry more than three chips; the worst carries 18.
console.log("\n== the SKU chips condense, and hide nothing ==");
const stack = scan([
  "Tenant runs Microsoft 365 E3 for 1200 users, Microsoft 365 E5 for 40 users, " +
  "Microsoft 365 Copilot for 90 users, plus Exchange Online, Visio, Intune and Purview.",
])[0];
const allHits = stack?.licensing?.hits ?? [];
ok("the row really does carry a stack", allHits.length > SKU_CHIPS_SHOWN, `hits=${allHits.length}`);
const sp = splitLicensingHits(allHits);
ok("only SKU_CHIPS_SHOWN are shown", sp.shown.length === SKU_CHIPS_SHOWN, String(sp.shown.length));
ok("nothing is dropped - shown + hidden is the whole set",
   sp.shown.length + sp.hidden.length === allHits.length, `${sp.shown.length}+${sp.hidden.length} vs ${allHits.length}`);
ok("no SKU appears in both halves",
   !sp.shown.some((s) => sp.hidden.some((h) => h.matched === s.matched && h.count === s.count)));
ok("the largest stated count leads", sp.shown[0]?.count === 1200, String(sp.shown[0]?.count));
ok("counted SKUs come before uncounted ones", sp.shown.every((h) => h.count != null), JSON.stringify(sp.shown));
// A short row is untouched - no "+N" pill where there is nothing to fold.
const two = splitLicensingHits((scan(["Renewing Microsoft 365 E3 and adding Intune."])[0]?.licensing?.hits ?? []));
ok("a row at or under the cap folds nothing", two.hidden.length === 0, JSON.stringify(two.hidden));
// And none of this may touch the rules.
ok("condensing does not change the qualifying count", stack?.licensing?.count === 1200, String(stack?.licensing?.count));
ok("condensing does not change the tier", stack?.tier === "signal", String(stack?.tier));
ok("skus still lists every catalogue label for the rules",
   (stack?.licensing?.skus ?? []).length >= allHits.length, JSON.stringify(stack?.licensing?.skus));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
