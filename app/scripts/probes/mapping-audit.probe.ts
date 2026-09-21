// Every column in Jack's real header list, in BOTH scanners, mapped to the
// field it should be. A mis-mapped column is how a lead silently exports
// with the wrong value — or no value — in a column he calls from.
import { parseCSVText } from "../../src/lib/csv";
import { profileColumns, guessFieldMapping, guessNotesColumns, guessCampaignColumns, LEAD_FIELDS,
  exportPhone, exportEmail, exportText, scan2, emptyRuleSet, toApolloRow } from "../../src/lib/scanner2";
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
// ------------------------------------------------- export hygiene
// Audited against the real 13,106-row Bookleads export, which was shipping
// 61 undialable work phones, 19 undialable mobiles, 10 malformed emails and
// a surname of "0". Apollo imports "N/A" as a phone number, so a call list
// of placeholders is worse than one with blanks — you cannot tell a bad
// number from a missing one. Every case below is real text from that file
// or from the CSP export.
console.log("\n=== export hygiene: placeholders never reach the CSV ===");

for (const v of ["N/A", "n/a", "NULL", "none", "-", "--", "0", "000", "unknown", "TBD", "not available", ".", "?"])
  ok(`  phone placeholder ${JSON.stringify(v)} exports blank`, exportPhone(v) === "", exportPhone(v));
for (const v of ["8.18028E+11", "9.18947E+11", "5.25549E+11", "1.16505E+11"])
  ok(`  Excel-mangled ${JSON.stringify(v)} exports blank \u2014 the digits are gone`, exportPhone(v) === "", exportPhone(v));
for (const v of ["123", "4567", "12", "1"])
  ok(`  too short to dial ${JSON.stringify(v)} exports blank`, exportPhone(v) === "", exportPhone(v));
// Three rows in the real file had an address in the phone column.
for (const v of ["jldellario@nrdllc.com", "shanda.brooke@emndefense.com", "dbajaj@fnrpusa.com"])
  ok(`  an email in the phone column exports blank`, exportPhone(v) === "", exportPhone(v));
for (const v of ["312-555-0147", "(312) 555-0147", "+1 786 953 5229", "18006772726", "312.555.0147 x12"])
  ok(`  a real phone ${JSON.stringify(v)} survives untouched`, exportPhone(v) === v, exportPhone(v));

for (const v of ["-", "N/A", "none", "null", "", "   "])
  ok(`  email placeholder ${JSON.stringify(v)} exports blank`, exportEmail(v) === "", exportEmail(v));
ok('  a trailing separator is stripped, not thrown away',
   exportEmail("jacob.rivera@ocvt.info \u00b7") === "jacob.rivera@ocvt.info", exportEmail("jacob.rivera@ocvt.info \u00b7"));
for (const v of ["dana@acme.com", "first.last+tag@sub.domain.co.uk"])
  ok(`  a real address ${JSON.stringify(v)} survives untouched`, exportEmail(v) === v, exportEmail(v));
for (const v of ["notanemail", "two@@at.com", "no at sign", "a@b"])
  ok(`  ${JSON.stringify(v)} is not an address and exports blank`, exportEmail(v) === "", exportEmail(v));

for (const v of ["Unknown", "N/A", "0", "-", "NULL", "none"])
  ok(`  text placeholder ${JSON.stringify(v)} exports blank`, exportText(v) === "", exportText(v));
// WHOLE-field only: a real name that merely contains a placeholder word is
// not a placeholder. This is the same trap the CRM-metadata Auto-DQ avoids.
for (const v of ["Nil Corp", "Unknown Pleasures Ltd", "None Such Brewing", "Zero Gravity Inc", "NA Trucking"])
  ok(`  a real company named ${JSON.stringify(v)} is NOT blanked`, exportText(v) === v, exportText(v));

console.log("\n=== a junk primary never shadows a good fallback ===");
{
  const HEAD3 = ['companyname','fullname','emailaddress1','telephone1','mobilephone','description'];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [HEAD3.join(','), [
    'Unknown', 'Ryan Suavet', '-', 'N/A', '9.18947E+11',
    'Dynamics 365 Business Central for 40 users, looking for an implementation partner',
  ].map(esc).join(',')].join('\n');
  const pp = [parseCSVText("j.csv", csv)];
  const prof = profileColumns(pp);
  const res = scan2(pp, { ...emptyRuleSet("keywords", "smc"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: [] } as never);
  ok('  the row still scans (hygiene does not drop leads)', res.rows.length === 1, String(res.rows.length));
  const r = res.rows[0];
  const e = toApolloRow(r) as unknown as Record<string, string>;
  ok('  a company literally named "Unknown" exports blank', e["Company Name"] === "", JSON.stringify(e["Company Name"]));
  ok('  an email of "-" exports blank', e.Email === "", JSON.stringify(e.Email));
  ok('  a phone of "N/A" exports blank', e["Work Direct Phone"] === "", JSON.stringify(e["Work Direct Phone"]));
  ok('  an Excel-mangled mobile exports blank', e["Mobile Phone"] === "", JSON.stringify(e["Mobile Phone"]));
  ok('  the real name still comes through', e["First Name"] === "Ryan" && e["Last Name"] === "Suavet", `${e["First Name"]}/${e["Last Name"]}`);

  // Per Jack: "the data being previewed in the scanner is what's
  // downloaded." The lead the table renders must equal the exported row,
  // so cleaning happens once at scan time rather than at export.
  console.log("\n=== preview equals download ===");
  ok('  previewed company === exported Company Name', r.lead.company === e["Company Name"], `${JSON.stringify(r.lead.company)} vs ${JSON.stringify(e["Company Name"])}`);
  ok('  previewed email === exported Email', r.lead.email === e.Email);
  ok('  previewed phone === exported Work Direct Phone', r.lead.phone === e["Work Direct Phone"]);
  ok('  previewed mobile === exported Mobile Phone', r.lead.mobilePhone === e["Mobile Phone"]);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
