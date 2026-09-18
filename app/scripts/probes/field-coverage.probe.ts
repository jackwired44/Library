// What lands in each of the nine download columns, for the real blobs, with
// the CSV identity columns EMPTY (the way a Microsoft SMC export arrives).
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow, SCANNER2_EXPORT_LABELS } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const HEAD = ['companyname','description','campaignidname','emailaddress1','fullname','jobtitle','mobilephone','telephone1','numberofemployees'];
const csv = [HEAD.join(',')].concat((samples as string[]).map((d) =>
  ['', d, 'US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2', '', '', '', '', '', ''].map(esc).join(',')
)).join('\n');
const parsed = [parseCSVText('s.csv', csv)];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet('c'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
const rows = res.rows.map((r) => toApolloRow(r));
console.log('CSV identity columns are all EMPTY — everything below came out of the blob.\n');
for (const col of SCANNER2_EXPORT_LABELS) {
  const filled = rows.filter((r) => String((r as Record<string,string>)[col] || '').trim()).length;
  console.log(`  ${String(filled).padStart(2)}/${rows.length}  ${col}`);
}
console.log('\nper row:');
rows.forEach((r, i) => console.log(`  ${String(i).padStart(2)} name="${r['First Name']}" title="${r.Title}" email="${r.Email}" work="${r['Work Direct Phone']}" mobile="${r['Mobile Phone']}"`));
