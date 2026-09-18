// Is the Strong Signal output actually dialable? Runs Jack's real volume
// through the exact upload path and asks the only question that matters
// before this becomes phone calls: can you call the rows it hands you?
import { parseCSVText } from "../../src/lib/csv";
import {
  scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns,
  guessCampaignColumns, bucketCounts, reconciles, toApolloRow, SCANNER2_EXPORT_LABELS,
} from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";

const CAMPS = [
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
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const N = Number(process.env.N || 11393);
const HEAD = ['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename','statuscodename','revenue','numberofemployees','campaignidname','companyname','description_1','estimatedclosedate'];
const lines = [HEAD.join(',')];
for (let i = 0; i < N; i++) {
  // Vary the TPID so each row is a distinct account, the way a real export is.
  const blob = (samples as string[])[i % samples.length].replace(/Customer TPID: (\d+)/, `Customer TPID: ${9000000 + i}`);
  // A real Dynamics export leaves plenty of identity columns empty — the
  // blob is the source. Mirror that: only every 3rd row has CSV identity.
  const hasCols = i % 3 === 0;
  lines.push([
    'US', blob, hasCols ? `p${i}@corp${i % 700}.com` : '', hasCols ? `Pat Vance ${i}` : '',
    hasCols ? 'IT Director' : '', hasCols ? `312555${String(i).padStart(4, '0')}` : '',
    hasCols ? `312444${String(i).padStart(4, '0')}` : '', `ACCT-${i}`, '', 'Chicago', 'IL', 'Seg',
    'Tech', 'Open', '100', hasCols ? '250' : '', CAMPS[i % CAMPS.length], hasCols ? `Corp ${i}` : '',
    'second desc', '2026-12-01',
  ].map(esc).join(','));
}
const csv = lines.join('\n');
console.log(`file: ${(csv.length / 1e6).toFixed(1)} MB, ${N} rows\n`);

const t0 = performance.now();
const parsed = [parseCSVText('real.csv', csv)];
const t1 = performance.now();
const prof = profileColumns(parsed);
const set = {
  ...emptyRuleSet('ready'),
  fields: guessFieldMapping(prof),
  notesColumns: guessNotesColumns(prof),
  campaignColumns: guessCampaignColumns(prof),
};
const t2 = performance.now();
const res = scan2(parsed, set);
const t3 = performance.now();
console.log(`parse ${(t1 - t0).toFixed(0)}ms · profile ${(t2 - t1).toFixed(0)}ms · scan ${(t3 - t2).toFixed(0)}ms`);
const c = bucketCounts(res.rows);
console.log('buckets', c);
console.log('reconciles:', reconciles(res), `(${res.rowsRead} read = ${res.rows.length} processed + ${res.duplicatesMerged} merged)`);

const strong = res.rows.filter((r) => r.bucket === 'priority');
console.log(`\n=== CAN YOU CALL THEM? ${strong.length} Strong Signal rows ===`);
const t4 = performance.now();
const out = strong.map((r) => toApolloRow(r));
console.log(`building the download took ${(performance.now() - t4).toFixed(0)}ms`);

const missing = (k: string) => out.filter((r) => !String((r as Record<string, string>)[k] || '').trim()).length;
const pct = (n: number) => `${((n / out.length) * 100).toFixed(1)}%`;
for (const col of SCANNER2_EXPORT_LABELS) {
  const m = missing(col);
  if (m) console.log(`  ${String(m).padStart(6)} rows (${pct(m).padStart(6)}) have NO ${col}`);
}
const noPhone = out.filter((r) => !r['Work Direct Phone'] && !r['Mobile Phone']).length;
const noContactAtAll = out.filter((r) => !r['Work Direct Phone'] && !r['Mobile Phone'] && !r.Email).length;
const noName = out.filter((r) => !String(r['First Name'] || '').trim()).length;
console.log(`\n  no phone of any kind : ${noPhone} (${pct(noPhone)})`);
console.log(`  no phone AND no email: ${noContactAtAll} (${pct(noContactAtAll)})  <- cannot be worked at all`);
console.log(`  no name              : ${noName} (${pct(noName)})`);

// Curation needs a stable key per lead, or Keep/Reject cannot be recorded.
const noKey = res.rows.filter((r) => !r.leadKey).length;
console.log(`\n  rows with no curation key (Keep/Maybe/Reject unavailable): ${noKey}`);

// Duplicate keys must not collide across different accounts.
const keys = new Map<string, number>();
for (const r of res.rows) if (r.leadKey) keys.set(r.leadKey, (keys.get(r.leadKey) || 0) + 1);
const collided = [...keys.entries()].filter(([, n]) => n > 1);
console.log(`  curation keys shared by more than one row: ${collided.length}`, collided.slice(0, 3));
