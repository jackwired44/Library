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
ok("every Notes line leads with the score", rows.every((r) => /^Score \d+/.test(r.Notes)), rows.find((r) => !/^Score \d+/.test(r.Notes))?.Notes.slice(0, 80));
ok("no literal 'undefined' / 'null' / 'NULL' anywhere", !/\bundefined\b|\bnull\b|\bNULL\b/.test(csv));
ok("no literal \\u escapes leaked into the file", !/\\u[0-9a-f]{4}/i.test(csv));
ok("no CSV column-index numbers where a value should be", rows.every((r) => !/^\d$/.test(r["Product Area"])));
ok("Notes carry the partner posture", rows.every((r) => /No partner assigned|Partner ID unresolved|Microsoft direct|partner: /.test(r.Notes)));
const scores = rows.map((r) => Number((/^Score (\d+)/.exec(r.Notes) || [])[1]));
const perfectIdx = rows.map((r, i) => (/★/.test(r.Notes) ? i : -1)).filter((i) => i >= 0);
const lastPerfect = perfectIdx.length ? Math.max(...perfectIdx) : -1;
ok("★ perfect leads are all at the very top", perfectIdx.length > 0 && lastPerfect === perfectIdx.length - 1, `${perfectIdx.length} perfect, last at row ${lastPerfect}`);
const afterPerfect = scores.slice(perfectIdx.length);
// TWO kinds of lead reach High regardless of score, so the download has
// three ordered groups, not two: pinned ★ first, then ⚑ TOP QUALITY
// (the customer states they want a partner — per Jack, "if it states
// wants a partner that needs to be flagged for top quality"), then
// everyone else by score descending.
const isPinned = (r: Record<string, string>) => /\u2605/.test(r.Notes);
const isTopQuality = (r: Record<string, string>) => /TOP QUALITY/.test(r.Notes);
const overrideIdx = rows.map((r, i) => (isPinned(r) || isTopQuality(r) ? i : -1)).filter((i) => i >= 0);
ok("  ⚑ top-quality leads sit directly below the pinned ones",
   overrideIdx.length === 0 || Math.max(...overrideIdx) === overrideIdx.length - 1,
   `${overrideIdx.length} overrides, last at row ${Math.max(...overrideIdx, -1)}`);
ok("  and no pinned lead sits below a top-quality one",
   rows.every((r, i) => !isPinned(r) || i < perfectIdx.length));
const afterOverrides = scores.slice(overrideIdx.length);
ok("below the overrides the file is in descending score order",
   afterOverrides.every((v, i) => i === 0 || v <= afterOverrides[i - 1]));
// The score floor therefore applies to everyone the score alone put here.
const scoreOnly = rows.filter((r) => !isPinned(r) && !isTopQuality(r))
  .map((r) => Number((/^Score (\d+)/.exec(r.Notes) || [])[1]));
ok("no score-qualified lead is under the High line (60)",
   scoreOnly.every((v) => v >= 60), scoreOnly.length ? `min ${Math.min(...scoreOnly)}` : "none");
ok("  and every row under 60 got there by an explicit override",
   rows.every((r) => Number((/^Score (\d+)/.exec(r.Notes) || [])[1]) >= 60 || isPinned(r) || isTopQuality(r)));
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
