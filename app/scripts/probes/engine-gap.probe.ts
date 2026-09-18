// Why does the SAME Microsoft SMC file score far more Strong Signal in the
// Main Scanner than in the Custom Scanner? Runs BOTH engines over the same
// real Cloud Ascent rows and attributes every divergence to a rule.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
import {
  scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns,
  guessCampaignColumns, classifySmc,
} from "../../src/lib/scanner2";
import { parseSmcLead, parseCampaign, resolveSmcRules, salesGaps, fiscalYearNumber } from "../../src/lib/smcLead";
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

const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const HEAD = 'companyname,description,campaignidname,emailaddress1,fullname,jobtitle,telephone1';
// Jack's REAL export populates the identity columns as well as carrying the
// blob — so populate them from the blob, or the Main Scanner auto-DQs every
// row for "missing company name" and the comparison measures nothing.
const csv = [HEAD].concat((samples as string[]).map((d, i) => {
  const l = parseSmcLead(d);
  const c0 = l.contacts[0];
  return [
    esc(l.company || `Account ${i}`),
    esc(d),
    esc(CAMPAIGNS[i] || 'NULL'),
    esc(c0?.email || `dana.reyes${i}@${(l.company || `acct${i}`).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || `acct${i}`}.com`),
    esc(c0 ? `${c0.firstName} ${c0.lastName}`.trim() : `Dana Reyes ${i}`),
    esc(c0?.title || 'IT Manager'),
    esc(c0?.phone || ''),
  ].join(',');
})).join('\n');

const parsed = [parseCSVText('smc.csv', csv)];

// --- Main Scanner
const main = scanParsedFiles(parsed);
const mainByIdx = new Map<number, (typeof main.results)[number]>();
for (const r of main.results) mainByIdx.set(Number(r.id.split('-')[1]), r);

// --- Custom Scanner
const prof = profileColumns(parsed);
const set = {
  ...emptyRuleSet('cmp'),
  fields: guessFieldMapping(prof),
  notesColumns: guessNotesColumns(prof),
  campaignColumns: guessCampaignColumns(prof),
};
const custom = scan2(parsed, set);
const rules = resolveSmcRules(set.smcRules);

console.log(`\nMain Scanner   : ${main.results.filter(r => r.tier === 'signal').length} strong / ${main.results.length} scored / ${main.rowsScanned} read (${main.noSignalRows.length} no signal, ${main.duplicatesRemoved} dupes)`);
const cStrong = custom.rows.filter(r => r.bucket === 'priority').length;
console.log(`Custom Scanner : ${cStrong} strong / ${custom.rows.length} shown / ${custom.rowsRead} read (${custom.duplicatesMerged} merged)\n`);

console.log('row | MAIN            | CUSTOM        | why they differ');
console.log('----+-----------------+---------------+----------------------------------------');
const reasons: Record<string, number> = {};
(samples as string[]).forEach((d, i) => {
  const m = mainByIdx.get(i);
  const mainTier = !m ? 'no signal' : m.tier === 'signal' ? 'STRONG' : m.tier === 'mention' ? 'review' : 'bad lead';
  const c = custom.rows.find(r => r.row.description === d);
  const cb = !c ? 'merged away' : c.bucket === 'priority' ? 'STRONG' : c.bucket === 'review' ? 'review' : c.bucket === 'excluded' ? 'bad lead' : 'no signal';

  let why = '';
  if (mainTier === 'STRONG' && cb !== 'STRONG') {
    const lead = parseSmcLead(d);
    const camp = parseCampaign(CAMPAIGNS[i] || 'NULL');
    const fy = fiscalYearNumber(camp);
    if (lead.empty) why = 'blank blob';
    else if (fy >= 0 && fy < 25) why = 'Custom: stale campaign (FY<25)';
    else if (c && c.snippet.startsWith('Not supported')) why = 'Custom: not-supported product (Fabric)';
    else if (!salesGaps(lead, rules).length) why = 'Custom: no Act Now + High Fit gap on a sold line';
    else why = '?';
    reasons[why] = (reasons[why] || 0) + 1;
    // What did Main think it found?
    why += `  [main saw: ${m!.category}${m!.licensing ? ' + licensing' : ''}]`;
  } else if (cb === 'STRONG' && mainTier !== 'STRONG') {
    why = 'Custom stricter? no — Custom found a real gap Main missed';
    reasons['custom only'] = (reasons['custom only'] || 0) + 1;
  }
  console.log(`${String(i).padStart(3)} | ${mainTier.padEnd(15)} | ${cb.padEnd(13)} | ${why}`);
});

console.log('\n--- Main Scanner tier breakdown with reasons ---');
for (const r of main.results) {
  const idx = Number(r.id.split('-')[1]);
  console.log(`  row ${String(idx).padStart(2)}  ${r.tier.padEnd(7)} ${r.category.padEnd(12)} ${r.dqReasons.length ? 'DQ: ' + r.dqReasons.join('; ') : (r.platform?.snippet || '').slice(0, 90)}`);
}

console.log('\n--- why Main says Strong where Custom does not ---');
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);

// What in the blob is Main actually matching on?
console.log('\n--- what the Main Scanner matches inside a Cloud Ascent blob ---');
const one = (samples as string[])[1];
const m1 = mainByIdx.get(1);
if (m1) {
  console.log('  category :', m1.category, '| tier:', m1.tier);
  console.log('  snippet  :', (m1.platform?.snippet || m1.notesSummary || '').slice(0, 240));
}
