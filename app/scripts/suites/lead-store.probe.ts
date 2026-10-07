// The lead store and the Apollo sync — pure logic, no browser.
//
// Per Jack: "we need to make this the source of truth for leads … from raw
// lead to finished lead in this library", and "once i upload the csv here
// going forward pull how many calls i have made to that contact from apollo
// and trellus and let me know every sequence its been assigned to current
// active on or finished and then i can filter through leads i may never
// have contacted yet."
//
// The matching rules here were settled by MEASUREMENT against the live
// Apollo account and the real 7,709-row CSP file, not by preference — see
// the "Apollo truncates the last name" block below, which is a real defect
// that a full-name key would have hit silently.
import {
  leadKeyOf, normCompany, mergeLeads, neverContacted, hasActiveSequence,
  hasFinishedSequence, sequenceNamesIn, outcomeSummary, buildLeadIndex,
  type LeadInput, type StoredLead,
} from "../../src/lib/leadStore";
import {
  parseSequenceCell, parseOutcomeCell, parseApolloSync, applyApolloSync,
  syncAgeDays, leadsToSync,
} from "../../src/lib/apolloSync";
import { parseCSVText } from "../../src/lib/csv";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d));
};
const lead = (o: Partial<LeadInput>): LeadInput => ({
  source: "main", company: "", contact: "", title: "", email: "", phone: "",
  mobilePhone: "", productArea: "", tier: "", notes: "", score: null,
  sourceFile: "f.csv", ...o,
});

console.log("=== the match key ===");
ok("an email is the key, case and space insensitive",
   leadKeyOf("  Ada@X.com ", "Ada Brant", "X Co") === leadKeyOf("ada@x.com", "", ""));
ok("  and it wins over the name fallback",
   leadKeyOf("ada@x.com", "Ada Brant", "X Co").startsWith("e:"));
ok("no email falls back to FIRST name + company",
   leadKeyOf("", "Ada Brant", "X Co") === leadKeyOf("", "Ada", "X Co"),
   `${leadKeyOf("", "Ada Brant", "X Co")} vs ${leadKeyOf("", "Ada", "X Co")}`);

// THE REAL DEFECT THIS GUARDS. A row scanned as "Josh Lewis" at Rosnet came
// back from the live Apollo account as name:"Josh" with NO last name. A
// full-name key misses it, silently, and the lead reads as never contacted.
ok("Apollo dropping the last name still matches (Josh Lewis -> Josh)",
   leadKeyOf("", "Josh Lewis", "Rosnet") === leadKeyOf("", "Josh", "Rosnet"));

ok("legal suffixes normalise away (LCF Systems, Inc. == LCF SYSTEMS)",
   normCompany("LCF Systems, Inc.") === normCompany("LCF SYSTEMS"),
   `${normCompany("LCF Systems, Inc.")} vs ${normCompany("LCF SYSTEMS")}`);
ok("  and LLC / Corp / Ltd too",
   normCompany("Acme LLC") === normCompany("Acme") && normCompany("Acme Corp") === normCompany("Acme"));
ok("different companies do NOT collide", normCompany("Acme") !== normCompany("Acne"));
ok("a row with neither an email nor a name+company cannot be keyed",
   leadKeyOf("", "", "") === "" && leadKeyOf("", "Ada", "") === "" && leadKeyOf("", "", "X Co") === "");
ok("  a placeholder without an @ is not treated as an email",
   leadKeyOf("none", "Ada", "X Co").startsWith("n:"));

console.log("\n=== merging uploads ===");
const first = mergeLeads([], [
  lead({ email: "a@x.com", contact: "Ada Brant", company: "X Co", tier: "Strong Signal", score: 70, notes: "first read" }),
  lead({ email: "b@y.com", contact: "Bo Hale", company: "Y Co", tier: "Needs Review" }),
  lead({ contact: "", company: "", notes: "unkeyable" }),
], "2026-01-01T00:00:00.000Z");
ok("new leads are added", first.added === 2, `added=${first.added}`);
ok("  an unkeyable row is skipped and counted, never silently dropped",
   first.skipped === 1 && first.leads.length === 2, `skipped=${first.skipped}`);
ok("  timesSeen starts at 1", first.leads.every((l) => l.timesSeen === 1));

