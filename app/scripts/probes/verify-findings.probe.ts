import { parseSmcLead } from "../../src/lib/smcLead";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow } from "../../src/lib/scanner2";
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

console.log('=== FINDING 3c: do contact details bleed between people? ===');
const blob = "Customer TPID: 555001 Company Name: New Leaf First Name: Christopher Last Name: Hallski Job Title: IT Manager First Name: Dana Last Name: Reyes Job Title: CFO Phone: 312-555-0147 Email: dana@newleaf.com";
const l = parseSmcLead(blob);
l.contacts.forEach((c, i) => console.log(`  contact ${i}: ${c.firstName} ${c.lastName} | title=${c.title} | phone=${c.phone || "-"} | email=${c.email || "-"}`));
const bled = !!l.contacts[0] && (l.contacts[0].email === "dana@newleaf.com" || l.contacts[0].phone === "312-555-0147");
console.log(bled ? "  CONFIRMED: Christopher carries Dana's phone/email\n" : "  not reproduced\n");

console.log('=== FINDING 3a: are two different people at one TPID merged? ===');
const mk = (tp: string, fn: string, ln: string, title: string, prod: string) =>
  `Customer TPID: ${tp} Company Name: Acme First Name: ${fn} Last Name: ${ln} Job Title: ${title} Phone: 312-555-0100 Email: ${fn.toLowerCase()}@acme.com SMC Type: Medium Product Propensity Details (as pulled from Cloud Ascent on 2026-06-01): - Azure: ${prod === 'Azure' ? 'Act Now (High Fit; High Prioritization Index)' : 'Unknown (Unknown Fit; Unknown Prioritization Index)'} - M365: Unknown (Unknown Fit; Unknown Prioritization Index) - D365 BC: ${prod === 'BC' ? 'Act Now (High Fit; High Prioritization Index)' : 'Unknown (Unknown Fit; Unknown Prioritization Index)'} - D365 F&O: Unknown (Unknown Fit; Unknown Prioritization Index) - D365 Sales Pro: Unknown (Unknown Fit; Unknown Prioritization Index) - Surface: Unknown (Unknown Fit; Unknown Prioritization Index) Product Ownership Details / Potential For Customer Adds (as pulled on 2026-06-01): - Has O365: Yes - Has Azure: No - Has D365: No`;
const csv = ['companyname,description,campaignidname'].concat([
  ['', mk('999111', 'Ann', 'Lee', 'CIO', 'Azure'), 'US~US~FY26~CMP~Azure Migrate~SRAIM1'],
  ['', mk('999111', 'Bob', 'Ray', 'CFO', 'BC'), 'US~US~FY26~CMP~Business Central~SRAIM2'],
].map(r => r.map(esc).join(','))).join('\n');
const parsed = [parseCSVText('t.csv', csv)];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet('t'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
console.log(`  read ${res.rowsRead}, kept ${res.rows.length}, merged ${res.duplicatesMerged}`);
res.rows.forEach(r => console.log(`    survivor: ${r.lead.contact} (${r.productLine}) leadKey=${r.leadKey}`));
console.log(res.rows.length < 2 ? "  CONFIRMED: one of two different people was dropped\n" : "  both survived\n");

console.log('=== FINDING 3b: does prose shadow a real labelled value? ===');
const b2 = "Company Name: Contoso Profiler comment: no immediate need identified, budget unclear. Budget: 250000 Authority: Naveen Sathiya Need: Cloud and Security modernisation Timeline: 2 months";
const l2 = parseSmcLead(b2);
console.log('  parsed BANT:', JSON.stringify(l2.bant));
console.log(l2.bant.budget !== '250000' ? "  CONFIRMED: the real Budget/Need were shadowed by prose\n" : "  correct\n");

console.log('=== FINDING 3c impact on the download ===');
const csv2 = ['companyname,description,campaignidname'].concat([['', blob, 'NULL']].map(r => r.map(esc).join(','))).join('\n');
const p2 = [parseCSVText('t2.csv', csv2)];
const pr2 = profileColumns(p2);
const r2 = scan2(p2, { ...emptyRuleSet('u'), fields: guessFieldMapping(pr2), notesColumns: guessNotesColumns(pr2), campaignColumns: guessCampaignColumns(pr2) });
if (r2.rows[0]) console.log('  exported row:', JSON.stringify(toApolloRow(r2.rows[0])));
