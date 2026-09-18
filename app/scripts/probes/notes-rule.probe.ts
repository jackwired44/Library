// THE NOTES RULE. Per Jack: when leads are scanned the notes must make sense
// — no gaps, no inconsistencies. This enforces that contract on every row of
// every branch, at volume, so a future rule change cannot quietly produce a
// note that describes a lead without saying why it landed where it did.
import { parseCSVText } from "../../src/lib/csv";
import { tidyBantValue, parseSmcLead } from "../../src/lib/smcLead";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, BUCKET2_META, tidyNote, type Bucket2 } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

const CAMPS = [
  'US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6',
  'US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10',
  'US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7',
  'US~FY24~CMP~COE True Up 1~SRAIM419760',
  'US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13',
  'US~US~FY25~CMP~Power BI Adoption~SRAIM9',
  'NULL',
];
const N = 2000;
const lines = ['companyname,description,campaignidname'];
for (let i = 0; i < N; i++) {
  const blob = (samples as string[])[i % samples.length].replace(/Customer TPID: (\d+)/, `Customer TPID: ${8000000 + i}`);
  lines.push(['', blob, CAMPS[i % CAMPS.length]].map(esc).join(','));
}
const parsed = [parseCSVText('rule.csv', lines.join('\n'))];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet('r'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
console.log(`  checking ${res.rows.length} scanned rows across every branch\n`);

// A note must open with a phrase that matches where the lead landed.
const OPENERS: Record<Bucket2, RegExp> = {
  priority: /^(Act Now|Evaluate|Nurture|Educate|Hot signal —|High prioritization index:|BANT on file —)/,
  review: /^(Needs review —|")/,               // the quoted form is the large-opp branch
  excluded: /^(Stale campaign —|No usable lead content|Not supported —)/,
  unmatched: /^No signal —/,
};

const bad: Record<string, string[]> = {};
const note = (k: string, row: number, n: string) => { (bad[k] ||= []).push(`row ${row}: "${n.slice(0, 90)}"`); };

res.rows.forEach((r, i) => {
  const n = r.snippet ?? "";
  if (!n.trim()) note("empty", i, n);
  else if (n.trim().length < 12) note("too short to mean anything", i, n);
  if (/ {2,}/.test(n)) note("doubled spaces", i, n);
  if (/(?:·\s*){2,}/.test(n)) note("doubled separator", i, n);
  if (/^[\s·]/.test(n) || /[\s·]$/.test(n)) note("separator hanging off an end", i, n);
  if (/\bundefined\b|\bNaN\b|\[object/.test(n)) note("placeholder leaked into the note", i, n);
  // "NULL" is legitimate only in the one sentence that names it.
  if (/\bNULL\b/.test(n) && !/No usable lead content \(blank or NULL\)/.test(n)) note("stray NULL", i, n);
  if (!OPENERS[r.bucket].test(n)) note(`note does not open with a ${BUCKET2_META[r.bucket].label} reason`, i, n);
  // Consistency: the note must not claim something the verdict contradicts.
  if (/Act Now \+ High\+ Fit/.test(n) && r.bucket !== "priority") note("claims a qualifying gap but is not Strong Signal", i, n);
  if (/Not supported —/.test(n) && r.bucket !== "excluded") note("claims not-supported but is not a Bad Lead", i, n);
  if (/Stale campaign —/.test(n) && r.bucket !== "excluded") note("claims stale but is not a Bad Lead", i, n);
});

const labels = [
  "empty", "too short to mean anything", "doubled spaces", "doubled separator",
  "separator hanging off an end", "placeholder leaked into the note", "stray NULL",
  "claims a qualifying gap but is not Strong Signal", "claims not-supported but is not a Bad Lead",
  "claims stale but is not a Bad Lead",
  ...Object.keys(bad).filter((k) => k.startsWith("note does not open")),
];
for (const k of [...new Set(labels)]) {
  ok(`no note: ${k}`, !bad[k], bad[k] ? `${bad[k].length} rows, e.g. ${bad[k][0]}` : "");
}
// Every bucket actually occurred, or the checks above proved nothing.
const seen = new Set(res.rows.map((r) => r.bucket));
ok("all four verdicts were exercised", seen.size === 4, [...seen].join(","));


console.log("\n  quoted BANT reads as content, not scaffolding:");
// The Notes column quotes the BANT need verbatim. These values arrive with
// their own sub-label and status word attached, which read as nonsense:
//   "Need: Solution: Data & Analytics" / "Need: Confirmed – secure, native AI"
const bantCases: [string, string][] = [
  ["Solution: Data & Analytics Modernization / Fabric", "Data & Analytics Modernization / Fabric"],
  ["Confirmed – secure, native AI integrated with M365 data and controls", "secure, native AI integrated with M365 data and controls"],
  ["Assumed minimum value: $10,000 placeholder", "$10,000"],
  ["34200 - Unverified – existing Microsoft budget; prefers reallocation", "34200"],
  ["Owner: Eric Wells", "Eric Wells"],
  ["Cloud and Security Evaluation", "Cloud and Security Evaluation"],
  ["Copilot / Copilot Chat", "Copilot / Copilot Chat"],
];
for (const [raw, want] of bantCases) {
  ok(`"${raw.slice(0, 38)}..." reads as "${want.slice(0, 32)}"`, tidyBantValue(raw) === want, `got "${tidyBantValue(raw)}"`);
}
for (const junk of ["TBD", "Confirmed", "N/A", "unknown", "  "]) {
  ok(`scaffolding-only value "${junk.trim()}" is dropped, not quoted`, tidyBantValue(junk) === "", `got "${tidyBantValue(junk)}"`);
}
// End to end: no note may quote a label twice or lead with a status word.
const quoted = res.rows.map((r) => r.snippet).filter((n) => /Need:/.test(n));
ok("no note repeats a label, e.g. \"Need: Solution:\"", !quoted.some((n) => /Need:\s*[A-Za-z][A-Za-z/&' ]{0,28}:/.test(n)), quoted.find((n) => /Need:\s*[A-Za-z][A-Za-z/&' ]{0,28}:/.test(n)) || "");
ok("no note quotes a status word as the need", !quoted.some((n) => /Need:\s*(Confirmed|Unverified|Assumed|TBD)\b/i.test(n)), quoted.find((n) => /Need:\s*(Confirmed|Unverified|Assumed|TBD)\b/i.test(n)) || "");
void parseSmcLead;

console.log("\n  normaliser holds on hostile input:");
ok("empty string falls back rather than returning nothing", tidyNote("").length > 0, tidyNote(""));
ok("dangling separators are trimmed", tidyNote(" · a · · b ·  ") === "a · b", `"${tidyNote(" · a · · b ·  ")}"`);
ok("runs of whitespace collapse", tidyNote("a    b") === "a b");

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
