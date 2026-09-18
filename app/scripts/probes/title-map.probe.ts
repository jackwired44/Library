// Does a populated jobtitle column reach the Title export column?
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
// A Dynamics-style blob with propensity but NO contact block — exactly the
// shape of the 99 rows in Jack's export.
const blob = (samples as string[]).find((d) => /Product Propensity Details/.test(d) && !/First\s+Name\s*:/.test(d))!;
const HEAD = 'address1_country,description,emailaddress1,fullname,jobtitle,mobilephone,telephone1,accountidname,numberofemployees,campaignidname,companyname';
const rows = [
  ['US', blob, 'corey@santarosa.gov', 'Corey Adkinson', 'IT Director', '850-555-0100', '850-983-1845', 'ACCT-1', '120', 'US~US~FY26~CMP~Expand Security~SRAIM1', 'FL-COUNTY OF SANTA ROSA'],
];
const parsed = [parseCSVText('t.csv', [HEAD].concat(rows.map((r) => r.map(esc).join(','))).join('\n'))];
const prof = profileColumns(parsed);
const fields = guessFieldMapping(prof);
console.log('guessed mapping:', JSON.stringify(fields, null, 0));
const res = scan2(parsed, { ...emptyRuleSet('t'), fields, notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
console.log('\nrows scanned:', res.rows.length);
if (res.rows[0]) {
  console.log('exported:', JSON.stringify(toApolloRow(res.rows[0]), null, 2));
}
