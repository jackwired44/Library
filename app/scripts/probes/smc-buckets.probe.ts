// Bucket per real sample row, with the suite's campaign pairing — a
// before/after snapshot for rule changes. Run: node scripts/probes/smc-buckets.cjs
import { parseSmcLead, parseCampaign } from "../../src/lib/smcLead";
import { classifySmc } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
const CAMPAIGNS = [
  'US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6',
  'US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10',
  'US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7',
  'US~FY24~CMP~COE True Up 1~SRAIM419760',
  'US~US~FY25~CMP~Partner CoSell~SRAIM562011',
  'US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2',
  'NULL',
  'US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33',
  'US~FY24~CMP~COE True Up 1~SRAIM419760',
  'NULL',
  'US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13',
  'US~US~FY25~CMP~TUM~SRAIM514049',
  'US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2',
];
(samples as string[]).forEach((d, i) => {
  const lead = parseSmcLead(d);
  const camp = parseCampaign(CAMPAIGNS[i] || "NULL");
  const r = classifySmc(lead, camp, 25);
  console.log(String(i).padStart(2), r.bucket.padEnd(9), (lead.company || lead.tpids[0] || "-").slice(0, 26).padEnd(26), "|", r.why.slice(0, 140));
});
