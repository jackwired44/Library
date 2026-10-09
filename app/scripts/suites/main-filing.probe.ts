// Filing a Main Scanner batch into All leads. Per Jack, after a 22-file
// May-to-September backfill: "make sure the counts right and make sure they
// are stored in all leads".
import { receivedOnFromFileName, leadInputsFromDuplicates, NO_SIGNAL_TIER } from "../../src/lib/leadFiling";
import { rawFieldsOf, appendRow, appendSegment } from "../../src/lib/rawNotes";
import { mergeLeads, leadKeyOf, leadKeyOfInput, type LeadInput } from "../../src/lib/leadStore";
import { qualifyLeadInputs } from "../../src/lib/leadQualify";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

// File-name dates.
const now = new Date("2026-10-09T12:00:00");
const cases: [string, string | undefined][] = [
  ["Book(5-7-26).csv", "2026-05-07"],
  ["Book(9-20).csv", "2026-09-20"],
  ["Book9-14_1.csv", "2026-09-14"],
  ["Book(7-30-26(dont use)).csv", "2026-07-30"],
  ["Book(8-10-2026).csv", "2026-08-10"],
  ["Book(12-1).csv", "2025-12-01"],      // no year, would be in the future -> last year
  ["Book(Sheet83).csv", undefined],
  ["Book82626.csv", undefined],
  ["Book(2-30-26).csv", undefined],     // not a real day
  ["Book(13-1-26).csv", undefined],
];
for (const [name, want] of cases) {
  const got = receivedOnFromFileName(name, now);
  ok(`date from "${name}"`, got === want, `got ${got}`);
}

const inp = (o: Partial<LeadInput>): LeadInput => ({
  source: "main", company: "Acme", contact: "Dana Diaz", title: "", email: "dana@acme.com",
  phone: "", mobilePhone: "", productArea: "", tier: "", notes: "", score: null, sourceFile: "", ...o,
});

// "No signal" never demotes a real verdict, in either order.
let m = mergeLeads([], [
  inp({ tier: "High priority", productArea: "Dynamics 365", score: 70, sourceFile: "a.csv", notes: "Wants BC" }),
  inp({ tier: NO_SIGNAL_TIER, sourceFile: "b.csv" }),
]);
ok("scored then no-signal keeps the verdict", m.leads[0].tier === "High priority", m.leads[0].tier);
ok("…and still records both files", m.leads[0].sourceFiles.length === 2);
m = mergeLeads([], [inp({ tier: NO_SIGNAL_TIER, sourceFile: "b.csv" }), inp({ tier: "Bad Leads", sourceFile: "a.csv" })]);
ok("no-signal then scored takes the verdict", m.leads[0].tier === "Bad Leads");
m = mergeLeads([], [inp({ tier: "High priority" }), inp({ tier: "Low priority" })]);
ok("a newer REAL verdict still wins (newest scan wins)", m.leads[0].tier === "Low priority");
m = mergeLeads([], [inp({ tier: NO_SIGNAL_TIER }), inp({ tier: NO_SIGNAL_TIER })]);
ok("no-signal over no-signal is fine", m.leads[0].tier === NO_SIGNAL_TIER);

// Duplicate rows add a file and nothing else.
const keys = new Set([leadKeyOf("dana@acme.com", "Dana Diaz", "Acme")]);
const dup = { id: "d1", sourceFile: "c.csv", company: "Acme", contact: "Dana Diaz", title: "", email: "dana@acme.com", phone: "", mergedIntoSourceFile: "a.csv", groupSize: 2 };
const stray = { ...dup, id: "d2", email: "dana.other@acme.com" };
const dIn = leadInputsFromDuplicates([dup, stray], keys);
ok("a repeat with a key outside the batch is not filed", dIn.length === 1);
m = mergeLeads([], [inp({ tier: "High priority", score: 70, notes: "Wants BC", sourceFile: "a.csv" }), ...dIn]);
const L = m.leads[0];
ok("duplicate adds its file", L.sourceFiles.join() === "a.csv,c.csv", L.sourceFiles.join());
ok("duplicate keeps the tier", L.tier === "High priority");
ok("duplicate keeps the score", L.score === 70);
ok("duplicate adds no note", !/·.*·/.test(L.notes) && L.notes.endsWith("Wants BC"), L.notes);
ok("one lead, not two", m.leads.length === 1);

