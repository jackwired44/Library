import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow, SCANNER2_EXPORT_LABELS } from "../../src/lib/scanner2";
import { guessCspColumns, POSTURE_META, BILLING_META } from "../../src/lib/cspRenewal";

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
let t = Date.now();
const parsed = [parseCSVText("BookCSPs_9-4.csv", fs.readFileSync(P, "utf8"))];
console.log(`parse ${Date.now() - t}ms · rows ${parsed[0].data.length}`);
const prof = profileColumns(parsed);
const fields = guessFieldMapping(prof);
console.log("\nidentity mapping:", JSON.stringify(fields, null, 2));
console.log("csp columns:", JSON.stringify(guessCspColumns(prof.map((p) => p.name)), null, 2));
console.log("notes:", JSON.stringify(guessNotesColumns(prof)), "· campaign:", JSON.stringify(guessCampaignColumns(prof)));

const rs = { ...emptyRuleSet("csp", "csp"), fields, notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) };
t = Date.now();
const res = scan2(parsed, rs);
console.log(`\nscan ${Date.now() - t}ms · kept ${res.rows.length} · merged ${res.duplicatesMerged} · read ${res.rowsRead}`);

const c: Record<string, number> = {};
for (const r of res.rows) c[r.bucket] = (c[r.bucket] ?? 0) + 1;
console.log("buckets:", JSON.stringify(c));

const post: Record<string, number> = {};
for (const r of res.rows) { const p = r.csp?.posture; if (p) post[p] = (post[p] ?? 0) + 1; }
console.log("posture:", JSON.stringify(post));
const strongPost: Record<string, number> = {};
for (const r of res.rows) if (r.bucket === "priority") { const p = r.csp?.posture; if (p) strongPost[p] = (strongPost[p] ?? 0) + 1; }
console.log("posture within Strong:", JSON.stringify(strongPost));

const bill: Record<string, number> = {};
for (const r of res.rows) { const b = r.csp?.billingRank; if (b != null) bill[BILLING_META[b].short] = (bill[BILLING_META[b].short] ?? 0) + 1; }
console.log("billing:", JSON.stringify(bill, null, 1));
const sBill: Record<string, number> = {};
for (const r of res.rows) if (r.bucket === "priority") { const b = r.csp?.billingRank; if (b != null) sBill[BILLING_META[b].short] = (sBill[BILLING_META[b].short] ?? 0) + 1; }
console.log("billing within Strong:", JSON.stringify(sBill, null, 1));

const ages = res.rows.map((r) => r.csp?.ageDays).filter((a): a is number => a != null).sort((a, b) => a - b);
console.log(`\nage days: n=${ages.length} min=${ages[0]} median=${ages[Math.floor(ages.length / 2)]} max=${ages[ages.length - 1]}`);
console.log("no dated note:", res.rows.filter((r) => r.csp?.ageDays == null).length);

const rows = res.rows.map((r) => toApolloRow(r)) as Record<string, string>[];
console.log("\n--- export fill (all rows) ---");
for (const col of SCANNER2_EXPORT_LABELS) {
  const n = rows.filter((r) => String(r[col] || "").trim()).length;
  console.log(`  ${String(n).padStart(5)}/${rows.length}  ${Math.round(100 * n / rows.length)}%  ${col}`);
}
const strong = res.rows.filter((r) => r.bucket === "priority").map((r) => toApolloRow(r)) as Record<string, string>[];
console.log("\n--- export fill (Strong Signal only) ---");
for (const col of SCANNER2_EXPORT_LABELS) {
  const n = strong.filter((r) => String(r[col] || "").trim()).length;
  console.log(`  ${String(n).padStart(5)}/${strong.length}  ${Math.round(100 * n / strong.length)}%  ${col}`);
}
console.log("\n--- 4 Strong Signal rows ---");
strong.slice(0, 4).forEach((r) => {
  console.log(`\n  ${r["Company Name"]} | ${r["First Name"]} <${r.Email}> ${r["Work Direct Phone"] || "no phone"}`);
  console.log(`  partner: ${r["Product Area"]}`);
  console.log(`  notes:   ${r.Notes.slice(0, 230)}`);
});
void POSTURE_META;

// Rank order check: top of the Strong list should be annual-new-upfront.
import { compareCspLeads } from "../../src/lib/cspRenewal";
const ranked = res.rows.filter((r) => r.bucket === "priority").map((r, i) => ({ r, i })).sort((a, b) => compareCspLeads(a.r.csp, b.r.csp) || a.i - b.i).map((x) => x.r);
console.log("\n--- top 8 Strong in rank order ---");
ranked.slice(0, 8).forEach((r) => console.log(`  [${r.csp!.billingRank}] str=${r.csp!.strength} $${(r.csp!.value ?? 0).toLocaleString().padStart(10)} ${String(r.csp!.ageDays).padStart(3)}d  ${r.lead.company.slice(0, 32).padEnd(33)} ${POSTURE_META[r.csp!.posture].short.padEnd(6)} ${r.csp!.billing}`));
console.log("--- bottom 3 ---");
ranked.slice(-3).forEach((r) => console.log(`  [${r.csp!.billingRank}] str=${r.csp!.strength} $${(r.csp!.value ?? 0).toLocaleString().padStart(10)} ${String(r.csp!.ageDays).padStart(3)}d  ${r.lead.company.slice(0, 32).padEnd(33)} ${POSTURE_META[r.csp!.posture].short.padEnd(6)} ${r.csp!.billing}`));
const conflicts = res.rows.filter((r) => r.csp?.partnerConflict).length;
console.log(`\npartner conflicts (column says open, notes name a reseller): ${conflicts}`);
const phoneFromNotes = res.rows.filter((r) => r.csp?.notesPhone && r.lead.phone === r.csp.notesPhone).length;
console.log(`phones recovered from notes: ${phoneFromNotes}`);
console.log("\n--- 12 phones recovered from notes (sanity) ---");
res.rows.filter((r) => r.csp?.notesPhone && r.lead.phone === r.csp.notesPhone).slice(0, 12)
  .forEach((r) => console.log(`  ${r.lead.company.slice(0, 34).padEnd(35)} ${r.lead.phone}`));
