// Jack's exact filter: from 1 Aug, no partner assigned. The tabs, the
// table and the downloads must all agree.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns } from "../../src/lib/scanner2";
import { POSTURE_META } from "../../src/lib/cspRenewal";

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
const parsed = [parseCSVText("BookCSPs_9-4.csv", fs.readFileSync(P, "utf8"))];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });

const FROM = "2026-08-01";
const dateOk = (r: typeof res.rows[number]) => !!(r.receivedOn && r.receivedOn >= FROM);
const openLane = (r: typeof res.rows[number]) => !!r.csp && POSTURE_META[r.csp.posture].open;
const band = (r: typeof res.rows[number]) => r.bucket;

const all = res.rows;
console.log(`whole upload                : ${all.length}`);
const byBandAll: Record<string, number> = {};
for (const r of all) byBandAll[band(r)] = (byBandAll[band(r)] ?? 0) + 1;
console.log(`  unfiltered band counts     : ${JSON.stringify(byBandAll)}   <- what the tabs USED to show`);

const view = all.filter((r) => dateOk(r) && openLane(r));
const byBand: Record<string, number> = {};
for (const r of view) byBand[band(r)] = (byBand[band(r)] ?? 0) + 1;
console.log(`\nfiltered: from ${FROM} + no partner in the way`);
console.log(`  rows in the table          : ${view.length}`);
console.log(`  faceted band counts        : ${JSON.stringify(byBand)}   <- what the tabs show NOW`);
console.log(`  High download would give   : ${byBand.priority ?? 0}`);
console.log(`  Medium download would give : ${byBand.review ?? 0}`);
const sum = Object.values(byBand).reduce((a, b) => a + b, 0);
console.log(`\n  bands sum to the table     : ${sum} === ${view.length}  ${sum === view.length ? "OK" : "MISMATCH"}`);
// posture counts, faceted against everything but posture (i.e. date only)
const dateOnly = all.filter(dateOk);
const post: Record<string, number> = { open: 0 };
for (const r of dateOnly) { const p = r.csp?.posture; if (!p) continue; post[p] = (post[p] ?? 0) + 1; if (POSTURE_META[p].open) post.open++; }
console.log(`  partner dropdown (date only): ${JSON.stringify(post)}`);
console.log(`  open lane there            : ${post.open} === ${view.length}  ${post.open === view.length ? "OK" : "MISMATCH"}`);
