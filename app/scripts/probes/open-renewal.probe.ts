// How many rows "upcoming contract renewal + no partner" would pin, by
// posture set and by horizon — measured on the real export before the rule
// is written, so the horizon comes from the file rather than a guess.
import { readFileSync } from "node:fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, emptyRuleSet, guessFieldMapping, guessNotesColumns, profileColumns, reconcileCspColumns } from "../../src/lib/scanner2";
import { POSTURE_META, type CspLead } from "../../src/lib/cspRenewal";

const f = process.argv[2];
const pf = parseCSVText(f.split("/").pop()!, readFileSync(f, "utf8"));
const rs = emptyRuleSet("probe", "csp");
rs.mode = "csp";
rs.fields = guessFieldMapping(profileColumns([pf]));
rs.notesColumns = guessNotesColumns(profileColumns([pf]));
rs.cspColumns = reconcileCspColumns(undefined, pf.fields);
const out = scan2([pf], rs);

const leads = out.rows.map((r) => r.csp).filter(Boolean) as CspLead[];
console.log(`rows read: ${out.rowsRead}   csp leads: ${leads.length}`);
console.log(`perfect (current pin): ${leads.filter((l) => l.perfect).length}`);
console.log(`wantsPartner         : ${leads.filter((l) => l.wantsPartner).length}`);

const up = (l: CspLead, days: number) =>
  l.renewal?.kind === "renewal" && l.renewal.daysOut != null && l.renewal.daysOut >= 0 && l.renewal.daysOut <= days;

const sets: [string, (l: CspLead) => boolean][] = [
  ["unassigned only", (l) => l.posture === "unassigned"],
  ["unassigned+unresolved", (l) => l.posture === "unassigned" || l.posture === "unresolved"],
  ["POSTURE open (incl MS direct)", (l) => POSTURE_META[l.posture].open],
];
for (const [name, open] of sets) {
  const row = [30, 60, 90, 180, 365, 99999].map((d) => `${d === 99999 ? "any" : d + "d"}=${leads.filter((l) => open(l) && up(l, d)).length}`);
  console.log(`${name.padEnd(32)} ${row.join("  ")}`);
}

const open90 = leads.filter((l) => POSTURE_META[l.posture].open && up(l, 90));
const un90 = leads.filter((l) => l.posture === "unassigned" && up(l, 90));
console.log(`\noverlap with perfect, open<=90      : ${open90.filter((l) => l.perfect).length} of ${open90.length}`);
console.log(`overlap with perfect, unassigned<=90: ${un90.filter((l) => l.perfect).length} of ${un90.length}`);
console.log(`partnerConflict among unassigned<=90: ${un90.filter((l) => l.partnerConflict).length}`);
console.log(`assumed (bare month) among open<=90 : ${open90.filter((l) => l.renewal!.assumed).length}`);

const byPosture: Record<string, number> = {};
for (const l of leads) if (up(l, 99999)) byPosture[l.posture] = (byPosture[l.posture] ?? 0) + 1;
console.log(`\nposture split of ALL upcoming contract renewals: ${JSON.stringify(byPosture)}`);

const ss = open90.map((l) => l.score).sort((a, b) => a - b);
if (ss.length) console.log(`\nscore spread, open<=90: min ${ss[0]}  p50 ${ss[Math.floor(ss.length / 2)]}  max ${ss[ss.length - 1]}  under 60: ${ss.filter((s) => s < 60).length}`);

console.log(`\nsample notes, open lane + upcoming <=90:`);
out.rows.filter((r) => r.csp && POSTURE_META[r.csp.posture].open && up(r.csp, 90)).slice(0, 8)
  .forEach((r) => console.log("  " + r.snippet));

/* ---- after the rule: what the engine now actually does ---- */
console.log(`\n=== shipped rule ===`);
const pinned = leads.filter((l) => l.openRenewal);
console.log(`openRenewal pins: ${pinned.length}   also perfect: ${pinned.filter((l) => l.perfect).length}   also wantsPartner: ${pinned.filter((l) => l.wantsPartner).length}`);
console.log(`all pinned are High: ${out.rows.filter((r) => r.csp?.openRenewal).every((r) => r.bucket === "priority")}`);
const marked = out.rows.filter((r) => r.snippet.startsWith("◆"));
console.log(`notes carrying the ◆ mark: ${marked.length} (should equal ${pinned.length})`);

import { CSP_NOTE_MAX_WORDS, CSP_NOTE_MAX_WORDS_ASK, compareCspLeads } from "../../src/lib/cspRenewal";
const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
let over = 0, worst = 0;
for (const r of out.rows) {
  const cap = r.csp?.wantsPartner || r.csp?.openRenewal ? CSP_NOTE_MAX_WORDS_ASK : CSP_NOTE_MAX_WORDS;
  const n = wc(r.snippet);
  if (n > worst) worst = n;
  if (n > cap) { over++; if (over <= 3) console.log(`  OVER ${n}>${cap}: ${r.snippet}`); }
}
console.log(`notes over the word cap: ${over}  (longest ${worst} words)`);

// Order, as the table and every download see it.
const sorted = [...out.rows].filter((r) => r.bucket === "priority").sort((a, b) => compareCspLeads(a.csp, b.csp));
const rank = (r: typeof sorted[number]) => r.csp?.openRenewal ? 0 : r.csp?.perfect ? 1 : r.csp?.wantsPartner ? 2 : 3;
console.log(`High rows: ${sorted.length}; pin order monotonic: ${sorted.every((r, i) => i === 0 || rank(sorted[i - 1]) <= rank(r))}`);
console.log(`top 8 of the High file:`);
sorted.slice(0, 8).forEach((r) => console.log("  " + r.snippet));
