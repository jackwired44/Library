// What the partner-related filters on the CSP tab can and cannot express
// today, measured on the real 9,265-row export.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns } from "../../src/lib/scanner2";
import { POSTURE_META } from "../../src/lib/cspRenewal";

const DIR = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b";
const FILE = "961c0c2c-BookCSPs_9-4.csv";
const parsed = [parseCSVText(FILE, fs.readFileSync(`${DIR}/${FILE}`, "utf8"))];
const prof = profileColumns(parsed);
const res = scan2(parsed, {
  ...emptyRuleSet("csp", "csp"),
  fields: guessFieldMapping(prof),
  notesColumns: guessNotesColumns(prof),
});
const leads = res.rows.map((r) => r.csp!).filter(Boolean);
console.log(`${res.rows.length} rows, ${leads.length} with a CSP lead\n`);

const n = (f: (l: typeof leads[0]) => boolean) => leads.filter(f).length;
const open = (l: typeof leads[0]) => POSTURE_META[l.posture].open;

console.log("=== the three partner signals, separately ===");
console.log(`  wantsPartner (⚑ the customer asks)        ${n((l) => l.wantsPartner)}`);
console.log(`  partnerPain  (unhappy with who they have) ${n((l) => !!l.partnerPain)}`);
console.log(`  perfect      (★ ask + open + annual up)   ${n((l) => l.perfect)}`);
console.log(`  openRenewal  (◆ renewal + open lane)      ${n((l) => l.openRenewal)}`);

console.log("\n=== wants a partner, crossed with who holds them ===");
console.log(`  wants + OPEN lane (nobody on record)      ${n((l) => l.wantsPartner && open(l))}`);
console.log(`  wants + HELD by a named partner          ${n((l) => l.wantsPartner && !open(l))}`);
console.log(`     …of those, with stated pain            ${n((l) => l.wantsPartner && !open(l) && !!l.partnerPain)}`);
console.log(`  does NOT state an ask, open lane          ${n((l) => !l.wantsPartner && open(l))}`);
console.log(`  does NOT state an ask, held               ${n((l) => !l.wantsPartner && !open(l))}`);

console.log("\n=== pain, crossed with the ask ===");
console.log(`  pain AND states an ask                    ${n((l) => !!l.partnerPain && l.wantsPartner)}`);
console.log(`  pain but states NO ask (silent churn)     ${n((l) => !!l.partnerPain && !l.wantsPartner)}`);

console.log("\n=== union: any partner-interest signal at all ===");
const anySignal = (l: typeof leads[0]) => l.wantsPartner || !!l.partnerPain;
console.log(`  wants OR pain                             ${n(anySignal)}`);
console.log(`  …inside High priority                     ${n((l) => anySignal(l) && l.score >= 60)}`);

console.log("\n=== how many controls each real question needs today ===");
const asks: [string, (l: typeof leads[0]) => boolean][] = [
  ["everyone asking for a partner", (l) => l.wantsPartner],
  ["asking + nobody holds them", (l) => l.wantsPartner && open(l)],
  ["asking + already held (the best type)", (l) => l.wantsPartner && !open(l)],
  ["unhappy with their partner", (l) => !!l.partnerPain],
  ["any partner interest at all", anySignal],
  ["★ perfect only", (l) => l.perfect],
];
for (const [label, f] of asks) console.log(`  ${label.padEnd(40)} ${String(n(f)).padStart(5)}`);

console.log("\n=== 8 real held-and-still-asking rows ===");
leads.filter((l) => l.wantsPartner && !open(l)).slice(0, 8).forEach((l) => {
  console.log(`  [${l.score}] ${l.company} — held by ${l.partner || "?"}${l.partnerPain ? ` (${l.partnerPain})` : ""}`);
});
console.log("\n=== 8 real pain-but-no-ask rows ===");
leads.filter((l) => !!l.partnerPain && !l.wantsPartner).slice(0, 8).forEach((l) => {
  console.log(`  [${l.score}] ${l.company} — ${l.partnerPain} (${POSTURE_META[l.posture].label})`);
});