const second = mergeLeads(first.leads, [
  // Same person, re-uploaded: a sparser file (no title) with a NEWER verdict.
  lead({ email: "a@x.com", contact: "Ada Brant", company: "X Co", tier: "Bad Lead", score: 12, notes: "second read", phone: "312-555-0100", sourceFile: "g.csv" }),
], "2026-02-01T00:00:00.000Z");
const ada = second.leads.find((l) => l.email === "a@x.com")!;
ok("a re-upload merges rather than duplicating", second.leads.length === 2 && second.added === 0 && second.updated === 1);
ok("  the NEWER scan verdict wins (tier, score, notes)",
   ada.tier === "Bad Lead" && ada.score === 12 && ada.notes === "second read",
   `${ada.tier}/${ada.score}/${ada.notes}`);
ok("  a newly supplied contact detail is filled in", ada.phone === "312-555-0100");
ok("  timesSeen increments", ada.timesSeen === 2, `${ada.timesSeen}`);
ok("  both source files are remembered",
   ada.sourceFiles.length === 2 && ada.sourceFiles.includes("g.csv"), ada.sourceFiles.join(","));
ok("  firstSeenAt is preserved, lastSeenAt moves",
   ada.firstSeenAt === "2026-01-01T00:00:00.000Z" && ada.lastSeenAt === "2026-02-01T00:00:00.000Z");

const sparse = mergeLeads(second.leads, [
  lead({ email: "a@x.com", contact: "Ada Brant", company: "X Co", phone: "", tier: "" }),
], "2026-03-01T00:00:00.000Z");
const ada2 = sparse.leads.find((l) => l.email === "a@x.com")!;
ok("a sparser later upload never blanks a filled contact field", ada2.phone === "312-555-0100");
ok("  nor blanks the tier when the new row states none", ada2.tier === "Bad Lead", ada2.tier);

const crossScanner = mergeLeads(second.leads, [
  lead({ source: "csp", email: "a@x.com", contact: "Ada Brant", company: "X Co", tier: "High priority" }),
], "2026-04-01T00:00:00.000Z");
ok("the same person seen by a different scanner stays ONE lead",
   crossScanner.leads.length === 2 && crossScanner.added === 0);
ok("  and carries the scanner that last saw them",
   crossScanner.leads.find((l) => l.email === "a@x.com")!.source === "csp");

console.log("\n=== sequence and outcome cells ===");
const seqs = parseSequenceCell("Jack Main Sequence:active:3; Carly Outbound Emails:finished");
ok("two sequences parse", seqs.length === 2, JSON.stringify(seqs));
ok("  name, status and step all read",
   seqs[0].name === "Jack Main Sequence" && seqs[0].status === "active" && seqs[0].step === 3);
ok("  a finished enrolment needs no step", seqs[1].status === "finished" && seqs[1].step === null);
ok("a bare sequence name reads as active",
   parseSequenceCell("Jack Main Sequence")[0].status === "active");
ok("empty segments are skipped, never invented as a nameless sequence",
   parseSequenceCell("; ;A;").length === 1);
ok("an empty cell yields no sequences", parseSequenceCell("").length === 0);

const outs = parseOutcomeCell("No Answer ×14; Left Voicemail x2; Gatekeeper / Front Desk");
ok("outcome counts parse with either multiplication sign",
   outs["No Answer"] === 14 && outs["Left Voicemail"] === 2, JSON.stringify(outs));
ok("  a bare outcome counts as one", outs["Gatekeeper / Front Desk"] === 1);
ok("  a slash in the outcome name survives", "Gatekeeper / Front Desk" in outs);
ok("an empty cell yields no outcomes", Object.keys(parseOutcomeCell("")).length === 0);

console.log("\n=== reading a sync file ===");
const syncCsv = [
  "Email,Name,Company,Sequences,Call Count,Outcomes,Last Outcome,Last Call",
  '"a@x.com","Ada Brant","X Co","Jack Main Sequence:active:3","17","No Answer ×14; Left Voicemail x2; Meeting Booked","Meeting Booked","2026-10-06"',
  '"","Josh","Rosnet","CSP Leads:finished","","Wrong Number","Wrong Number","2026-09-01"',
  '"zz@none.com","Zed Nobody","Z Co","Jack Main Sequence:active","4","No Answer ×4","No Answer","2026-10-01"',
  '"","",""',
].join("\n");
const sync = parseApolloSync([parseCSVText("sync.csv", syncCsv)]);
ok("every keyable row reads", sync.rows.length === 3, `${sync.rows.length}`);
ok("  the unkeyable row is counted, not dropped silently", sync.skipped === 1, `${sync.skipped}`);
ok("  a stated call count is used", sync.rows[0].callCount === 17, `${sync.rows[0].callCount}`);
ok("  with no stated count, the outcome tallies ARE the count",
   sync.rows[1].callCount === 1, `${sync.rows[1].callCount}`);
