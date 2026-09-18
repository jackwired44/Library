// Read every distinct note the scanner produces, in full, and the BANT
// fragments they are built from.
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, BUCKET2_META } from "../../src/lib/scanner2";
import { parseSmcLead } from "../../src/lib/smcLead";
import samples from "../fixtures/smc-samples.json";
const CAMPS = ['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~FY24~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~FY24~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const csv = ['companyname,description,campaignidname'].concat((samples as string[]).map((d, i) =>
  ['', d, CAMPS[i] || 'NULL'].map(esc).join(','))).join('\n');
const parsed = [parseCSVText('n.csv', csv)];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet('n'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });

console.log('=== FULL NOTES, unabridged ===');
res.rows.forEach((r, i) => console.log(`\n[${i}] ${BUCKET2_META[r.bucket].label}\n    ${r.snippet}`));

console.log('\n\n=== the BANT fragments these notes quote ===');
(samples as string[]).forEach((d, i) => {
  const l = parseSmcLead(d);
  const b = l.bant;
  if (!b.budget && !b.authority && !b.need && !b.timeline && !b.partner) return;
  console.log(`row ${i}:`);
  for (const [k, v] of Object.entries(b)) console.log(`   ${k.padEnd(9)} "${v}"`);
});
