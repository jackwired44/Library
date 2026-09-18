import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
const CAMPAIGNS = ['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~FY24~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~FY24~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const csv = ['companyname,description,campaignidname,emailaddress1,fullname']
  .concat((samples as string[]).map((d, i) => [esc(''), esc(d), esc(CAMPAIGNS[i] || 'NULL'), esc(''), esc('')].join(','))).join('\n');
const parsed = [parseCSVText('smc.csv', csv)];
const prof = profileColumns(parsed);
const set = { ...emptyRuleSet('t'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) };
const res = scan2(parsed, set);
console.log('rowsRead', res.rowsRead, 'kept', res.rows.length, 'merged', res.duplicatesMerged);
const byKey = new Map<string, number>();
res.rows.forEach((r, i) => {
  console.log(String(i).padStart(2), (r.receivedOn ?? '----------'), r.bucket.padEnd(9), JSON.stringify(r.leadKey), '|', (r.lead.company || '-').slice(0, 24));
  if (r.leadKey) byKey.set(r.leadKey, (byKey.get(r.leadKey) || 0) + 1);
});
for (const [k, n] of byKey) if (n > 1) console.log('SHARED CURATION KEY', JSON.stringify(k), 'on', n, 'rows');
