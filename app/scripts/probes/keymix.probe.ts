// Which identity does each REAL sample lead end up curated by?
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const csv = ['companyname,description,campaignidname,emailaddress1,fullname']
  .concat((samples as string[]).map(d => [esc(''), esc(d), esc('NULL'), esc(''), esc('')].join(','))).join('\n');
const parsed = [parseCSVText('s.csv', csv)];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet('k'), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
const kind = (k: string | null) => !k ? 'NONE' : k.startsWith('tpid:') ? 'TPID' : k.startsWith('email:') ? 'email' : k.startsWith('text:') ? 'text hash' : k.includes('|site:') ? 'company+site' : 'company+contact';
const tally: Record<string, number> = {};
res.rows.forEach(r => { const t = kind(r.leadKey); tally[t] = (tally[t] || 0) + 1; });
console.log('curation key source across the real sample blobs:');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log('\nper row:');
res.rows.forEach((r, i) => console.log(`  ${String(i).padStart(2)} ${kind(r.leadKey).padEnd(15)} ${(r.lead.company || '-').slice(0, 26)}`));
