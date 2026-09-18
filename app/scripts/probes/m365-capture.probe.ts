// Focused probe: which Microsoft-365 phrasings does the engine actually see?
// Goes through parseCSVText (the real path, incl. stripGluedNull) rather
// than hand-built rows, so nothing here is an artefact of the harness.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";

const PHRASES: string[] = [
  "We use Microsoft 365 here.",
  "Microsoft 365 for 50 users.",
  "Microsoft 365 licensing for 50 users, renewal in March.",
  "M365 for 50 users.",
  "Office 365 for 50 users.",
  "Microsoft 365 Business Standard for 50 users.",
  "Microsoft 365 Business Premium for 50 users.",
  "Microsoft 365 E3 for 50 users.",
  "M365 E5 for 50 users.",
  "348 Microsoft 365 G3 licenses up for renewal.",
  "Microsoft 365 password reset, locked out of my account.",
  "Microsoft 365 for 60 users but we are happy with our current provider.",
  "Microsoft 365 for 50 users, we want to work with Microsoft directly, not a reseller.",
  "F1 / Company Tenant Partner",
  "Dynamics 365 Business Central- 40 usersNULL",
  "...they need help with their workload.NULL",
];

const HEAD = ["First Name", "Last Name", "Title", "Company", "Email", "Phone", "Comments"];
const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
const csv = HEAD.join(",") + "\n" + PHRASES.map((p, i) =>
  [`F${i}`, `L${i}`, "IT Director", `Probe ${i} Inc`, `p${i}@probe${i}corp.com`, `(312) 555-${1000 + i}`, p].map(esc).join(",")
).join("\n");

(async () => {
  const parsed = parseCSVText("m365.csv", csv);
  const s = scanParsedFiles([parsed]);

  const tierOf = new Map<string, string>();
  const seat = new Map<string, unknown>();
  const cat = new Map<string, string>();
  const dq = new Map<string, string[]>();
  s.results.forEach(r => {
    const c = String(r.row.__f.company || "").trim();
    tierOf.set(c, r.tier); cat.set(c, r.category); dq.set(c, r.dqReasons);
    seat.set(c, r.dynamicsSeatCount ?? r.licensing?.count ?? null);
  });
  const noSig = new Set(s.noSignalRows.map(r => String(r.company || "").trim()));

  console.log("\n  bucket     seats  category      phrase");
  console.log("  " + "-".repeat(96));
  PHRASES.forEach((p, i) => {
    const key = `Probe ${i} Inc`;
    const bucket = noSig.has(key) ? "NO SIGNAL" : (tierOf.get(key) === "signal" ? "STRONG" : tierOf.get(key) === "mention" ? "REVIEW" : "BAD");
    const reasons = dq.get(key) ?? [];
    console.log(`  ${bucket.padEnd(10)} ${String(seat.get(key) ?? "-").padEnd(6)} ${(cat.get(key) ?? "-").padEnd(13)} ${p.slice(0, 58)}${reasons.length ? `\n${" ".repeat(33)}[DQ: ${reasons.join("; ")}]` : ""}`);
  });

  console.log(`\n  read ${s.rowsScanned} · processed ${s.results.length} · no signal ${s.noSignalRows.length} · dupes ${s.duplicatesRemoved}`);
})();
