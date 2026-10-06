// Prove the rebuilt CSV scans identically, row by row, to the original scan.
import { readFileSync } from "node:fs";
import { parseCSVText } from "../src/lib/csv";
import { scanParsedFiles, normalizeDupKey, CATEGORY_META } from "../src/lib/detection";
// Writes outside the repo by default: the output holds real prospect
// names, emails and phone numbers. Override with GAP_OUT.
const OUT = process.env.GAP_OUT ?? "/tmp/gap-out";
const want = JSON.parse(readFileSync(`${OUT}/gap-fingerprint.json`, "utf8")) as any[];
const f = `${OUT}/gap-leads-for-scanner.csv`;
const out = scanParsedFiles([parseCSVText("gap-leads-for-scanner.csv", readFileSync(f, "utf8"))]);
const rows = out.results as Record<string, any>[];

const got = new Map<string, any>();
for (const r of rows) got.set(normalizeDupKey(String(r.row?.__f?.fullName ?? ""), String(r.row?.__f?.company ?? "")), r);

let ok = 0; const diffs: string[] = [];
for (const w of want) {
  const r = got.get(w.k);
  if (!r) { diffs.push(`MISSING ${w.k}`); continue; }
  const cat = CATEGORY_META[r.category as never]?.label ?? r.category;
  const same = r.tier === w.tier && cat === w.cat && (r.mainScore?.score ?? 0) === w.score
    && r.priorityBand === w.band && !!r.isGoogleWorkspaceMigration === w.g && !!r.isPartnerSeeking === w.p;
  if (same) ok++;
  else diffs.push(`${w.k}: want ${w.tier}/${w.cat}/${w.score}/${w.band} got ${r.tier}/${cat}/${r.mainScore?.score}/${r.priorityBand}`);
}
console.log(`rows in file     : ${(out as any).rowsScanned}`);
console.log(`dupes merged     : ${(out as any).duplicatesRemoved}`);
console.log(`no signal        : ${(out as any).noSignalRows?.length ?? 0}`);
console.log(`IDENTICAL        : ${ok} / ${want.length}`);
if (diffs.length) { console.log(`DIFFS (${diffs.length}):`); diffs.slice(0, 15).forEach((d) => console.log("  " + d)); }
const c: Record<string, number> = {};
for (const r of rows.filter((x) => x.tier === "signal"))
  c[CATEGORY_META[r.category as never]?.label ?? r.category] = (c[CATEGORY_META[r.category as never]?.label ?? r.category] ?? 0) + 1;
console.log(`strong by line   : ${JSON.stringify(c)}`);
console.log(`google->MS pins  : ${rows.filter((r) => r.isGoogleWorkspaceMigration).length}  partner pins: ${rows.filter((r) => r.isPartnerSeeking).length}`);
