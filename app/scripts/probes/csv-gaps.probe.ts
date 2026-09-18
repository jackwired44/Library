// The CSV is the product. Audit every column, in every scanner, for gaps:
// blank-everywhere columns, values that cannot be what the header claims,
// and anything Apollo would reject or silently hide.
import * as fs from "fs";
import { parseCSVText, toCSV } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow, SCANNER2_EXPORT_LABELS, CSP_EXPORT_LABELS, CSP_BUCKET_META } from "../../src/lib/scanner2";
import { EXPORT_LABELS } from "../../src/lib/detection";
import { compareCspLeads } from "../../src/lib/cspRenewal";

console.log("=== the column contract ===");
console.log("Main Scanner :", EXPORT_LABELS.join(" | "));
console.log("Custom (SMC) :", SCANNER2_EXPORT_LABELS.join(" | "));
console.log("CSP          :", CSP_EXPORT_LABELS.join(" | "));
const dropped = EXPORT_LABELS.filter((l) => !(CSP_EXPORT_LABELS as readonly string[]).includes(l));
console.log("CSP drops    :", dropped.join(", "), "\u2014 a CSP export states neither, so they shipped empty");
const L = "ABCDEFGHIJ";
console.log("CSP letters  :", CSP_EXPORT_LABELS.map((l, i) => `${L[i]}=${l}`).join("  "));

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
const parsed = [parseCSVText("BookCSPs_9-4.csv", fs.readFileSync(P, "utf8"))];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
const high = res.rows.filter((r) => r.bucket === "priority").map((r, i) => ({ r, i })).sort((a, b) => compareCspLeads(a.r.csp, b.r.csp) || a.i - b.i).map((x) => x.r);
const out = high.map((r) => toApolloRow(r, CSP_BUCKET_META[r.bucket].label));
const csv = toCSV(out, [...CSP_EXPORT_LABELS]);
const rows = parseCSVText("b.csv", csv).data as Record<string, string>[];

console.log(`\n=== High priority export: ${rows.length} rows ===`);
for (const c of CSP_EXPORT_LABELS) {
  const vals = rows.map((r) => String(r[c] ?? "").trim());
  const n = vals.filter(Boolean).length;
  const uniq = new Set(vals.filter(Boolean)).size;
  const longest = vals.reduce((m, v) => Math.max(m, v.length), 0);
  const flag = n === 0 ? "  <-- BLANK IN EVERY ROW: Apollo will not offer this column"
    : n < rows.length * 0.5 ? "  <-- under half filled"
    : "";
  console.log(`  ${c.padEnd(21)} ${String(n).padStart(5)}/${rows.length}  ${String(Math.round(100 * n / rows.length)).padStart(3)}%  distinct ${String(uniq).padStart(5)}  longest ${String(longest).padStart(4)}${flag}`);
}

console.log("\n=== column letters I and J must never hold a bare number ===");
const letterOf = (label: string) => "ABCDEFGHIJ"[CSP_EXPORT_LABELS.indexOf(label as never)];
for (const label of ["Product Area", "Notes"] as const) {
  const vals = rows.map((r) => String(r[label] ?? "").trim()).filter(Boolean);
  const numeric = vals.filter((v) => /^[-+]?[\d,]*\.?\d+([eE][-+]?\d+)?$/.test(v));
  const startsDigit = vals.filter((v) => /^\s*\d/.test(v));
  console.log(`  ${letterOf(label)} = ${label.padEnd(14)} ${vals.length} filled \u00b7 purely numeric ${numeric.length} \u00b7 starts with a digit ${startsDigit.length}${numeric.length || startsDigit.length ? "   <-- PROBLEM" : "   OK"}`);
}

console.log("\n=== value sanity, column by column ===");
const bad: string[] = [];
const check = (label: string, fn: (v: string) => boolean, col: string) => {
  const offenders = rows.map((r) => String(r[col] ?? "").trim()).filter(Boolean).filter((v) => !fn(v));
  console.log(`  ${offenders.length === 0 ? "OK  " : "BAD "} ${label}${offenders.length ? `  e.g. ${JSON.stringify(offenders.slice(0, 3))}` : ""}`);
  if (offenders.length) bad.push(`${col}: ${offenders.length}`);
};
check("Email is a real address", (v) => /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i.test(v), "Email");
check("Work phone has >= 7 digits and no E+ notation", (v) => (v.match(/\d/g) || []).length >= 7 && !/[eE]\s*\+/.test(v), "Work Direct Phone");
check("Mobile phone likewise", (v) => (v.match(/\d/g) || []).length >= 7 && !/[eE]\s*\+/.test(v), "Mobile Phone");
check("Product Area is one of the priority bands", (v) => ["High priority", "Medium priority", "Low priority", "No signal"].includes(v), "Product Area");
check("Notes start with a score", (v) => /^Score \d+/.test(v), "Notes");
check("Name has no stray comma/semicolon that would split a cell", (v) => !/[\r\n]/.test(v), "First Name");
check("Company has no newline", (v) => !/[\r\n]/.test(v), "Company Name");
check("Notes have no newline (would break a naive importer)", (v) => !/[\r\n]/.test(v), "Notes");

console.log("\n=== Excel / importer compatibility ===");
{
  const hyg2 = (label: string, cond: boolean, d = "") => console.log(`  ${cond ? "OK  " : "BAD "} ${label}${cond ? "" : `  ${d}`}`);
  // No BOM, on purpose: it would prepend an invisible character to the
  // first header and any importer that does not strip it loses column A.
  hyg2("no byte-order mark — column A's header is clean for every importer", csv.charCodeAt(0) !== 0xFEFF);
  hyg2("the first header is exactly \"First Name\"", csv.split(/\r?\n/)[0].replace(/"/g, "").split(",")[0] === "First Name", JSON.stringify(csv.slice(0, 14)));
  hyg2("Title and Number of Employees are gone", !(CSP_EXPORT_LABELS as readonly string[]).includes("Title") && !(CSP_EXPORT_LABELS as readonly string[]).includes("Number of Employees"));
}

console.log("\n=== whole-file hygiene ===");
const hyg = (label: string, cond: boolean, d = "") => console.log(`  ${cond ? "OK  " : "BAD "} ${label}${cond ? "" : `  ${d}`}`);
hyg("no literal NULL / undefined anywhere", !/(^|[,"])\s*(NULL|undefined|null)\s*([,"]|$)/m.test(csv));
hyg("no unescaped \\u sequences", !/\\u[0-9a-f]{4}/i.test(csv));
hyg("header row is exactly the eight CSP labels", csv.split(/\r?\n/)[0].replace(/"/g, "") === CSP_EXPORT_LABELS.join(","), csv.split(/\r?\n/)[0]);
hyg("every row has eight fields after re-parse", rows.every((r) => Object.keys(r).length === 8));
hyg("UTF-8 safe (no replacement chars)", !/\uFFFD/.test(csv));
hyg("no row is entirely blank", rows.every((r) => Object.values(r).some((v) => String(v).trim())));
if (bad.length) console.log("\nGAPS:", bad.join(" · ")); else console.log("\nNo gaps found in the exported columns.");
