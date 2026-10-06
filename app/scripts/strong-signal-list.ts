// TEMP — Strong Signals from Jack's Main Scanner files, deduped, as an
// Apollo-importable CSV. Built so adding more files (August) is safe:
// dedupe is email-first, then name+company, the same rule the app uses.
import { readFileSync, writeFileSync } from "node:fs";
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, stripSnippetPrefix, CATEGORY_META, normalizeDupKey } from "../../src/lib/detection";

const OUT = "/tmp/claude-0/-home-user-Library/dd1348d8-8ff6-501c-af5d-361f8a90722b/scratchpad";
const files = process.argv.slice(2);
const parsed = files.map((f) => parseCSVText(f.split("/").pop()!, readFileSync(f, "utf8")));
const out = scanParsedFiles(parsed);
const rows = (out.results as Record<string, any>[]).filter((r) => r.tier === "signal");

// Second dedupe pass across the whole set: email first, then name+company.
// scanParsedFiles already drops same-batch duplicates on name+company, but
// email catches the same person listed under two company spellings.
const seenEmail = new Set<string>();
const seenNameCo = new Set<string>();
const kept: Record<string, any>[] = [];
let dropped = 0;
for (const r of rows.sort((a, b) => (b.mainScore?.score ?? 0) - (a.mainScore?.score ?? 0))) {
  const email = String(r.row?.__f?.email ?? "").trim().toLowerCase();
  const nameCo = normalizeDupKey(String(r.row?.__f?.fullName ?? ""), String(r.row?.__f?.company ?? ""));
  if (email && seenEmail.has(email)) { dropped++; continue; }
  if (!email && nameCo && seenNameCo.has(nameCo)) { dropped++; continue; }
  if (email) seenEmail.add(email);
  if (nameCo) seenNameCo.add(nameCo);
  kept.push(r);
}

const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const header = ["First Name", "Last Name", "Company", "Email", "Title", "Phone",
  "Product Line", "Score", "Top Priority", "Why (matched snippet)", "Source File"];
const lines = [header.join(",")];
for (const r of kept) {
  const full = String(r.row?.__f?.fullName ?? "").trim();
  const sp = full.lastIndexOf(" ");
  lines.push([
    sp > 0 ? full.slice(0, sp) : full,
    sp > 0 ? full.slice(sp + 1) : "",
    r.row?.__f?.company, r.row?.__f?.email, r.row?.__f?.title,
    r.row?.__f?.workPhone || r.row?.__f?.mobilePhone,
    CATEGORY_META[r.category as never]?.label ?? r.category,
    r.mainScore?.score ?? "",
    r.isGoogleWorkspaceMigration ? "Google -> Microsoft" : r.isPartnerSeeking ? "Wants a partner" : "",
    stripSnippetPrefix(String(r.notesSummary ?? "")),
    r.sourceFile,
  ].map(q).join(","));
}
writeFileSync(`${OUT}/carly-strong-signals.csv`, lines.join("\n"));
writeFileSync(`${OUT}/strong.json`, JSON.stringify(kept.map((r) => ({
  company: String(r.row?.__f?.company ?? "").trim(),
  name: String(r.row?.__f?.fullName ?? "").trim(),
  email: String(r.row?.__f?.email ?? "").trim().toLowerCase(),
  score: r.mainScore?.score, category: CATEGORY_META[r.category as never]?.label ?? r.category,
})), null, 1));

console.log(`rows read            : ${(out as any).rowsScanned}`);
console.log(`same-batch dupes     : ${(out as any).duplicatesRemoved}`);
console.log(`strong signal        : ${rows.length}`);
console.log(`cross-file dupes cut : ${dropped}`);
console.log(`FINAL DEDUPED LIST   : ${kept.length}`);
console.log(`  with a work email  : ${kept.filter((r) => String(r.row?.__f?.email ?? "").trim()).length}`);
const byCat: Record<string, number> = {};
for (const r of kept) byCat[CATEGORY_META[r.category as never]?.label ?? r.category] = (byCat[CATEGORY_META[r.category as never]?.label ?? r.category] ?? 0) + 1;
console.log(`  by product line    : ${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join("  ·  ")}`);
console.log(`  distinct companies : ${new Set(kept.map((r) => String(r.row?.__f?.company ?? "").trim().toLowerCase())).size}`);
console.log(`\nwrote carly-strong-signals.csv`);
