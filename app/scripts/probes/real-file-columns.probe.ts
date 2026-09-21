// Column mapping, audited against Jack's OWN export files rather than a
// fixture — the only way to catch the class of bug that has bitten this
// scanner repeatedly: a column that exists, is 70% full, and is silently
// mapped to nothing (customeridname, telephone1) or to the wrong thing.
//
// A probe, not a suite: it needs the real uploads, which are not in git,
// and skips any file that is not on disk. Run it whenever column handling
// changes, or when a new export shape arrives:
//
//   node scripts/probes/real-file-columns.cjs
//
// What it asserts per file: every source column's fill rate and what it
// mapped to; that nothing with a home in the Apollo shape went unmapped;
// the export's column contract; that the exported row count and Company
// Name match what the table previews; that no text column holds a bare
// number and no phone/email is junk; and — the real question — that each
// exported value traces back to the column the mapping claims it came from.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import {
  scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns,
  toApolloRow, exportLabelsFor, CSP_EXPORT_LABELS, SCANNER2_EXPORT_LABELS, CSP_BUCKET_META,
  type ScannerKind,
} from "../../src/lib/scanner2";
import { guessCspColumns } from "../../src/lib/cspRenewal";

const U = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/";
const FILES: { file: string; kind: ScannerKind; label: string }[] = [
  { file: "961c0c2c-BookCSPs_9-4.csv", kind: "csp", label: "CSP  BookCSPs_9-4 (25 MB)" },
  { file: "7783118b-Scanner_Test_2.csv", kind: "csp", label: "CSP  Scanner_Test_2 (subset)" },
  { file: "4e91c37e-Bookleads.csv", kind: "smc", label: "SMC  Bookleads (14 MB)" },
];
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

