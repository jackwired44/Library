// Strong Signal quality audit for the Custom Scanner. Every check below is
// a specific way the rule could be wrong, measured on the real samples.
import { parseSmcLead, parseCampaign, resolveSmcRules, salesGaps, opportunities, hotWordHit, fiscalYearNumber, PRODUCT_LINE_OF } from "../../src/lib/smcLead";
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
const rules = resolveSmcRules(undefined);
const rows = (samples as string[]).map((d, i) => {
  const lead = parseSmcLead(d);
  const camp = parseCampaign(CAMPAIGNS[i] || 'NULL');
  return { i, d, lead, camp, verdict: classifySmc(lead, camp, 25, rules) };
});

const say = (h: string) => console.log(`\n=== ${h} ===`);

say('1. Coarse "Has D365" suppressing a real Business Central / Sales gap');
// Cloud Ascent reports ONE ownership flag for all of Dynamics, but says
// Act Now on a SPECIFIC module. Owning Sales does not mean owning BC.
let suppressed = 0;
for (const { i, lead } of rows) {
  if (lead.owns.D365 !== true) continue;
  const blocked = lead.propensity.filter(p =>
    (p.product === 'D365 BC' || p.product === 'D365 Sales Pro') &&
    p.stage === 'Act Now' && p.fit === 'High');
  if (blocked.length) {
    suppressed++;
    console.log(`  row ${i}: Act Now + High Fit on ${blocked.map(b => b.product).join(', ')} but "Has D365: Yes" suppresses it`);
  }
}
console.log(`  ${suppressed} of ${rows.length} rows affected here.`);

say('2. What each Strong Signal actually rests on');
for (const { i, lead, camp, verdict } of rows) {
  if (verdict.bucket !== 'priority') continue;
  const gaps = salesGaps(lead, rules);
  const hot = hotWordHit(lead, camp.name, rules);
  console.log(`  row ${i}: ${gaps.length ? `propensity gap (${gaps.map(g => g.product).join(', ')})` : hot ? `hot word "${hot.word}" in ${hot.where}` : 'other'}`);
}

say('3. Hot words firing from the NOTES blob (the weakest of the three sources)');
let notesOnly = 0;
for (const { i, lead, camp, verdict } of rows) {
  const hot = hotWordHit(lead, camp.name, rules);
  if (hot?.where === 'notes' && verdict.bucket === 'priority' && !salesGaps(lead, rules).length) {
    notesOnly++;
    const at = lead.rawText.toLowerCase().indexOf(hot.word);
    console.log(`  row ${i}: "${hot.word}" — context: …${lead.rawText.slice(Math.max(0, at - 60), at + 60)}…`);
  }
}
console.log(`  ${notesOnly} Strong verdicts rest on a hot word found only in the notes.`);

say('4. Rows whose ONLY Act Now + High Fit is on an unsupported product');
for (const { i, lead } of rows) {
  const acts = opportunities(lead).filter(o => o.stage === 'Act Now' && o.fit === 'High' && !o.owned);
  if (!acts.length) continue;
  const sold = acts.filter(o => PRODUCT_LINE_OF[o.product]);
  if (!sold.length) console.log(`  row ${i}: Act Now on ${acts.map(a => a.product).join(', ')} only — correctly not Strong`);
}

say('5. Stale campaign exclusions');
for (const { i, camp, verdict } of rows) {
  const fy = fiscalYearNumber(camp);
  if (fy >= 0 && fy < 25) console.log(`  row ${i}: ${camp.fiscalYear} ${camp.name} -> ${verdict.bucket}`);
}

say('6. Bucket totals');
const t: Record<string, number> = {};
for (const r of rows) t[r.verdict.bucket] = (t[r.verdict.bucket] || 0) + 1;
console.log(' ', t);
