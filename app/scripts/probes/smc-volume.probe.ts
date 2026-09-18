// Capacity check: 7,000 real-shaped SMC rows through the exact upload path.
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, bucketCounts } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
const CAMPS = ['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13'];
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const N = Number(process.env.N || 7000);
const lines = ['companyname,description,campaignidname,emailaddress1,fullname,jobtitle,telephone1,address1_country,websiteurl,numberofemployees'];
for (let i = 0; i < N; i++) {
  const d = (samples as string[])[i % samples.length].replace(/Customer TPID: (\d+)/, `Customer TPID: ${1000000 + i}`);
  lines.push([esc(''), esc(d), esc(CAMPS[i % CAMPS.length]), esc(`p${i}@x${i % 900}.com`), esc(`Person ${i}`), esc('IT'), esc(''), esc('US'), esc(''), esc(String(i % 500))].join(','));
}
const csv = lines.join('\n');
console.log(`csv ${(csv.length / 1e6).toFixed(1)} MB, ${N} rows`);
const t0 = performance.now();
const parsed = [parseCSVText('volume.csv', csv)];
const t1 = performance.now();
const prof = profileColumns(parsed);
const t2 = performance.now();
const set = { ...emptyRuleSet('vol'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) };
const res = scan2(parsed, set);
const t3 = performance.now();
const res2 = scan2(parsed, { ...set, smcRules: { hotWordsPushStrong: false } as never });
const t4 = performance.now();
console.log(`parse ${(t1 - t0).toFixed(0)}ms · profile ${(t2 - t1).toFixed(0)}ms · scan ${(t3 - t2).toFixed(0)}ms · total ${(t3 - t0).toFixed(0)}ms · RESCAN (rule change) ${(t4 - t3).toFixed(0)}ms`);
if (res2.rows.length !== res.rows.length) throw new Error('rescan row count drifted');
const c = bucketCounts(res.rows);
console.log('counts', c, 'reconciles', res.rowsRead === res.rows.length + res.duplicatesMerged);
const strong = res.rows.filter((r) => r.bucket === 'priority');
const noLine = strong.filter((r) => !r.productLine).length;
console.log(`strong ${strong.length} · without product line ${noLine} · by line`, strong.reduce((m: Record<string, number>, r) => { const k = r.productLine ?? 'none'; m[k] = (m[k] || 0) + 1; return m; }, {}));
console.log('heap MB', (process.memoryUsage().heapUsed / 1e6).toFixed(0));
