import { parseSmcLead, parsePulledOn } from "../../src/lib/smcLead";
import { leadKey } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
console.log("=== every date-shaped string in each blob, and what we read ===");
(samples as string[]).forEach((d, i) => {
  const hits = [...d.matchAll(/([A-Za-z][A-Za-z ]{0,24}?)[:\s(]{0,4}(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4})/g)]
    .map((m) => `${m[1].trim().slice(-28)} => ${m[2]}`);
  const l = parseSmcLead(d);
  console.log(String(i).padStart(2), "pulledOn:", String(l.pulledOn).padEnd(12), "| raw dates:", hits.length ? hits.join(" ;; ") : "none");
});
console.log("\n=== lead identity collisions (curation key) ===");
const seen = new Map<string, number[]>();
(samples as string[]).forEach((d, i) => {
  const l = parseSmcLead(d);
  const k = leadKey({ company: l.company, contact: l.contacts[0] ? `${l.contacts[0].firstName} ${l.contacts[0].lastName}`.trim() : "", title: "", email: "", phone: "", notes: "" } as never);
  if (!k) return;
  seen.set(k, [...(seen.get(k) || []), i]);
});
for (const [k, idx] of seen) if (idx.length > 1) console.log("  shared key", JSON.stringify(k), "rows", idx.join(","));
console.log("  (none listed above = no collisions)");
console.log("\n=== parsePulledOn unit ===");
const cases: [string, string | null][] = [
  ["Details (as pulled from Cloud Ascent on 2026-02-25): - Azure", "2026-02-25"],
  ["Adds (as pulled on 2026-09-01): - Has O365", "2026-09-01"],
  ["pulled from Cloud Ascent on 2026-06-27) ... (as pulled on 2026-06-22)", "2026-06-22"],
  ["Timeline: 11/30/2026 Partner: 3RT", null],
  ["no date here", null],
];
let bad = 0;
for (const [t, want] of cases) { const got = parsePulledOn(t); if (got !== want) { bad++; console.log("  FAIL", JSON.stringify(t.slice(0, 40)), got, "wanted", want); } }
console.log(bad ? `  ${bad} failed` : `  ${cases.length}/${cases.length} ok`);
