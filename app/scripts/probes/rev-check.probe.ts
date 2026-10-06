import { readFileSync } from "node:fs";
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
const parsed = process.argv.slice(2).map((f) => parseCSVText(f.split("/").pop()!, readFileSync(f, "utf8")));
const hi = scanParsedFiles(parsed).results.filter((r) => r.tier === "signal");
// Explicit, unambiguous "this deal is dead" language — does any real row
// carry one that the brief is now failing to report?
const HARD = /\b(decided (?:against|not to proceed)|not (?:to )?proceed\w*|went with \w+ instead|cancel(?:led|ed)\b|declin(?:ed|ing)\b|fell through|backed out|passed on|on hold|no longer (?:interested|pursuing)|stay(?:ing)? (?:on|with) \w+)\b/i;
const hard = hi.filter((r) => HARD.test(Object.values(r.row ?? {}).map(String).join(" ")));
const carried = hard.filter((r) => /Row reverses:/.test(r.notesSummary));
console.log(`rows with explicit dead-deal language: ${hard.length} of ${hi.length}`);
console.log(`of those, the brief reports it:        ${carried.length}`);
hard.slice(0, 6).forEach((r) => {
  const m = HARD.exec(Object.values(r.row ?? {}).map(String).join(" "));
  console.log(`   [${m?.[0]}] ${/Row reverses:/.test(r.notesSummary) ? "REPORTED" : "MISSED  "} :: ${r.notesSummary.slice(0, 95)}`);
});
