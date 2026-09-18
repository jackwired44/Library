// The one question that matters: does a dialable telephone1 ever fail to
// reach the export? Row by row, on the real file.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow } from "../../src/lib/scanner2";
import { isDialable } from "../../src/lib/cspRenewal";

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
const parsed = [parseCSVText("BookCSPs_9-4.csv", fs.readFileSync(P, "utf8"))];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });

let lost = 0, kept = 0, mangledOnly = 0;
const losses: string[] = [];
for (const r of res.rows) {
  const src = String((r.row as Record<string, string>).telephone1 ?? "").trim();
  if (!src) continue;
  const exported = (toApolloRow(r) as Record<string, string>)["Work Direct Phone"];
  if (isDialable(src)) {
    if (exported) kept++;
    else { lost++; if (losses.length < 10) losses.push(`  ${r.lead.company.slice(0, 30).padEnd(31)} src=${JSON.stringify(src)} -> exported ${JSON.stringify(exported)}`); }
  } else if (!exported) mangledOnly++;
}
console.log(`rows kept after dedupe: ${res.rows.length} (from ${res.rowsRead} read, ${res.duplicatesMerged} merged)\n`);
console.log(`telephone1 dialable AND exported : ${kept}`);
console.log(`telephone1 dialable but LOST     : ${lost}${lost ? "   <-- BUG" : "   <-- none, nothing is dropped"}`);
console.log(`telephone1 present but Excel-mangled (E+), correctly blanked: ${mangledOnly}`);
losses.forEach((l) => console.log(l));

const ex = res.rows.map((r) => toApolloRow(r) as Record<string, string>);
const withWork = ex.filter((e) => e["Work Direct Phone"]).length;
const withAny = ex.filter((e) => e["Work Direct Phone"] || e["Mobile Phone"]).length;
console.log(`\nexport: work phone ${withWork}/${ex.length} (${Math.round(100 * withWork / ex.length)}%) · any phone ${withAny} (${Math.round(100 * withAny / ex.length)}%)`);
const srcHas = res.rows.filter((r) => isDialable(String((r.row as Record<string, string>).telephone1 ?? ""))).length;
console.log(`source rows with a dialable telephone1: ${srcHas} — export carries ${withWork}, difference ${srcHas - withWork}`);
const fromOther = res.rows.filter((r) => r.lead.phone && !isDialable(String((r.row as Record<string, string>).telephone1 ?? ""))).length;
console.log(`phones sourced from somewhere other than telephone1 (fallback column / labelled note): ${fromOther}`);
const mangledRows = res.rows.filter((r) => r.csp?.phoneMangled).length;
console.log(`rows left with NO phone because Excel destroyed the value: ${mangledRows}`);
