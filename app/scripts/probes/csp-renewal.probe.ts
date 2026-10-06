// How much renewal information this CSP upload actually carries, and
// whether it reaches the note / exported Notes column.
import { readFileSync } from "node:fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, emptyRuleSet, guessFieldMapping, guessNotesColumns, profileColumns, reconcileCspColumns } from "../../src/lib/scanner2";

const f = process.argv[2];
const pf = parseCSVText(f.split("/").pop()!, readFileSync(f, "utf8"));
const profiles = profileColumns([pf]);
const rs = emptyRuleSet("probe", "csp");
rs.mode = "csp";
rs.fields = guessFieldMapping(profiles);
rs.notesColumns = guessNotesColumns(profiles);
rs.cspColumns = reconcileCspColumns(undefined, pf.fields);
const out = scan2([pf], rs);

let withRenewal = 0, inNote = 0, missing: string[] = [];
const byKind: Record<string, number> = {};
const byBucket: Record<string, number> = {};
for (const r of out.rows) {
  const rn = r.csp?.renewal;
  if (!rn) continue;
  withRenewal++;
  byKind[rn.kind] = (byKind[rn.kind] ?? 0) + 1;
  byBucket[r.bucket] = (byBucket[r.bucket] ?? 0) + 1;
  const head = rn.kind === "renewal" ? (rn.daysOut != null && rn.daysOut < 0 ? "renewed" : "renews") : "close";
  if (r.snippet.includes(head)) inNote++;
  else if (missing.length < 6) missing.push(`${r.lead.company} :: ${rn.kind}/${rn.when}/${rn.daysOut} :: ${r.snippet.slice(0, 120)}`);
}
console.log(`rows read            : ${out.rowsRead}`);
console.log(`state a renewal date : ${withRenewal}`);
console.log(`  by kind            : ${JSON.stringify(byKind)}`);
console.log(`  by bucket          : ${JSON.stringify(byBucket)}`);
console.log(`renewal shown in note: ${inNote} / ${withRenewal}`);
if (missing.length) { console.log(`MISSING FROM NOTE:`); missing.forEach((m) => console.log("  " + m)); }
console.log(`\nsample notes with a renewal:`);
out.rows.filter((r) => r.csp?.renewal).slice(0, 5).forEach((r) => console.log("  " + r.snippet));

// Cap compliance: "close passed X" is one word longer than "renewed X",
// so prove no row was pushed over the word cap by the fix.
import { CSP_NOTE_MAX_WORDS, CSP_NOTE_MAX_WORDS_ASK } from "../../src/lib/cspRenewal";
const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
let over = 0, worst = 0; const ex: string[] = [];
for (const r of out.rows) {
  const cap = r.csp?.wantsPartner ? CSP_NOTE_MAX_WORDS_ASK : CSP_NOTE_MAX_WORDS;
  const n = wc(r.snippet);
  if (n > worst) worst = n;
  if (n > cap) { over++; if (ex.length < 3) ex.push(`${n}>${cap} :: ${r.snippet}`); }
}
console.log(`\nnotes over the word cap: ${over}  (longest note ${worst} words)`);
ex.forEach((e) => console.log("  " + e));
console.log(`\npassed-forecast wording now reads:`);
out.rows.filter((r) => r.csp?.renewal?.kind === "forecast" && (r.csp!.renewal!.daysOut ?? 0) < 0)
  .slice(0, 3).forEach((r) => console.log("  " + r.snippet));
