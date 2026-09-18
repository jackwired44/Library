// A company appears twice in one export: a Cloud Ascent propensity row that
// names nobody, and a campaign row carrying the contact. The contactless row
// used to download blank — 70 of one real 99-row view Jack pulled. It must
// now adopt the sibling's contact, WITHOUT ever mixing two people together.
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns, toApolloRow, makeRule } from "../../src/lib/scanner2";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

const HEAD = ['description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','companyname','campaignidname'];
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const row = (o: Partial<Record<string, string>>) => HEAD.map((h) => esc(o[h] ?? "")).join(",");
const PROP = (tpid: string, co: string) =>
  `Customer TPID: ${tpid} SMC Type: Medium Product Propensity Details (as pulled from Cloud Ascent on 2026-09-01): - Azure: Act Now (High Fit; High Prioritization Index) - M365: Educate (Very Low Fit; Very Low Prioritization Index) Product Ownership Details / Potential For Customer Adds (as pulled on 2026-09-01): - Has O365: Yes - Has Azure: No Company Name: ${co}`;
const CAMP = 'US~US~FY26~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7';

const csv = [HEAD.join(',')].concat([
  // A: names nobody, has a TPID sibling below
  row({ description: PROP('93634874', 'ACME CO'), companyname: 'ACME CO', campaignidname: CAMP }),
  // B: the donor, same TPID + company
  row({ description: PROP('93634874', 'ACME CO'), companyname: 'ACME CO', campaignidname: CAMP,
        emailaddress1: 'hlewis@acme.com', fullname: 'Hank Lewis', jobtitle: 'IT Director', telephone1: '757-220-5493' }),
  // C: names somebody but has no email — must NOT inherit Hank's
  row({ description: PROP('93634874', 'ACME CO'), companyname: 'ACME CO', campaignidname: CAMP, fullname: 'Jane Roe' }),
  // D: no TPID, matches only by company name
  row({ description: 'Azure: Act Now (High Fit; High Prioritization Index) Has Azure: No', companyname: 'ACME CO', campaignidname: CAMP }),
  // E: nobody anywhere for this company
  row({ description: PROP('40598152', 'ORPHAN LLC'), companyname: 'ORPHAN LLC', campaignidname: CAMP }),
]).join('\n');

const parsed = [parseCSVText('b.csv', csv)];
const prof = profileColumns(parsed);
const rs = { ...emptyRuleSet('c'), mode: 'smc' as const, fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof), rules: [makeRule('x', ['zzznever'], 'review')] };
const res = scan2(parsed, rs);
const ex = res.rows.map((r) => ({ r, e: toApolloRow(r) as Record<string, string> }));

const byCo = (co: string) => ex.filter(({ e }) => e['Company Name'] === co);

const acme = byCo('ACME CO');
ok('all four ACME rows survive', acme.length === 4, `got ${acme.length}`);
const A = acme.find(({ r }) => r.contactFrom === 'tpid' && String(r.row.fullname ?? '') === '');
ok('the contactless TPID row adopted a contact', !!A);
ok('  adopted name', A?.e['First Name'] === 'Hank' && A?.e['Last Name'] === 'Lewis', `${A?.e['First Name']} | ${A?.e['Last Name']}`);
ok('  adopted email', A?.e.Email === 'hlewis@acme.com', A?.e.Email);
ok('  adopted work phone', A?.e['Work Direct Phone'] === '757-220-5493', A?.e['Work Direct Phone']);
ok('  adopted title', A?.e.Title === 'IT Director', A?.e.Title);
ok('  note says where the contact came from', /from another row/i.test(A?.e.Notes ?? ''), A?.e.Notes);

const B = acme.find(({ r }) => String(r.row.fullname ?? '') === 'Hank Lewis');
ok('the donor row is untouched', !B?.r.contactFrom && B?.e.Email === 'hlewis@acme.com');

const C = acme.find(({ r }) => String(r.row.fullname ?? '') === 'Jane Roe');
ok('a row that names someone is never backfilled', !C?.r.contactFrom);
ok('  keeps its own name', C?.e['First Name'] === 'Jane' && C?.e['Last Name'] === 'Roe', `${C?.e['First Name']} | ${C?.e['Last Name']}`);
ok('  does NOT inherit the other person email', !C?.e.Email, C?.e.Email);
ok('  does NOT inherit the other person phone', !C?.e['Work Direct Phone'], C?.e['Work Direct Phone']);

const D = acme.find(({ r }) => r.contactFrom === 'company');
ok('a row with no TPID matches on company name', !!D);
ok('  adopted the same contact', D?.e.Email === 'hlewis@acme.com', D?.e.Email);

const orphan = byCo('ORPHAN LLC')[0];
ok('a company with no contact anywhere stays blank', !orphan?.r.contactFrom && !orphan?.e['First Name']);
ok('  and its note is not annotated', !/from another row/i.test(orphan?.e.Notes ?? ''), orphan?.e.Notes);

// The split itself, at the boundaries that matter.
import { splitName } from "../../src/lib/scanner2";
ok('splitName: "Dana Reyes"', splitName('Dana Reyes').first === 'Dana' && splitName('Dana Reyes').last === 'Reyes');
ok('splitName keeps a multi-part surname whole', splitName('Mary Jo van der Berg').last === 'Berg' && splitName('Mary Jo van der Berg').first === 'Mary Jo van der');
ok('splitName honours "Last, First"', splitName('Reyes, Dana').first === 'Dana' && splitName('Reyes, Dana').last === 'Reyes');
ok('splitName leaves a one-word name in First, never invents a surname', splitName('Cher').first === 'Cher' && splitName('Cher').last === '');
ok('splitName on blank is blank', splitName('').first === '' && splitName('').last === '');

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
