// Companies that are never a lead, on ANY scanner.
//
// Per Jack: "for any scanner if there ever is a company called contess
// remove it instantly". Confirmed with him before building: the match is
// EXACTLY "Contess", and the row is DROPPED OUTRIGHT rather than shown as
// a Bad Lead.
//
// The exactness is the whole safety of the rule, which is why half this
// suite is negative cases: Contessa is a real US frozen-food business and
// a prefix match would silently delete it with nothing on screen saying
// so. Nothing in any of Jack's uploaded files matches either spelling, so
// the data could not settle it and the question was asked rather than
// guessed.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, isBlockedCompany, BLOCKED_COMPANIES } from "../../src/lib/detection";
import {
  scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, reconciles,
} from "../../src/lib/scanner2";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d));
};
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;

console.log("=== the list itself ===");
ok("the blocklist is a list, so adding one later is data not code", Array.isArray(BLOCKED_COMPANIES));
ok("  and it holds the one name Jack asked for", BLOCKED_COMPANIES.includes("contess"), BLOCKED_COMPANIES.join(", "));

console.log("\n=== exact match, after normalising case / punctuation / legal suffix ===");
for (const blocked of [
  "Contess", "contess", "CONTESS", "  Contess  ", "Contess.",
  "Contess, Inc.", "Contess LLC", "Contess Inc", "Contess Corp", "Contess Co.",
]) ok(`blocked: "${blocked}"`, isBlockedCompany(blocked));

// The negative half. Each of these is a DIFFERENT company and must survive.
for (const safe of [
  "Contessa", "Contessa Foods", "Contessa Premium Foods", "The Contessa Group",
  "Hotel Contessa", "Contessi", "Contest Co", "Conte", "Contessa's Kitchen",
  "", "   ", "Acme Supply",
]) ok(`NOT blocked: "${safe || "(blank)"}"`, !isBlockedCompany(safe));

ok("null/undefined are not blocked and do not throw",
   !isBlockedCompany(null) && !isBlockedCompany(undefined));

console.log("\n=== Main Scanner: dropped before anything can see it ===");
const MAIN_ROWS = [
  ["Contess", "Looking at Dynamics 365 Business Central for 40 users."],        // would be Strong Signal
  ["Contessa Foods", "Looking at Dynamics 365 Business Central for 40 users."], // must survive
  ["Contess", "We sell office chairs."],                                        // would be a no-signal row
  ["Acme Supply", "Renewing Microsoft 365 E3 for 300 users this year."],        // untouched
];
const mainCsv = ["Company,Full Name,Title,Email,Phone,Comments"]
  .concat(MAIN_ROWS.map((r, i) =>
    [r[0], `P V${i}`, "IT Director", `p${i}@x${i}.com`, "312-555-0100", r[1]].map(q).join(","))).join("\n");
const res = scanParsedFiles([parseCSVText("t.csv", mainCsv)]);
const companies = res.results.map((r) => r.row.__f.company);

ok("a blocked company never reaches the results table",
   !companies.some((c) => /^contess$/i.test(String(c || ""))), companies.join(" | "));
ok("  even on a row that would otherwise be Strong Signal",
   !res.results.some((r) => /^contess$/i.test(String(r.row.__f.company || "")) && r.tier === "signal"));
ok("a blocked company never reaches the Non Relevant tab either",
   !res.noSignalRows.some((r) => /^contess$/i.test(String(r.company || ""))),
   res.noSignalRows.map((r) => r.company).join(" | "));
ok("Contessa Foods is untouched", companies.includes("Contessa Foods"), companies.join(" | "));
ok("every other lead is untouched", companies.includes("Acme Supply"), companies.join(" | "));
ok("the removal is counted, never silent", res.blockedRemoved === 2, `blockedRemoved=${res.blockedRemoved}`);
ok("rows read still balances: read = processed + no signal + duplicates + blocked",
   res.rowsScanned === res.results.length + res.noSignalRows.length + res.duplicatesRemoved + res.blockedRemoved,
   `${res.rowsScanned} vs ${res.results.length}+${res.noSignalRows.length}+${res.duplicatesRemoved}+${res.blockedRemoved}`);

console.log("\n=== Custom (SMC) and CSP: the same rule, through scan2 ===");
const S2_ROWS = [
  ["Contess", "Dynamics 365 Business Central renewal, 40 users, no partner assigned."],
  ["Contessa Foods", "Dynamics 365 Business Central renewal, 40 users, no partner assigned."],
  ["Acme Supply", "Microsoft 365 E3 renewal, 300 users."],
];
const s2Csv = ["customeridname,fullname,emailaddress1,telephone1,msp_forecastcomments"]
  .concat(S2_ROWS.map((r, i) =>
    [r[0], `P V${i}`, `p${i}@x${i}.com`, "312-555-0100", r[1]].map(q).join(","))).join("\n");

for (const kind of ["smc", "csp"] as const) {
  const parsed = [parseCSVText("t.csv", s2Csv)];
  const prof = profileColumns(parsed);
  const r2 = scan2(parsed, {
    ...emptyRuleSet(kind, kind),
    fields: guessFieldMapping(prof),
    notesColumns: guessNotesColumns(prof),
  });
  const names = r2.rows.map((r) => String(r.lead.company || ""));
  ok(`[${kind}] Contess is dropped outright`, !names.some((n) => /^contess$/i.test(n)), names.join(" | "));
  ok(`[${kind}] Contessa Foods survives`, names.some((n) => /contessa/i.test(n)), names.join(" | "));
  ok(`[${kind}] the removal is counted`, r2.blockedRemoved === 1, `blockedRemoved=${r2.blockedRemoved}`);
  ok(`[${kind}] the rowsRead invariant still balances`, reconciles(r2),
     `${r2.rowsRead} vs ${r2.rows.length}+${r2.duplicatesMerged}+${r2.blockedRemoved}`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