const bad = res.rows.filter((r) => r.csp?.notesPhone && r.lead.phone === r.csp.notesPhone && (r.lead.phone.match(/\d/g) || []).length > 15).length;
console.log(`recovered numbers with more than 15 digits (would be garbage): ${bad}`);

console.log("\n=== SCORE MODEL ===");
const sc = res.rows.map((r) => r.csp!.score).sort((a, b) => a - b);
const q = (p: number) => sc[Math.min(sc.length - 1, Math.floor(sc.length * p))];
console.log(`score: min=${sc[0]} p25=${q(.25)} median=${q(.5)} p75=${q(.75)} p90=${q(.9)} max=${sc[sc.length - 1]}`);
const bands = [[0,24],[25,39],[40,59],[60,74],[75,100]] as const;
for (const [lo,hi] of bands) console.log(`  ${String(res.rows.filter((r) => r.csp!.score >= lo && r.csp!.score <= hi).length).padStart(5)}  ${lo}-${hi}`);
const perfect = res.rows.filter((r) => r.csp?.perfect);
console.log(`\n★ perfect leads (wants partner + none assigned + annual upfront): ${perfect.length}`);
perfect.slice(0, 6).forEach((r) => console.log(`  ${String(r.csp!.score).padStart(3)}  ${r.lead.company.slice(0, 34).padEnd(35)} $${(r.csp!.value ?? 0).toLocaleString().padStart(10)}  ${r.lead.phone ? "☎" : " "} ${r.lead.contact}`));
const wants = res.rows.filter((r) => r.csp?.motion.includes("wants a partner"));
console.log(`\nrows whose notes say they want a partner: ${wants.length}`);
const wp: Record<string, number> = {};
for (const r of wants) wp[r.csp!.posture] = (wp[r.csp!.posture] ?? 0) + 1;
console.log("  by posture:", JSON.stringify(wp));
console.log("\n--- 3 'wants a partner' note excerpts (verify the regex is catching real asks) ---");
wants.slice(0, 3).forEach((r) => { const n = r.lead.notes; const m = /(look(ing|s)?\s+for\s+(a\s+)?(new\s+)?(partner|reseller|csp|msp|provider)|need(s|ing)?\s+(a\s+)?(new\s+)?(partner|reseller|csp|msp)|partner\s+(recommendation|referral|introduction|intro)|(recommend|introduce|find|identify|source)\s+(them\s+)?(a\s+)?partner|no\s+partner\s+(yet|identified|selected|in\s+place)|open\s+to\s+(a\s+)?(new\s+)?partner|unhappy\s+with|switch(ing)?\s+partners?)/i.exec(n); const at = m ? Math.max(0, m.index - 90) : 0; console.log(`  ${r.lead.company.slice(0,28)}: …${n.slice(at, at + 220).replace(/\s+/g," ")}…`); });

console.log("\n=== PENALTY MODEL: where the formerly hard-stopped rows land now ===");
const deadRows = res.rows.filter((r) => r.csp!.deadReasons.length);
const dl = deadRows.filter((r) => r.csp!.deadInLatest), dO = deadRows.filter((r) => !r.csp!.deadInLatest);
const byB = (xs: typeof res.rows) => { const o: Record<string, number> = {}; for (const r of xs) o[r.bucket] = (o[r.bucket] ?? 0) + 1; return JSON.stringify(o); };
console.log(`rows with dead language anywhere: ${deadRows.length}`);
console.log(`  in the NEWEST entry: ${dl.length} -> ${byB(dl)}`);
console.log(`  only in OLDER entries: ${dO.length} -> ${byB(dO)}`);
const staleRows = res.rows.filter((r) => (r.csp!.ageDays ?? 0) > 270);
console.log(`rows untouched >270d: ${staleRows.length} -> ${byB(staleRows)}`);
const rescued = dO.filter((r) => r.bucket === "priority");
console.log(`\nHigh-priority leads that a hard stop would have binned (old no-show, live now): ${rescued.length}`);
rescued.slice(0, 5).forEach((r) => console.log(`  ${String(r.csp!.score).padStart(3)}  ${r.lead.company.slice(0, 34).padEnd(35)} $${(r.csp!.value ?? 0).toLocaleString().padStart(10)}  ${r.csp!.ageDays}d  ${POSTURE_META[r.csp!.posture].short}`));
