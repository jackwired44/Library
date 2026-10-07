// How often does the SAME person arrive with DIFFERENT notes, across Jack's
// real uploads?
//
// Jack asked how the lead store should handle it: "if i upload leads that
// have different notes on the same person whats the best way to handle
// this … like a month ago i updated a lead for manuel riveriea then just
// now another."
//
// MEASURED ANSWER, across 9,461 keyed rows / 7,395 distinct people from
// five real Main files plus the real CSP export:
//
//   seen more than once            648  (8.8% of people)
//   ...with DIFFERENT notes        635  (98% of those repeats)
//   ...with a different TIER       427
//   ...seen by BOTH scanners       498
//   ...notes that are a pure subset  1
//
// So 634 of 635 carry genuinely different information, and mergeLeads'
// current `notes: inc.notes || prev.notes` destroys it almost every time.
//
// Two distinct shapes, which want different handling:
//
//   COMPLEMENTARY (eric@teamshares.com) — Main says "10 seats on Business
//   Central", a later Main scan says "BC, no count, goes direct with
//   Microsoft", CSP says "$15k on Copilot/D365/BC, annual upfront (74)".
//   Three angles on one opportunity; any single one is worse than all three.
//
//   CONTRADICTORY (ben@marketyourstyle.com) — the SAME scanner across three
//   dates reads "Office 365 A3 (8 seats)" -> Low, "Microsoft 365 A3 (15
//   seats)" -> High, "M365 A1 (1 seat)" -> Bad Leads. That is Microsoft's
//   export data disagreeing with itself, not a scanner defect, and it is
//   worth keeping visible rather than silently resolving to the newest.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns } from "../../src/lib/scanner2";
import { leadInputsFromResults, leadInputsFromRows2 } from "../../src/lib/leadFiling";
import { leadKeyOf, combineNotes, NOTE_COMBINED_MAX, type LeadInput } from "../../src/lib/leadStore";

const DIR = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b";
const MAIN = ["bb31c527-Book8-26-26.csv","c1009a37-Book8-21-26.csv","d119ae44-Book9-4-26.csv","dc5b3192-Book9-30.csv","39b8008d-Book8-10-26.csv"];

type Seen = { key: string; file: string; notes: string; tier: string; src: string };
const seen: Seen[] = [];