for (const { file, kind, label } of FILES) {
  const path = U + file;
  if (!fs.existsSync(path)) { console.log(`\n### ${label}: NOT PRESENT, skipped`); continue; }
  console.log(`\n${"=".repeat(74)}\n### ${label}\n${"=".repeat(74)}`);
  const parsed = [parseCSVText(file, fs.readFileSync(path, "utf8"))];
  const cols = profileColumns(parsed);
  const fields = guessFieldMapping(cols);
  const notesCols = guessNotesColumns(cols);
  const campCols = guessCampaignColumns(cols);
  const rs = { ...emptyRuleSet(kind, kind), fields, notesColumns: notesCols, campaignColumns: campCols } as never;
  const res = scan2(parsed, rs);
  const raw = parsed[0].data as Record<string, unknown>[];
  const headers = parsed[0].fields;

  // --- 1. every source column: mapped to what, and how full is it?
  console.log(`\n-- source columns (${headers.length}), fill over ${raw.length} rows --`);
  const fillOf = (h: string) => raw.filter((r) => String(r[h] ?? "").trim() && String(r[h]).trim().toUpperCase() !== "NULL").length;
  const mappedTo = new Map<string, string[]>();
  for (const [k, v] of Object.entries(fields)) if (v) (mappedTo.get(String(v)) ?? mappedTo.set(String(v), []).get(String(v))!).push(k);
  const cspCols = kind === "csp" ? guessCspColumns(headers) : {};
  for (const [k, v] of Object.entries(cspCols)) if (v) (mappedTo.get(String(v)) ?? mappedTo.set(String(v), []).get(String(v))!).push(`csp:${k}`);
  for (const c of notesCols) (mappedTo.get(c) ?? mappedTo.set(c, []).get(c)!).push("notes");
  for (const c of campCols) (mappedTo.get(c) ?? mappedTo.set(c, []).get(c)!).push("campaign");
  // Columns with NO home in the ten-column Apollo shape. Unmapped on
  // purpose: there is nowhere for a country or a forecast close date to go,
  // and inventing a column for them would break the import contract. Listed
  // explicitly so a genuinely-lost column still fails this check.
  const NO_HOME = /^(address1_(country|city|stateorprovince|postalcode|line\d)|websiteurl|statuscodename|estimatedclosedate|industrycodename|revenue|msdyn_segmentidname|accountidname|msp_rollupestrevenue|Product Area|Title|Number of Employees|Last Name)$/i;
  const unmappedFull: string[] = [];
  for (const h of headers) {
    const f = fillOf(h);
    const to = mappedTo.get(h) ?? [];
    const full = f / Math.max(raw.length, 1) > 0.25;
    const noHome = NO_HOME.test(h);
    const flag = to.length ? "" : !full ? "  (sparse)" : noHome ? "  (no column in the Apollo shape \u2014 expected)" : "  <== UNMAPPED and >25% full";
    if (!to.length && full && !noHome) unmappedFull.push(`${h} (${pct(f, raw.length)}%)`);
    console.log(`   ${String(pct(f, raw.length)).padStart(3)}%  ${h.padEnd(34)} ${to.join(", ") || "-"}${flag}`);
  }
  ok(`no column with a home in the export is left unmapped`, unmappedFull.length === 0, unmappedFull.join("; "));

  // --- 2. the export contract
  const labels = exportLabelsFor(kind);
  const expect = kind === "csp" ? CSP_EXPORT_LABELS : SCANNER2_EXPORT_LABELS;
  ok(`export is the ${expect.length} expected columns, in order`, JSON.stringify(labels) === JSON.stringify(expect), JSON.stringify(labels));

  // --- 3. PREVIEW == DOWNLOAD. Same function the UI calls, per row.
  const kept = res.rows;
  const out = kept.map((r) => toApolloRow(r, kind === "csp" ? CSP_BUCKET_META[r.bucket].label : undefined));
  ok(`one exported row per previewed row (${out.length})`, out.length === kept.length);
  let mismatch = 0;
  for (let i = 0; i < kept.length; i++) {
    const r = kept[i], e = out[i] as unknown as Record<string, string>;
    // The company shown in the table IS the company exported.
    const shown = (kind === "smc" ? r.smc?.company : "") || r.lead.company || "";
    if ((e["Company Name"] || "") !== shown) mismatch++;
  }
  ok(`every exported Company Name equals the previewed one`, mismatch === 0, `${mismatch} differ`);

  // --- 4. per-column fill in the export
  console.log(`\n-- export fill over ${out.length} rows --`);
  for (const c of labels) {
    const n = out.filter((r) => String((r as unknown as Record<string, string>)[c] ?? "").trim()).length;
    console.log(`   ${String(pct(n, out.length)).padStart(3)}%  ${String(n).padStart(5)}/${out.length}  ${c}`);
  }

  // --- 5. no numeric leakage in the text columns, and none in the wrong place
  const textCols = ["Product Area", "Notes", "Company Name", "First Name", "Last Name"];
  for (const c of textCols) {
    if (!labels.includes(c)) continue;
    const bad = out.filter((r) => /^\d+(\.\d+)?$/.test(String((r as unknown as Record<string, string>)[c] ?? "").trim()));
    ok(`  "${c}" holds no bare number`, bad.length === 0, `${bad.length} rows`);
  }
  // Phones must be dialable, emails must look like emails.
  const phoneBad = out.filter((r) => { const v = String((r as unknown as Record<string, string>)["Work Direct Phone"] ?? ""); return v && (/E\+\d/i.test(v) || (v.replace(/\D/g, "").length < 7)); });
  ok(`  every exported work phone is dialable`, phoneBad.length === 0, `${phoneBad.length} bad`);
  const mailBad = out.filter((r) => { const v = String((r as unknown as Record<string, string>).Email ?? ""); return v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); });
  ok(`  every exported email is well formed`, mailBad.length === 0, `${mailBad.length} bad`);

  // --- 6. TRACEABILITY: does each exported value come from the column the
  //     mapping claims? Sampled over rows that actually have the value.
  console.log(`\n-- traceability: exported value vs its mapped source column --`);
  const trace: [string, string | undefined][] = [
    ["Email", fields.email as string | undefined],
    ["Work Direct Phone", fields.phone as string | undefined],
    ["Mobile Phone", fields.mobilePhone as string | undefined],
  ];
  for (const [label, src] of trace) {
    if (!labels.includes(label)) continue;
    if (!src) { console.log(`   ${label}: no column mapped`); continue; }
    let checked = 0, agree = 0;
    for (let i = 0; i < kept.length && checked < 400; i++) {
      const v = String((out[i] as unknown as Record<string, string>)[label] ?? "").trim();
      if (!v) continue;
      checked++;
      const srcVal = String(kept[i].row[src] ?? "").trim();
      // Phones are normalised on the way out, so compare digits only.
      const norm = (x: string) => (label.includes("Phone") ? x.replace(/\D/g, "") : x.toLowerCase());
      if (norm(srcVal) === norm(v) || (label.includes("Phone") && norm(srcVal).endsWith(norm(v)))) agree++;
    }
    console.log(`   ${label.padEnd(20)} ${agree}/${checked} traced to "${src}"`);
    ok(`  "${label}" traces to its mapped column ${src}`, checked === 0 || agree / checked > 0.9, `${agree}/${checked}`);
  }
  // Names: First+Last must reconstruct the source full name.
  const nameSrc = fields.contact as string | undefined;
  if (nameSrc) {
    let checked = 0, agree = 0;
    for (let i = 0; i < kept.length && checked < 400; i++) {
      const e = out[i] as unknown as Record<string, string>;
      const joined = `${e["First Name"] || ""} ${e["Last Name"] || ""}`.trim().toLowerCase();
      if (!joined) continue;
      checked++;
      const src = String(kept[i].row[nameSrc] ?? "").trim().toLowerCase().replace(/,\s*/g, " ").replace(/\s+/g, " ");
      const rev = src.split(" ").reverse().join(" ");
      if (src === joined || rev === joined || src.split(" ").sort().join(" ") === joined.split(" ").sort().join(" ")) agree++;
    }
    console.log(`   First+Last name     ${agree}/${checked} reconstruct "${nameSrc}"`);
    ok(`  First+Last rebuilds the source full name`, checked === 0 || agree / checked > 0.95, `${agree}/${checked}`);
  }
}
console.log(`\n${"=".repeat(74)}\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
