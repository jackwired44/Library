// Capacity: Jack pulls one CSP file a month and may combine several.
// Measure the real file, then 2x and 3x it, watching time and memory.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow, buildRun } from "../../src/lib/scanner2";

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
const text = fs.readFileSync(P, "utf8");
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const heap = () => Math.round(process.memoryUsage().heapUsed / 1048576);
console.log(`source file: ${mb(text.length)}\n`);

for (const copies of [1, 2, 3]) {
  const files = Array.from({ length: copies }, (_, i) => ({ name: `book-${i}.csv`, text }));
  let t = Date.now();
  const parsed = files.map((f) => parseCSVText(f.name, f.text));
  const tParse = Date.now() - t;
  const rows = parsed.reduce((n, p) => n + p.data.length, 0);
  const prof = profileColumns(parsed);
  const rs = { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) };
  t = Date.now();
  const res = scan2(parsed, rs);
  const tScan = Date.now() - t;
  t = Date.now();
  scan2(parsed, { ...rs, cspRules: { strongAt: 70 } });
  const tRescan = Date.now() - t;
  t = Date.now();
  const exported = res.rows.map((r) => toApolloRow(r));
  const tExport = Date.now() - t;
  const run = buildRun(files.map((f) => f.name), rs.name, res, "csp");
  console.log(`${copies} file(s) · ${rows.toLocaleString()} rows in · ${res.rows.length.toLocaleString()} kept · ${res.duplicatesMerged.toLocaleString()} merged`);
  console.log(`   parse ${tParse}ms · scan ${tScan}ms · rescan ${tRescan}ms · export ${tExport}ms · heap ${heap()} MB`);
  console.log(`   run record persisted: ${JSON.stringify(run).length} bytes (counts + filenames only, no rows)`);
  console.log(`   reconciles: ${res.rowsRead === res.rows.length + res.duplicatesMerged}`);
  void exported;
}

// What a scan actually holds in memory: every raw row is retained on Row2.row
const parsed1 = [parseCSVText("one.csv", text)];
const prof1 = profileColumns(parsed1);
const res1 = scan2(parsed1, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof1), notesColumns: guessNotesColumns(prof1), campaignColumns: guessCampaignColumns(prof1) });
const approx = JSON.stringify(res1.rows.slice(0, 200)).length / 200;
console.log(`\nper-row retained footprint ~${Math.round(approx)} bytes -> ${mb(approx * res1.rows.length)} for this file`);
console.log(`IndexedDB writes per scan: 1 rule set + 1 run record. Curation rows are written only when you click one.`);