// Earliest file date wins.
m = mergeLeads([], [
  inp({ tier: "High priority", sourceFile: "Book(9-20).csv", receivedOn: receivedOnFromFileName("Book(9-20).csv", now) }),
  inp({ tier: NO_SIGNAL_TIER, sourceFile: "Book(5-7-26).csv", receivedOn: receivedOnFromFileName("Book(5-7-26).csv", now) }),
]);
ok("received = earliest file date", m.leads[0].receivedOn === "2026-05-07", m.leads[0].receivedOn);

// The CSV row behind every lead. Per Jack: "their csv upload data is
// attached to every lead".
const row = { fullname: "Dana Diaz", companyname: "Acme", Comments: "Wants Business Central", numberofemployees: "45", blank: "", nul: "NULL", __f: { x: 1 } };
const f = rawFieldsOf(row, "Wants Business Central")!;
ok("raw row keeps real columns", f.fullname === "Dana Diaz" && f.numberofemployees === "45");
ok("raw row drops the notes column (already a segment)", !("Comments" in f));
ok("raw row drops blanks, NULL and app fields", !("blank" in f) && !("nul" in f) && !("__f" in f));
let rec = appendRow(undefined, "k", { at: "2026-10-09", file: "a.csv", fields: f })!;
ok("first row stored", rec.rows!.length === 1);
ok("identical row from the same file is not stored twice", appendRow(rec, "k", { at: "2026-10-10", file: "a.csv", fields: f }) === null);
rec = appendRow(rec, "k", { at: "2026-10-10", file: "b.csv", fields: f })!;
ok("same row from another file IS stored (which files it was on)", rec.rows!.length === 2);
const withNote = appendSegment(rec, "k", { at: "2026-10-10", file: "b.csv", text: "new note" })!;
ok("adding a note keeps the rows", withNote.rows?.length === 2 && withNote.segments.length === 1);

// Per Jack: "i need to be able to save every lead from the uploads i dont
// want to miss any".
ok("no email + no company still keys on a phone", leadKeyOf("", "Sam Fox", "", "(312) 555-0199") === "p:3125550199");
ok("…else on a full name", leadKeyOf("", "Sam Fox", "", "") === "x:sam fox");
ok("a single word and nothing else is still unkeyable", leadKeyOf("", "Sam", "", "") === "");
ok("email still wins over everything", leadKeyOf("a@b.com", "Sam Fox", "B Co", "3125550199") === "e:a@b.com");
ok("first name + company is unchanged", leadKeyOf("", "Sam Fox", "Brandt Metals", "3125550199") === "n:sam|brandt metals");
ok("an input keys through its mobile when there is no work phone", leadKeyOfInput({ contact: "Al", mobilePhone: "312 555 0100" }) === "p:3125550100");
m = mergeLeads([], [inp({ email: "", company: "", contact: "Sam Fox", phone: "312-555-0199", tier: "Needs Review" })]);
ok("such a row is stored, not skipped", m.leads.length === 1 && m.skipped === 0);
const gate = qualifyLeadInputs([inp({ company: "Acme Managed Services LLC", email: "x@acme-it.com", tier: "High priority" })], []);
ok("the gate hands back the input it flagged, so it can still be stored", gate.discarded.length === 1 && gate.discarded[0].input?.company === "Acme Managed Services LLC", JSON.stringify(gate.discarded.map((d) => d.reason)));
m = mergeLeads([], [{ ...gate.discarded[0].input!, tier: "Bad Lead", notFit: "Competitor" }]);
ok("a not-fit lead is stored as a Bad Lead with its reason", m.leads[0].tier === "Bad Lead" && m.leads[0].notFit === "Competitor");

console.log(`main-filing ${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
