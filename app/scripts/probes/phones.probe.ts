// Where do CSP phone numbers go? Trace every row from source columns to
// the exported cell and account for every loss.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow } from "../../src/lib/scanner2";
import { isDialable, labelledPhoneFrom } from "../../src/lib/cspRenewal";

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
const parsed = [parseCSVText("BookCSPs_9-4.csv", fs.readFileSync(P, "utf8"))];
const prof = profileColumns(parsed);
const fields = guessFieldMapping(prof);
console.log("identity mapping:", JSON.stringify(fields));
const raw = parsed[0].data as Record<string, string>[];
const val = (r: Record<string, string>, c: string) => String(r[c] ?? "").trim();

console.log("\n=== the source columns, after parse cleanup ===");
for (const c of ["telephone1", "mobilephone", "address1_telephone1"]) {
  const filled = raw.filter((r) => val(r, c)).length;
  const dial = raw.filter((r) => val(r, c) && isDialable(val(r, c))).length;
  console.log(`  ${c.padEnd(20)} filled ${String(filled).padStart(5)}  dialable ${String(dial).padStart(5)}  unusable ${filled - dial}`);
}
const anySrc = raw.filter((r) => ["telephone1", "mobilephone", "address1_telephone1"].some((c) => val(r, c) && isDialable(val(r, c)))).length;
console.log(`  ANY dialable source column: ${anySrc} of ${raw.length}`);

console.log("\n=== what the mapping actually reads ===");
console.log(`  phone       <- ${fields.phone}`);
console.log(`  mobilePhone <- ${fields.mobilePhone}`);
const unread = ["telephone1", "mobilephone", "address1_telephone1"].filter((c) => c !== fields.phone && c !== fields.mobilePhone);
console.log(`  NOT READ    -> ${unread.join(", ") || "(none)"}`);
for (const c of unread) {
  const rescues = raw.filter((r) => val(r, c) && isDialable(val(r, c)) && !isDialable(val(r, fields.phone || "")) && !isDialable(val(r, fields.mobilePhone || ""))).length;
  console.log(`     ${c}: ${rescues} rows where it is the ONLY dialable number`);
}

const res = scan2(parsed, { ...emptyRuleSet("csp", "csp"), fields, notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
const rows = res.rows;
console.log(`\n=== after the scan (${rows.length} kept of ${res.rowsRead} read) ===`);
const withWork = rows.filter((r) => r.lead.phone).length;
const withMob = rows.filter((r) => r.lead.mobilePhone).length;
const withAny = rows.filter((r) => r.lead.phone || r.lead.mobilePhone).length;
console.log(`  work phone ${withWork}  ·  mobile ${withMob}  ·  either ${withAny}  (${Math.round(100 * withAny / rows.length)}%)`);

const none = rows.filter((r) => !r.lead.phone && !r.lead.mobilePhone);
console.log(`\n=== the ${none.length} rows with NO phone — why? ===`);
let srcBlank = 0, srcMangled = 0, unreadCol = 0, notesLabelled = 0;
for (const r of none) {
  const rr = r.row as Record<string, string>;
  const cols = ["telephone1", "mobilephone", "address1_telephone1"];
  const anyFilled = cols.some((c) => val(rr, c));
  const anyDial = cols.some((c) => val(rr, c) && isDialable(val(rr, c)));
  const inUnread = unread.some((c) => val(rr, c) && isDialable(val(rr, c)));
  if (!anyFilled) srcBlank++;
  else if (!anyDial) srcMangled++;
  else if (inUnread) unreadCol++;
  if (labelledPhoneFrom(String(rr.msp_forecastcomments ?? ""))) notesLabelled++;
}
console.log(`  source columns all blank        ${srcBlank}`);
console.log(`  source held only a mangled E+   ${srcMangled}`);
console.log(`  a column we do not read has one ${unreadCol}   <-- recoverable`);
console.log(`  notes state a labelled phone    ${notesLabelled}   <-- already recovered where possible`);

console.log("\n=== is there an unlabelled number in the notes of phoneless rows? ===");
const LOOSE = /(?<![\d-])(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)/;
const loose = none.filter((r) => LOOSE.test(String((r.row as Record<string, string>).msp_forecastcomments ?? "")));
console.log(`  ${loose.length} of ${none.length} contain a US-shaped number somewhere in the notes`);
loose.slice(0, 8).forEach((r) => {
  const t = String((r.row as Record<string, string>).msp_forecastcomments ?? "");
  const m = LOOSE.exec(t)!;
  const at = Math.max(0, m.index - 70);
  console.log(`    ${r.lead.company.slice(0, 26).padEnd(27)} …${t.slice(at, m.index + 40).replace(/\s+/g, " ")}…`);
});

const ex = rows.filter((r) => r.bucket === "priority").map((r) => toApolloRow(r));
console.log(`\n=== High priority export: ${ex.filter((r) => r["Work Direct Phone"]).length}/${ex.length} work, ${ex.filter((r) => r["Mobile Phone"]).length} mobile, ${ex.filter((r) => r["Work Direct Phone"] || r["Mobile Phone"]).length} either`);
