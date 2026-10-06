// The CSP High-priority download, produced exactly the way Scanner2's
// exportApollo produces it, from Jack's real file — then read back and
// checked column by column.
import * as fs from "fs";
import { parseCSVText, toCSV } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow, SCANNER2_EXPORT_LABELS, CSP_EXPORT_LABELS, CSP_BUCKET_META } from "../../src/lib/scanner2";
import { compareCspLeads } from "../../src/lib/cspRenewal";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
const parsed = [parseCSVText("BookCSPs_9-4.csv", fs.readFileSync(P, "utf8"))];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });

// mirror Scanner2.cspByPriority + exportApollo (no manual overrides in a headless run)
const high = res.rows.filter((r) => r.bucket === "priority").map((r, i) => ({ r, i })).sort((a, b) => compareCspLeads(a.r.csp, b.r.csp) || a.i - b.i).map((x) => x.r);
const out = high.map((r) => toApolloRow(r, CSP_BUCKET_META[r.bucket].label));
const csv = toCSV(out, [...CSP_EXPORT_LABELS]);
const outPath = "/tmp/claude-0/-home-user-Library/dd1348d8-8ff6-501c-af5d-361f8a90722b/scratchpad/csp-high-priority.csv";
fs.writeFileSync(outPath, csv);

// read it back through the same parser Apollo-style tools would
const back = parseCSVText("back.csv", csv);
const rows = back.data as Record<string, string>[];
console.log(`wrote ${outPath} — ${rows.length} rows, ${(csv.length / 1024).toFixed(0)} KB`);

console.log("\n=== shape ===");
ok("exactly the eight CSP columns, in order", JSON.stringify(back.fields) === JSON.stringify(CSP_EXPORT_LABELS), JSON.stringify(back.fields));
ok("every High-priority lead is in the file", rows.length === high.length, `${rows.length} vs ${high.length}`);
ok("round-trips through the CSV parser with no row loss", rows.length === out.length);

console.log("\n=== fill ===");
const filled = (c: string) => rows.filter((r) => String(r[c] ?? "").trim()).length;
for (const c of CSP_EXPORT_LABELS) console.log(`  ${String(filled(c)).padStart(5)}/${rows.length}  ${Math.round(100 * filled(c) / rows.length)}%  ${c}`);
ok("Company Name on every row", filled("Company Name") === rows.length);
ok("First Name on (almost) every row", filled("First Name") >= rows.length * 0.99, String(filled("First Name")));
ok("Email on (almost) every row", filled("Email") >= rows.length * 0.98, String(filled("Email")));
// 71% of ALL rows in this export carry a phone; the High-priority slice
// runs a little lower. This is the data, not a mapping fault — the number
// is printed above so a regression would show as a drop.
ok("Work Direct Phone on most rows (phones were the ask)", filled("Work Direct Phone") >= rows.length * 0.55, String(filled("Work Direct Phone")));
ok("Notes on every row", filled("Notes") === rows.length);

console.log("\n=== content ===");
ok("Product Area is the priority on every row, not a product line", rows.every((r) => r["Product Area"] === "High priority"), [...new Set(rows.map((r) => r["Product Area"]))].join(" | "));
ok("every Notes line carries its score, at the end", rows.every((r) => /\(\d{1,3}\)$/.test(r.Notes)), rows.find((r) => !/\(\d{1,3}\)$/.test(r.Notes))?.Notes.slice(0, 80));
ok("no literal 'undefined' / 'null' / 'NULL' anywhere", !/\bundefined\b|\bnull\b|\bNULL\b/.test(csv));
ok("no literal \\u escapes leaked into the file", !/\\u[0-9a-f]{4}/i.test(csv));
ok("no CSV column-index numbers where a value should be", rows.every((r) => !/^\d$/.test(r["Product Area"])));
// Per Jack the note must say whether they go direct or through a partner,
// in words rather than in lane jargon. "Open lane" is still the FILTER's
// label; a column header can be jargon, a sentence cannot.
ok("Notes say whether they go direct or through a partner",
   rows.every((r) => /no partner yet|direct with Microsoft|via partner: /.test(r.Notes)),
   rows.find((r) => !/no partner yet|direct with Microsoft|via partner: /.test(r.Notes))?.Notes);
