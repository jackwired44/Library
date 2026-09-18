// Every column in Jack's real header list, in BOTH scanners, mapped to the
// field it should be. A mis-mapped column is how a lead silently exports
// with the wrong value — or no value — in a column he calls from.
import { parseCSVText } from "../../src/lib/csv";
import { profileColumns, guessFieldMapping, guessNotesColumns, guessCampaignColumns, LEAD_FIELDS } from "../../src/lib/scanner2";
import { computeFileFieldMapping } from "../../src/lib/detection";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

// Jack's real export headers, verbatim, including the duplicate description
// (Papa renames the second to description_1).
const HEAD = ['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename','statuscodename','revenue','numberofemployees','campaignidname','companyname','description','estimatedclosedate'];
const parsed = [parseCSVText('h.csv', [HEAD.join(','), HEAD.map(() => 'x').join(',')].join('\n'))];
const prof = profileColumns(parsed);

console.log("=== Custom Scanner ===");
const custom = guessFieldMapping(prof);
const wantCustom: Record<string, string> = {
  company: 'companyname', contact: 'fullname', title: 'jobtitle', email: 'emailaddress1',
  phone: 'telephone1', mobilePhone: 'mobilephone', employees: 'numberofemployees',
};
for (const [k, want] of Object.entries(wantCustom)) {
  ok(`${k} -> ${want}`, custom[k as keyof typeof custom] === want, `got ${custom[k as keyof typeof custom] ?? "(unmapped)"}`);
}
const notes = guessNotesColumns(prof);
ok(`notes -> description (+ description_1)`, notes.includes('description') && notes.includes('description_1'), JSON.stringify(notes));
ok(`campaign -> campaignidname`, guessCampaignColumns(prof).includes('campaignidname'), JSON.stringify(guessCampaignColumns(prof)));
ok(`campaignidname is NOT swallowed into notes`, !notes.includes('campaignidname'));
// Every identity field the UI offers must be mapped — an unmapped one is a
// blank column in the download.
const unmapped = LEAD_FIELDS.filter((f) => f.key !== 'notes' && !custom[f.key]);
ok('no identity field is left unmapped', unmapped.length === 0, unmapped.map((f) => f.label).join(', '));

console.log("\n=== Main Scanner (untouched, checked only) ===");
const main = computeFileFieldMapping({ name: 'h.csv', fields: HEAD, data: [] } as never);
const wantMain: Record<string, string> = {
  fullName: 'fullname', title: 'jobtitle', company: 'companyname', email: 'emailaddress1',
  workPhone: 'telephone1', mobilePhone: 'mobilephone', employees: 'numberofemployees', comments: 'description',
};
for (const [k, want] of Object.entries(wantMain)) {
  ok(`${k} -> ${want}`, (main as Record<string, string>)[k] === want, `got ${(main as Record<string, string>)[k] ?? "(unmapped)"}`);
}

console.log("\n=== the same field never claimed twice ===");
for (const [label, m] of [["Custom", custom as Record<string, string>], ["Main", main as Record<string, string>]] as const) {
  const used = Object.values(m).filter(Boolean) as string[];
  const dupes = used.filter((c, i) => used.indexOf(c) !== i);
  ok(`${label}: no column is mapped to two fields`, dupes.length === 0, [...new Set(dupes)].join(', '));
}
console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
