// What does the Notes column actually say? Looking for gaps (empty/near
// empty), inconsistencies (a note that contradicts the tier), and artefacts.
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, BUCKET2_META } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
const CAMPS = ['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~FY24~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~FY24~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const csv = ['companyname,description,campaignidname'].concat((samples as string[]).map((d, i) =>
  ['', d, CAMPS[i] || 'NULL'].map(esc).join(','))).join('\n');
const parsed = [parseCSVText('n.csv', csv)];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet('n'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });

const problems: string[] = [];
res.rows.forEach((r, i) => {
  const n = r.snippet || "";
  const tier = BUCKET2_META[r.bucket].label;
  console.log(`\n[${i}] ${tier.padEnd(13)} | ${n}`);
  if (!n.trim()) problems.push(`row ${i}: EMPTY note`);
  if (n.trim().length < 12) problems.push(`row ${i}: note is only ${n.trim().length} chars: "${n}"`);
  if (/\bNULL\b/i.test(n)) problems.push(`row ${i}: leftover NULL in note`);
  if (/\s{2,}/.test(n)) problems.push(`row ${i}: double spaces`);
  if (/·\s*·|·\s*$|^\s*·/.test(n)) problems.push(`row ${i}: dangling separator: "${n}"`);
  if (/\bundefined\b|\bNaN\b|\[object/.test(n)) problems.push(`row ${i}: placeholder leaked`);
  // A note claiming a qualifying gap on a row that is NOT Strong Signal.
  if (/Act Now \+ High\+ Fit/.test(n) && r.bucket !== "priority") problems.push(`row ${i}: note claims a qualifying gap but tier is ${tier}`);
  // Strong Signal must always say WHY.
  if (r.bucket === "priority" && !/Act Now|Hot signal|High prioritization|BANT on file/.test(n)) problems.push(`row ${i}: Strong Signal with no stated reason: "${n}"`);
  // Bad Leads must always say why they were excluded.
  if (r.bucket === "excluded" && !/Stale campaign|No usable lead content|Not supported/.test(n)) problems.push(`row ${i}: Bad Lead with no stated reason: "${n}"`);
  // A note must not end mid-word from a slice.
  if (/[a-z],$/.test(n.trim())) problems.push(`row ${i}: note ends on a comma: "${n.slice(-40)}"`);
});
console.log(`\n\n=== ${problems.length} problems ===`);
problems.forEach((p) => console.log('  ' + p));
