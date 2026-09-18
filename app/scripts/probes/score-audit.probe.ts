// Does the High band actually contain leads worth calling? Read real rows
// at each level rather than trusting the arithmetic.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns } from "../../src/lib/scanner2";
import { POSTURE_META, BILLING_META, DEFAULT_CSP_RULES } from "../../src/lib/cspRenewal";

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
const parsed = [parseCSVText("BookCSPs_9-4.csv", fs.readFileSync(P, "utf8"))];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
const R = DEFAULT_CSP_RULES;
const rows = res.rows;
const high = rows.filter((r) => r.bucket === "priority");
const pct = (n: number, d: number) => `${Math.round(100 * n / d)}%`;

console.log(`High band: ${high.length} of ${rows.length} (${pct(high.length, rows.length)})\n`);

console.log("=== what is actually IN the High band ===");
const openN = high.filter((r) => POSTURE_META[r.csp!.posture].open).length;
const annualUp = high.filter((r) => r.csp!.billingRank <= 1).length;
const fresh = high.filter((r) => (r.csp!.ageDays ?? 999) <= 30).length;
const noDate = high.filter((r) => r.csp!.ageDays == null).length;
const hasPhone = high.filter((r) => r.lead.phone || r.lead.mobilePhone).length;
const bigMoney = high.filter((r) => (r.csp!.value ?? 0) >= 50000).length;
const noValue = high.filter((r) => r.csp!.value == null || r.csp!.value === 0).length;
const motion = high.filter((r) => r.csp!.motion.length > 0).length;
const deadAny = high.filter((r) => r.csp!.deadReasons.length > 0).length;
console.log(`  open partner lane      ${String(openN).padStart(5)}  ${pct(openN, high.length)}`);
console.log(`  annual upfront (0 or 1)${String(annualUp).padStart(5)}  ${pct(annualUp, high.length)}`);
console.log(`  touched <= 30 days     ${String(fresh).padStart(5)}  ${pct(fresh, high.length)}`);
console.log(`  no dated note at all   ${String(noDate).padStart(5)}  ${pct(noDate, high.length)}`);
console.log(`  reachable by phone     ${String(hasPhone).padStart(5)}  ${pct(hasPhone, high.length)}`);
console.log(`  value >= $50k          ${String(bigMoney).padStart(5)}  ${pct(bigMoney, high.length)}`);
console.log(`  NO value stated        ${String(noValue).padStart(5)}  ${pct(noValue, high.length)}`);
console.log(`  some motion in notes   ${String(motion).padStart(5)}  ${pct(motion, high.length)}`);
console.log(`  dead language anywhere ${String(deadAny).padStart(5)}  ${pct(deadAny, high.length)}`);

console.log("\n=== how a lead clears 60 — the marginal cases matter most ===");
const bands: [number, number, string][] = [[60, 64, "just over the line"], [65, 74, "comfortable"], [75, 100, "strong"]];
for (const [lo, hi, label] of bands) {
  const set = high.filter((r) => r.csp!.score >= lo && r.csp!.score <= hi);
  if (!set.length) continue;
  const o = set.filter((r) => POSTURE_META[r.csp!.posture].open).length;
  const a = set.filter((r) => r.csp!.billingRank <= 1).length;
  const m = set.filter((r) => r.csp!.motion.length > 0).length;
  const v = set.filter((r) => (r.csp!.value ?? 0) >= 10000).length;
  console.log(`  ${lo}-${hi} ${label.padEnd(20)} ${String(set.length).padStart(5)} leads · open ${pct(o, set.length)} · annual-upfront ${pct(a, set.length)} · motion ${pct(m, set.length)} · >=$10k ${pct(v, set.length)}`);
}

console.log("\n=== 6 leads sitting EXACTLY on the line (60-62) — would you call these? ===");
high.filter((r) => r.csp!.score >= 60 && r.csp!.score <= 62).slice(0, 6).forEach((r) => {
  const c = r.csp!;
  console.log(`\n  ${c.score}  ${r.lead.company.slice(0, 40)}  ${r.lead.phone ? "phone" : "NO PHONE"}`);
  console.log(`      ${POSTURE_META[c.posture].label} · ${BILLING_META[c.billingRank].short} · $${(c.value ?? 0).toLocaleString()} · ${c.ageDays}d · motion: ${c.motion.join(", ") || "none"}`);
  console.log(`      ${c.breakdown.join("  ")}`);
});

console.log("\n=== the top 5, and what carried them ===");
high.slice().sort((a, b) => b.csp!.score - a.csp!.score).slice(0, 5).forEach((r) => {
  const c = r.csp!;
  console.log(`  ${String(c.score).padStart(3)}${c.perfect ? " *" : "  "} ${r.lead.company.slice(0, 34).padEnd(35)} ${c.breakdown.join("  ")}`);
});

console.log("\n=== sensitivity: where would the line put the count ===");
for (const t of [50, 55, 60, 65, 70, 75, 80]) {
  const n = rows.filter((r) => r.csp!.perfect || r.csp!.score >= t).length;
  console.log(`  High at ${String(t).padStart(3)}+  ->  ${String(n).padStart(5)} leads  ${pct(n, rows.length)}${t === R.strongAt ? "   <- current" : ""}`);
}

console.log("\n=== what a High lead looks like with NO value stated (are these real?) ===");
high.filter((r) => (r.csp!.value ?? 0) === 0).slice(0, 4).forEach((r) => {
  const c = r.csp!;
  console.log(`  ${c.score}  ${r.lead.company.slice(0, 34).padEnd(35)} ${POSTURE_META[c.posture].short} · ${BILLING_META[c.billingRank].short} · ${c.ageDays}d · ${c.motion.join(", ") || "no motion"}`);
});