// Each Main file scanned SEPARATELY — that is how Jack uploads them.
for (const f of MAIN) {
  const parsed = [parseCSVText(f, fs.readFileSync(`${DIR}/${f}`, "utf8"))];
  const res = scanParsedFiles(parsed);
  const inputs: LeadInput[] = [
    ...leadInputsFromResults(res.results),
  ];
  for (const i of inputs) {
    const k = leadKeyOf(i.email, i.contact, i.company);
    if (k) seen.push({ key: k, file: f, notes: i.notes, tier: i.tier, src: "main" });
  }
}
// Plus the CSP file, a different scanner entirely.
{
  const f = "961c0c2c-BookCSPs_9-4.csv";
  const parsed = [parseCSVText(f, fs.readFileSync(`${DIR}/${f}`, "utf8"))];
  const prof = profileColumns(parsed);
  const res = scan2(parsed, { ...emptyRuleSet("csp","csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof) });
  for (const i of leadInputsFromRows2(res.rows, "csp")) {
    const k = leadKeyOf(i.email, i.contact, i.company);
    if (k) seen.push({ key: k, file: f, notes: i.notes, tier: i.tier, src: "csp" });
  }
}

const byKey = new Map<string, Seen[]>();
for (const s of seen) {
  const a = byKey.get(s.key) || []; a.push(s); byKey.set(s.key, a);
}
const multi = [...byKey.values()].filter((a) => a.length > 1);
const diffNotes = multi.filter((a) => new Set(a.map((x) => x.notes.trim())).size > 1);
const crossScanner = multi.filter((a) => new Set(a.map((x) => x.src)).size > 1);
const diffTier = multi.filter((a) => new Set(a.map((x) => x.tier)).size > 1);

console.log(`rows keyed            ${seen.length}`);
console.log(`distinct people       ${byKey.size}`);
console.log(`seen more than once   ${multi.length}  (${(100*multi.length/byKey.size).toFixed(1)}% of people)`);
console.log(`  ...with DIFFERENT notes   ${diffNotes.length}  (${(100*diffNotes.length/Math.max(1,multi.length)).toFixed(1)}% of repeats)`);
console.log(`  ...with a different TIER  ${diffTier.length}`);
console.log(`  ...seen by BOTH scanners  ${crossScanner.length}`);

console.log(`\n=== 6 real people whose notes differ between uploads ===`);
for (const g of diffNotes.slice(0, 6)) {
  console.log(`\n  ${g[0].key}`);
  for (const s of g) console.log(`    [${s.src}/${s.tier}] ${s.file.slice(0,20)}: ${s.notes.slice(0, 150)}`);
}
// Are the differing notes genuinely complementary, or just the same thing reworded?
let subset = 0;
for (const g of diffNotes) {
  const ns = g.map((x) => x.notes.trim()).filter(Boolean);
  if (ns.length < 2) continue;
  const sorted = [...ns].sort((a,b) => b.length - a.length);
  if (ns.every((n) => sorted[0].includes(n))) subset++;
}
console.log(`\nof ${diffNotes.length} differing-note people, ${subset} are a pure SUBSET (longest contains the rest)`);
console.log(`so ${diffNotes.length - subset} carry genuinely DIFFERENT information in each note`);

// Jack asked whether the notes could instead be MERGED into one field.
// Measure what that actually costs, against the caps he already set: the
// CSP note is capped at 30 words because "our rep is just calling the lead
// and talking they dont need super detailed specifics".
const single = seen.map((s) => s.notes.length).filter(Boolean).sort((a,b)=>a-b);
const joined = diffNotes.map((g) => [...new Set(g.map((x)=>x.notes.trim()).filter(Boolean))].join(" | "));
const jl = joined.map((j) => j.length).sort((a,b)=>a-b);
const pct = (a: number[], q: number) => a.length ? a[Math.floor(a.length*q)] : 0;
console.log(`\n=== what a CONCATENATED note would cost ===`);
console.log(`  one note today        median ${pct(single,0.5)} chars, p90 ${pct(single,0.9)}, max ${single[single.length-1]}`);
console.log(`  concatenated          median ${pct(jl,0.5)} chars, p90 ${pct(jl,0.9)}, max ${jl[jl.length-1]}`);
console.log(`  over 200 chars        ${jl.filter((n)=>n>200).length} of ${jl.length}`);
console.log(`  over 300 chars        ${jl.filter((n)=>n>300).length} of ${jl.length}`);
// How much of a concatenated note is the SAME closing question repeated?
const repeatedAsk = joined.filter((j) => (j.match(/Ask (?:if|how) /g) || []).length > 1).length;
console.log(`  repeat the same "Ask ..." scaffolding twice or more   ${repeatedAsk} of ${jl.length}`);
console.log(`\n=== a real concatenated note ===`);
const worst = joined.filter((j)=>j.length>250)[0];
if (worst) console.log("  " + worst.slice(0, 520));

// What the SHIPPED combine actually produces, replaying each person's
// uploads in order through combineNotes.
const DAY = ["2026-08-21","2026-08-26","2026-09-04","2026-09-30","2026-08-10","2026-10-07"];
const fileDay = (f: string) => {
  if (f.includes("8-21")) return DAY[0];
  if (f.includes("8-26")) return DAY[1];
  if (f.includes("9-4") || f.includes("CSPs_9-4")) return DAY[2];
  if (f.includes("9-30")) return DAY[3];
  if (f.includes("8-10")) return DAY[4];
  return DAY[5];
};
const combinedLens: number[] = [];
let shownOne = "";
for (const g of multi) {
  const ordered = [...g].sort((a,b) => fileDay(a.file) < fileDay(b.file) ? -1 : 1);
  let acc = "";
  for (const s of ordered) acc = combineNotes(acc, s.notes, `${fileDay(s.file)}T12:00:00.000Z`);
  combinedLens.push(acc.length);
  if (!shownOne && g.length >= 3) shownOne = acc;
}
combinedLens.sort((a,b)=>a-b);
console.log(`\n=== what the SHIPPED combine produces, over ${multi.length} repeat people ===`);
console.log(`  median ${pct(combinedLens,0.5)} chars, p90 ${pct(combinedLens,0.9)}, max ${combinedLens[combinedLens.length-1]}`);
console.log(`  over the ${NOTE_COMBINED_MAX}-char cap   ${combinedLens.filter((n)=>n>NOTE_COMBINED_MAX).length}`);
console.log(`\n=== a real 3-upload lead, as stored ===`);
console.log(shownOne.split("\n").map((l)=>"  " + l).join("\n"));
