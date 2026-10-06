// Rebuild the "not in Jack Main or Carly Main" leads as a scanner-ready CSV.
// Emits one column per resolved detection field, filled from the values the
// original per-file column mapping produced — so re-uploading this file
// reproduces the same tier/category/score the original scan gave, which a
// raw union-of-headers dump does NOT (two source files carry both a
// `comments` and a `Comments` column; merged, the mapper can only claim one
// and the other row's notes go unread).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { parseCSVText } from "../src/lib/csv";
import { scanParsedFiles, normalizeDupKey, CATEGORY_META, computeFileFieldMapping } from "../src/lib/detection";

// Writes outside the repo by default: the output holds real prospect
// names, emails and phone numbers. Override with GAP_OUT.
const OUT = process.env.GAP_OUT ?? "/tmp/gap-out";
const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const readNames = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith(".txt"))
    .flatMap((f) => readFileSync(`${dir}/${f}`, "utf8").split("\n"))
    .map(norm).filter(Boolean);
const enrolled = new Set([...readNames(`${OUT}/seq`), ...readNames(`${OUT}/jackseq`)]);

const files = process.argv.slice(2);
const parsed = files.map((f) => parseCSVText(f.split("/").pop()!, readFileSync(f, "utf8")));
const out = scanParsedFiles(parsed);
const signal = (out.results as Record<string, any>[]).filter((r) => r.tier === "signal");

const seenEmail = new Set<string>(); const seenNameCo = new Set<string>();
const kept: Record<string, any>[] = [];
for (const r of signal.sort((a, b) => (b.mainScore?.score ?? 0) - (a.mainScore?.score ?? 0))) {
  const email = String(r.row?.__f?.email ?? "").trim().toLowerCase();
  const nameCo = normalizeDupKey(String(r.row?.__f?.fullName ?? ""), String(r.row?.__f?.company ?? ""));
  if (email && seenEmail.has(email)) continue;
  if (!email && nameCo && seenNameCo.has(nameCo)) continue;
  if (email) seenEmail.add(email);
  if (nameCo) seenNameCo.add(nameCo);
  kept.push(r);
}
const gaps = kept.filter((r) => !enrolled.has(norm(r.row?.__f?.fullName)));

// Column labels chosen so guessColumn maps each back 1:1 on re-upload.
const COLS: [string, (r: any) => unknown][] = [
  ["Full Name", (r) => r.row?.__f?.fullName],
  ["Title", (r) => r.row?.__f?.title],
  ["Company Name", (r) => r.row?.__f?.company],
  ["Email", (r) => r.row?.__f?.email],
  ["Work Direct Phone", (r) => r.row?.__f?.workPhone],
  ["Mobile Phone", (r) => r.row?.__f?.mobilePhone],
  ["Number of Employees", (r) => r.row?.__f?.employees],
  ["Product Area", (r) => r.row?.__f?.productArea],
  ["Notes", (r) => r.row?.__f?.comments],
  ["Source File", (r) => r.sourceFile],
];
// Columns the per-file mapping never claimed are still read by detection's
// general column scan (two files carry BOTH `comments` and `Comments`; only
// one can be claimed as Notes). Carry them through under their original
// names or those rows lose the text that qualified them.
const extras: string[] = [];
for (const pf of parsed) {
  const claimed = new Set(Object.values(computeFileFieldMapping(pf)).filter(Boolean) as string[]);
  for (const c of pf.fields)
    if (c && !c.startsWith("__") && !claimed.has(c) && !extras.includes(c)) extras.push(c);
}
const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const head = [...COLS.map(([h]) => h), ...extras];
writeFileSync(`${OUT}/gap-leads-for-scanner.csv`,
  [head.map(q).join(","),
   ...gaps.map((r) => [...COLS.map(([, g]) => q(g(r))), ...extras.map((c) => q(r.row?.[c] ?? ""))].join(","))
  ].join("\n"));
console.log(`carried-through columns: ${extras.join(", ") || "(none)"}`);

// fingerprint the originals so the re-scan can be proved identical
writeFileSync(`${OUT}/gap-fingerprint.json`, JSON.stringify(gaps.map((r) => ({
  k: normalizeDupKey(String(r.row?.__f?.fullName ?? ""), String(r.row?.__f?.company ?? "")),
  tier: r.tier, cat: CATEGORY_META[r.category as never]?.label ?? r.category,
  score: r.mainScore?.score ?? 0, band: r.priorityBand,
  g: !!r.isGoogleWorkspaceMigration, p: !!r.isPartnerSeeking,
}))));
console.log(`strong signal (deduped): ${kept.length}`);
console.log(`already in a Main seq  : ${kept.length - gaps.length}`);
console.log(`GAP ROWS WRITTEN       : ${gaps.length}`);
