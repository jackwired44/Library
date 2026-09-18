import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, toApolloRow, localDayKey, bucketCounts } from "../../src/lib/scanner2";
const N = 15000;
const today = localDayKey(new Date());
const plus = (n: number) => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + n); return localDayKey(d); };
const HEAD = ['Customer Name','Customer Domain','Subscription Id','Offer Name','Subscription Status','License Quantity','Term Duration','Commitment End Date','Auto Renew Enabled','Partner Of Record','Contact Name','Contact Email','Contact Phone'];
const SKUS = ['Microsoft 365 Business Premium','Microsoft 365 E3','Microsoft 365 E5','Dynamics 365 Business Central Essentials','Dynamics 365 Sales Professional','Azure Plan','Office 365 E1'];
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const lines = [HEAD.join(',')];
for (let i = 0; i < N; i++) {
  lines.push([
    `Company ${i % 4200}`, `co${i % 4200}.com`, `s${i}`, SKUS[i % SKUS.length],
    i % 97 === 0 ? 'Deleted' : 'Active', String((i % 400) + 1), 'Annual',
    plus((i % 500) - 60), i % 3 === 0 ? 'True' : 'False',
    i % 11 === 0 ? 'Wired CIO LLC' : `Partner ${i % 37}`,
    `Person ${i}`, `p${i}@co${i % 4200}.com`, `312-555-${String(1000 + (i % 8999))}`,
  ].map(q).join(','));
}
const csv = lines.join('\n');
console.log(`file: ${(csv.length / 1048576).toFixed(1)} MB, ${N} rows`);

let t = Date.now();
const parsed = [parseCSVText('big.csv', csv)];
console.log(`parse        ${Date.now() - t} ms`);
t = Date.now();
const prof = profileColumns(parsed);
console.log(`profile      ${Date.now() - t} ms`);
const rs = { ...emptyRuleSet('csp', 'csp'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof) };
t = Date.now();
const res = scan2(parsed, rs);
console.log(`scan         ${Date.now() - t} ms`);
t = Date.now();
const rows = res.rows.map((r) => toApolloRow(r));
console.log(`export map   ${Date.now() - t} ms`);
t = Date.now();
scan2(parsed, { ...rs, cspRules: { nowDays: 45 } });
console.log(`rescan (knob)${Date.now() - t} ms`);

console.log('\nrows kept:', res.rows.length, '· duplicates merged:', res.duplicatesMerged, '· read:', res.rowsRead);
console.log('buckets:', JSON.stringify(bucketCounts(res.rows)));
const filled = (c: string) => rows.filter((r) => String((r as Record<string,string>)[c] || '').trim()).length;
console.log('export fill:', ['First Name','Company Name','Email','Work Direct Phone','Number of Employees','Product Area','Notes'].map((c) => `${c} ${filled(c)}`).join(' · '));
console.log('reconciles:', res.rowsRead === res.rows.length + res.duplicatesMerged);