ok("  every column mapped", sync.unmapped.length === 0, sync.unmapped.join(","));

console.log("\n=== applying it to stored leads ===");
const stored = mergeLeads([], [
  lead({ email: "a@x.com", contact: "Ada Brant", company: "X Co" }),
  lead({ contact: "Josh Lewis", company: "Rosnet" }),          // no email, Apollo has "Josh"
  lead({ email: "never@x.com", contact: "Never Called", company: "N Co" }),
], "2026-05-01T00:00:00.000Z").leads;
const applied = applyApolloSync(stored, sync.rows, "2026-10-07T00:00:00.000Z");
ok("matched leads take the Apollo state", applied.matched === 2, `matched=${applied.matched}`);
ok("  including the one matched only by first name + company",
   !!applied.leads.find((l) => l.company === "Rosnet")!.apollo);
ok("  a sync row matching no stored lead is returned, not discarded",
   applied.unmatched.length === 1 && applied.unmatched[0].email === "zz@none.com");
ok("  a lead with no sync row keeps no Apollo state",
   !applied.leads.find((l) => l.email === "never@x.com")!.apollo);

const adaSynced = applied.leads.find((l) => l.email === "a@x.com")!;
ok("call count lands", adaSynced.apollo!.callCount === 17);
ok("  outcomes land", adaSynced.apollo!.outcomes["No Answer"] === 14);
ok("  the summary reads as context, not seventeen rows",
   outcomeSummary(adaSynced.apollo) === "No Answer ×14, Left Voicemail ×2, Meeting Booked",
   outcomeSummary(adaSynced.apollo));

// Replace, never merge — a re-sync must be able to CLEAR state that ended.
const resync = applyApolloSync(applied.leads, [{
  email: "a@x.com", contact: "Ada Brant", company: "X Co",
  sequences: [], callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "",
}], "2026-10-08T00:00:00.000Z");
const adaCleared = resync.leads.find((l) => l.email === "a@x.com")!;
ok("a re-sync REPLACES rather than accumulating",
   adaCleared.apollo!.sequences.length === 0 && adaCleared.apollo!.callCount === 0,
   JSON.stringify(adaCleared.apollo));
ok("  so a lead removed from its sequence stops reading as enrolled",
   !hasActiveSequence(adaCleared));
ok("a sync never disturbs the scan-derived fields",
   adaCleared.company === "X Co" && adaCleared.timesSeen === 1);

console.log("\n=== the filters Jack asked for ===");
const L = applied.leads;
ok("'active in a sequence' finds the active one",
   L.filter(hasActiveSequence).length === 1 && hasActiveSequence(L.find((l) => l.email === "a@x.com")!));
ok("'finished' finds the finished one, and is exclusive of active",
   L.filter(hasFinishedSequence).length === 1 && hasFinishedSequence(L.find((l) => l.company === "Rosnet")!));
ok("  a lead cannot be both active and finished",
   !L.some((l) => hasActiveSequence(l) && hasFinishedSequence(l)));
ok("'never contacted' is about CALLS, not enrolment",
   L.filter(neverContacted).length === 1 && neverContacted(L.find((l) => l.email === "never@x.com")!));
ok("  a lead IN a sequence with zero calls still reads never contacted",
   neverContacted({ ...L[0], apollo: { syncedAt: "x", sequences: [{ name: "S", status: "active", step: 1 }], callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "" } }));
ok("sequence names are listed for the filter",
   sequenceNamesIn(L).join("|") === "CSP Leads|Jack Main Sequence", sequenceNamesIn(L).join("|"));

console.log("\n=== staleness and ordering ===");
ok("nothing synced reads as null, not zero days", syncAgeDays(stored) === null);
ok("  a synced set reports its age in whole days",
   syncAgeDays(applied.leads, Date.parse("2026-10-10T00:00:00.000Z")) === 3,
   String(syncAgeDays(applied.leads, Date.parse("2026-10-10T00:00:00.000Z"))));
ok("  the NEWEST sync decides the age, not the oldest",
   syncAgeDays(resync.leads, Date.parse("2026-10-10T00:00:00.000Z")) === 2);
const order = leadsToSync(applied.leads);
ok("a bounded sync asks about the most recently seen leads first",
   order.length === 3 && order[0].lastSeenAt >= order[order.length - 1].lastSeenAt);
ok("the lead index keys every lead", buildLeadIndex(L).size === L.length);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
