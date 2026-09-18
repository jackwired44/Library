// Causal test: is the Main Scanner's Strong Signal on Cloud Ascent data
// driven by real buying language, or by the propensity TABLE that lists
// every Microsoft product on every single lead?
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
import { parseSmcLead } from "../../src/lib/smcLead";
import samples from "../fixtures/smc-samples.json";

const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const HEAD = 'companyname,description,campaignidname,emailaddress1,fullname,jobtitle,telephone1';

// The table region: everything from "Product Propensity Details" onward.
const TABLE_RE = /Product Propensity Details[\s\S]*?(?=Profiler comment|$)/i;

function build(list: string[]): string {
  return [HEAD].concat(list.map((d, i) => {
    const l = parseSmcLead(d);
    const c0 = l.contacts[0];
    const dom = (l.company || `acct${i}`).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || `acct${i}`;
    return [
      esc(l.company || `Account ${i}`), esc(d), esc('US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'),
      esc(c0?.email || `dana.reyes${i}@${dom}.com`),
      esc(c0 ? `${c0.firstName} ${c0.lastName}`.trim() : `Dana Reyes ${i}`),
      esc(c0?.title || 'IT Manager'), esc(c0?.phone || ''),
    ].join(',');
  })).join('\n');
}

const withTable = samples as string[];
const withoutTable = withTable.map((d) => d.replace(TABLE_RE, ' '));

const a = scanParsedFiles([parseCSVText('a.csv', build(withTable))]);
const b = scanParsedFiles([parseCSVText('b.csv', build(withoutTable))]);

const strongA = a.results.filter(r => r.tier === 'signal').length;
const strongB = b.results.filter(r => r.tier === 'signal').length;
const scoredA = a.results.length, scoredB = b.results.length;

console.log(`\nMain Scanner, blob AS-IS          : ${strongA} strong, ${scoredA} scored, ${a.noSignalRows.length} no signal`);
console.log(`Main Scanner, propensity table cut: ${strongB} strong, ${scoredB} scored, ${b.noSignalRows.length} no signal`);
console.log(`\n=> ${strongA - strongB} of ${strongA} Main Strong verdicts (${strongA ? Math.round((strongA - strongB) / strongA * 100) : 0}%) exist ONLY because of the propensity table.`);
console.log(`=> ${scoredA - scoredB} of ${scoredA} rows are visible to Main ONLY because of the propensity table.`);

console.log('\n--- per row ---');
const byIdx = (res: typeof a) => { const m = new Map<number, string>(); for (const r of res.results) m.set(Number(r.id.split('-')[1]), r.tier); return m; };
const ma = byIdx(a), mb = byIdx(b);
withTable.forEach((_, i) => {
  const ta = ma.get(i) ?? 'none', tb = mb.get(i) ?? 'none';
  console.log(`  ${String(i).padStart(2)}  with table: ${ta.padEnd(8)} without: ${tb.padEnd(8)} ${ta !== tb ? '<-- table changed the verdict' : ''}`);
});

// How often does the table alone name a product? (every lead, by design)
const namesEveryProduct = withTable.filter(d => /D365 BC|M365|Azure/i.test(d)).length;
console.log(`\n${namesEveryProduct} of ${withTable.length} blobs name a Microsoft product somewhere in the table — which is what gives Main a category on almost every row.`);