const scores = rows.map((r) => Number((/\((\d{1,3})\)$/.exec(r.Notes) || [])[1]));
// THREE kinds of lead reach High regardless of score, and all three pin to
// the top in a stated order, so the download is four ordered groups:
//   ◆ an upcoming contract renewal with no partner on the record — per
//     Jack, "a company with a known upcoming renewal date no partner is
//     the highest priority lead here";
//   ★ the perfect lead (asking for a partner, none assigned, annual
//     upfront);
//   ⚑ the customer states they want a partner — per Jack, "if it states
//     wants a partner that needs to be flagged for top quality";
//   then everyone else by score descending.
// Checked as a monotonic rank down the file rather than three separate
// index windows: that holds even where a lead carries two marks at once,
// which the index form could not express.
const isOpenRenewal = (r: Record<string, string>) => /\u25C6/.test(r.Notes);
const isPinned = (r: Record<string, string>) => /\u2605/.test(r.Notes);
const isTopQuality = (r: Record<string, string>) => /⚑ Wants partner/.test(r.Notes);
// A FOURTH route into High: a contract renewing inside 90 days in ANY
// lane. Held by a partner it does not pin, it just ranks by score — so it
// widens the score-floor checks below but not the order check above.
// Only a CONTRACT renewal routes into High on its own — a forecast close
// carries the same clock but never qualifies, so this must not match it.
const isRenewalSoon = (r: Record<string, string>) => /⏰ Renews /.test(r.Notes);
const isOverride = (r: Record<string, string>) => isOpenRenewal(r) || isPinned(r) || isTopQuality(r);
const pinRank = (r: Record<string, string>) =>
  isOpenRenewal(r) ? 0 : isPinned(r) ? 1 : isTopQuality(r) ? 2 : 3;
const counts = [0, 1, 2, 3].map((k) => rows.filter((r) => pinRank(r) === k).length);
ok("the file is in pin order: ◆ renewal+open lane, then ★, then ⚑, then the rest",
   rows.every((r, i) => i === 0 || pinRank(rows[i - 1]) <= pinRank(r)),
   `◆${counts[0]} ★${counts[1]} ⚑${counts[2]} rest${counts[3]}`);
ok("  and the ◆ renewals lead the file, soonest first",
   (() => {
     const d = rows.filter(isOpenRenewal).map((r) => Number((/\((\d{1,3})d\)/.exec(r.Notes) || [])[1]));
     return d.every((v, i) => i === 0 || Number.isNaN(v) || v >= d[i - 1]);
   })(), rows.filter(isOpenRenewal)[0]?.Notes.slice(0, 60) ?? "none");
const overrideIdx = rows.map((r, i) => (isOverride(r) ? i : -1)).filter((i) => i >= 0);
const afterOverrides = scores.slice(overrideIdx.length);
ok("below the overrides the file is in descending score order",
   afterOverrides.every((v, i) => i === 0 || v <= afterOverrides[i - 1]));
// The score floor therefore applies to everyone the score alone put here.
const scoreOnly = rows.filter((r) => !isOverride(r) && !isRenewalSoon(r))
  .map((r) => Number((/\((\d{1,3})\)$/.exec(r.Notes) || [])[1]));
ok("no score-qualified lead is under the High line (60)",
   scoreOnly.every((v) => v >= 60), scoreOnly.length ? `min ${Math.min(...scoreOnly)}` : "none");
ok("  and every row under 60 got there by an explicit override",
   rows.every((r) => Number((/\((\d{1,3})\)$/.exec(r.Notes) || [])[1]) >= 60 || isOverride(r) || isRenewalSoon(r)));
const phones = rows.map((r) => r["Work Direct Phone"]).filter(Boolean);
ok("every exported phone has enough digits to dial", phones.every((v) => (v.match(/\d/g) || []).length >= 7), phones.find((v) => (v.match(/\d/g) || []).length < 7));
ok("no Excel scientific-notation phones survive (5.25549E+11)", phones.every((v) => !/[eE]\s*\+/.test(v)), phones.find((v) => /[eE]\s*\+/.test(v)));
ok("no mangled number leaked into Mobile either", rows.map((r) => r["Mobile Phone"]).filter(Boolean).every((v) => !/[eE]\s*\+/.test(v)));
ok("emails look like emails", rows.filter((r) => r.Email).every((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.Email.trim())), rows.find((r) => r.Email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.Email.trim()))?.Email);
const longNotes = rows.filter((r) => r.Notes.length > 600).length;
console.log(`  notes length: max ${Math.max(...rows.map((r) => r.Notes.length))} chars, ${longNotes} over 600`);
const withComma = rows.filter((r) => r.Notes.includes(",")).length;
ok("notes containing commas survive quoting (round-trip proves it)", withComma > 0 && rows.length === out.length, String(withComma));

console.log("\n=== first 3 rows of the file ===");
rows.slice(0, 3).forEach((r) => console.log(`  ${r["First Name"]} | ${r["Company Name"]} | ${r.Email} | ${r["Work Direct Phone"] || "-"} | ${r["Product Area"]}\n    ${r.Notes.slice(0, 160)}`));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
